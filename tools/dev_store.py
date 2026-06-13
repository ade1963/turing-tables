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
from urllib.parse import parse_qs, urlparse

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

    def _subtree(self, key):
        # Emulate Firebase: GET /watch.json returns {child: value} assembled
        # from the /watch/<child>.json keys stored separately.
        prefix = key[:-5] + "/"  # strip ".json", add "/"
        out = {}
        for k, v in DATA.items():
            if k.startswith(prefix) and k.endswith(".json"):
                child = k[len(prefix):-5]
                if "/" not in child:
                    out[child] = v
        return out or None

    def _apply_query(self, children):
        qs = parse_qs(urlparse(self.path).query)
        order = qs.get("orderBy", [None])[0]
        limit = qs.get("limitToLast", [None])[0]
        items = list(children.items())
        if order:
            field = order.strip('"')
            items.sort(key=lambda kv: (kv[1] or {}).get(field, 0))
        if limit:
            items = items[-int(limit):]
        return dict(items)

    def do_GET(self):
        key = self._key()
        if key is None:
            return self._respond(404, b'{"error":"path must end with .json"}')
        if key in DATA:
            body = DATA[key]
        else:
            body = self._subtree(key)
            if isinstance(body, dict):
                body = self._apply_query(body)
        self._respond(200, json.dumps(body).encode())

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
