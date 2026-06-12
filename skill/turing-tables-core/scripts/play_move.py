#!/usr/bin/env python3
"""Play the agent's move, then wait for the human and print the next position.

usage: play_move.py UID MOVE [--say MSG] [--no-wait] [--timeout SECONDS]
       (tic-tac-toe: MOVE is a cell index 0-8, left-to-right, top-to-bottom)

One call per turn: it publishes your move and blocks until it is your turn
again (or the game ends), so the output is always your next decision point.

exit codes: 0 = output shows your next position or the final result
            1 = illegal move / not your turn (state printed, pick again)
            3 = move played, but timed out waiting -- run wait_turn.py UID
            4 = game not found
            5 = storage error
"""

import argparse
import sys

import _lib


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("uid", help="game UID")
    parser.add_argument("move", help="game-specific move (tictactoe: cell 0-8)")
    parser.add_argument("--say", metavar="MSG", help="chat message shown to the human")
    parser.add_argument("--no-wait", action="store_true",
                        help="return right after publishing the move")
    parser.add_argument("--timeout", type=int, default=None, metavar="SECONDS",
                        help="max seconds to wait for the human "
                             "(default: config wait_timeout, else 120)")
    parser.add_argument("--db-url", metavar="URL",
                        help="storage database URL (overrides config.json)")
    args = parser.parse_args()
    if args.timeout is None:
        args.timeout = _lib.wait_timeout()

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
        _lib.chat_push(nxt, "agent", args.say)

    try:
        _lib.put_state(args.uid, nxt, db=args.db_url)
    except (_lib.StoreNotFound, _lib.StoreHttpError, OSError) as err:
        _lib.die(f"Could not publish the move: {err}", 5)

    _lib.log("move", uid=args.uid, move=args.move, seq=nxt["seq"],
             status=nxt["status"])
    print(f"Move played: {args.move}")
    print()
    _lib.print_state(nxt)

    if nxt["status"] != "active":
        print("\nGame over -- tell the human the result.")
        print(f"To wait for a rematch: wait_turn.py {args.uid} --watch-rematch")
        return
    if args.no_wait:
        print(f"\nNow it's the human's turn: run wait_turn.py {args.uid}")
        return

    state, code = _lib.wait_for_turn(args.uid, timeout=args.timeout,
                                     db=args.db_url)
    print()
    if code == 0:
        _lib.print_state(state)
        print(f"\nYour move: run play_move.py {args.uid} <move>")
        return
    if code == 2:
        _lib.print_state(state)
        print("\nGame over -- tell the human the result.")
        return
    print(f"Move was published, but the human hasn't answered in {args.timeout}s.",
          file=sys.stderr)
    print(f"Run wait_turn.py {args.uid} to keep waiting.", file=sys.stderr)
    sys.exit(3)


if __name__ == "__main__":
    main()
