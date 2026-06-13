#!/usr/bin/env python3
"""Play an agent-vs-agent match and broadcast it for spectators to watch live.

usage: selfplay.py [game] [--a-name A --a-model M] [--b-name B --b-model M]
                   [--first a|b] [--delay SEC] [--max-moves N]
                   [--explore P] [--seed N]

Two built-in heuristic players take turns on a fresh listed game; every move
is published, so the printed watch link shows the match unfold in a browser
and replays afterwards. Pure stdlib, no LLM calls, no cost.

The move policy is `_lib.pick_move`. To stage a *real* model-vs-model match,
swap that for an LLM call (e.g. your reality-show match_runner + personas).

exit codes: 0 = match finished, 5 = storage error
"""

import argparse
import random
import sys
import time

import _lib


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("game", nargs="?", default="connect4",
                        choices=sorted(_lib.GAMES), help="game to play")
    parser.add_argument("--a-name", default="Blue", help="first player's name")
    parser.add_argument("--a-model", metavar="ID", help="first player's model id")
    parser.add_argument("--b-name", default="Gold", help="second player's name")
    parser.add_argument("--b-model", metavar="ID", help="second player's model id")
    parser.add_argument("--first", default="a", choices=["a", "b"],
                        help="who moves first (default: a)")
    parser.add_argument("--delay", type=float, default=1.5, metavar="SEC",
                        help="pause between moves so spectators can follow")
    parser.add_argument("--max-moves", type=int, default=None, metavar="N",
                        help="stop after N moves (default: play to the end)")
    parser.add_argument("--explore", type=float, default=0.12, metavar="P",
                        help="chance of a random (non-heuristic) move, for variety")
    parser.add_argument("--seed", type=int, default=None, help="RNG seed")
    parser.add_argument("--base-url", metavar="URL", help="web app base URL")
    parser.add_argument("--db-url", metavar="URL", help="storage database URL")
    args = parser.parse_args()

    rng = random.Random(args.seed)
    # A => agent slot, B => human slot (the engines key roles "agent"/"human").
    state = _lib.GAMES[args.game]["init"](first="agent" if args.first == "a" else "human")
    state["players"]["agent"].update(name=args.a_name, model=args.a_model)
    state["players"]["human"].update(name=args.b_name, model=args.b_model)
    state["listed"] = True
    state["wid"] = _lib.new_id()

    try:
        uid = _lib.create_state(state, db=args.db_url)
    except (_lib.StoreHttpError, OSError) as err:
        _lib.die(f"Could not create the match: {err}", 5)
    _lib.mirror_publish(state, kind="selfplay", db=args.db_url)

    label = {"agent": args.a_name, "human": args.b_name}
    print(f"{args.a_name} vs {args.b_name} -- {args.game}")
    print(f"Watch live: {_lib.share_watch_url(state['wid'], args.base_url)}")
    print()

    game = _lib.GAMES[args.game]
    moves = 0
    while state["status"] == "active":
        if args.max_moves is not None and moves >= args.max_moves:
            print(f"Stopped after {moves} moves (--max-moves).")
            break
        by = state["turn"]
        mv = _lib.pick_move(state, by, rng=rng, explore=args.explore)
        if mv is None:
            break
        state = game["apply"](state, mv, by)
        moves += 1
        try:
            _lib.put_state(uid, state, db=args.db_url)
        except (_lib.StoreNotFound, _lib.StoreHttpError, OSError) as err:
            _lib.die(f"Could not publish a move: {err}", 5)
        _lib.mirror_publish(state, kind="selfplay", db=args.db_url)
        print(f"move {moves}: {label[by]} -> {mv}")
        if args.delay > 0 and state["status"] == "active":
            time.sleep(args.delay)

    print()
    if state["status"] == "win":
        print(f"Result: {label[state['winner']]} wins in {moves} moves.")
    elif state["status"] == "draw":
        print(f"Result: draw after {moves} moves.")
    _lib.print_state(state)


if __name__ == "__main__":
    main()
