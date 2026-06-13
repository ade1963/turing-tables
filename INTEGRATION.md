# Integrating Turing Tables into the larger project

Turing Tables is promoted first as its own small, self-contained project
(separate repo + GitHub Pages). This note records how it folds into the larger
**"Model Behavior"** monorepo (`self-evolving-agent`) later, once the small
project has proven itself — so nothing here needs doing now, but the seams are
already in the right places.

## Why they belong together

| | Turing Tables | Model Behavior (`demos/reality-show/`) |
|---|---|---|
| Who plays | **human vs AI agent** | **AI vs AI** (two LLMs) |
| Surface | static web board (this repo) | FastAPI leaderboard + daemon |
| Board engines | JS + python mirror (`tictactoe/connect4/gomoku`) | `core/games/four_in_a_row.py` |
| Identity | `players.{agent,human}.{name,model}` | personas `(name, model_id, prefix)` |
| Match driver | `selfplay.py` → `_lib.pick_move` | `core/reality_show/match_runner.py` |

They are two halves of the same idea — "agents playing board games in public."
Turing Tables is the **spectator-friendly front end**; Model Behavior is the
**autonomous match engine + standings**.

## Step 1 — fold in as a folder (preserves history)

The web app has no build step, so it drops in as a plain folder:

```bash
# from the self-evolving-agent monorepo root
git subtree add --prefix demos/turing-tables \
    https://github.com/ade1963/turing-tables.git main
# later updates:
git subtree pull --prefix demos/turing-tables \
    https://github.com/ade1963/turing-tables.git main
```

GitHub Pages can keep deploying from the standalone repo, or the monorepo can
publish `demos/turing-tables/` — both work because it is pure static files.

## Step 2 — let the two projects reference each other

1. **Leaderboard → live boards.** The reality-show leaderboard links each live
   or recent match to a Turing Tables spectator URL
   (`…/turing-tables/#/watch/<wid>`), so the audience watches the *same* match
   render on the nicer board UI.
2. **Real model-vs-model on the Turing Tables board.** `selfplay.py` takes its
   move from `_lib.pick_move` (a free heuristic). Swap that for an LLM policy
   backed by `core/reality_show/match_runner.py` + `personas.json`, and two real
   OpenRouter models play on the shared Firebase board — `kind:"selfplay"` and
   the `players.*.model` fields are already there to show who's playing.
3. **Shared engines, eventually.** Both sides keep independent rule copies today
   (by design — each validates moves itself). If consolidation is ever wanted,
   the python `_lib` engines expose the same shape Model Behavior's
   `match_runner` duck-types (`legal_moves`/`apply`/`result`/render), so a thin
   adapter could let one engine set serve both.

## Already aligned for this

- Identity vocabulary matches personas: `name` + `model` on both sides.
- `selfplay.py` has an explicit `policy`/`pick_move` seam for an LLM driver.
- The read-only `/watch/<wid>` mirror is exactly the public, embeddable artifact
  a leaderboard would link to — no private game UID leaks.
