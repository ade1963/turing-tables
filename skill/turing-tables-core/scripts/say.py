#!/usr/bin/env python3
"""Post a chat message to the board without making a move.

usage: say.py UID MESSAGE

Useful while it is the human's turn: answer board chat, or say goodbye
when the human stopped answering. Does not change whose turn it is.

exit codes: 0 = sent, 4 = game not found, 5 = storage error
"""

import argparse

import _lib

MAX_CHAT = 8


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("uid", help="game UID")
    parser.add_argument("message", help="chat text shown on the board")
    parser.add_argument("--db-url", metavar="URL",
                        help="storage database URL (overrides config.json)")
    args = parser.parse_args()

    try:
        state = _lib.get_state(args.uid, db=args.db_url)
    except _lib.StoreNotFound as err:
        _lib.die(str(err), 4)
    except (_lib.StoreHttpError, OSError) as err:
        _lib.die(f"Storage unreachable: {err}", 5)

    state["chat"] = (state.get("chat") or [])[-(MAX_CHAT - 1):]
    state["chat"].append({"by": "agent", "msg": args.message})
    state["seq"] = state["seq"] + 1

    try:
        _lib.put_state(args.uid, state, db=args.db_url)
    except (_lib.StoreNotFound, _lib.StoreHttpError, OSError) as err:
        _lib.die(f"Could not send the message: {err}", 5)

    _lib.log("say", uid=args.uid, seq=state["seq"])
    print("Sent.")


if __name__ == "__main__":
    main()
