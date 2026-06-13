// Helpers shared by all game engines (mirrored in the skill's _lib.py).

// Storage backends (Firebase RTDB) strip empty arrays and null values from
// stored JSON — restore the full schema after every read.
export function normalizeCommon(state, boardSize) {
  const board = Array.from({ length: boardSize }, (_, i) => state.board?.[i] || "");
  const score = state.score ?? {};
  const p = state.players ?? {};
  const agent = p.agent ?? {};
  const human = p.human ?? {};
  return {
    winner: null,
    turn: null,
    ...state,
    board,
    moves: state.moves ?? [],
    chat: state.chat ?? [],
    listed: state.listed ?? false,
    wid: state.wid ?? null,
    score: {
      agent: score.agent ?? 0,
      human: score.human ?? 0,
      draws: score.draws ?? 0,
    },
    players: {
      agent: { mark: agent.mark ?? "X", name: agent.name ?? "Hermes", model: agent.model ?? null },
      human: { mark: human.mark ?? "O", name: human.name ?? "Guest", model: human.model ?? null },
    },
  };
}

export function baseInit(gameId, { first = "human" } = {}, boardSize) {
  const agentMark = first === "agent" ? "X" : "O";
  return {
    v: 1,
    game: gameId,
    seq: 1,
    round: 1,
    first,
    players: {
      agent: { mark: agentMark, name: "Hermes", model: null },
      human: { mark: agentMark === "X" ? "O" : "X", name: "Guest" },
    },
    turn: first,
    status: "active",
    winner: null,
    score: { agent: 0, human: 0, draws: 0 },
    board: Array(boardSize).fill(""),
    moves: [],
    chat: [],
    listed: false, // demos/rematches are local until an agent lists them
    wid: null,
  };
}

// Compact public snapshot for the read-only spectator mirror (/watch/<wid>).
// Mirrors _lib.mirror_publish in the skill scripts. Contains no private uid.
export function watchSnapshot(state, kind = "human") {
  return {
    game: state.game,
    status: state.status,
    turn: state.turn ?? null,
    seq: state.seq,
    round: state.round ?? 1,
    winner: state.winner ?? null,
    board: state.board,
    moves: (state.moves ?? []).slice(-120),
    chat: (state.chat ?? []).slice(-8),
    players: {
      agent: {
        name: state.players.agent.name ?? "Hermes",
        model: state.players.agent.model ?? null,
        mark: state.players.agent.mark,
      },
      human: {
        name: state.players.human.name ?? "Guest",
        model: state.players.human.model ?? null,
        mark: state.players.human.mark,
      },
    },
    kind,
    updatedAt: Date.now(),
  };
}

// Post-move bookkeeping: result, turn flip, score, seq. Mutates and returns next.
export function finishMove(engine, prev, next, by) {
  const res = engine.result(next);
  next.status = res.status;
  next.winner = res.winner;
  next.turn = res.status === "active" ? (by === "human" ? "agent" : "human") : null;
  if (res.status === "win") next.score[res.winner] = (next.score[res.winner] ?? 0) + 1;
  else if (res.status === "draw") next.score.draws = (next.score.draws ?? 0) + 1;
  next.seq = prev.seq + 1;
  return next;
}
