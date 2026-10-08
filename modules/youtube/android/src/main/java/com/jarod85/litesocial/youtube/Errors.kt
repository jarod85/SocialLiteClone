package com.jarod85.litesocial.youtube

import org.schabi.newpipe.extractor.exceptions.AgeRestrictedContentException
import org.schabi.newpipe.extractor.exceptions.ContentNotAvailableException
import org.schabi.newpipe.extractor.exceptions.GeographicRestrictionException
import org.schabi.newpipe.extractor.exceptions.PaidContentException
import org.schabi.newpipe.extractor.exceptions.PrivateContentException
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import org.schabi.newpipe.extractor.exceptions.SignInConfirmNotBotException
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** Short, human messages for what can go wrong talking to YouTube. */
object Errors {
  /** YouTube refused to answer this network (bot check or rate limit). */
  const val BLOCKED = "ERR_YOUTUBE_BLOCKED"
  /** No connection, or YouTube didn't answer in time. */
  const val OFFLINE = "ERR_YOUTUBE_OFFLINE"
  /** Private, paid, age-restricted or region-locked: no player can show it anonymously. */
  const val RESTRICTED = "ERR_YOUTUBE_RESTRICTED"
  /** Anything else, typically YouTube changing something the extractor reads. */
  const val OTHER = "ERR_YOUTUBE"

  fun isBlocked(error: Throwable): Boolean = error is SignInConfirmNotBotException || error is ReCaptchaException

  fun code(error: Throwable): String = when (error) {
    is UnknownHostException, is ConnectException, is SocketTimeoutException -> OFFLINE
    is SignInConfirmNotBotException, is ReCaptchaException -> BLOCKED
    is AgeRestrictedContentException, is PrivateContentException, is PaidContentException, is GeographicRestrictionException -> RESTRICTED
    else -> OTHER
  }

  fun describe(error: Throwable): String = when (error) {
    is UnknownHostException, is ConnectException -> "No connection."
    is SocketTimeoutException -> "YouTube took too long to answer."
    is AgeRestrictedContentException -> "This video is age-restricted and can't be watched without an account."
    is PrivateContentException -> "This video is private."
    is PaidContentException -> "This video is for paying members only."
    is GeographicRestrictionException -> "This video isn't available in your country."
    is SignInConfirmNotBotException, is ReCaptchaException ->
      "YouTube is asking this network to prove it isn't a bot. Try again later or on another network (for example mobile data instead of Wi-Fi)."
    is ContentNotAvailableException -> error.message?.substringAfter(": ")?.trim('"') ?: "This video isn't available."
    is IOException -> "Network problem: ${error.message ?: error.javaClass.simpleName}"
    else -> error.message?.take(200) ?: error.javaClass.simpleName
  }
}
