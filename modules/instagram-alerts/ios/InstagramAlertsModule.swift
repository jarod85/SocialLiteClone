import ExpoModulesCore
import WebKit

/**
 The iOS side of Instagram notifications. The checking itself is TypeScript
 (src/features/instagramAlerts/checker); this makes its requests with the login of
 the in-app browser, like InstagramApi.kt does on Android.

 The browser's cookies are read here and never handed to JavaScript. Requests only ever
 go to https://www.instagram.com (the host is fixed here, the app passes just a path),
 and cookies Instagram refreshes are written back to the browser, as the browser would.
 */
public class InstagramAlertsModule: Module {
  private static let host = "www.instagram.com"

  private lazy var urlSession: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpShouldSetCookies = false  // The browser's cookies are set by hand, below.
    configuration.httpCookieAcceptPolicy = .never
    configuration.timeoutIntervalForRequest = 20
    return URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
  }()

  public func definition() -> ModuleDefinition {
    Name("InstagramAlerts")

    /** Whether the browser holds an Instagram login, and the account's id. */
    AsyncFunction("session") { () async -> [String: Any?] in
      let cookies = await Self.browserCookies()
      let loggedIn = cookies.contains { $0.name == "sessionid" && !$0.value.isEmpty }
      return ["loggedIn": loggedIn, "viewerId": cookies.first { $0.name == "ds_user_id" }?.value]
    }

    AsyncFunction("request") { (method: String, path: String, headers: [String: String], body: String?) async throws -> [String: Any] in
      guard path.hasPrefix("/"), let url = URL(string: "https://\(Self.host)\(path)"), url.host == Self.host else {
        throw InstagramPathException()
      }
      var request = URLRequest(url: url)
      request.httpMethod = method
      for (name, value) in headers where !["cookie", "host"].contains(name.lowercased()) {
        request.setValue(value, forHTTPHeaderField: name)
      }
      let cookies = await Self.browserCookies()
      request.setValue(cookies.map { "\($0.name)=\($0.value)" }.joined(separator: "; "), forHTTPHeaderField: "Cookie")
      if let csrf = cookies.first(where: { $0.name == "csrftoken" })?.value {
        request.setValue(csrf, forHTTPHeaderField: "X-CSRFToken")
      }
      request.httpBody = body?.data(using: .utf8)

      let (data, response) = try await self.urlSession.data(for: request)
      guard let http = response as? HTTPURLResponse else { throw InstagramPathException() }
      var fields: [String: String] = [:]
      for (key, value) in http.allHeaderFields {
        if let key = key as? String, let value = value as? String { fields[key.lowercased()] = value }
      }
      let refreshed = HTTPCookie.cookies(withResponseHeaderFields: http.allHeaderFields as? [String: String] ?? [:], for: url)
      if !refreshed.isEmpty { await Self.store(refreshed) }
      return ["status": http.statusCode, "body": String(decoding: data, as: UTF8.self), "headers": fields]
    }
  }

  /** The browser's cookies for www.instagram.com (the WebView's default store). */
  private static func browserCookies() async -> [HTTPCookie] {
    await withCheckedContinuation { done in
      DispatchQueue.main.async {
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { all in
          done.resume(returning: all.filter { cookie in
            let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
            return host == domain || host.hasSuffix(".\(domain)")
          })
        }
      }
    }
  }

  private static func store(_ cookies: [HTTPCookie]) async {
    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
      DispatchQueue.main.async {
        let store = WKWebsiteDataStore.default().httpCookieStore
        let group = DispatchGroup()
        for cookie in cookies {
          group.enter()
          store.setCookie(cookie) { group.leave() }
        }
        group.notify(queue: .main) { done.resume() }
      }
    }
  }
}

/** A redirect means "go log in" (as on Android): it is returned as is, not followed. */
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
  }
}

final class InstagramPathException: Exception, @unchecked Sendable {
  override var reason: String { "Only paths on www.instagram.com can be requested." }
}
