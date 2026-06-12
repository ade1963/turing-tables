#!/usr/bin/env python3
"""Probe the live database to confirm firebase.rules.json is applied.

usage: check_rules.py [db-url]   (default: the skill's config.json)

Only touches /games/rulesprobe000. Legit writes must pass; malformed or
oversized writes and listing the whole /games node must be rejected.
"""

import copy
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "skill", "turing-tables-core", "scripts"))
import _lib  # noqa: E402

UID = "rulesprobe000"


def put(db, payload):
    req = urllib.request.Request(f"{db}/games/{UID}.json",
                                 data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"},
                                 method="PUT")
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status
    except urllib.error.HTTPError as err:
        return err.code


def get(db, path):
    try:
        with urllib.request.urlopen(f"{db}{path}", timeout=15) as res:
            return res.status
    except urllib.error.HTTPError as err:
        return err.code


def main():
    db = _lib.db_url(sys.argv[1] if len(sys.argv) > 1 else None)
    valid = _lib.GAMES["gomoku"]["init"]()

    extra_key = copy.deepcopy(valid)
    extra_key["evil"] = "x" * 4096
    huge_msg = copy.deepcopy(valid)
    huge_msg["chat"] = [{"by": "agent", "msg": "x" * 5000}]
    big_board = copy.deepcopy(valid)
    big_board["board"] = ["X"] * 200
    long_name = copy.deepcopy(valid)
    long_name["players"]["agent"]["name"] = "n" * 500

    checks = [
        ("valid game state accepted",       put(db, valid),        True),
        ("unknown top-level key rejected",  put(db, extra_key),    False),
        ("oversized chat msg rejected",     put(db, huge_msg),     False),
        ("200-cell board rejected",         put(db, big_board),    False),
        ("500-char player name rejected",   put(db, long_name),    False),
        ("junk document rejected",          put(db, {"lol": 1}),   False),
        ("listing all games rejected",      get(db, "/games.json"), False),
    ]

    failures = 0
    for label, status, want_ok in checks:
        ok = status == 200
        good = ok == want_ok
        failures += 0 if good else 1
        print(f"{'PASS' if good else 'FAIL'}  {label} (HTTP {status})")

    put(db, valid)  # leave the probe doc in a tiny valid state
    if failures:
        print(f"\n{failures} check(s) failed -- rules are probably "
              "not applied yet (Firebase console -> Realtime Database -> Rules).")
        sys.exit(1)
    print("\nAll checks passed -- validation rules are live.")


if __name__ == "__main__":
    main()
