---
name: turing-tables-connect4
description: Play Connect 4 (four in a row) with a human on a shared web board. You create a game link, the human plays in their browser, you answer with one script call per turn. Use when the user asks to play Connect 4 / connect four / four in a row.
version: 1.2.0
license: MIT
metadata:
  hermes:
    tags: [games, fun, connect4]
---

# Connect 4 (Turing Tables)

The human clicks in a browser; you answer with python3 (stdlib-only) scripts
shared by all Turing Tables games. URLs, log file, and wait timeout come from
`config.json` next to the scripts — no environment variables needed.

```bash
S=${HERMES_SKILL_DIR}/../turing-tables-core/scripts

# 1. create a game and share the printed link with the human
python3 $S/new_game.py connect4 --say "Good luck!"

# 2. wait for the human's first move (exit 0 = your turn, 2 = game over, 3 = re-run me)
python3 $S/wait_turn.py <UID>

# 3. drop into a column 0-6; the script publishes it, then WAITS for the human
python3 $S/play_move.py <UID> 3 --say "Center column!"
```

Repeat step 3 — one call per turn — until the output says game over, then tell
the human the result. The human can click Rematch (score carries over; first
move alternates): wait for it with `wait_turn.py <UID> --watch-rematch`.

**CRITICAL — do not end your turn while a game is active.** The human plays
on the web board, NOT in chat: no chat message will arrive to wake you up.
After sharing the link, message the human, then immediately run `wait_turn.py`
in the same session; on every exit 3 re-run it. Only stop when the game is
over or the human says stop.

## Moves & strategy

The board is 7 columns (0-6) × 6 rows; your move is a COLUMN number and the
disc falls to the lowest free cell. The printout shows the grid with column
numbers and the open columns. Before each move, scan carefully:

1. Can you complete 4 in a row (horizontal, vertical, or diagonal)? Play it.
2. Can the human complete 4 next move? Block that column.
3. Avoid placing a disc that gives the human a winning cell directly above it.
4. Otherwise prefer the center column (3), then 2/4 — they touch the most lines.

A full column is rejected with exit 1 — pick another.

## Notes

- Waits block with heartbeats on stderr; **exit 3 is normal** — just re-run.
- Exit 4 = bad UID or deleted game: start a new one.
- Board chat messages from the human appear in the script output — reply
  with `--say`.
- Every request is appended to the log file from config.json.
