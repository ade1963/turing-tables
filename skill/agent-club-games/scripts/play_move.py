#!/usr/bin/env python3
"""Play the agent's move and publish the new state to the shared board.

usage: play_move.py UID MOVE [--say MSG]
       (tic-tac-toe: MOVE is a cell index 0-8, left-to-right, top-to-bottom)

exit codes: 0 = move played
            1 = illegal move / not your turn (state printed, pick again)
            4 = game not found
            5 = storage error
"""

import argparse
import sys

import _lib

MAX_CHAT = 8


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("uid", help="game UID")
    parser.add_argument("move", help="game-specific move (tictactoe: cell 0-8)")
    parser.add_argument("--say", metavar="MSG", help="chat message shown to the human")
    parser.add_argument("--db-url", metavar="URL",
                        help="storage database URL (or set AGENT_CLUB_DB_URL)")
    args = parser.parse_args()

    try:
        state = _lib.get_state(args.uid, db=args.db_url)
    except _lib.StoreNotFound as err:
        _lib.die(str(err), 4)
    except (_lib.StoreHttpError, OSError) as err:
        _lib.die(f"Storage unreachable: {err}", 5)

    game = _lib.GAMES.get(state["game"])
    if not game:
        _lib.die(f"Unsupported game in state: {state['game']!r}", 5)

    try:
        move = game["parse_move"](args.move)
    except ValueError as err:
        _lib.die(f"Bad move: {err}\n{game['move_help']}", 1)

    reason = game["validate"](state, move, "agent")
    if reason:
        print(f"Illegal move ({reason}). Current state:\n", file=sys.stderr)
        _lib.print_state(state)
        sys.exit(1)

    nxt = game["apply"](state, move, "agent")
    if args.say:
        nxt["chat"] = (nxt.get("chat") or [])[-(MAX_CHAT - 1):]
        nxt["chat"].append({"by": "agent", "msg": args.say})

    try:
        _lib.put_state(args.uid, nxt, db=args.db_url)
    except (_lib.StoreNotFound, _lib.StoreHttpError, OSError) as err:
        _lib.die(f"Could not publish the move: {err}", 5)

    print(f"Move played: {args.move}")
    print()
    _lib.print_state(nxt)
    print()
    if nxt["status"] == "active":
        print(f"Now it's the human's turn: run wait_turn.py {args.uid}")
    else:
        print("Game over -- tell the human the result.")
        print(f"To wait for a rematch: wait_turn.py {args.uid} --watch-rematch")


if __name__ == "__main__":
    main()
