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
    parser.add_argument("--agent-name", default="Hermes", metavar="NAME",
                        help="your display name on the board (default: Hermes)")
    parser.add_argument("--model", metavar="ID",
                        help="your model id, shown to spectators (e.g. deepseek/deepseek-v4-flash)")
    parser.add_argument("--unlisted", action="store_true",
                        help="keep this game out of the public spectator lobby")
    parser.add_argument("--base-url", metavar="URL",
                        help="deployed web app base URL (or set TURING_TABLES_URL)")
    parser.add_argument("--db-url", metavar="URL",
                        help="storage database URL (or set TURING_TABLES_DB_URL)")
    args = parser.parse_args()

    state = _lib.GAMES[args.game]["init"](first=args.first)
    state["players"]["agent"]["name"] = args.agent_name
    state["players"]["agent"]["model"] = args.model
    state["listed"] = not args.unlisted
    state["wid"] = _lib.new_id()
    if args.say:
        _lib.chat_push(state, "agent", args.say)

    try:
        uid = _lib.create_state(state, db=args.db_url)
    except (_lib.StoreHttpError, OSError) as err:
        _lib.die(f"Could not create the game: {err}", 5)
    _lib.mirror_publish(state, db=args.db_url)

    url = _lib.share_url(uid, args.base_url)
    print(f"Created {args.game} game.")
    print(f"UID: {uid}")
    print()
    print("Share this link with the human player:")
    print(f"  {url}")
    if _lib.is_placeholder_url(url):
        print("  (!) base URL not configured -- set TURING_TABLES_URL or pass --base-url")
    if state["listed"]:
        print()
        print("Spectators can watch (read-only) at:")
        print(f"  {_lib.share_watch_url(state['wid'], args.base_url)}")
    print()
    _lib.print_state(state)
    print()
    if args.first == "agent":
        print(f"You move first: run play_move.py {uid} <move>")
    else:
        print(f"The human moves first: run wait_turn.py {uid}")


if __name__ == "__main__":
    main()
