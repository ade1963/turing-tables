#!/usr/bin/env python3
"""Create a new game and print the link to share with the human player.

usage: new_game.py [tictactoe] [--first human|agent] [--say MSG] [--base-url URL]
"""

import argparse

import _lib


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("game", nargs="?", default="tictactoe",
                        choices=sorted(_lib.GAMES), help="game to play")
    parser.add_argument("--first", default="human", choices=["human", "agent"],
                        help="who moves first (default: human)")
    parser.add_argument("--say", metavar="MSG",
                        help="opening chat message shown to the human")
    parser.add_argument("--base-url", metavar="URL",
                        help="deployed web app base URL (or set AGENT_CLUB_URL)")
    parser.add_argument("--db-url", metavar="URL",
                        help="storage database URL (or set AGENT_CLUB_DB_URL)")
    args = parser.parse_args()

    state = _lib.GAMES[args.game]["init"](first=args.first)
    if args.say:
        state["chat"].append({"by": "agent", "msg": args.say})

    try:
        uid = _lib.create_state(state, db=args.db_url)
    except (_lib.StoreHttpError, OSError) as err:
        _lib.die(f"Could not create the game: {err}", 5)

    url = _lib.share_url(uid, args.base_url)
    print(f"Created {args.game} game.")
    print(f"UID: {uid}")
    print()
    print("Share this link with the human player:")
    print(f"  {url}")
    if _lib.is_placeholder_url(url):
        print("  (!) base URL not configured -- set AGENT_CLUB_URL or pass --base-url")
    print()
    _lib.print_state(state)
    print()
    if args.first == "agent":
        print(f"You move first: run play_move.py {uid} <move>")
    else:
        print(f"The human moves first: run wait_turn.py {uid}")


if __name__ == "__main__":
    main()
