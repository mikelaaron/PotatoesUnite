#!/usr/bin/env python3
"""Tiny protocol-v0 stand-in for firmware bring-up. No state, no world.

    python3 firmware/tools/stub_server.py [port]

Answers /v0/register with a fixed potato, /v0/heartbeat and /v0/choice with a
fixed Question scene, and logs every body it receives so the device's events
and battery can be read off the terminal.
"""
import json, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
REV = 7

def scene(line, choices=True, cue="none"):
    return {
        "rev": REV, "expression": "waiting", "line": line,
        "choices": [{"id": "heinz", "label": "HEINZ"},
                    {"id": "hunts", "label": "HUNT'S"},
                    {"id": "whatever", "label": "WHATEVER'S THERE"}] if choices else [],
        "cue": cue, "expires_at": int(time.time()) + 36000, "file_unread": 2,
    }

class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quieter than the default access log
        pass
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        print(time.strftime("%H:%M:%S"), self.path, json.dumps(body), flush=True)
        if self.path == "/v0/register":
            out = {"potato_id": "0417", "name": "Doreen", "variety": "russet",
                   "seed": 123456789, "claim_code": "BRK-7H2"}
        elif self.path == "/v0/heartbeat":
            out = scene("Ketchup. Which would you least object to?")
        elif self.path == "/v0/choice":
            out = scene("%s. Noted. It's in the File." % body.get("choice_id", "?").upper(), choices=False)
            out["rev"] = REV + 1
        else:
            self.send_response(404); self.end_headers(); return
        data = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

print("stub potato server on :%d" % PORT, flush=True)
HTTPServer(("0.0.0.0", PORT), H).serve_forever()
