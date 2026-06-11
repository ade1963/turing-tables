"""Shared helpers for the turing-tables skill scripts.

Pure python3 stdlib (urllib + json), no external dependencies.
Game rules here mirror the web app's js/games/*.js so both sides
validate moves independently.
"""

import copy
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

PLACEHOLDER_BASE_URL = "https://YOUR-USERNAME.github.io/turing-tables"

# Configuration sources, in priority order: CLI flag > environment variable >
# scripts/config.json. Agent shells often don't inherit exported variables,
# so config.json is the most reliable place (keys: app_url, db_url, log).
_CONFIG = None


def _config():
    global _CONFIG
    if _CONFIG is None:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
        try:
            with open(path, encoding="utf-8") as f:
                _CONFIG = json.load(f)
        except (OSError, ValueError):
            _CONFIG = {}
    return _CONFIG


def wait_timeout():
    """Default seconds a wait blocks before returning to the agent (exit 3).
    Each return costs a full-context LLM call, so set this as high as the
    agent's tool runner allows."""
    val = os.environ.get("TURING_TABLES_WAIT_TIMEOUT") or _config().get("wait_timeout")
    try:
        return int(val)
    except (TypeError, ValueError):
        return 120


def log(event, **fields):
    path = os.environ.get("TURING_TABLES_LOG") or _config().get("log")
    if not path:
        return
    rec = {"t": datetime.datetime.now().isoformat(timespec="seconds"),
           "event": event, **fields}
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
    except OSError:
        pass


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
    url = (cli_value or os.environ.get("TURING_TABLES_DB_URL")
           or _config().get("db_url"))
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
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            body = res.read().decode()
            log("http", method=method, url=url, status=res.status,
                ms=int((time.monotonic() - started) * 1000))
            return body
    except urllib.error.HTTPError as err:
        log("http_error", method=method, url=url, status=err.code)
        raise StoreHttpError(f"HTTP {err.code} from storage") from err
    except OSError as err:
        log("http_error", method=method, url=url, error=str(err))
        raise


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
    base = (cli_base or os.environ.get("TURING_TABLES_URL")
            or _config().get("app_url") or PLACEHOLDER_BASE_URL)
    return f"{base.rstrip('/')}/#/g/{uid}"


def is_placeholder_url(url):
    return "YOUR-USERNAME" in url


def die(msg, code=1):
    log("fatal", msg=msg, code=code)
    print(msg, file=sys.stderr)
    sys.exit(code)


def wait_for_turn(uid, timeout=120, watch_rematch=False, db=None):
    """Poll until it's the agent's turn (0) or the game is over (2) or
    timeout (3). Returns (state, code); state is None on timeout before
    the first successful read."""
    print(f"Waiting for the human (timeout {timeout}s, heartbeat every 30s)...",
          file=sys.stderr, flush=True)
    log("wait_start", uid=uid, timeout=timeout, watch_rematch=watch_rematch)
    deadline = time.monotonic() + timeout
    started = time.monotonic()
    last_beat = started
    errors = 0
    state = None
    while True:
        try:
            state = get_state(uid, db=db)
            errors = 0
        except StoreNotFound as err:
            die(str(err), 4)
        except (StoreHttpError, OSError) as err:
            errors += 1
            if errors >= 5:
                die(f"Storage unreachable after {errors} attempts: {err}", 5)
            time.sleep(5)
            continue

        if state["status"] == "active" and state["turn"] == "agent":
            log("wait_done", uid=uid, result="your_turn", seq=state["seq"])
            return state, 0
        if state["status"] != "active" and not watch_rematch:
            log("wait_done", uid=uid, result="game_over", seq=state["seq"])
            return state, 2

        now = time.monotonic()
        if now - last_beat >= 30:
            print(f"... still waiting ({int(now - started)}s elapsed; "
                  f"seq {state['seq']}, turn: {state['turn']}, status: {state['status']})",
                  file=sys.stderr, flush=True)
            last_beat = now
        if now >= deadline:
            log("wait_done", uid=uid, result="timeout",
                seq=state["seq"] if state else None)
            return state, 3
        time.sleep(2 if now - started < 30 else 5)


# ----------------------------------------------- tic-tac-toe (mirrors JS)

TTT_LINES = [
    (0, 1, 2), (3, 4, 5), (6, 7, 8),
    (0, 3, 6), (1, 4, 7), (2, 5, 8),
    (0, 4, 8), (2, 4, 6),
]


def _normalize_common(state, board_size):
    # Storage backends (Firebase RTDB) strip empty arrays and null values
    # from stored JSON -- restore the full schema after every read.
    state.setdefault("moves", [])
    state.setdefault("chat", [])
    state.setdefault("winner", None)
    state.setdefault("turn", None)
    score = state.get("score") or {}
    state["score"] = {k: score.get(k, 0) for k in ("agent", "human", "draws")}
    board = state.get("board") or []
    state["board"] = [board[i] if i < len(board) and board[i] else ""
                      for i in range(board_size)]
    return state


