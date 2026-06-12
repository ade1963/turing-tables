// App shell: hash router + game loop.
// Routes:  #/             landing page
//          #/g/<id>       live game view, <id> = game UID created by the agent
//          #/demo/<game>  local demo board (hotseat, no storage)

import { store, StoreError } from "./store.js";
import { games } from "./games/registry.js";

const POLL_MS = 2500;
const POLL_HIDDEN_MS = 8000;

const view = document.getElementById("view");
let session = null; // { id, state, engine, timer, stopped, local, replay }

// Game state is world-writable by design (public-by-link) — escape anything
// state-derived before putting it into HTML.
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

window.addEventListener("hashchange", route);
route();

function route() {
  stopSession();
  let m = location.hash.match(/^#\/g\/([A-Za-z0-9-]+)/);
  if (m) return openGame(m[1]);
  m = location.hash.match(/^#\/demo\/([a-z0-9]+)/);
  if (m && games[m[1]]) return openDemo(m[1]);
  renderLanding();
}

function stopSession() {
  if (session) {
    session.stopped = true;
    clearTimeout(session.timer);
    session = null;
  }
}

// ---------------------------------------------------------------- game view

// Storage backends (Firebase RTDB) strip empty arrays/nulls — let the game
// engine restore its schema after every read.
function normalized(state) {
  return games[state.game]?.normalize?.(state) ?? state;
}

async function openGame(id) {
  view.innerHTML = `<div class="loading">Loading game…</div>`;
  let state;
  try {
    state = normalized(await store.get(id));
  } catch (err) {
    return renderError(err, () => openGame(id));
  }
  const engine = games[state.game];
  if (!engine) {
    return renderError(
      new StoreError("http", `This board doesn't support the game "${state.game}" yet.`),
      null
    );
  }
  session = { id, state, engine, timer: null, stopped: false, local: false, replay: null };
  renderGame();
  scheduleNext();
}

function openDemo(gameId) {
  const engine = games[gameId];
  const state = engine.init({ first: "human" });
  state.players.agent.name = "Player two";
  session = { id: null, state, engine, timer: null, stopped: false, local: true, replay: null };
  renderGame();
}

function renderGame() {
  const { state, engine, local, replay } = session;
  // Keep a half-typed chat message across poll-driven re-renders.
  const prevInput = view.querySelector("[data-chatsend] input");
  const draft = prevInput ? prevInput.value : "";
  const hadFocus = !!prevInput && document.activeElement === prevInput;

  const agentName = esc(state.players.agent.name ?? "Agent");
  view.innerHTML = `
    <div class="game">
      <div class="game-head">
        <h1>${engine.name}</h1>
        <span class="round">round ${esc(state.round ?? 1)}</span>
      </div>
      ${local ? `<p class="demo-note">Demo — you play both sides.
        <a href="#/">Hook up an agent</a> for a real opponent.</p>` : ""}
      <p class="status" data-status></p>
      <div class="board" data-board></div>
      <div class="chat" data-chat></div>
      ${local ? "" : `<div class="chat-send" data-chatsend>
        <input type="text" maxlength="120" placeholder="Message ${agentName}…">
        <button type="button" class="btn small">Send</button>
      </div>`}
      <div class="actions" data-actions></div>
      ${local ? "" : `<p class="hint">You are <strong>${esc(state.players.human.mark)}</strong> ·
        ${agentName} is <strong>${esc(state.players.agent.mark)}</strong>
        · score you <strong>${esc(state.score?.human ?? 0)} : ${esc(state.score?.agent ?? 0)}</strong>
        ${agentName} (draws ${esc(state.score?.draws ?? 0)})</p>`}
    </div>`;

  if (replay) {
    renderReplayBoard();
  } else {
    const canMove = state.status === "active" && (local || state.turn === "human");
    engine.render(view.querySelector("[data-board]"), state, {
      canMove,
      onMove: humanMove,
    });
    renderStatus();
  }
  renderChat();
  wireChatInput(!local && state.status === "active" && state.turn === "human", draft, hadFocus);
  renderActions();
}

function wireChatInput(canChat, draft = "", hadFocus = false) {
  const wrap = view.querySelector("[data-chatsend]");
  if (!wrap) return;
  const input = wrap.querySelector("input");
  const btn = wrap.querySelector("button");
  input.disabled = btn.disabled = !canChat;
  wrap.classList.toggle("muted", !canChat);
  if (!canChat) return;
  input.value = draft;
  if (hadFocus) input.focus();
  const send = async () => {
    const msg = input.value.trim();
    if (!msg) return;
    const { state } = session;
    const next = structuredClone(state);
    next.chat = (next.chat ?? []).slice(-7); // keep at most 8 with the new one
    next.chat.push({ by: "human", msg });
    next.seq = state.seq + 1;
    await commit(next, "Couldn't send the message — check your connection.");
  };
  btn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });
}

