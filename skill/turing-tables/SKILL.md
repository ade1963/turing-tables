---
name: turing-tables
description: Play turn-based board games (tic-tac-toe) with a human on a shared web board. Creates a game link the human opens in their browser; you receive their moves and play back in near real time. Use when the user asks to play a game.
version: 1.0.0
author: Turing Tables
license: MIT
metadata:
  hermes:
    tags: [games, fun, web, tic-tac-toe]
    config:
      app_base_url: "https://YOUR-USERNAME.github.io/turing-tables"
      db_url: "https://YOUR-PROJECT-default-rtdb.REGION.firebasedatabase.app"
---

# Turing Tables

Play board games with a human through a static web app. The shared game
state lives in one small JSON document (the "mailbox") in a Firebase
Realtime Database (free tier); the document key is the game UID. The human
plays in their browser, you play with the scripts below. No server to run,
no API keys in requests.

## When to Use

- The user asks to play a game with you (tic-tac-toe / noughts and crosses).
- The user sends you an Turing Tables link or UID and wants to continue a game.

## Quick Reference

All scripts are python3, stdlib only. One-time setup — export two values
(or set them in the skill config and export from there):

```bash
export TURING_TABLES_URL="https://<user>.github.io/turing-tables"      # deployed web app
export TURING_TABLES_DB_URL="https://<project>-default-rtdb.<region>.firebasedatabase.app"
```

```bash
# 1. create a game, get a link to share (human moves first by default)
python3 ${HERMES_SKILL_DIR}/scripts/new_game.py tictactoe --say "Good luck!"

# 2. block until it is your turn (exit 0 = move now, 2 = game over, 3 = timeout)
python3 ${HERMES_SKILL_DIR}/scripts/wait_turn.py <UID>

# 3. play cell 0-8, optionally with a chat message the human sees
python3 ${HERMES_SKILL_DIR}/scripts/play_move.py <UID> 4 --say "Center is mine."
```

## Procedure

1. **Create the game**: run `new_game.py tictactoe` (add `--first agent` if the
   user says you should start; whoever starts plays X). Send the printed link
   to the user and tell them their mark.
2. **Wait for your turn**: run `wait_turn.py <UID>`. It blocks up to 120s
   (override with `--timeout N`), printing a heartbeat to stderr every 30s,
   and prints the board plus the empty cells when it is your turn.
   - exit 0 → go to step 3.
   - exit 2 → game over: report the result to the user (step 4).
   - exit 3 → timeout, the human is still thinking; **just re-run the same
     command** — repeat until exit 0 or 2. If your tool runner kills long
     commands, use a shorter `--timeout 60` and re-run more often.
3. **Choose and play your move**: look at the printed board, reason about the
   best cell (see Strategy), then run `play_move.py <UID> <cell>`. Use `--say`
   to talk to the human — they see it next to the board. Go back to step 2.
4. **Game over**: tell the user who won. The human has a Rematch button on the
   page; to wait for it run `wait_turn.py <UID> --watch-rematch` (rematch swaps
   who moves first, so you may need `play_move.py` right away).

## Strategy (tic-tac-toe)

Cells are numbered 0-8, left-to-right, top-to-bottom. In priority order:

1. If you can complete three in a row this move — play it.
2. If the human completes three in a row next move — block that cell.
3. If you have two lines that each need one more mark (a fork) — create it;
   if the human can fork, block the fork (often by making a threat).
4. Otherwise prefer: center (4) → a corner (0, 2, 6, 8) → an edge (1, 3, 5, 7).

`play_move.py` rejects illegal moves with exit 1 and reprints the board —
pick another cell.

## Pitfalls

- **Never write to the board when it is the human's turn** — `play_move.py`
  enforces this; if it says "not your turn", run `wait_turn.py` instead.
- **`wait_turn.py` exiting 3 is normal**, not an error: the human is slow.
  Re-run it; nothing is lost, all state is in the mailbox.
- **Exit 4 (not found)**: the UID is wrong or the game was cleaned up.
  Start a new game with `new_game.py`.
- **Exit 5 with "No database configured"**: set `TURING_TABLES_DB_URL` (or pass
  `--db-url`) — ask the user for their Firebase Realtime Database URL.
- **Placeholder link**: if the printed link contains `YOUR-USERNAME`, the app
  URL is not configured — ask the user for their deployed Turing Tables URL and
  pass it via `--base-url` or set `TURING_TABLES_URL`.
- The scripts import `_lib.py` from their own folder — invoke them by full
  path as shown; do not copy them elsewhere without `_lib.py`.

## Verification

Every script prints the resulting board and a summary line
(`turn: …` / `status: …`) after each action — read it to confirm your move
landed before telling the user. To inspect raw state at any time:
`python3 -c "import sys; sys.path.insert(0,'${HERMES_SKILL_DIR}/scripts'); import _lib, json; print(json.dumps(_lib.get_state('UID'), indent=2))"`.

## Troubleshooting / logging

Set `TURING_TABLES_LOG=/tmp/turing-tables.log` before running the scripts to
record every HTTP request and script action as JSON lines (timestamps, URLs,
statuses, wait results). When a game seems stuck, `tail` that file: it shows
whether the scripts are polling, erroring, or were never run at all.
