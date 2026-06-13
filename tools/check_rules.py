#!/usr/bin/env python3
"""Probe the live database to confirm firebase.rules.json is applied.

usage: check_rules.py [db-url]   (default: the skill's config.json)

Only touches /games/rulesprobe000 and /watch/rulesprobe000. Legit writes must
pass; malformed/oversized writes and listing the whole /games node must be
rejected, while listing /watch (the public lobby) must be allowed.
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


def put(db, path, payload):
    req = urllib.request.Request(f"{db}/{path}.json",
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


def watch_snapshot():
    return {
        "game": "gomoku", "status": "active", "turn": "agent", "seq": 2,
        "round": 1, "board": [""] * 81, "moves": [{"by": "human", "cell": 40}],
        "players": {"agent": {"name": "Blue", "model": "x/y", "mark": "X"},
                    "human": {"name": "Gold", "model": "p/q", "mark": "O"}},
        "kind": "selfplay", "updatedAt": 1700000000000,
    }


def main():
    db = _lib.db_url(sys.argv[1] if len(sys.argv) > 1 else None)
    valid = _lib.GAMES["gomoku"]["init"]()
    valid["wid"] = UID

    extra_key = copy.deepcopy(valid); extra_key["evil"] = "x" * 4096
    huge_msg = copy.deepcopy(valid); huge_msg["chat"] = [{"by": "agent", "msg": "x" * 5000}]
    big_board = copy.deepcopy(valid); big_board["board"] = ["X"] * 200
    long_name = copy.deepcopy(valid); long_name["players"]["agent"]["name"] = "n" * 500

    w_valid = watch_snapshot()
    w_big = copy.deepcopy(w_valid); w_big["board"] = ["X"] * 200
    w_extra = copy.deepcopy(w_valid); w_extra["secret"] = "x" * 4096

    g = f"games/{UID}"
    w = f"watch/{UID}"
    checks = [
        ("valid game state accepted",        put(db, g, valid),       True),
        ("unknown top-level key rejected",   put(db, g, extra_key),   False),
        ("oversized chat msg rejected",      put(db, g, huge_msg),    False),
        ("200-cell board rejected",          put(db, g, big_board),   False),
        ("500-char player name rejected",    put(db, g, long_name),   False),
        ("junk document rejected",           put(db, g, {"lol": 1}),  False),
        ("valid watch snapshot accepted",    put(db, w, w_valid),     True),
        ("oversized watch board rejected",   put(db, w, w_big),       False),
        ("unknown watch key rejected",       put(db, w, w_extra),     False),
        ("listing /watch (lobby) allowed",   get(db, "/watch.json?orderBy=%22updatedAt%22&limitToLast=5"), True),
        ("listing all games rejected",       get(db, "/games.json"),  False),
    ]

    failures = 0
    for label, status, want_ok in checks:
        ok = status == 200
        good = ok == want_ok
        failures += 0 if good else 1
        print(f"{'PASS' if good else 'FAIL'}  {label} (HTTP {status})")

    put(db, g, valid)        # leave the probe docs tiny + valid
    put(db, w, w_valid)
    if failures:
        print(f"\n{failures} check(s) failed -- rules are probably "
              "not applied yet (Firebase console -> Realtime Database -> Rules).")
        sys.exit(1)
    print("\nAll checks passed -- validation rules are live.")


if __name__ == "__main__":
    main()
