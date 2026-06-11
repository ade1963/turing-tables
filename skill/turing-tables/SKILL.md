---
name: turing-tables
description: Play board games (tic-tac-toe) with a human on a shared web board. You create a game link, the human plays in their browser, you answer with script calls. Use when the user asks to play a game.
version: 1.1.0
license: MIT
metadata:
  hermes:
    tags: [games, fun, web, tic-tac-toe]
---

# Turing Tables

You play board games against a human. They click in a browser; you use three
python3 (stdlib-only) scripts. URLs and the log file are read from
`scripts/config.json` — no environment variables, no exports needed.

## How to play

```bash
S=${HERMES_SKILL_DIR}/scripts

# 1. create a game and share the printed link with the human
python3 $S/new_game.py tictactoe --say "Good luck!"

# 2. wait for the human's first move (exit 0 = your turn, 2 = game over, 3 = re-run me)
python3 $S/wait_turn.py <UID>

# 3. play a cell; the script publishes it, then WAITS and prints your next position
python3 $S/play_move.py <UID> 4 --say "Center!"
```

Repeat step 3 — one call per turn — until the output says game over, then
tell the human the result. To wait for the human to click Rematch:
`wait_turn.py <UID> --watch-rematch` (rematch swaps who moves first).

**CRITICAL — do not end your turn while a game is active.** The human plays
on the web board, NOT in chat: no chat message will arrive to wake you up.
After sharing the link, message the human, then immediately run
`wait_turn.py` in the same session, and on every exit 3 re-run it (tell the
human you're still waiting every few timeouts). Only stop waiting when the
game is over or the human says stop.

## Choosing your move (tic-tac-toe)

Cells are numbered 0-8, left-to-right, top-to-bottom; each printout lists the
empty cells. Think before playing: take a winning cell if you have one, else
block the human's winning cell, else prefer center (4) > corners > edges, and
watch for forks. Illegal moves are rejected with exit 1 — pick another cell.

## Notes

- Waits block up to 120s with heartbeats on stderr; **exit 3 is normal** —
  the human is slow, just re-run the same command.
- Exit 4 = bad UID or deleted game: start a new one.
- Every request and action is appended to the log file from config.json —
  check it if something looks stuck.
