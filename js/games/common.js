// Helpers shared by all game engines (mirrored in the skill's _lib.py).

// Storage backends (Firebase RTDB) strip empty arrays and null values from
// stored JSON — restore the full schema after every read.
export function normalizeCommon(state, boardSize) {
  const board = Array.from({ length: boardSize }, (_, i) => state.board?.[i] || "");
  const score = state.score ?? {};
  return {
    winner: null,
    turn: null,
    ...state,
    board,
    moves: state.moves ?? [],
    chat: state.chat ?? [],
    score: {
      agent: score.agent ?? 0,
      human: score.human ?? 0,
      draws: score.draws ?? 0,
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
      agent: { mark: agentMark, name: "Hermes" },
      human: { mark: agentMark === "X" ? "O" : "X" },
    },
    turn: first,
    status: "active",
    winner: null,
    score: { agent: 0, human: 0, draws: 0 },
    board: Array(boardSize).fill(""),
    moves: [],
    chat: [],
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
