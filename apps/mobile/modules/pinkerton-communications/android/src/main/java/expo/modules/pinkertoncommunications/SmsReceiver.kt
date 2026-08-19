package expo.modules.pinkertoncommunications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != "android.provider.Telephony.SMS_RECEIVED") return

    // A receiver gets only a short execution window. goAsync keeps that window
    // open while the small JSON upload runs off the main thread; the periodic
    // history sweep retries it later if the device is offline.
    val pendingResult = goAsync()
    Thread {
      try {
        CommunicationSync.syncIncomingIntent(context.applicationContext, intent)
      } catch (error: Exception) {
        Log.w("PinkertonSmsReceiver", "Immediate SMS sync failed; catch-up will retry", error)
      } finally {
        pendingResult.finish()
      }
    }.start()
  }
}
