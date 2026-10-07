package com.jarod85.litesocial.alerts

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * The periodic background check. WorkManager keeps it scheduled across app
 * restarts, updates and reboots, and only runs it with a network connection.
 * Android decides the exact timing (battery saver and Doze can delay it).
 */
class CheckWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    if (AlertPrefs.isEnabled(applicationContext)) InstagramChecker.run(applicationContext)
    // Always "success": a failed check is retried at the next interval, not in a tight loop.
    return Result.success()
  }

  companion object {
    private const val WORK_NAME = "instagram-alerts"

    fun schedule(context: Context) {
      val minutes = AlertPrefs.intervalMinutes(context).toLong()
      val request = PeriodicWorkRequest.Builder(CheckWorker::class.java, minutes, TimeUnit.MINUTES)
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .build()
      WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    fun cancel(context: Context) {
      WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }
  }
}
