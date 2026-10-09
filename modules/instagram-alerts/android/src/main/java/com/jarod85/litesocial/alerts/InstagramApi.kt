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
import java.net.URLEncoder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Calls Instagram's own web API (the one instagram.com uses) with the login
 * that lives in Lite Social's in-app browser.
 *
 * The session cookies are read from the WebView's cookie store, sent to
 * www.instagram.com only, and any cookies Instagram refreshes are written back,
 * just as the browser itself would. Nothing is stored anywhere else.
 *
 * Requests look like the in-app browser's own: its user agent, and the app id
 * and request tokens the instagram.com page hands that browser (see [tokens]).
 */
class InstagramApi private constructor(
  private val context: Context,
  private val cookies: String,
  private val csrfToken: String,
  private val userAgent: String,
) {
  /** The signed-in account's numeric id (Instagram's ds_user_id cookie). */
  val viewerId: String? = cookieValue(cookies, "ds_user_id")

  /** The tokens instagram.com's page carries; GraphQL and some POSTs need them. */
  data class Tokens(val appId: String?, val fbDtsg: String?, val lsd: String?) {
    /** Instagram's checksum of fb_dtsg, sent alongside it. */
    val jazoest: String? get() = fbDtsg?.let { "2" + it.sumOf { c -> c.code } }
  }

  private var cachedTokens: Tokens? = AlertPrefs.webTokens(context, viewerId)?.let(::parseTokens)

  private val appId: String
    get() = cachedTokens?.appId ?: WEB_APP_ID

  sealed class Failure(message: String) : Exception(message) {
    class NotLoggedIn : Failure("Not logged in. Open Instagram in Lite Social and log in.")
    class Checkpoint : Failure("Instagram wants you to confirm it's you. Open Instagram in Lite Social.")
    class RateLimited : Failure("Instagram asked to slow down (HTTP 429). The next check will try again.")
    class Http(val code: Int, detail: String = "") : Failure("HTTP $code" + if (detail.isNotEmpty()) " ($detail)" else "")
    class BadResponse(detail: String) : Failure("Unexpected response: $detail")
  }

  /** GET a path under https://www.instagram.com and parse its JSON. */
  @Throws(IOException::class, Failure::class)
  fun getJson(path: String, referer: String = "$BASE/"): JSONObject = json(send("GET", path, null, referer, emptyMap()))

  /** POST a form to a path under https://www.instagram.com and parse its JSON. */
  @Throws(IOException::class, Failure::class)
  fun postForm(path: String, form: Map<String, String>, referer: String = "$BASE/", headers: Map<String, String> = emptyMap()): JSONObject {
    val body = form.entries.joinToString("&") { (k, v) -> "${encode(k)}=${encode(v)}" }
    return json(send("POST", path, body, referer, headers + ("Content-Type" to "application/x-www-form-urlencoded")))
  }

  /**
   * A GraphQL query as instagram.com's own page runs it: a persisted query
   * named by its doc_id, with the page's request tokens.
   */
  @Throws(IOException::class, Failure::class)
  fun graphql(friendlyName: String, docId: String, variables: JSONObject, referer: String): JSONObject {
    val tokens = tokens()
    val fbDtsg = tokens.fbDtsg ?: throw Failure.BadResponse("instagram.com's page had no request token")
    val form = linkedMapOf(
      "av" to (viewerId ?: ""),
      "__a" to "1",
      "__comet_req" to "7",
      "fb_dtsg" to fbDtsg,
      "jazoest" to (tokens.jazoest ?: ""),
      "lsd" to (tokens.lsd ?: ""),
      "fb_api_caller_class" to "RelayModern",
      "fb_api_req_friendly_name" to friendlyName,
      "server_timestamps" to "true",
      "doc_id" to docId,
      "variables" to variables.toString(),
    )
    val headers = mapOf("X-FB-Friendly-Name" to friendlyName, "X-FB-LSD" to (tokens.lsd ?: ""))
    val json = postForm("/api/graphql", form, referer, headers)
    val error = json.optJSONArray("errors")?.optJSONObject(0)?.optString("message")?.ifBlank { "error" }
      ?: json.takeIf { it.has("error") }?.let { it.optString("errorSummary").ifBlank { "error ${it.opt("error")}" } }
    if (error != null) {
      // The page's tokens may have expired; the next check fetches new ones.
      forgetTokens()
      throw Failure.BadResponse("GraphQL: ${error.take(80)}")
    }
    return json
  }

  /**
   * The app id and request tokens embedded in instagram.com's page for this
   * browser, fetched with the session and kept for a few hours.
   */
  @Throws(IOException::class, Failure::class)
  fun tokens(): Tokens {
    cachedTokens?.takeIf { it.fbDtsg != null }?.let { return it }
    val (code, html) = send("GET", "/", null, "$BASE/", mapOf("Accept" to "text/html,application/xhtml+xml"), expectJson = false)
    if (code in 300..399) throw Failure.NotLoggedIn()
    if (code >= 400) throw Failure.Http(code, "instagram.com page")
    val tokens = Tokens(
      appId = find(html, APP_ID_PATTERNS),
      fbDtsg = find(html, DTSG_PATTERNS),
      lsd = find(html, LSD_PATTERNS),
    )
    cachedTokens = tokens
    AlertPrefs.setWebTokens(context, viewerId, JSONObject().apply {
      tokens.appId?.let { put("appId", it) }
      tokens.fbDtsg?.let { put("fbDtsg", it) }
      tokens.lsd?.let { put("lsd", it) }
    }.toString())
    return tokens
  }

  fun forgetTokens() {
    cachedTokens = null
    AlertPrefs.setWebTokens(context, null, null)
  }

  /** Sends a request and returns (status, body); handles redirects, login and rate-limit answers. */
  private fun send(
    method: String,
    path: String,
    body: String?,
    referer: String,
    headers: Map<String, String>,
    expectJson: Boolean = true,
  ): Pair<Int, String> {
    val connection = URL(BASE + path).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = method
      connection.instanceFollowRedirects = false // A redirect means "go log in".
      connection.connectTimeout = 15_000
      connection.readTimeout = 20_000
      connection.setRequestProperty("User-Agent", userAgent)
      connection.setRequestProperty("Cookie", cookies)
      connection.setRequestProperty("Accept", "*/*")
      connection.setRequestProperty("Accept-Language", "en-US,en;q=0.9")
      connection.setRequestProperty("Referer", referer)
      if (expectJson) {
        connection.setRequestProperty("X-IG-App-ID", appId)
        connection.setRequestProperty("X-CSRFToken", csrfToken)
        connection.setRequestProperty("X-ASBD-ID", ASBD_ID)
        connection.setRequestProperty("X-IG-WWW-Claim", AlertPrefs.wwwClaim(context) ?: "0")
        connection.setRequestProperty("X-Requested-With", "XMLHttpRequest")
        connection.setRequestProperty("Origin", BASE)
        connection.setRequestProperty("Sec-Fetch-Site", "same-origin")
        connection.setRequestProperty("Sec-Fetch-Mode", "cors")
        connection.setRequestProperty("Sec-Fetch-Dest", "empty")
      }
      headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
      if (body != null) {
        connection.doOutput = true
        connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      }

      val code = connection.responseCode
      storeCookies(connection)
      connection.getHeaderField("x-ig-set-www-claim")?.takeIf { it.isNotBlank() }?.let { AlertPrefs.setWwwClaim(context, it) }
      val text = (if (code >= 400) connection.errorStream else connection.inputStream)
        ?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
      if (code == 429) throw Failure.RateLimited()
      return code to text
    } finally {
      connection.disconnect()
    }
  }

  private fun json(response: Pair<Int, String>): JSONObject {
    val (code, body) = response
    if (code in 300..399) throw Failure.NotLoggedIn()
    // Some of Instagram's endpoints guard their JSON against being run as a script.
    val json = runCatching { JSONObject(body.removePrefix("for (;;);")) }.getOrNull()
    val message = json?.optString("message").orEmpty()
    when {
      message == "login_required" -> throw Failure.NotLoggedIn()
      message == "checkpoint_required" || message == "challenge_required" -> throw Failure.Checkpoint()
      code == 401 || code == 403 -> throw Failure.NotLoggedIn()
      code >= 400 -> throw Failure.Http(code, message.take(60))
      json == null -> throw Failure.BadResponse(if (body.trimStart().startsWith("<")) "a web page" else "not JSON")
    }
    return json!!
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
    /** instagram.com's public web app id, used until the page has told us the one it gives this browser. */
    private const val WEB_APP_ID = "936619743392459"
    /** Sent by instagram.com with every API call. */
    private const val ASBD_ID = "359341"

    internal val APP_ID_PATTERNS = listOf(
      Regex("\"X-IG-App-ID\"\\s*:\\s*\"(\\d{6,20})\""),
      Regex("\"appId\"\\s*:\\s*\"(\\d{6,20})\""),
      Regex("\"APP_ID\"\\s*:\\s*\"(\\d{6,20})\""),
    )
    internal val DTSG_PATTERNS = listOf(
      Regex("\\[\"DTSGInitialData\",\\[],\\{\"token\":\"([^\"]+)\""),
      Regex("\"dtsg\"\\s*:\\s*\\{\\s*\"token\"\\s*:\\s*\"([^\"]+)\""),
      Regex("name=\"fb_dtsg\"\\s+value=\"([^\"]+)\""),
    )
    internal val LSD_PATTERNS = listOf(
      Regex("\\[\"LSD\",\\[],\\{\"token\":\"([^\"]+)\""),
      Regex("\"lsd\"\\s*:\\s*\\{\\s*\"token\"\\s*:\\s*\"([^\"]+)\""),
    )

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

    fun find(text: String, patterns: List<Regex>): String? =
      patterns.firstNotNullOfOrNull { it.find(text)?.groupValues?.get(1) }

    private fun parseTokens(json: String): Tokens? = runCatching {
      val o = JSONObject(json)
      Tokens(o.optString("appId").ifEmpty { null }, o.optString("fbDtsg").ifEmpty { null }, o.optString("lsd").ifEmpty { null })
    }.getOrNull()

    private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")

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
