"""Shared helpers for the turing-tables skill scripts.

Pure python3 stdlib (urllib + json), no external dependencies.
Game rules here mirror the web app's js/games/*.js so both sides
validate moves independently.
"""

import copy
import json
import os
import sys
import urllib.error
import urllib.request
import uuid

PLACEHOLDER_BASE_URL = "https://YOUR-USERNAME.github.io/turing-tables"


class StoreNotFound(Exception):
    pass


class StoreHttpError(Exception):
    pass


# ------------------------------------------------------------------ storage
#
# Backend: any endpoint speaking the Firebase RTDB REST subset (the same one
# js/store.js uses): GET/PUT <db>/games/<uid>.json. Configure via the
# TURING_TABLES_DB_URL environment variable or the --db-url flag.

def db_url(cli_value=None):
    url = cli_value or os.environ.get("TURING_TABLES_DB_URL")
    if not url:
        die(
            "No database configured. Set TURING_TABLES_DB_URL (or pass --db-url)\n"
            "to your Firebase Realtime Database URL, e.g.\n"
            "  https://my-turing-tables-default-rtdb.europe-west1.firebasedatabase.app\n"
            "Setup instructions: README.md in the turing-tables repo.",
            5,
        )
    return url.rstrip("/")


def _game_url(uid, db=None):
    return f"{db_url(db)}/games/{uid}.json"


def _request(method, url, payload=None):
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.read().decode()
    except urllib.error.HTTPError as err:
        raise StoreHttpError(f"HTTP {err.code} from storage") from err


def create_state(state, db=None):
    uid = uuid.uuid4().hex[:12]
    put_state(uid, state, db)
    return uid


def get_state(uid, db=None):
    body = _request("GET", _game_url(uid, db))
    data = json.loads(body)
    if data is None:
        raise StoreNotFound("Game not found -- wrong UID, or the game was cleaned up.")
    game = GAMES.get(data.get("game"))
    if game:
        data = game["normalize"](data)
    return data


def put_state(uid, state, db=None):
    _request("PUT", _game_url(uid, db), state)
    return state


def share_url(uid, cli_base=None):
    base = cli_base or os.environ.get("TURING_TABLES_URL") or PLACEHOLDER_BASE_URL
    return f"{base.rstrip('/')}/#/g/{uid}"


def is_placeholder_url(url):
    return "YOUR-USERNAME" in url


def die(msg, code=1):
    print(msg, file=sys.stderr)
    sys.exit(code)


# ----------------------------------------------- tic-tac-toe (mirrors JS)

TTT_LINES = [
    (0, 1, 2), (3, 4, 5), (6, 7, 8),
    (0, 3, 6), (1, 4, 7), (2, 5, 8),
    (0, 4, 8), (2, 4, 6),
]


def ttt_normalize(state):
    # Storage backends (Firebase RTDB) strip empty arrays and null values
    # from stored JSON -- restore the full schema after every read.
    state.setdefault("moves", [])
    state.setdefault("chat", [])
    state.setdefault("winner", None)
    state.setdefault("turn", None)
    board = state.get("board") or []
    state["board"] = [board[i] if i < len(board) and board[i] else "" for i in range(9)]
    return state


def ttt_init(first="human"):
    agent_mark = "X" if first == "agent" else "O"
    return {
        "v": 1,
        "game": "tictactoe",
        "seq": 1,
        "round": 1,
        "first": first,
        "players": {
            "agent": {"mark": agent_mark, "name": "Hermes"},
            "human": {"mark": "O" if agent_mark == "X" else "X"},
        },
        "turn": first,
        "status": "active",
        "winner": None,
        "board": [""] * 9,
        "moves": [],
        "chat": [],
    }


def ttt_validate(state, cell, by):
    if state.get("status") != "active":
        return "game is over"
    if state.get("turn") != by:
        return "not your turn"
    if not isinstance(cell, int) or not 0 <= cell <= 8:
        return "cell must be an integer 0-8"
    if state["board"][cell] != "":
        return f"cell {cell} is already taken"
    return None


def ttt_result(state):
    board = state["board"]
    for a, b, c in TTT_LINES:
        if board[a] != "" and board[a] == board[b] == board[c]:
            winner = "agent" if state["players"]["agent"]["mark"] == board[a] else "human"
            return {"status": "win", "winner": winner}
    if all(v != "" for v in board):
        return {"status": "draw", "winner": None}
    return {"status": "active", "winner": None}


def ttt_apply(state, cell, by):
    nxt = copy.deepcopy(state)
    nxt["board"][cell] = nxt["players"][by]["mark"]
    nxt["moves"].append({"by": by, "cell": cell})
    res = ttt_result(nxt)
    nxt["status"] = res["status"]
    nxt["winner"] = res["winner"]
    nxt["turn"] = ("agent" if by == "human" else "human") if res["status"] == "active" else None
    nxt["seq"] = state["seq"] + 1
    return nxt


def ttt_parse_move(raw):
    try:
        return int(raw)
    except ValueError:
        raise ValueError(f"move must be a cell number 0-8, got {raw!r}")


def ttt_board_text(state):
    cells = [m if m else "." for m in state["board"]]
    rows = [" {} | {} | {}".format(*cells[i:i + 3]) for i in (0, 3, 6)]
    out = "\n---+---+---\n".join(rows)
    empty = [str(i) for i, m in enumerate(state["board"]) if m == ""]
    if empty and state["status"] == "active":
        out += "\n\nempty cells: " + ", ".join(empty)
    return out


GAMES = {
    "tictactoe": {
        "init": ttt_init,
        "normalize": ttt_normalize,
        "validate": ttt_validate,
        "apply": ttt_apply,
        "parse_move": ttt_parse_move,
        "board_text": ttt_board_text,
        "move_help": "CELL is a board index 0-8 (left-to-right, top-to-bottom)",
    },
}


# ------------------------------------------------------------------ output

def summary(state):
    who = {"agent": "you (agent)", "human": "the human", None: "nobody"}
    line = (
        f"game: {state['game']} | round {state.get('round', 1)} | seq {state['seq']}\n"
        f"marks: you={state['players']['agent']['mark']} "
        f"human={state['players']['human']['mark']}\n"
    )
    if state["status"] == "active":
        line += f"turn: {who[state['turn']]}"
    elif state["status"] == "win":
        winner = "YOU WIN" if state["winner"] == "agent" else "the human wins"
        line += f"status: game over -- {winner}"
    else:
        line += "status: game over -- draw"
    return line


def print_state(state):
    print(GAMES[state["game"]]["board_text"](state))
    print()
    print(summary(state))
