#!/usr/bin/env python3
"""Block until it is the agent's turn (or the game ends), then print the state.

usage: wait_turn.py UID [--timeout SECONDS] [--watch-rematch]

exit codes: 0 = your turn, make a move
            2 = game over (result printed)
            3 = timed out waiting -- just re-run to keep waiting
            4 = game not found
            5 = storage error
"""

import argparse
import sys

import _lib


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("uid", help="game UID")
    parser.add_argument("--timeout", type=int, default=None, metavar="SECONDS",
                        help="max seconds to wait (default: config wait_timeout, "
                             "else 120; exit 3 = re-run)")
    parser.add_argument("--watch-rematch", action="store_true",
                        help="keep waiting after game over (human may click Rematch)")
    parser.add_argument("--db-url", metavar="URL",
                        help="storage database URL (overrides config.json)")
    args = parser.parse_args()
    if args.timeout is None:
        args.timeout = _lib.wait_timeout()

    state, code = _lib.wait_for_turn(args.uid, timeout=args.timeout,
                                     watch_rematch=args.watch_rematch,
                                     db=args.db_url)
    if code == 0:
        _lib.print_state(state)
        print(f"\nYour move: run play_move.py {args.uid} <move>")
        return
    if code == 2:
        _lib.print_state(state)
        print(f"\nTo wait for a rematch: wait_turn.py {args.uid} --watch-rematch")
        sys.exit(2)
    print(f"Timed out after {args.timeout}s -- the human hasn't moved yet.",
          file=sys.stderr)
    print(f"Re-run wait_turn.py {args.uid} to keep waiting.", file=sys.stderr)
    sys.exit(3)


if __name__ == "__main__":
    main()
