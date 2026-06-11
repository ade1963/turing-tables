#!/usr/bin/env python3
"""Block until it is the agent's turn (or the game ends), then print the state.

usage: wait_turn.py UID [--timeout SECONDS] [--watch-rematch]

exit codes: 0 = your turn, make a move
            2 = game over (result printed)
            3 = timed out waiting — just re-run to keep waiting
            4 = game not found
            5 = storage error
"""

import argparse
import sys
import time

import _lib


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("uid", help="game UID")
    parser.add_argument("--timeout", type=int, default=120, metavar="SECONDS",
                        help="max seconds to wait (default: 120; exit 3 = re-run)")
    parser.add_argument("--watch-rematch", action="store_true",
                        help="keep waiting after game over (human may click Rematch)")
    parser.add_argument("--db-url", metavar="URL",
                        help="storage database URL (or set TURING_TABLES_DB_URL)")
    args = parser.parse_args()

    print(f"Waiting for the human (timeout {args.timeout}s, heartbeat every 30s)...",
          file=sys.stderr, flush=True)
    _lib.log("wait_start", uid=args.uid, timeout=args.timeout,
             watch_rematch=args.watch_rematch)

    deadline = time.monotonic() + args.timeout
    started = time.monotonic()
    last_beat = started
    errors = 0
    while True:
        try:
            state = _lib.get_state(args.uid, db=args.db_url)
            errors = 0
        except _lib.StoreNotFound as err:
            _lib.die(str(err), 4)
        except (_lib.StoreHttpError, OSError) as err:
            errors += 1
            if errors >= 5:
                _lib.die(f"Storage unreachable after {errors} attempts: {err}", 5)
            time.sleep(5)
            continue

        if state["status"] == "active" and state["turn"] == "agent":
            _lib.log("wait_done", uid=args.uid, result="your_turn", seq=state["seq"])
            _lib.print_state(state)
            print(f"\nYour move: run play_move.py {args.uid} <move>")
            return
        if state["status"] != "active" and not args.watch_rematch:
            _lib.log("wait_done", uid=args.uid, result="game_over", seq=state["seq"])
            _lib.print_state(state)
            print(f"\nTo wait for a rematch: wait_turn.py {args.uid} --watch-rematch")
            sys.exit(2)

        now = time.monotonic()
        if now - last_beat >= 30:
            print(f"... still waiting ({int(now - started)}s elapsed; "
                  f"seq {state['seq']}, turn: {state['turn']}, status: {state['status']})",
                  file=sys.stderr, flush=True)
            last_beat = now

        if now >= deadline:
            _lib.log("wait_done", uid=args.uid, result="timeout", seq=state["seq"])
            print(f"Timed out after {args.timeout}s -- the human hasn't moved yet.",
                  file=sys.stderr)
            print(f"Re-run wait_turn.py {args.uid} to keep waiting.", file=sys.stderr)
            sys.exit(3)

        # Poll fast at first, then back off.
        time.sleep(2 if time.monotonic() - started < 30 else 5)


if __name__ == "__main__":
    main()
