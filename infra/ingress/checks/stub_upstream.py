#!/usr/bin/env python3
"""Two stand-in upstreams for the ingress gate check (infra/ingress/checks/gate.sh).

    stub_upstream.py server   PORT   the server: GET /api/auth/verify
    stub_upstream.py scrapers PORT   the scrapers: anything else

server:   answers 204 to "Bearer good-token", 429 with Retry-After: 7 to "Bearer slow-down",
          401 to everything else, and remembers the X-Forwarded-Uri and X-Forwarded-Method
          the ingress sent with the question.
scrapers: answers 200 "scrapers <METHOD> <path>", remembers the Authorization header it
          received, and streams three NDJSON lines a second apart on /stream_article_text.
Both answer GET /__seen with what they have recorded, as JSON. Standard library only.
"""
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

role, port = sys.argv[1], int(sys.argv[2])
seen = {"calls": 0, "last": {}}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):  # quiet
        pass

    def reply(self, status, body=b"", headers=None):
        self.send_response(status)
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def handle_any(self):
        # Read the body even though nothing uses it: the connection is reused, and unread
        # bytes would be taken for the next request line.
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        if self.path == "/__seen":
            return self.reply(200, json.dumps(seen).encode(), {"Content-Type": "application/json"})
        seen["calls"] += 1
        if role == "server":
            seen["last"] = {
                "uri": self.headers.get("X-Forwarded-Uri"),
                "method": self.headers.get("X-Forwarded-Method"),
                "path": self.path,
            }
            token = self.headers.get("Authorization", "")
            if token == "Bearer good-token":
                return self.reply(204)
            if token == "Bearer slow-down":
                return self.reply(429, b'{"detail":"Too many requests"}', {"Retry-After": "7", "Content-Type": "application/json"})
            return self.reply(401, b'{"detail":"Missing or invalid authorization header"}', {"Content-Type": "application/json"})
        seen["last"] = {"authorization": self.headers.get("Authorization"), "path": self.path}
        if self.path.startswith("/stream_article_text"):
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            for n in range(3):
                line = json.dumps({"n": n}).encode() + b"\n"
                self.wfile.write(b"%x\r\n%s\r\n" % (len(line), line))
                self.wfile.flush()
                time.sleep(1)
            self.wfile.write(b"0\r\n\r\n")
            return
        self.reply(200, f"scrapers {self.command} {self.path}".encode(), {"Content-Type": "text/plain"})

    do_GET = do_POST = do_HEAD = handle_any


ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
