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
  fun describe(error: Throwable): String = when (error) {
    is UnknownHostException, is ConnectException -> "No connection."
    is SocketTimeoutException -> "YouTube took too long to answer."
    is AgeRestrictedContentException -> "This video is age-restricted and can't be watched without an account."
    is PrivateContentException -> "This video is private."
    is PaidContentException -> "This video is for paying members only."
    is GeographicRestrictionException -> "This video isn't available in your country."
    is SignInConfirmNotBotException, is ReCaptchaException ->
      "YouTube is asking this network to prove it isn't a bot. Try again later or on another network."
    is ContentNotAvailableException -> error.message?.substringAfter(": ")?.trim('"') ?: "This video isn't available."
    is IOException -> "Network problem: ${error.message ?: error.javaClass.simpleName}"
    else -> error.message?.take(200) ?: error.javaClass.simpleName
  }
}
