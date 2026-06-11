# 🎲 Turing Tables

Play board games against an AI agent — through a **fully static web page**.

An agent (built for [Hermes Agent](https://github.com/NousResearch/hermes-agent),
but any agent with a shell works) creates a game, sends you a link, and you play
in your browser. The agent sees your moves and answers within seconds.
No server code to run, no accounts for players, no API keys in the page.
Deployable on GitHub Pages for free.

## How it works

```
human browser ──GET/PUT──▶  <db>/games/<UID>.json  ◀──GET/PUT── agent (python3 stdlib)
      ▲                    (one tiny JSON doc per game,
      │                     Firebase Realtime DB free tier)
  static page on GitHub Pages              game link: <pages-url>/#/g/<UID>
```

The whole game state is one JSON document; its key is the game UID the agent
generates and puts into the link. Both sides poll it every few seconds while
waiting; turn order is enforced by a `turn` field and an incrementing `seq`
counter. Storage access lives behind a tiny adapter
([js/store.js](js/store.js), [scripts/_lib.py](skill/turing-tables-core/scripts/_lib.py))
that speaks the Firebase REST subset `GET/PUT <db>/games/<uid>.json` — any
endpoint implementing those two verbs works as a backend
(see [tools/dev_store.py](tools/dev_store.py) for a 90-line local stand-in).

> **Why Firebase and not a zero-signup JSON host?** All of them were tested
> and none survive 2026: jsonblob.com stopped sending CORS headers on
> responses (browser reads fail), dweet.io is gone, extendsclass.com now
> requires API keys, jsonhosting.com caps at 100 requests/hour,
> jsonstorage.net at 1,000/month — too low for polling. Firebase's free
> Spark plan needs no credit card and handles this load with ease.

## Setup (one time, ~5 minutes)

### 1. Create the shared database

1. Go to [console.firebase.google.com](https://console.firebase.google.com),
   **Add project** (Analytics not needed).
2. **Build → Realtime Database → Create database** (any region, start in
   locked mode).
3. In the **Rules** tab, allow public access *only* under `/games`:
   ```json
   {
     "rules": {
       "games": {
         "$game": { ".read": true, ".write": true }
       }
     }
   }
   ```
4. Copy the database URL, e.g.
   `https://my-turing-tables-default-rtdb.europe-west1.firebasedatabase.app`.

### 2. Deploy the web app on GitHub Pages

1. Paste the database URL into [js/config.js](js/config.js) (`dbUrl`).
2. Create a GitHub repository (e.g. `turing-tables`) and push this folder:
   ```bash
   git remote add origin https://github.com/<you>/turing-tables.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Source: Deploy from a branch**, branch
   `main`, folder `/ (root)`. After a minute the app is live at
   `https://<you>.github.io/turing-tables/`.

### 3. Hook up the Hermes agent

There is one thin skill per game plus a shared core (scripts + config):

```
skill/turing-tables-core/        # shared scripts + config.json (not a skill itself)
skill/turing-tables-tictactoe/   # SKILL.md for tic-tac-toe
skill/turing-tables-connect4/    # SKILL.md for Connect 4
```

1. Put your URLs into
   [skill/turing-tables-core/scripts/config.json](skill/turing-tables-core/scripts/config.json)
   (`app_url`, `db_url`, optional `log` path, `wait_timeout` seconds).
   Environment variables `TURING_TABLES_URL` / `TURING_TABLES_DB_URL` /
   `TURING_TABLES_LOG` / `TURING_TABLES_WAIT_TIMEOUT` override it if set.
2. Copy **all** skill folders into Hermes' skills directory (the per-game
   skills reference the core by relative path):
   ```bash
   cp -r skill/turing-tables-* ~/.hermes/skills/games/
   ```
3. Ask Hermes: *"let's play tic-tac-toe"* (or *connect 4*). It creates a
   game, sends you the link, and waits. One script call per turn:
   `play_move.py` publishes Hermes' move and blocks until you answer.

**Token note**: waiting inside a script costs zero LLM tokens; tokens are
spent each time a wait *returns* to the agent (full-context call). Set
`wait_timeout` as high as your agent's tool runner allows (default 480s).

The scripts are plain python3 (stdlib only), so any agent with a shell tool
can use them — the per-game SKILL.md files (e.g.
[turing-tables-connect4](skill/turing-tables-connect4/SKILL.md)) double as
the instructions.

## Playing

- Open the link the agent gives you — the board renders immediately.
- When it's your turn the cells light up; click one (Connect 4: click any
  cell in a column to drop there).
- "Hermes is thinking…" means the agent has been notified and is choosing.
- The text box under the board sends a chat message the agent sees with
  your move.
- After the game ends, hit **Rematch ↺** — first move alternates and the
  score carries over across rounds.

## Local development (no Firebase needed)

```bash
python3 tools/dev_store.py            # storage stand-in on :8001
python3 -m http.server 8000           # the app on :8000
# js/config.js → dbUrl: "http://localhost:8001"
python3 skill/turing-tables-core/scripts/new_game.py \
  --db-url http://localhost:8001 --base-url http://localhost:8000
```

## Adding a new game

1. Create `js/games/<id>.js` implementing the engine interface
   (`normalize / init / validate / apply / result / render` — see
   [js/games/connect4.js](js/games/connect4.js); reuse
   [js/games/common.js](js/games/common.js)) and register it in
   [js/games/registry.js](js/games/registry.js).
2. Mirror the rules in
   [skill/turing-tables-core/scripts/_lib.py](skill/turing-tables-core/scripts/_lib.py)
   (`GAMES` dict entry).
3. Add a thin `skill/turing-tables-<id>/SKILL.md` (copy an existing one,
   change the game name, move format, and strategy lines).

Rules are intentionally duplicated on both sides so each player validates
moves independently — for board games this is a few dozen lines.

## Honest limitations

- **Games are public-by-link**: anyone with the UID can read or write that
  game's state (the rules above expose only `/games`). Fine for games;
  never put secrets or personal data in it.
- **The agent must keep polling**: if the agent session ends, the game
  pauses until it runs `wait_turn.py` again (state is never lost).
- **Firebase free tier limits** (1 GB storage, 10 GB/month transfer) are
  far beyond what turn-based games use, but they exist. Old games are never
  auto-deleted; wipe `/games` in the Firebase console occasionally if you care.

## License

MIT — see [LICENSE](LICENSE).
