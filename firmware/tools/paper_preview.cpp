// Render the e-paper layout on the host with the firmware's own code.
//
//   c++ -std=c++11 -I firmware/paper firmware/tools/paper_preview.cpp -o /tmp/paper_preview
//   /tmp/paper_preview /tmp/paper            # writes /tmp/paper-<scene>.ppm and prints the text dump
//   python3 firmware/tools/ppm2png.py /tmp/paper-morning.ppm
//
// Same PaperModel → same pixels as the device, so the layout is edited here
// and only confirmed on the panel.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "paper_gfx.h"
#include "layout.h"

static void writePpm(const PaperCanvas &cv, const char *path) {
  FILE *f = fopen(path, "wb");
  if (!f) { perror(path); return; }
  const int S = 3;   // 3x so the 5x7 is readable on a screen
  fprintf(f, "P6\n%d %d\n255\n", PAPER_W * S, PAPER_H * S);
  static const uint8_t RGB[4][3] = {{20, 18, 14}, {238, 232, 214}, {232, 190, 30}, {196, 40, 30}};
  for (int y = 0; y < PAPER_H * S; ++y)
    for (int x = 0; x < PAPER_W * S; ++x) fwrite(RGB[cv.get(x / S, y / S)], 1, 3, f);
  fclose(f);
}

static void fill(PaperModel &m) {
  memset(&m, 0, sizeof(m));
  strcpy(m.name, "Clive"); strcpy(m.variety, "russet"); strcpy(m.potatoId, "0002"); strcpy(m.claim, "BRK-7H2");
  m.dither = DITHER_COARSE; m.chosen = -1;
}

int main(int argc, char **argv) {
  const char *prefix = argc > 1 ? argv[1] : "/tmp/paper";
  static PaperCanvas cv;
  PaperModel m;
  char path[256];

  struct Scene { const char *name; void (*make)(PaperModel &); };
  static const Scene scenes[] = {
    {"morning", [](PaperModel &m) {
      fill(m); m.hasBulletin = true; m.no = 1; strcpy(m.edition, "MORNING");
      strcpy(m.headline, "THE NET IS LIVE.");
      strcpy(m.items[0], "Population: 14. All 14 are new. Nobody knows what they're doing. This is normal.");
      strcpy(m.items[1], "Today's Question: ketchup. Polls close at 18:00."); m.nItems = 2;
      strcpy(m.line, "You weren't here. I voted Hunt's. It's in the File."); }},
    {"evening", [](PaperModel &m) {
      fill(m); m.hasBulletin = true; m.no = 4; strcpy(m.edition, "EVENING");
      strcpy(m.headline, "AN INQUIRY, 9 TO 5 TO 3.");
      strcpy(m.items[0], "The inquiry has concluded. Findings: it was dropped.");
      strcpy(m.items[1], "Today: 5 potatoes left home, 1 in the dark, 0 shaken. The Net is calmer. Something is wrong."); m.nItems = 2;
      strcpy(m.line, "Four hours, forty-five minutes. I counted."); m.eyes = 1; m.showClaim = true; }},
    {"incident", [](PaperModel &m) {
      fill(m); m.hasBulletin = true; m.no = 3; strcpy(m.edition, "MORNING"); m.incident = true;
      strcpy(m.headline, "INCIDENT.");
      strcpy(m.items[0], "A potato was dropped at 09:12 in a region we will not name. It is fine. The Hands responsible have been noted.");
      strcpy(m.items[1], "All members: check your footing."); m.nItems = 2;
      strcpy(m.line, "I'm noting this."); strcpy(m.status, "NO NET"); }},
    {"question", [](PaperModel &m) {
      fill(m); m.hasBulletin = true; m.no = 1; strcpy(m.edition, "MORNING");
      strcpy(m.headline, "THE DROPPED POTATO IS RESTING.");
      strcpy(m.items[0], "Its neighbor has sent a pebble. The Net does not know what this means but it was kind."); m.nItems = 1;
      m.question = true; strcpy(m.qText, "Ketchup. Which would you least object to being served with?");
      strcpy(m.options[0], "HEINZ"); strcpy(m.options[1], "HUNT'S"); strcpy(m.options[2], "WHATEVER'S THERE"); m.nOptions = 3;
      m.cursor = 1; m.chosen = 2; }},
    {"nonet", [](PaperModel &m) { fill(m); m.name[0] = 0; strcpy(m.line, ""); strcpy(m.status, "JOIN POTATO-B458"); }},
  };
  for (const Scene &s : scenes) {
    s.make(m);
    PaperLog log;
    renderPaper(cv, m, &log);
    snprintf(path, sizeof(path), "%s-%s.ppm", prefix, s.name);
    writePpm(cv, path);
    printf("== %s  (%s, hash %08x)\n%s", s.name, path, (unsigned)cv.hash(), log.text);
  }
  // The 2x text dump, as the device prints it.

  scenes[0].make(m);
  renderPaper(cv, m, nullptr);
  dumpCanvas(cv, 2, [](const char *l) { puts(l); });
  return 0;
}