function renderStatus(extra) {
  const el = view.querySelector("[data-status]");
  if (!el || !session) return;
  const { state, local } = session;
  const agentName = state.players.agent.name ?? "Agent";
  let text, cls = "";
  if (state.status === "win") {
    if (local) {
      text = `${state.players[state.winner].mark} wins!`;
      cls = "good";
    } else {
      text = state.winner === "human" ? "You win! 🎉" : `${agentName} wins 🤖`;
      cls = state.winner === "human" ? "good" : "bad";
    }
  } else if (state.status === "draw") {
    text = "It's a draw.";
  } else if (local) {
    text = `${state.players[state.turn].mark} to move`;
    cls = "good";
  } else if (state.turn === "human") {
    text = `Your turn — place an ${state.players.human.mark}`;
    cls = "good";
  } else {
    text = `${agentName} is thinking`;
    cls = "thinking";
  }
  el.textContent = extra ?? text;
  el.className = `status ${extra ? "bad" : cls}`;
}

function renderChat() {
  const el = view.querySelector("[data-chat]");
  if (!el || !session) return;
  const { state } = session;
  const msgs = state.chat ?? [];
  el.replaceChildren(
    ...msgs.slice(-4).map((m) => {
      const div = document.createElement("div");
      div.className = `bubble ${m.by}`;
      const who = m.by === "agent" ? (state.players.agent.name ?? "Agent") : "You";
      div.textContent = `${who}: ${m.msg}`;
      return div;
    })
  );
}

