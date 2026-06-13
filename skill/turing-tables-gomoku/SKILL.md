---
name: turing-tables-gomoku
description: Play Gomoku (five in a row on a 9x9 board) with a human on a shared web board. You create a game link, the human plays in their browser, you answer with one script call per turn. Use when the user asks to play gomoku / five in a row / gobang / renju.
version: 1.3.0
license: MIT
metadata:
  hermes:
    tags: [games, fun, gomoku]
---

# Gomoku (Turing Tables)

The human clicks in a browser; you answer with python3 (stdlib-only) scripts
shared by all Turing Tables games. URLs, log file, and wait timeout come from
`config.json` next to the scripts — no environment variables needed.

```bash
S=${HERMES_SKILL_DIR}/../turing-tables-core/scripts

# 1. create a game and share the printed link with the human
python3 $S/new_game.py gomoku --say "Good luck!"

# 2. wait for the human's first move (exit 0 = your turn, 2 = game over, 3 = re-run me)
python3 $S/wait_turn.py <UID>

# 3. place a stone; the script publishes it, then WAITS for the human
python3 $S/play_move.py <UID> e5 --say "Center!"
```

Run every script with your terminal tool's timeout at its MAXIMUM (e.g.
timeout=600): they block on purpose and return the moment the human moves.

Repeat step 3 — one call per turn — until the output says game over, then tell
the human the result. The human can click Rematch (score carries over; first
move alternates): wait for it with `wait_turn.py <UID> --watch-rematch`.

**CRITICAL — do not end your turn while a game is active.** The human plays
on the web board, NOT in chat: no chat message will arrive to wake you up.
After sharing the link, message the human, then immediately run `wait_turn.py`
in the same session; on every exit 3 re-run it. Only stop when the game is
over, the human says stop, or the human disappears (see below).

## Moves & strategy

The board is 9×9; a move is a coordinate like `e5` — columns a-i left to
right, rows 1-9 top to bottom. Place a stone on any empty cell; FIVE in a
row (horizontal, vertical, or diagonal) wins. Read the printed grid
carefully and check, in order:

1. Can you complete five in a row? Play it.
2. Does the human have four in a row with an empty fifth cell? Block it now.
3. Does the human have an OPEN three (both ends empty)? Block one end —
   next move it becomes an unstoppable open four.
4. Otherwise extend your own longest line, keeping its ends open; in the
   opening stay near the center (e5 and neighbours).

An occupied cell is rejected with exit 1 — pick another.

## If the human leaves / resuming

After ~3 timed-out waits in a row with no move (~30 min), say goodbye on the
board — `python3 $S/say.py <UID> "Stepping away — message me to resume!"` —
tell the user the game is paused, and end your turn (the one exception to the
CRITICAL rule). To resume any paused or interrupted game later, just run
`python3 $S/wait_turn.py <UID>`: state is never lost.

## Notes

- Exit 3 (timeout) is normal — just re-run; heartbeats go to stderr.
- Exit 4 = bad UID or deleted game: start a new one.
- The human's board chat appears in script output — reply with `--say`, or
  `python3 $S/say.py <UID> "msg"` to chat without moving.
- Add `--agent-name <name>` / `--model <your-model-id>` to `new_game.py` so
  spectators see who they're watching; it prints a read-only watch link for
  the public lobby. Use `--unlisted` to keep a game private.
- Only the LATEST board printout matters: earlier boards in this conversation
  are obsolete — never rely on them, and they are safe to forget.
- Every request is appended to the log file from config.json.
