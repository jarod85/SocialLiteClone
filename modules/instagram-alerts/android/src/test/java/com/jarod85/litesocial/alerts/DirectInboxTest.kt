package com.jarod85.litesocial.alerts

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DirectInboxTest {
  /** Shaped like instagram.com's PolarisDirectInboxQuery reply. */
  private val graphqlText =
    """
    {"data":{"get_slide_mailbox_for_iris_subscription":{"threads_by_folder":{"edges":[
      {"node":{"as_ig_direct_thread":{
        "thread_id":"340282366841710300949128100000000001","thread_key":"17840000000000001",
        "is_group":false,"is_muted":false,"marked_as_unread":false,
        "viewer":{"interop_messaging_user_fbid":"900","id":"17841400000000000"},
        "users":[{"interop_messaging_user_fbid":"901","id":"555","username":"jane.doe","full_name":"Jane Doe","profile_pic_url":"https://cdn/x.jpg"}],
        "slide_messages":{"edges":[
          {"node":{"content_type":"TEXT","content":{"text_body":"see you at 7?"},"sender_fbid":"901","timestamp_ms":"1791000002000"}},
          {"node":{"content_type":"REACTION_LOG_XMAT","sender_fbid":"900","timestamp_ms":"1791000001500"}},
          {"node":{"content_type":"TEXT","content":{"text_body":"hey"},"sender":{"id":"901"},"timestamp_ms":1791000001000}},
          {"node":{"content_type":"TEXT","content":{"text_body":"hi!"},"sender_fbid":"900","timestamp_ms":1791000000000}}
        ]}
      }}},
      {"node":{"as_ig_direct_thread":{
        "thread_id":"340282366841710300949128100000000002","is_group":true,"thread_title":"Climbing","is_muted":true,
        "viewer":{"interop_messaging_user_fbid":"900"},
        "users":[{"interop_messaging_user_fbid":"902","username":"sam"}],
        "slide_messages":{"edges":[
          {"node":{"content_type":"XMA","content":{"xma":{"target_url":"https://www.instagram.com/reel/abc/"}},"sender":{"user_dict":{"interop_messaging_user_fbid":"902","username":"sam"}},"timestamp_ms":"1791000003000"}}
        ]}
      }}}
    ]}}}}
    """
  private val graphql get() = JSONObject(graphqlText)

  @Test fun parsesGraphqlThreads() {
    val threads = DirectInbox.parseGraphql(graphql, "17841400000000000")
    assertEquals(2, threads.size)

    val dm = threads[0]
    assertEquals("340282366841710300949128100000000001", dm.id)
    assertEquals(listOf("see you at 7?", "hey"), dm.incoming.map { it.text })
    assertEquals("Jane Doe (@jane.doe)", dm.users[dm.incoming.first().senderId]?.name)
    assertEquals("https://cdn/x.jpg", dm.users[dm.incoming.first().senderId]?.picture)
    assertEquals(1791000002000L, dm.incoming.first().atMs)
    assertNull(dm.unread)

    val group = threads[1]
    assertTrue(group.isGroup)
    assertTrue(group.muted)
    assertEquals("Climbing", group.title)
    assertEquals("Shared a reel", group.incoming.single().text)
    assertEquals("@sam", group.users[group.incoming.single().senderId]?.name)
  }

  @Test fun nothingIncomingWhenYouWroteLast() {
    val json = JSONObject(graphqlText.replace("\"sender_fbid\":\"901\",\"timestamp_ms\":\"1791000002000\"", "\"sender_fbid\":\"900\",\"timestamp_ms\":\"1791000002000\""))
    assertTrue(DirectInbox.parseGraphql(json, null)[0].incoming.isEmpty())
  }

  @Test fun aSenderWhoIsNoParticipantIsYouWhenTheViewerIsMissing() {
    val json = JSONObject(graphqlText.replace("\"viewer\":{\"interop_messaging_user_fbid\":\"900\",\"id\":\"17841400000000000\"},", ""))
    val dm = DirectInbox.parseGraphql(json, "17841400000000000")[0]
    assertEquals(listOf("see you at 7?", "hey"), dm.incoming.map { it.text })
  }

  @Test fun parsesRestInbox() {
    val json = JSONObject(
      """
      {"viewer":{"pk":"100"},"inbox":{"threads":[
        {"thread_id":"340282366841710300949128100000000003","thread_title":"kim","is_group":false,
         "users":[{"pk":"200","username":"kim","full_name":""}],
         "last_seen_at":{"100":{"timestamp":"1791000000000000"}},
         "items":[
           {"user_id":"200","item_type":"text","text":"lunch?","timestamp":"1791000005000000"},
           {"user_id":"200","item_type":"media","media":{"media_type":2},"timestamp":1791000004000000}
         ]}
      ]}}
      """,
    )
    val thread = DirectInbox.parseRest(json, null).single()
    assertEquals(true, thread.unread)
    assertEquals(listOf("lunch?", "Sent a video"), thread.incoming.map { it.text })
    assertEquals(1791000005000L, thread.incoming.first().atMs)
    assertEquals("@kim", thread.users["200"]?.name)
  }

  @Test fun timestampsInAnyUnit() {
    assertEquals(1791000000000L, DirectInbox.millis("1791000000000000"))
    assertEquals(1791000000000L, DirectInbox.millis(1791000000000L))
    assertEquals(1791000000000L, DirectInbox.millis(1791000000))
    assertEquals(0L, DirectInbox.millis(null))
  }

  @Test fun findsPageTokens() {
    val html = """<script>["DTSGInitialData",[],{"token":"NAc:abc"},1]...["LSD",[],{"token":"lsd1"},2]..."X-IG-App-ID":"1217981644879628"</script>"""
    assertEquals("NAc:abc", InstagramApi.find(html, InstagramApi.DTSG_PATTERNS))
    assertEquals("lsd1", InstagramApi.find(html, InstagramApi.LSD_PATTERNS))
    assertEquals("1217981644879628", InstagramApi.find(html, InstagramApi.APP_ID_PATTERNS))
  }
}
