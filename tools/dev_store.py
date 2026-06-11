#!/usr/bin/env python3
"""Offline stand-in for the storage backend (Firebase RTDB REST subset).

Lets you develop and test Turing Tables without internet or a Firebase project:

    python3 tools/dev_store.py [port]      # default port 8001

then set dbUrl in js/config.js (and TURING_TABLES_DB_URL for the skill scripts)
to http://localhost:8001. Implements, with CORS like Firebase:

    GET  /<path>.json  -> stored JSON, or null
    PUT  /<path>.json  -> stores the request body

State is in-memory only and lost on restart.
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DATA = {}


class Handler(BaseHTTPRequestHandler):
    def _respond(self, code, body=None):
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-cache")
        if body is not None:
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body is not None:
            self.wfile.write(body)

    def _key(self):
        path = self.path.split("?", 1)[0]
        return path if path.endswith(".json") else None

    def do_OPTIONS(self):
        self._respond(204)

    def do_GET(self):
        key = self._key()
        if key is None:
            return self._respond(404, b'{"error":"path must end with .json"}')
        self._respond(200, json.dumps(DATA.get(key)).encode())

    def do_PUT(self):
        key = self._key()
        if key is None:
            return self._respond(404, b'{"error":"path must end with .json"}')
        length = int(self.headers.get("Content-Length", 0))
        try:
            DATA[key] = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            return self._respond(400, b'{"error":"invalid JSON"}')
        self._respond(200, json.dumps(DATA[key]).encode())

    def log_message(self, fmt, *args):
        pass  # keep test output readable


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
    print(f"dev store listening on http://localhost:{port} (in-memory, CORS *)")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
