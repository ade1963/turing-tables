// App shell: hash router + game loop.
// Routes:  #/        landing page
//          #/g/<id>  game view, <id> = jsonblob UID created by the agent

import { store, StoreError } from "./store.js";
import { games } from "./games/registry.js";

const POLL_MS = 2500;
const POLL_HIDDEN_MS = 8000;

const view = document.getElementById("view");
let session = null; // { id, state, engine, timer, stopped }

window.addEventListener("hashchange", route);
route();

function route() {
  stopSession();
  const m = location.hash.match(/^#\/g\/([A-Za-z0-9-]+)/);
  if (m) {
    openGame(m[1]);
  } else {
    renderLanding();
  }
}

function stopSession() {
  if (session) {
    session.stopped = true;
    clearTimeout(session.timer);
    session = null;
  }
}

// ---------------------------------------------------------------- game view

async function openGame(id) {
  view.innerHTML = `<div class="loading">Loading game…</div>`;
  let state;
  try {
    state = await store.get(id);
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
  session = { id, state, engine, timer: null, stopped: false };
  renderGame();
  scheduleNext();
}

function renderGame() {
  const { state, engine } = session;
  view.innerHTML = `
    <div class="game">
      <div class="game-head">
        <h1>${engine.name}</h1>
        <span class="round">round ${state.round ?? 1}</span>
      </div>
      <p class="status" data-status></p>
      <div class="board" data-board></div>
      <div class="chat" data-chat></div>
      <div class="actions" data-actions></div>
      <p class="hint">You are <strong>${state.players.human.mark}</strong> ·
        ${state.players.agent.name ?? "Agent"} is <strong>${state.players.agent.mark}</strong></p>
    </div>`;

  const humanTurn = state.status === "active" && state.turn === "human";
  engine.render(view.querySelector("[data-board]"), state, {
    canMove: humanTurn,
    onMove: humanMove,
  });
  renderStatus();
  renderChat();
  renderActions();
}

function renderStatus(extra) {
  const el = view.querySelector("[data-status]");
  if (!el || !session) return;
  const { state } = session;
  const agentName = state.players.agent.name ?? "Agent";
  let text, cls = "";
  if (state.status === "win") {
    text = state.winner === "human" ? "You win! 🎉" : `${agentName} wins 🤖`;
    cls = state.winner === "human" ? "good" : "bad";
  } else if (state.status === "draw") {
    text = "It's a draw.";
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

function renderActions() {
  const el = view.querySelector("[data-actions]");
  if (!el || !session) return;
  const { state } = session;
  el.replaceChildren();
  if (state.status !== "active") {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "Rematch ↺";
    btn.addEventListener("click", rematch);
    el.appendChild(btn);
  }
}

async function humanMove(move) {
  const { state, engine, id } = session;
  const reason = engine.validate(state, move, "human");
  if (reason) return renderStatus(`Illegal move: ${reason}`);

  const next = engine.apply(state, move, "human");
  await commit(next, "Couldn't send your move — check your connection and try again.");
}

async function rematch() {
  const { state, engine } = session;
  const next = engine.init({ first: state.first === "human" ? "agent" : "human" });
  next.seq = state.seq + 1;
  next.round = (state.round ?? 1) + 1;
  next.players.agent.name = state.players.agent.name;
  await commit(next, "Couldn't start the rematch — check your connection and try again.");
}

// Re-fetch before writing: if someone else advanced the game, show that instead.
async function commit(next, failMsg) {
  const { id, state } = session;
  renderStatus("Sending…");
  try {
    const remote = await store.get(id);
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

// Poll only while we wait on the agent.
function scheduleNext() {
  const s = session;
  if (!s || s.stopped) return;
  clearTimeout(s.timer);
  if (s.state.status !== "active" || s.state.turn !== "agent") return;
  const delay = document.hidden ? POLL_HIDDEN_MS : POLL_MS;
  s.timer = setTimeout(async () => {
    if (s.stopped) return;
    try {
      const remote = await store.get(s.id);
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
      <p>${err.message}</p>
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
  home.textContent = "About Agent Club";
  actions.appendChild(home);
}

function renderLanding() {
  view.innerHTML = `
    <div class="landing">
      <section class="hero">
        <h1>Play board games with your AI&nbsp;agent</h1>
        <p>Agent Club is a tiny static web app. An AI agent (like
          <a href="https://github.com/NousResearch/hermes-agent" target="_blank" rel="noopener">Hermes</a>)
          creates a game, sends you a link, and you play right here — no accounts, no server.</p>
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
        <p>This repo ships a ready-made skill for the Hermes Agent. Install it and ask Hermes for a game:</p>
        <pre><code>cp -r skill/agent-club-games ~/.hermes/skills/games/
# then tell Hermes: "let's play tic-tac-toe"</code></pre>
        <p>Details in the <a href="https://github.com/" data-repo-link>README</a>.</p>
      </section>
    </div>`;
}
