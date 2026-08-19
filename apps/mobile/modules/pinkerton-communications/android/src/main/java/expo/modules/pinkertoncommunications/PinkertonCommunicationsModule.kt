package expo.modules.pinkertoncommunications

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class ContactSyncLink : Record {
  @Field
  val contactId: String = ""

  @Field
  val phoneNumber: String = ""
}

class PinkertonCommunicationsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PinkertonCommunications")

    AsyncFunction("configure") {
        apiBaseUrl: String,
        syncToken: String,
        deviceId: String,
        links: List<ContactSyncLink> ->
      val context =
        appContext.reactContext
          ?: throw IllegalStateException("Android application context is unavailable")
      CommunicationSync.saveConfiguration(
        context,
        apiBaseUrl,
        syncToken,
        deviceId,
        links.map { ContactLink(it.contactId, it.phoneNumber) }
      )
      mapOf("configuredContacts" to links.size)
    }

    AsyncFunction("clearConfiguration") {
      val context =
        appContext.reactContext
          ?: throw IllegalStateException("Android application context is unavailable")
      CommunicationSync.clearConfiguration(context)
    }

    // This sweep catches outgoing messages (Android provides no equivalent
    // outgoing-SMS broadcast) and retries incoming messages after an outage.
    // The endpoint's device/external unique key makes the overlap intentional.
    AsyncFunction("syncSmsSince") { sinceEpochMillis: Double ->
      val context =
        appContext.reactContext
          ?: throw IllegalStateException("Android application context is unavailable")
      CommunicationSync.syncHistorical(context, sinceEpochMillis.toLong())
    }
  }
}