def _finish_move(state, nxt, by):
    """Shared post-move bookkeeping: result, turn flip, score, seq."""
    game = GAMES[nxt["game"]]
    res = game["result"](nxt)
    nxt["status"] = res["status"]
    nxt["winner"] = res["winner"]
    nxt["turn"] = ("agent" if by == "human" else "human") if res["status"] == "active" else None
    if res["status"] == "win":
        nxt["score"][res["winner"]] = nxt["score"].get(res["winner"], 0) + 1
    elif res["status"] == "draw":
        nxt["score"]["draws"] = nxt["score"].get("draws", 0) + 1
    nxt["seq"] = state["seq"] + 1
    return nxt


def ttt_normalize(state):
    return _normalize_common(state, 9)


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
        "score": {"agent": 0, "human": 0, "draws": 0},
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
    return _finish_move(state, nxt, by)


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


# -------------------------------------------------- connect 4 (mirrors JS)
#
# Board: flat 42-array, 7 columns x 6 rows, index = row*7 + col, row 0 = top.
# A move is a column 0-6; the disc falls to the lowest empty cell.

C4_COLS, C4_ROWS = 7, 6


def c4_normalize(state):
    return _normalize_common(state, C4_COLS * C4_ROWS)


def c4_init(first="human"):
    state = ttt_init(first)
    state["game"] = "connect4"
    state["board"] = [""] * (C4_COLS * C4_ROWS)
    return state


def c4_drop_row(board, col):
    """Lowest empty row in a column, or None if the column is full."""
    for row in range(C4_ROWS - 1, -1, -1):
        if board[row * C4_COLS + col] == "":
            return row
    return None


def c4_validate(state, col, by):
    if state.get("status") != "active":
        return "game is over"
    if state.get("turn") != by:
        return "not your turn"
    if not isinstance(col, int) or not 0 <= col < C4_COLS:
        return "column must be an integer 0-6"
    if c4_drop_row(state["board"], col) is None:
        return f"column {col} is full"
    return None


def c4_result(state):
    board = state["board"]
    for row in range(C4_ROWS):
        for col in range(C4_COLS):
            mark = board[row * C4_COLS + col]
            if mark == "":
                continue
            for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
                line = [(row + i * dr, col + i * dc) for i in range(4)]
                if all(0 <= r < C4_ROWS and 0 <= c < C4_COLS
                       and board[r * C4_COLS + c] == mark for r, c in line):
                    winner = ("agent" if state["players"]["agent"]["mark"] == mark
                              else "human")
                    return {"status": "win", "winner": winner,
                            "line": [r * C4_COLS + c for r, c in line]}
    if all(v != "" for v in board):
        return {"status": "draw", "winner": None}
    return {"status": "active", "winner": None}


def c4_apply(state, col, by):
    nxt = copy.deepcopy(state)
    row = c4_drop_row(nxt["board"], col)
    nxt["board"][row * C4_COLS + col] = nxt["players"][by]["mark"]
    nxt["moves"].append({"by": by, "col": col, "row": row})
    return _finish_move(state, nxt, by)


def c4_parse_move(raw):
    try:
        return int(raw)
    except ValueError:
        raise ValueError(f"move must be a column number 0-6, got {raw!r}")


def c4_board_text(state):
    board = state["board"]
    rows = []
    for row in range(C4_ROWS):
        cells = [board[row * C4_COLS + c] or "." for c in range(C4_COLS)]
        rows.append(" " + " ".join(cells))
    out = "\n".join(rows) + "\n " + " ".join(str(c) for c in range(C4_COLS))
    if state["status"] == "active":
        open_cols = [str(c) for c in range(C4_COLS)
                     if c4_drop_row(board, c) is not None]
        out += "\n\nopen columns: " + ", ".join(open_cols)
    return out


GAMES = {
    "tictactoe": {
        "init": ttt_init,
        "normalize": ttt_normalize,
        "validate": ttt_validate,
        "apply": ttt_apply,
        "result": ttt_result,
        "parse_move": ttt_parse_move,
        "board_text": ttt_board_text,
        "move_help": "CELL is a board index 0-8 (left-to-right, top-to-bottom)",
    },
    "connect4": {
        "init": c4_init,
        "normalize": c4_normalize,
        "validate": c4_validate,
        "apply": c4_apply,
        "result": c4_result,
        "parse_move": c4_parse_move,
        "board_text": c4_board_text,
        "move_help": "MOVE is a column 0-6; the disc falls to the lowest free cell",
    },
}


# ------------------------------------------------------------------ output

def summary(state):
    who = {"agent": "you (agent)", "human": "the human", None: "nobody"}
    score = state.get("score") or {}
    line = (
        f"game: {state['game']} | round {state.get('round', 1)} | seq {state['seq']}\n"
        f"marks: you={state['players']['agent']['mark']} "
        f"human={state['players']['human']['mark']} | "
        f"score you {score.get('agent', 0)} : {score.get('human', 0)} human"
        f" (draws {score.get('draws', 0)})\n"
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
    chat = state.get("chat") or []
    if chat:
        print("\nchat:")
        for m in chat[-3:]:
            who = state["players"]["agent"].get("name", "agent") \
                if m.get("by") == "agent" else "human"
            print(f"  {who}: {m.get('msg', '')}")
