package com.jarod85.litesocial.alerts

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.WebSettings
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Calls Instagram's own web API (the one instagram.com uses) with the login
 * that lives in Lite Social's in-app browser.
 *
 * The session cookies are read from the WebView's cookie store, sent to
 * www.instagram.com only, and any cookies Instagram refreshes are written back,
 * just as the browser itself would. Nothing is stored anywhere else.
 */
class InstagramApi private constructor(
  private val context: Context,
  private val cookies: String,
  private val csrfToken: String,
  private val userAgent: String,
) {
  /** The signed-in account's numeric id (Instagram's ds_user_id cookie). */
  val viewerId: String? = cookieValue(cookies, "ds_user_id")

  sealed class Failure(message: String) : Exception(message) {
    class NotLoggedIn : Failure("Not logged in. Open Instagram in Lite Social and log in.")
    class Checkpoint : Failure("Instagram wants you to confirm it's you. Open Instagram in Lite Social.")
    class RateLimited : Failure("Instagram asked to slow down (HTTP 429). The next check will try again.")
    class Http(val code: Int) : Failure("HTTP $code")
    class BadResponse(detail: String) : Failure("Unexpected response: $detail")
  }

  /** GET a path under https://www.instagram.com and parse its JSON. */
  @Throws(IOException::class, Failure::class)
  fun getJson(path: String): JSONObject {
    val connection = URL(BASE + path).openConnection() as HttpURLConnection
    try {
      connection.instanceFollowRedirects = false // A redirect means "go log in".
      connection.connectTimeout = 15_000
      connection.readTimeout = 20_000
      connection.setRequestProperty("User-Agent", userAgent)
      connection.setRequestProperty("Cookie", cookies)
      connection.setRequestProperty("Accept", "*/*")
      connection.setRequestProperty("Accept-Language", "en-US,en;q=0.9")
      connection.setRequestProperty("Referer", "$BASE/")
      connection.setRequestProperty("X-IG-App-ID", WEB_APP_ID)
      connection.setRequestProperty("X-CSRFToken", csrfToken)
      connection.setRequestProperty("X-Requested-With", "XMLHttpRequest")

      val code = connection.responseCode
      storeCookies(connection)
      val body = (if (code >= 400) connection.errorStream else connection.inputStream)
        ?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""

      if (code in 300..399) throw Failure.NotLoggedIn()
      val json = runCatching { JSONObject(body) }.getOrNull()
      val message = json?.optString("message").orEmpty()
      when {
        message == "login_required" -> throw Failure.NotLoggedIn()
        message == "checkpoint_required" || message == "challenge_required" -> throw Failure.Checkpoint()
        code == 401 || code == 403 -> throw Failure.NotLoggedIn()
        code == 429 -> throw Failure.RateLimited()
        code >= 400 -> throw Failure.Http(code)
        json == null -> throw Failure.BadResponse(if (body.trimStart().startsWith("<")) "a web page" else "not JSON")
      }
      return json!!
    } finally {
      connection.disconnect()
    }
  }

  private fun storeCookies(connection: HttpURLConnection) {
    val setCookies = connection.headerFields.entries
      .filter { it.key.equals("Set-Cookie", ignoreCase = true) }
      .flatMap { it.value }
    if (setCookies.isEmpty()) return
    onMainThread {
      val manager = CookieManager.getInstance()
      setCookies.forEach { manager.setCookie(BASE, it) }
      manager.flush()
    }
  }

  companion object {
    private const val BASE = "https://www.instagram.com"
    /** instagram.com's public web app id, sent by the site with every API call. */
    private const val WEB_APP_ID = "936619743392459"

    /** Null when the in-app browser has no Instagram session. */
    fun create(context: Context): InstagramApi? {
      var cookies: String? = null
      var webViewUserAgent: String? = null
      onMainThread {
        cookies = CookieManager.getInstance().getCookie(BASE)
        webViewUserAgent = runCatching { WebSettings.getDefaultUserAgent(context) }.getOrNull()
      }
      val jar = cookies ?: return null
      if (cookieValue(jar, "sessionid").isNullOrEmpty()) return null
      val csrf = cookieValue(jar, "csrftoken") ?: ""
      return InstagramApi(context.applicationContext, jar, csrf, browserUserAgent(webViewUserAgent))
    }

    fun cookieValue(cookies: String, name: String): String? =
      cookies.split(';').map { it.trim() }.firstOrNull { it.startsWith("$name=") }?.substringAfter('=')

    /**
     * The same user agent the in-app browser sends (src/webview/userAgent.ts):
     * the device's WebView UA without its "this is a WebView" markers.
     */
    fun browserUserAgent(webViewUserAgent: String?): String {
      val ua = webViewUserAgent ?: return FALLBACK_USER_AGENT
      if (!ua.contains("Android") || !Regex("Chrome/\\d+").containsMatchIn(ua)) return FALLBACK_USER_AGENT
      return ua
        .replace(Regex(";\\s*wv(?=\\))"), "")
        .replace(Regex(" Build/[^;)]+"), "")
        .replace(Regex("Version/\\d+(?:\\.\\d+)* "), "")
        .replace(Regex("\\s{2,}"), " ")
        .trim()
    }

    private const val FALLBACK_USER_AGENT =
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"

    /** CookieManager and WebSettings belong to the WebView, which lives on the main thread. */
    private fun onMainThread(block: () -> Unit) {
      if (Looper.myLooper() == Looper.getMainLooper()) {
        block()
        return
      }
      val done = CountDownLatch(1)
      var error: Throwable? = null
      Handler(Looper.getMainLooper()).post {
        try {
          block()
        } catch (e: Throwable) {
          error = e
        } finally {
          done.countDown()
        }
      }
      if (!done.await(10, TimeUnit.SECONDS)) throw IOException("The browser's cookie store didn't respond")
      error?.let { throw IOException("Couldn't read the browser's cookie store", it) }
    }
  }
}
