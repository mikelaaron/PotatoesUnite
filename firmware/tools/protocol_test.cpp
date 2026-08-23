// Host test for firmware/potato/protocol.h and pools.h: the wire format and
// the counted-duration words, checked without a board or a network.
//
//   AJ=$(arduino-cli config get directories.user)/libraries/ArduinoJson/src
//   c++ -std=c++11 -I firmware/potato -I "$AJ" firmware/tools/protocol_test.cpp -o /tmp/pt && /tmp/pt
#include <stdio.h>
#include <string.h>
#include "protocol.h"
#include "pools.h"

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { ++failures; printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #cond); } } while (0)
#define CHECK_STR(a, b) do { if (strcmp((a), (b)) != 0) { ++failures; printf("FAIL %s:%d \"%s\" != \"%s\"\n", __FILE__, __LINE__, (a), (b)); } } while (0)

int main() {
  // The stub's Question scene, as firmware/tools/stub_server.py sends it.
  const char *stubScene =
      "{\"rev\": 7, \"expression\": \"waiting\", \"line\": \"Ketchup. Which would you least object to?\", "
      "\"choices\": [{\"id\": \"heinz\", \"label\": \"HEINZ\"}, {\"id\": \"hunts\", \"label\": \"HUNT'S\"}, "
      "{\"id\": \"whatever\", \"label\": \"WHATEVER'S THERE\"}], \"cue\": \"none\", \"expires_at\": 1787488427, "
      "\"file_unread\": 2}";
  SceneData s;
  CHECK(parseScene(stubScene, s));
  CHECK(s.rev == 7);
  CHECK(s.expression == EXPR_WAITING);
  CHECK_STR(s.line, "Ketchup. Which would you least object to?");
  CHECK(s.nChoices == 3);
  CHECK_STR(s.choices[2].id, "whatever");
  CHECK_STR(s.choices[2].label, "WHATEVER'S THERE");
  CHECK(s.fileUnread == 2);
  CHECK(!s.hasRequest);

  // The protocol doc's full scene: request, bulletin (ignored here), cue.
  const char *docScene =
      "{\"rev\": 43, \"expression\": \"aggrieved\", \"line\": \"You weren't here. I voted Hunt's. It's in the File.\", "
      "\"choices\": [], \"cue\": \"throat_clear\", \"expires_at\": 1756036800, \"file_unread\": 3, "
      "\"request\": {\"id\": \"r81\", \"text\": \"Put me on my side for one minute.\", \"check\": \"orientation:side\", "
      "\"for_s\": 60, \"expires_at\": 1756003600}, "
      "\"bulletin\": {\"no\": 4, \"edition\": \"evening\", \"headline\": \"AN INQUIRY, 9 TO 5 TO 3.\", \"items\": [\"a\", \"b\"]}}";
  CHECK(parseScene(docScene, s));
  CHECK(s.rev == 43);
  CHECK(s.expression == EXPR_AGGRIEVED);
  CHECK(s.nChoices == 0);
  CHECK_STR(s.cue, "throat_clear");
  CHECK(s.hasRequest);
  CHECK_STR(s.requestId, "r81");
  CHECK_STR(s.requestCheck, "orientation:side");
  CHECK(s.requestForS == 60.0f);
  CHECK(s.requestExpiresAt == 1756003600u);

  // still:<s> carries its duration in the check.
  CHECK(parseScene("{\"rev\":1,\"request\":{\"id\":\"r2\",\"check\":\"still:1200\",\"text\":\"Leave me alone for twenty minutes.\"}}", s));
  CHECK(s.requestForS == 1200.0f);
  // A minimal scene and a bad one.
  CHECK(parseScene("{\"rev\":1,\"line\":\"Dark.\"}", s));
  CHECK(s.expression == EXPR_NEUTRAL && s.nChoices == 0);
  CHECK(!parseScene("{not json", s));

  // Heartbeat body: events drained with values, t from millis, t=0 unsynced.
  EventQueue q;
  q.push(1000, EV_PICKUP, 0);
  q.push(5000, EV_FACEDOWN_END, 17100);
  q.push(6000, EV_BATTERY_LOW, 20);
  q.push(7000, EV_REQUEST_DONE, 0, "r81");
  Event evs[EVENT_CAP];
  for (int i = 0; i < q.count; ++i) evs[i] = q.at(i);
  HeartbeatSnapshot snap = {63, true, true, "up", 14400, "quiet"};
  char body[1536];
  size_t n = buildHeartbeatJson("00ff", 42, snap, evs, q.count, 1756000010L, 10000, body, sizeof(body));
  CHECK(n > 0);
  JsonDocument back;
  CHECK(deserializeJson(back, body) == DeserializationError::Ok);
  CHECK_STR(back["secret"] | "", "00ff");
  CHECK((back["rev_seen"] | 0) == 42);
  CHECK((back["battery"]["pct"] | 0) == 63);
  CHECK((back["battery"]["charging"] | false) == true);
  CHECK_STR(back["orientation"] | "", "up");
  CHECK((back["since_handled_s"] | 0) == 14400);
  CHECK_STR(back["sound"] | "", "quiet");
  CHECK(back["events"].size() == 4);
  CHECK((back["events"][0]["t"] | 0L) == 1756000001L);          // 9s before now
  CHECK_STR(back["events"][1]["type"] | "", "facedown_end");
  CHECK((back["events"][1]["dur_s"] | 0) == 17100);
  CHECK((back["events"][2]["pct"] | 0) == 20);
  CHECK_STR(back["events"][3]["request_id"] | "", "r81");
  CHECK(back["temp_c"].isNull());
  n = buildHeartbeatJson("00ff", 0, snap, evs, 1, 0L, 10000, body, sizeof(body));
  CHECK(deserializeJson(back, body) == DeserializationError::Ok);
  CHECK((back["events"][0]["t"] | -1L) == 0L);                  // no clock yet

  n = buildRegisterJson("00ff", "amoled18", "0.1.0", body, sizeof(body));
  CHECK_STR(body, "{\"secret\":\"00ff\",\"board\":\"amoled18\",\"fw\":\"0.1.0\"}");
  n = buildChoiceJson("00ff", 7, "hunts", body, sizeof(body));
  CHECK_STR(body, "{\"secret\":\"00ff\",\"scene_rev\":7,\"choice_id\":\"hunts\"}");

  // Counted durations, in words.
  char w[48];
  durationWords(4 * 3600 + 45 * 60, w, sizeof(w)); CHECK_STR(w, "Four hours, forty-five minutes");
  durationWords(60, w, sizeof(w));                 CHECK_STR(w, "One minute");
  durationWords(40, w, sizeof(w));                 CHECK_STR(w, "Forty seconds");
  durationWords(2 * 86400 + 3 * 3600, w, sizeof(w)); CHECK_STR(w, "Two days, three hours");
  durationWords(3600, w, sizeof(w));               CHECK_STR(w, "One hour");

  // Pools: seed-stable opening, never the same line twice running.
  poolSeed = 123456789;
  const char *a = pickLine(POOL_PICKUP);
  const char *b = pickLine(POOL_PICKUP);
  CHECK(a != b);
  poolSeed = 123456789;
  memset(poolHist, 0, sizeof(poolHist));
  for (int i = 0; i < POOL_COUNT; ++i) poolLast[i] = -1;
  CHECK(pickLine(POOL_PICKUP) == a);

  // Every device line is at most 60 characters at its worst-case fill
  // (docs/COPY_REVIEW.md §1). Templates are filled with the longest value
  // their filler can produce: durations swept over a day and a fortnight
  // for "%s. I counted.", and "12 AM" for the night hour.
  {
    char longestDur[48] = ""; size_t longestLen = 0;
    for (uint32_t sec = 0; sec < 15 * 86400; sec += 60) {
      durationWords(sec, w, sizeof(w));
      if (strlen(w) > longestLen) { longestLen = strlen(w); strncpy(longestDur, w, sizeof(longestDur) - 1); }
    }
    printf("longest duration fill: \"%s\" (%u)\n", longestDur, (unsigned)longestLen);
    int checked = 0;
    auto checkLine = [&](const char *l, const char *where) {
      char filled[256];
      const char *at = strstr(l, "%s");
      if (at) {
        const char *fill = strstr(l, "counted") ? longestDur : "12 AM";
        snprintf(filled, sizeof(filled), "%.*s%s%s", (int)(at - l), l, fill, at + 2);
      } else {
        snprintf(filled, sizeof(filled), "%s", l);
      }
      // Count characters, not bytes: the ellipsis is one character.
      size_t chars = 0;
      for (const unsigned char *c = (const unsigned char *)filled; *c; ++c) if ((*c & 0xC0) != 0x80) ++chars;
      ++checked;
      if (chars > 60) { ++failures; printf("FAIL line over 60 (%u) in %s: \"%s\"\n", (unsigned)chars, where, filled); }
    };
    for (int i = 0; i < POOL_COUNT; ++i)
      for (int k = 0; k < POOLS[i].n; ++k) checkLine(POOLS[i].lines[k], "pool");
    for (int i = 0; i < ALL_SINGLE_LINES_N; ++i) checkLine(ALL_SINGLE_LINES[i], "single");
    printf("line length check: %d lines, all <= 60 at worst-case fill%s\n", checked, failures ? " (see FAIL above)" : "");
    CHECK(checked >= 60);
  }

  printf("%s: %d failure(s)\n", failures ? "FAILED" : "protocol_test passed", failures);
  return failures ? 1 : 0;
}
