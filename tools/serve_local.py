#!/usr/bin/env python3
"""Local test server: serves the site and saves submitted answers to a folder on disk.

Usage:
    python tools/serve_local.py [--port 8765] [--host 0.0.0.0] [--out ~/t1-study-local-responses]

While this server runs, config.js is served with save = POST to /save (also for preview links), so every
finished test run lands as a JSON file in --out. The config.js file on disk is not changed.
Keep --out outside the site folder so test answers are never deployed with the site.
"""
import argparse
import http.server
import json
import time
from functools import partial
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
OVERRIDE = b'\n;window.STUDY_CONFIG.save = { method: "post", postUrl: "/save", savePreview: true }; // added by serve_local.py\n'


class Handler(http.server.SimpleHTTPRequestHandler):
    out_dir: Path

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/config.js":
            body = (SITE / "config.js").read_bytes() + OVERRIDE
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/save":
            self.send_error(404)
            return
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            data = json.loads(raw)
            name = "_".join(str(data.get(k, "")) for k in ("part", "batch", "annotator")).replace("/", "")
        except ValueError:
            self.send_error(400, "not JSON")
            return
        path = self.out_dir / f"{name}_{time.strftime('%Y%m%d-%H%M%S')}.json"
        path.write_bytes(raw)
        print(f"saved {path}", flush=True)
        body = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--out", type=Path, default=Path.home() / "t1-study-local-responses")
    args = ap.parse_args()
    args.out = args.out.expanduser()
    args.out.mkdir(parents=True, exist_ok=True)
    Handler.out_dir = args.out
    server = http.server.ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=str(SITE)))
    print(f"serving {SITE} on http://{args.host}:{args.port}/  (answers -> {args.out})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
