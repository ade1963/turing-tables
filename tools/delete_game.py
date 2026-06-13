#!/usr/bin/env python3
"""Delete a game and its public lobby mirror.

usage: delete_game.py UID [--wid WID] [--watch-only] [--db-url URL]

Removes the writable game at /games/UID and, if it has one, its read-only
spectator snapshot at /watch/<wid> (so it drops out of the lobby). Use this
to prune old or unwanted games without wiping the whole database.

  delete_game.py 917f8448cdc7              # delete a game + its mirror
  delete_game.py --watch-only --wid abcd…  # delete only a stray lobby entry

Requires the Firebase rules from firebase.rules.json (which allow DELETE).

exit codes: 0 = done, 2 = nothing to delete, 5 = storage error
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "skill", "turing-tables-core", "scripts"))
import _lib  # noqa: E402


def _req(method, url):
    req = urllib.request.Request(url, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, res.read().decode()
    except urllib.error.HTTPError as err:
        return err.code, ""
    except OSError as err:
        _lib.die(f"Storage unreachable: {err}", 5)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("uid", nargs="?", help="game UID to delete")
    parser.add_argument("--wid", help="watch/mirror id (auto-read from the game if omitted)")
    parser.add_argument("--watch-only", action="store_true",
                        help="delete only the /watch/<wid> mirror (needs --wid)")
    parser.add_argument("--db-url", metavar="URL", help="storage database URL")
    args = parser.parse_args()

    db = _lib.db_url(args.db_url)
    removed = []

    if args.watch_only:
        if not args.wid:
            _lib.die("--watch-only requires --wid", 1)
    else:
        if not args.uid:
            _lib.die("give a UID (or use --watch-only --wid WID)", 1)
        wid = args.wid
        if wid is None:  # discover the mirror id from the game itself
            status, body = _req("GET", f"{db}/games/{args.uid}.json")
            data = json.loads(body) if body else None
            if data:
                wid = data.get("wid")
        status, _ = _req("DELETE", f"{db}/games/{args.uid}.json")
        if status == 200:
            removed.append(f"games/{args.uid}")
        args.wid = wid

    if args.wid:
        status, _ = _req("DELETE", f"{db}/watch/{args.wid}.json")
        if status == 200:
            removed.append(f"watch/{args.wid}")

    if not removed:
        print("Nothing to delete (already gone?).")
        sys.exit(2)
    _lib.log("delete", removed=removed)
    print("Deleted: " + ", ".join(removed))


if __name__ == "__main__":
    main()
