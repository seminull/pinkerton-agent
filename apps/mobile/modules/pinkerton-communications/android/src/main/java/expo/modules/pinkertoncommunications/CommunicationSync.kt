package expo.modules.pinkertoncommunications

import android.content.Context
import android.content.Intent
import android.provider.Telephony
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject

internal data class ContactLink(
  val contactId: String,
  val phoneNumber: String
)

private data class SyncConfiguration(
  val apiBaseUrl: String,
  val syncToken: String,
  val deviceId: String,
  val contactsByPhone: Map<String, String>
)

private data class SmsEvent(
  val externalId: String,
  val contactId: String,
  val direction: String,
  val occurredAtMillis: Long,
  val body: String,
  val counterpartyAddress: String
)

internal object CommunicationSync {
  private const val PREFERENCES_NAME = "pinkerton_communication_sync"
  private const val CONFIGURATION_KEY = "configuration"
  private const val CONNECT_TIMEOUT_MILLIS = 7_000
  private const val READ_TIMEOUT_MILLIS = 10_000
  private const val MAX_BATCH_EVENTS = 200

  fun saveConfiguration(
    context: Context,
    apiBaseUrl: String,
    syncToken: String,
    deviceId: String,
    links: List<ContactLink>
  ) {
    require(apiBaseUrl.startsWith("http://") || apiBaseUrl.startsWith("https://")) {
      "API URL must begin with http:// or https://"
    }
    require(syncToken.isNotBlank()) { "A mobile sync token is required" }
    require(deviceId.isNotBlank()) { "A device ID is required" }

    val contactLinks = JSONArray()
    links.forEach { link ->
      val phone = normalizePhone(link.phoneNumber)
      if (link.contactId.isNotBlank() && phone.isNotBlank()) {
        contactLinks.put(
          JSONObject()
            .put("contactId", link.contactId)
            .put("phoneNumber", phone)
        )
      }
    }
    val configuration =
      JSONObject()
        .put("apiBaseUrl", apiBaseUrl.trimEnd('/'))
        .put("syncToken", syncToken)
        .put("deviceId", deviceId)
        .put("links", contactLinks)

    // MODE_PRIVATE keeps the revocable device token inside this app's sandbox.
    // It is deliberately not an agent's reusable login credential.
    context
      .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(CONFIGURATION_KEY, configuration.toString())
      .apply()
  }

  fun clearConfiguration(context: Context) {
    context
      .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      .edit()
      .remove(CONFIGURATION_KEY)
      .apply()
  }

