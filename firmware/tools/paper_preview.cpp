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

static void fill(PaperModel &m, const char *name, const char *variety, const char *id) {
  memset(&m, 0, sizeof(m));
  strcpy(m.name, name); strcpy(m.variety, variety); strcpy(m.potatoId, id); strcpy(m.claim, "JXN-BNW");
  m.chosen = -1;
}

int main(int argc, char **argv) {
  const char *prefix = argc > 1 ? argv[1] : "/tmp/paper";
  static PaperCanvas cv;
  PaperModel m;
  char path[256];

  struct Scene { const char *name; void (*make)(PaperModel &); };
  static const Scene scenes[] = {
    {"rosemary", [](PaperModel &m) { fill(m, "Rosemary", "red", "0002");
      strcpy(m.line, "You weren't here. I voted Hunt's. It's in the File."); }},
    {"question", [](PaperModel &m) { fill(m, "Rosemary", "red", "0002"); m.expression = 1;
      strcpy(m.line, "Ketchup. Which would you least object to being served with?");
      strcpy(m.options[0], "HEINZ"); strcpy(m.options[1], "HUNT'S"); strcpy(m.options[2], "WHATEVER'S THERE"); m.nOptions = 3; m.chosen = 1; }},
    {"aggrieved", [](PaperModel &m) { fill(m, "Clive", "russet", "0003"); m.expression = 2;
      strcpy(m.line, "Four hours, forty-five minutes. I counted."); strcpy(m.status, "NO NET"); }},
    {"asleep", [](PaperModel &m) { fill(m, "Doreen", "purple_majesty", "0001"); m.expression = 4; }},
    {"alarmed", [](PaperModel &m) { fill(m, "Edward", "king_edward", "0004"); m.alarmed = true; m.glance = true; m.showClaim = true;
      strcpy(m.line, "INCIDENT. A potato was dropped at 09:12."); }},
    {"nonet", [](PaperModel &m) { memset(&m, 0, sizeof(m)); m.chosen = -1; strcpy(m.joinAp, "POTATO-A8C4"); strcpy(m.joinFailSsid, "Fenton"); }},
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