function btnEl(label, onClick, ghost = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = ghost ? "btn ghost" : "btn";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function renderActions() {
  const el = view.querySelector("[data-actions]");
  if (!el || !session) return;
  const { state, replay } = session;
  el.replaceChildren();
  if (state.status === "active") return;
  if (replay) {
    const back = btnEl("◀", () => stepReplay(-1), true);
    const fwd = btnEl("▶", () => stepReplay(1), true);
    back.disabled = replay.idx === 0;
    fwd.disabled = replay.idx === state.moves.length;
    const exit = btnEl("✕ Exit replay", () => {
      session.replay = null;
      renderGame();
    });
    el.append(back, fwd, exit);
    return;
  }
  el.appendChild(btnEl("Rematch ↺", rematch));
  if (state.moves?.length) {
    el.appendChild(
      btnEl("▶ Replay", () => {
        session.replay = { idx: 0 };
        renderGame();
      }, true)
    );
  }
}

// -------------------------------------------------------------------- replay

function stepReplay(d) {
  const r = session?.replay;
  if (!r) return;
  r.idx = Math.max(0, Math.min(session.state.moves.length, r.idx + d));
  renderGame();
}

function renderReplayBoard() {
  const { state, engine, replay } = session;
  const shown = state.moves.slice(0, replay.idx);
  const board = Array(state.board.length).fill("");
  for (const mv of shown) engine.placeAt(board, mv, state.players[mv.by].mark);
  const finished = replay.idx === state.moves.length;
  const snap = {
    ...state,
    board,
    moves: shown,
    status: finished ? state.status : "active",
    winner: finished ? state.winner : null,
  };
  engine.render(view.querySelector("[data-board]"), snap, { canMove: false });
  const el = view.querySelector("[data-status]");
  el.textContent = `Replay — move ${replay.idx} of ${state.moves.length}`;
  el.className = "status";
}

// --------------------------------------------------------------------- moves

async function humanMove(move) {
  const { state, engine, local } = session;
  const by = local ? state.turn : "human";
  const reason = engine.validate(state, move, by);
  if (reason) return renderStatus(`Illegal move: ${reason}`);

  const next = engine.apply(state, move, by);
  await commit(next, "Couldn't send your move — check your connection and try again.");
}

async function rematch() {
  const { state, engine } = session;
  const next = engine.init({ first: state.first === "human" ? "agent" : "human" });
  next.seq = state.seq + 1;
  next.round = (state.round ?? 1) + 1;
  next.players.agent.name = state.players.agent.name;
  next.score = structuredClone(state.score ?? next.score);
  await commit(next, "Couldn't start the rematch — check your connection and try again.");
}

// Re-fetch before writing: if someone else advanced the game, show that instead.
async function commit(next, failMsg) {
  if (session.local) {
    session.state = next;
    renderGame();
    return;
  }
  const { id, state } = session;
  renderStatus("Sending…");
  try {
    const remote = normalized(await store.get(id));
    if (remote.seq !== state.seq) {
      session.state = remote;
      renderGame();
      scheduleNext();
      return;
    }
    await store.put(id, next);
    session.state = next;
    renderGame();
    scheduleNext();
  } catch (err) {
    if (err.kind === "not_found") return renderError(err, null);
    renderStatus(failMsg);
  }
}

// Poll while the game is live: the agent's moves arrive on its turn, and its
// chat messages (say.py) can arrive even while we hold the turn.
function scheduleNext() {
  const s = session;
  if (!s || s.stopped || s.local) return;
  clearTimeout(s.timer);
  if (s.state.status !== "active") return;
  const delay = document.hidden ? POLL_HIDDEN_MS : POLL_MS;
  s.timer = setTimeout(async () => {
    if (s.stopped) return;
    try {
      const remote = normalized(await store.get(s.id));
      if (s.stopped) return;
      if (remote.seq !== s.state.seq) {
        s.state = remote;
        renderGame();
      }
    } catch (err) {
      if (err.kind === "not_found") return renderError(err, null);
      renderStatus("Connection lost — retrying…");
    }
    scheduleNext();
  }, delay);
}

// ------------------------------------------------------------- static views

function renderError(err, retry) {
  stopSession();
  view.innerHTML = `
    <div class="card error-card">
      <h1>😕 ${err.kind === "not_found" ? "Game not found" : "Something went wrong"}</h1>
      <p>${esc(err.message)}</p>
      <div class="actions"></div>
    </div>`;
  const actions = view.querySelector(".actions");
  if (retry) {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "Try again";
    btn.addEventListener("click", retry);
    actions.appendChild(btn);
  }
  const home = document.createElement("a");
  home.className = "btn ghost";
  home.href = "#/";
  home.textContent = "About Turing Tables";
  actions.appendChild(home);
}

function renderLanding() {
  view.innerHTML = `
    <div class="landing">
      <section class="hero">
        <h1>Play board games with your AI&nbsp;agent</h1>
        <p>Turing Tables is a tiny static web app. An AI agent (like
          <a href="https://github.com/NousResearch/hermes-agent" target="_blank" rel="noopener">Hermes</a>)
          creates a game, sends you a link, and you play right here — no accounts, no server.</p>
      </section>
      <section class="card demo-strip">
        <h2>Try the board right now</h2>
        <p>No agent yet? Play both sides of a local demo game:</p>
        <div class="actions">
          <a class="btn ghost" href="#/demo/tictactoe">Tic-tac-toe</a>
          <a class="btn ghost" href="#/demo/connect4">Connect 4</a>
          <a class="btn ghost" href="#/demo/gomoku">Gomoku</a>
        </div>
      </section>
      <section class="steps">
        <div class="card"><span class="step-n">1</span>
          <h2>Agent creates a game</h2>
          <p>The agent stores a fresh board in a shared JSON mailbox and gets a unique game id.</p></div>
        <div class="card"><span class="step-n">2</span>
          <h2>You get a link</h2>
          <p>It looks like <code>#/g/&lt;game-id&gt;</code>. Open it and the board appears.</p></div>
        <div class="card"><span class="step-n">3</span>
          <h2>Take turns</h2>
          <p>Your moves are written to the mailbox; the agent polls it, thinks, and answers.</p></div>
      </section>
      <section class="card setup">
        <h2>Hook up your own agent</h2>
        <p>This repo ships ready-made skills for the Hermes Agent — tic-tac-toe, Connect&nbsp;4,
          and Gomoku. Install them and ask Hermes for a game:</p>
        <pre><code>cp -r skill/turing-tables-* ~/.hermes/skills/games/
# then tell Hermes: "let's play gomoku"</code></pre>
        <p>Details in the <a href="https://github.com/ade1963/turing-tables" data-repo-link>README</a>.</p>
      </section>
    </div>`;
}