  fun syncHistorical(context: Context, sinceEpochMillis: Long): Map<String, Any> {
    val configuration = loadConfiguration(context)
      ?: throw IllegalStateException("SMS sync has not been configured")
    val projection =
      arrayOf(
        Telephony.Sms.ADDRESS,
        Telephony.Sms.BODY,
        Telephony.Sms.DATE,
        Telephony.Sms.TYPE
      )
    val events = mutableListOf<SmsEvent>()
    var newestSeenAt = sinceEpochMillis.coerceAtLeast(0)
    var examined = 0

    context.contentResolver
      .query(
        Telephony.Sms.CONTENT_URI,
        projection,
        "${Telephony.Sms.DATE} >= ?",
        arrayOf(sinceEpochMillis.coerceAtLeast(0).toString()),
        "${Telephony.Sms.DATE} ASC"
      )
      ?.use { cursor ->
        val addressIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
        val bodyIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)
        val dateIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)
        val typeIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.TYPE)

        while (cursor.moveToNext()) {
          examined += 1
          val occurredAt = cursor.getLong(dateIndex)
          newestSeenAt = maxOf(newestSeenAt, occurredAt)
          val address = cursor.getString(addressIndex) ?: continue
          val contactId =
            configuration.contactsByPhone[normalizePhone(address)] ?: continue
          val direction =
            when (cursor.getInt(typeIndex)) {
              Telephony.Sms.MESSAGE_TYPE_INBOX -> "incoming"
              Telephony.Sms.MESSAGE_TYPE_SENT -> "outgoing"
              else -> continue
            }
          val body = cursor.getString(bodyIndex) ?: ""
          events += createEvent(contactId, direction, occurredAt, address, body)
        }
      }

    val upload = upload(configuration, events)
    return mapOf(
      "examined" to examined,
      "matched" to events.size,
      "accepted" to upload.first,
      "duplicates" to upload.second,
      // Moving to "now" when the inbox had no rows avoids re-querying an empty
      // history forever. A one-second overlap protects messages arriving while
      // the cursor is open; duplicates are harmless at the server.
      "nextCursor" to maxOf(newestSeenAt, System.currentTimeMillis() - 1_000)
    )
  }

  fun syncIncomingIntent(context: Context, intent: Intent) {
    val configuration = loadConfiguration(context) ?: return
    if (configuration.contactsByPhone.isEmpty()) return

    // Multipart SMS segments share an address and timestamp. Combining before
    // fingerprinting keeps one logical text from becoming several CRM rows.
    val grouped = linkedMapOf<String, MutableList<String>>()
    val details = mutableMapOf<String, Pair<String, Long>>()
    Telephony.Sms.Intents.getMessagesFromIntent(intent).forEach { message ->
      val address = message.displayOriginatingAddress ?: return@forEach
      val timestamp = message.timestampMillis
      val key = "$address|$timestamp"
      grouped.getOrPut(key) { mutableListOf() }.add(message.displayMessageBody ?: "")
      details[key] = address to timestamp
    }

    val events =
      grouped.mapNotNull { (key, parts) ->
        val (address, timestamp) = details[key] ?: return@mapNotNull null
        val contactId =
          configuration.contactsByPhone[normalizePhone(address)] ?: return@mapNotNull null
        createEvent(contactId, "incoming", timestamp, address, parts.joinToString(""))
      }
    upload(configuration, events)
  }

  private fun loadConfiguration(context: Context): SyncConfiguration? {
    val raw =
      context
        .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        .getString(CONFIGURATION_KEY, null)
        ?: return null
    val json = JSONObject(raw)
    val contactsByPhone = mutableMapOf<String, String>()
    val links = json.getJSONArray("links")
    for (index in 0 until links.length()) {
      val link = links.getJSONObject(index)
      contactsByPhone[link.getString("phoneNumber")] = link.getString("contactId")
    }
    return SyncConfiguration(
      apiBaseUrl = json.getString("apiBaseUrl"),
      syncToken = json.getString("syncToken"),
      deviceId = json.getString("deviceId"),
      contactsByPhone = contactsByPhone
    )
  }

  private fun createEvent(
    contactId: String,
    direction: String,
    occurredAtMillis: Long,
    address: String,
    body: String
  ): SmsEvent {
    val normalizedAddress = normalizePhone(address)
    val fingerprint =
      sha256("$direction|$occurredAtMillis|$normalizedAddress|${sha256(body)}")
    return SmsEvent(
      externalId = "android-sms:$fingerprint",
      contactId = contactId,
      direction = direction,
      occurredAtMillis = occurredAtMillis,
      body = body,
      counterpartyAddress = address
    )
  }

  private fun upload(
    configuration: SyncConfiguration,
    events: List<SmsEvent>
  ): Pair<Int, Int> {
    if (events.isEmpty()) return 0 to 0
    var accepted = 0
    var duplicates = 0
    events.chunked(MAX_BATCH_EVENTS).forEach { batch ->
      val result = uploadBatch(configuration, batch)
      accepted += result.first
      duplicates += result.second
    }
    return accepted to duplicates
  }

  private fun uploadBatch(
    configuration: SyncConfiguration,
    events: List<SmsEvent>
  ): Pair<Int, Int> {
    val root = configuration.apiBaseUrl.trimEnd('/')
    val endpoint =
      if (root.endsWith("/api")) {
        "$root/communications/sync"
      } else {
        "$root/api/communications/sync"
      }
    val body = JSONObject().put("deviceId", configuration.deviceId)
    val jsonEvents = JSONArray()
    events.forEach { event ->
      jsonEvents.put(
        JSONObject()
          .put("externalId", event.externalId)
          .put("contactId", event.contactId)
          .put("channel", "sms")
          .put("direction", event.direction)
          .put("occurredAt", Instant.ofEpochMilli(event.occurredAtMillis).toString())
          .put("body", event.body)
          .put("counterpartyAddress", event.counterpartyAddress)
      )
    }
    body.put("events", jsonEvents)

    val connection = URL(endpoint).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "POST"
      connection.connectTimeout = CONNECT_TIMEOUT_MILLIS
      connection.readTimeout = READ_TIMEOUT_MILLIS
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "application/json")
      connection.setRequestProperty(
        "Authorization",
        "Bearer ${configuration.syncToken}"
      )
      connection.outputStream.bufferedWriter(Charsets.UTF_8).use { writer ->
        writer.write(body.toString())
      }

      val status = connection.responseCode
      val responseStream =
        if (status in 200..299) connection.inputStream else connection.errorStream
      val response = responseStream?.bufferedReader()?.use { it.readText() }.orEmpty()
      if (status !in 200..299) {
        throw IllegalStateException("Pinkerton sync returned HTTP $status: $response")
      }
      val json = JSONObject(response)
      return json.optInt("accepted", 0) to json.optInt("duplicates", 0)
    } finally {
      connection.disconnect()
    }
  }

  private fun normalizePhone(value: String): String {
    val digits = value.filter(Char::isDigit)
    // The CRM currently stores North American numbers in human formatting.
    // Preserve non-NANP country codes so two international contacts do not
    // collapse onto the same last ten digits.
    return if (digits.length == 11 && digits.startsWith("1")) digits.takeLast(10) else digits
  }

  private fun sha256(value: String): String {
    val bytes = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
    return bytes.joinToString("") { byte -> "%02x".format(byte) }
  }
}
