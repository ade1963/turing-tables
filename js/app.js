// App shell: hash router + game loop.
// Routes:  #/               landing page (+ spectator lobby)
//          #/g/<id>         live game view, <id> = private game UID (agent-created)
//          #/watch/<wid>    read-only spectator view of the public /watch mirror
//          #/demo/<game>    local demo board (hotseat, no storage)

import { store, StoreError } from "./store.js";
import { games } from "./games/registry.js";
import { watchSnapshot } from "./games/common.js";

const POLL_MS = 2500;
const POLL_HIDDEN_MS = 8000;

const view = document.getElementById("view");
let session = null; // { id|wid, state, engine, timer, stopped, local, spectate, kind, replay }

// Game state is world-writable by design (public-by-link) — escape anything
// state-derived before putting it into HTML.
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

// Human's chosen display name, remembered between games.
const getNick = () => localStorage.getItem("tt_nick") || "Guest";
const setNick = (v) => localStorage.setItem("tt_nick", v.slice(0, 24));

window.addEventListener("hashchange", route);
route();

function route() {
  stopSession();
  let m = location.hash.match(/^#\/g\/([A-Za-z0-9-]+)/);
  if (m) return openGame(m[1]);
  m = location.hash.match(/^#\/watch\/([A-Za-z0-9-]+)/);
  if (m) return openWatch(m[1]);
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

function mode() {
  return session.local ? "local" : session.spectate ? "spectate" : "live";
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
  session = { id, state, engine, timer: null, stopped: false, local: false, spectate: false, replay: null };
  renderGame();
  scheduleNext();
}

async function openWatch(wid) {
  view.innerHTML = `<div class="loading">Loading game…</div>`;
  let snap;
  try {
    snap = await store.getPath(`watch/${wid}`);
  } catch (err) {
    return renderError(err, () => openWatch(wid));
  }
  if (!snap) {
    return renderError(
      new StoreError("not_found", "This game isn't being broadcast — it may have ended or was never public."),
      null
    );
  }
  const engine = games[snap.game];
  if (!engine) {
    return renderError(new StoreError("http", `Unsupported game "${snap.game}".`), null);
  }
  session = {
    wid, id: null, state: normalized(snap), engine,
    spectate: true, kind: snap.kind || "human", lastUpdatedAt: snap.updatedAt,
    timer: null, stopped: false, local: false, replay: null,
  };
  renderGame();
  scheduleNext();
}

function openDemo(gameId) {
  const engine = games[gameId];
  const state = engine.init({ first: "human" });
  state.players.agent.name = "Player two";
  session = { id: null, state, engine, timer: null, stopped: false, local: true, spectate: false, replay: null };
  renderGame();
}

// side label = name (+ model), already HTML-escaped
function sideLabel(state, role) {
  const p = state.players[role];
  const name = esc(p.name ?? (role === "agent" ? "Agent" : "Guest"));
  return p.model ? `${name} <span class="model">${esc(p.model)}</span>` : name;
}

function renderGame() {
  const { state, engine, replay } = session;
  const m = mode();
  // Keep a half-typed chat message across poll-driven re-renders.
  const prevInput = view.querySelector("[data-chatsend] input");
  const draft = prevInput ? prevInput.value : "";
  const hadFocus = !!prevInput && document.activeElement === prevInput;

  let banner = "";
  if (m === "local") {
    banner = `<p class="demo-note">Demo — you play both sides.
      <a href="#/">Hook up an agent</a> for a real opponent.</p>`;
  } else if (m === "spectate") {
    banner = `<p class="demo-note">👀 Spectating ${session.kind === "selfplay" ? "an AI match" : "a live game"} — read-only.</p>`;
  }

  let hint = "";
  if (m === "live") {
    hint = `<p class="hint">You are <strong>${esc(state.players.human.mark)}</strong> ·
      ${sideLabel(state, "agent")} is <strong>${esc(state.players.agent.mark)}</strong>
      · score you <strong>${esc(state.score?.human ?? 0)} : ${esc(state.score?.agent ?? 0)}</strong>
      ${esc(state.players.agent.name ?? "Agent")} (draws ${esc(state.score?.draws ?? 0)})</p>`;
  } else if (m === "spectate") {
    hint = `<p class="hint">${sideLabel(state, "agent")} <strong>${esc(state.players.agent.mark)}</strong>
      vs ${sideLabel(state, "human")} <strong>${esc(state.players.human.mark)}</strong></p>`;
  }

  view.innerHTML = `
    <div class="game">
      <div class="game-head">
        <h1>${engine.name}</h1>
        <span class="round">round ${esc(state.round ?? 1)}</span>
      </div>
      ${banner}
      <p class="status" data-status></p>
      <div class="board" data-board></div>
      <div class="chat" data-chat></div>
      ${m === "live" ? `<div class="chat-send" data-chatsend>
        <input type="text" maxlength="120" placeholder="Message ${esc(state.players.agent.name ?? "the agent")}…">
        <button type="button" class="btn small">Send</button>
      </div>
      <div class="nick" data-nick>You're playing as
        <input type="text" maxlength="24" value="${esc(getNick())}" aria-label="your name"></div>` : ""}
      <div class="actions" data-actions></div>
      ${hint}
    </div>`;

  if (replay) {
    renderReplayBoard();
  } else {
    const canMove = state.status === "active" && (m === "local" || (m === "live" && state.turn === "human"));
    engine.render(view.querySelector("[data-board]"), state, { canMove, onMove: humanMove });
    renderStatus();
  }
  renderChat();
  wireChatInput(m === "live" && state.status === "active" && state.turn === "human", draft, hadFocus);
  wireNick();
  renderActions();
}

function wireNick() {
  const input = view.querySelector("[data-nick] input");
  if (!input) return;
  input.addEventListener("change", () => setNick(input.value.trim() || "Guest"));
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
  const { state } = session;
  const m = mode();
  const agentName = state.players.agent.name ?? "Agent";
  let text, cls = "";
  if (m === "spectate") {
    const P = state.players;
    if (state.status === "win") { text = `${P[state.winner].name} wins 🏆`; cls = "good"; }
    else if (state.status === "draw") { text = "Draw."; }
    else { text = `${P[state.turn].name} to move`; cls = "thinking"; }
  } else if (state.status === "win") {
    if (m === "local") { text = `${state.players[state.winner].mark} wins!`; cls = "good"; }
    else { text = state.winner === "human" ? "You win! 🎉" : `${agentName} wins 🤖`; cls = state.winner === "human" ? "good" : "bad"; }
  } else if (state.status === "draw") {
    text = "It's a draw.";
  } else if (m === "local") {
    text = `${state.players[state.turn].mark} to move`; cls = "good";
  } else if (state.turn === "human") {
    text = `Your turn — place an ${state.players.human.mark}`; cls = "good";
  } else {
    text = `${agentName} is thinking`; cls = "thinking";
  }
  el.textContent = extra ?? text;
  el.className = `status ${extra ? "bad" : cls}`;
}

function renderChat() {
  const el = view.querySelector("[data-chat]");
  if (!el || !session) return;
  const { state } = session;
  const spectate = mode() === "spectate";
  const humanName = state.players.human.name ?? "Guest";
  const agentName = state.players.agent.name ?? "Agent";
  el.replaceChildren(
    ...(state.chat ?? []).slice(-4).map((mm) => {
      const div = document.createElement("div");
      div.className = `bubble ${mm.by}`;
      const who = mm.by === "agent" ? agentName : (spectate ? humanName : "You");
      div.textContent = `${who}: ${mm.msg}`;
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
  const m = mode();
  el.replaceChildren();
  if (state.status === "active") return;
  if (replay) {
    const back = btnEl("◀", () => stepReplay(-1), true);
    const fwd = btnEl("▶", () => stepReplay(1), true);
    back.disabled = replay.idx === 0;
    fwd.disabled = replay.idx === state.moves.length;
    el.append(back, fwd, btnEl("✕ Exit replay", () => { session.replay = null; renderGame(); }));
    return;
  }
  if (m === "live" || m === "local") el.appendChild(btnEl("Rematch ↺", rematch));
  if (state.moves?.length) {
    el.appendChild(btnEl("▶ Replay", () => { session.replay = { idx: 0 }; renderGame(); }, true));
    el.appendChild(btnEl("📷 Share image", shareImage, true));
  }
}

// -------------------------------------------------------------------- replay

function stepReplay(d) {
  const r = session?.replay;
  if (!r) return;
  r.idx = Math.max(0, Math.min(session.state.moves.length, r.idx + d));
  renderGame();
}

function replaySnapshot(idx) {
  const { state, engine } = session;
  const shown = state.moves.slice(0, idx);
  const board = Array(state.board.length).fill("");
  for (const mv of shown) engine.placeAt(board, mv, state.players[mv.by].mark);
  const finished = idx === state.moves.length;
  return {
    ...state, board, moves: shown,
    status: finished ? state.status : "active",
    winner: finished ? state.winner : null,
  };
}

function renderReplayBoard() {
  const { engine, replay, state } = session;
  engine.render(view.querySelector("[data-board]"), replaySnapshot(replay.idx), { canMove: false });
  const el = view.querySelector("[data-status]");
  el.textContent = `Replay — move ${replay.idx} of ${state.moves.length}`;
  el.className = "status";
}

// --------------------------------------------------------------- share image

async function shareImage() {
  const { state, engine } = session;
  const cols = engine.cols;
  const rows = state.board.length / cols;
  const CELL = 46, GAP = 6, PAD = 22, TOP = 64, BOT = 18;
  const W = PAD * 2 + cols * (CELL + GAP) - GAP;
  const H = TOP + rows * (CELL + GAP) - GAP + BOT;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0f1117"; ctx.fillRect(0, 0, W, H);

  const a = state.players.agent.name ?? "Agent";
  const h = state.players.human.name ?? "Guest";
  ctx.fillStyle = "#e8eaf0";
  ctx.font = "600 22px system-ui, Segoe UI, sans-serif";
  ctx.fillText(`${a} vs ${h}`, PAD, 30);
  let result = "Draw";
  if (state.status === "win") result = `${state.players[state.winner].name} wins`;
  ctx.fillStyle = "#9aa1b2";
  ctx.font = "15px system-ui, Segoe UI, sans-serif";
  ctx.fillText(`${engine.name} · ${result} · Turing Tables`, PAD, 50);

  const winLine = state.status === "win" ? new Set(engine.result(state).line) : new Set();
  const COLORS = { X: "#6c8cff", O: "#fbbf24" };
  state.board.forEach((mk, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = PAD + c * (CELL + GAP), y = TOP + r * (CELL + GAP);
    ctx.fillStyle = "#1c202c";
    roundRect(ctx, x, y, CELL, CELL, 10); ctx.fill();
    if (mk) {
      ctx.fillStyle = COLORS[mk] || "#e8eaf0";
      ctx.beginPath();
      ctx.arc(x + CELL / 2, y + CELL / 2, CELL * 0.34, 0, Math.PI * 2);
      ctx.fill();
    }
    if (winLine.has(i)) {
      ctx.strokeStyle = "#4ade80"; ctx.lineWidth = 3;
      roundRect(ctx, x + 2, y + 2, CELL - 4, CELL - 4, 9); ctx.stroke();
    }
  });

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `turing-tables-${state.game}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).catch(() => {});
      }
    } catch { /* clipboard unsupported — the download still happened */ }
  }, "image/png");
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
  next.players.agent.model = state.players.agent.model;
  next.score = structuredClone(state.score ?? next.score);
  next.listed = state.listed;
  next.wid = state.wid;
  await commit(next, "Couldn't start the rematch — check your connection and try again.");
}

// Re-fetch before writing: if someone else advanced the game, show that instead.
async function commit(next, failMsg) {
  if (session.local) {
    session.state = next;
    renderGame();
    return;
  }
  if (next.players?.human) next.players.human.name = getNick();
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
    if (next.listed && next.wid) {
      store.putPath(`watch/${next.wid}`, watchSnapshot(next, "human")).catch(() => {});
    }
    renderGame();
    scheduleNext();
  } catch (err) {
    if (err.kind === "not_found") return renderError(err, null);
    renderStatus(failMsg);
  }
}

// Poll while the game is live. Live games watch /games/<id>; spectators watch
// the /watch/<wid> mirror (updatedAt changes on every move and chat message).
function scheduleNext() {
  const s = session;
  if (!s || s.stopped || s.local) return;
  clearTimeout(s.timer);
  if (s.state.status !== "active") return;
  const delay = document.hidden ? POLL_HIDDEN_MS : POLL_MS;
  s.timer = setTimeout(async () => {
    if (s.stopped) return;
    try {
      if (s.spectate) {
        const snap = await store.getPath(`watch/${s.wid}`);
        if (s.stopped) return;
        if (snap && snap.updatedAt !== s.lastUpdatedAt) {
          s.lastUpdatedAt = snap.updatedAt;
          s.state = normalized(snap);
          renderGame();
        }
      } else {
        const remote = normalized(await store.get(s.id));
        if (s.stopped) return;
        if (remote.seq !== s.state.seq) {
          s.state = remote;
          renderGame();
        }
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
      <section class="card lobby" data-lobby>
        <h2>Live &amp; recent games</h2>
        <p class="muted-p">Loading…</p>
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
  fillLobby();
}

async function fillLobby() {
  const el = view.querySelector("[data-lobby]");
  if (!el) return;
  let rows;
  try {
    rows = await store.listWatch(24);
  } catch {
    el.remove(); // no lobby (offline / not configured) — hide the section silently
    return;
  }
  if (!rows.length) {
    el.innerHTML = `<h2>Live &amp; recent games</h2>
      <p class="muted-p">No public games yet — start one with your agent and it shows up here.</p>`;
    return;
  }
  const live = rows.filter((r) => r.status === "active");
  const done = rows.filter((r) => r.status !== "active").slice(0, 8);
  const section = (title, list) =>
    list.length ? `<h3 class="lobby-h">${title}</h3><div class="lobby-list">${list.map(lobbyRow).join("")}</div>` : "";
  el.innerHTML = `<h2>Live &amp; recent games</h2>
    ${section("● Live now", live)}
    ${section("Recent", done)}`;
}

function lobbyRow(r) {
  const game = games[r.game]?.name ?? r.game;
  const a = esc(r.players?.agent?.name ?? "Agent");
  const h = esc(r.players?.human?.name ?? "Guest");
  let pill;
  if (r.status === "active") pill = `<span class="lpill live">● live</span>`;
  else if (r.status === "win") pill = `<span class="lpill">${esc(r.players?.[r.winner]?.name ?? "winner")} won</span>`;
  else pill = `<span class="lpill">draw</span>`;
  return `<a class="lobby-row" href="#/watch/${esc(r.wid)}">
    <span class="lg">${esc(game)}</span>
    <span class="lp">${a} <span class="vs">vs</span> ${h}</span>
    ${pill}
  </a>`;
}
