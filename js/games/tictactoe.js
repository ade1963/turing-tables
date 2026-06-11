// Tic-tac-toe game module. Implements the common engine interface:
//   init(opts)                 -> fresh state
//   validate(state, move, by)  -> null if legal, else reason string
//   apply(state, move, by)     -> new state (does not mutate input)
//   result(state)              -> { status, winner, line? }
//   render(el, state, opts)    -> draw board into el; opts: { canMove, onMove }
//
// Moves are { cell: 0..8 }, board indices:  0 1 2 / 3 4 5 / 6 7 8.
// X always moves first; whoever moves first gets X.

import { normalizeCommon, baseInit, finishMove } from "./common.js";

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6],            // diagonals
];

export const tictactoe = {
  id: "tictactoe",
  name: "Tic-Tac-Toe",

  normalize(state) {
    return normalizeCommon(state, 9);
  },

  init(opts) {
    return baseInit("tictactoe", opts, 9);
  },

  validate(state, move, by) {
    if (state.status !== "active") return "game is over";
    if (state.turn !== by) return "not your turn";
    const cell = move?.cell;
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) return "cell must be an integer 0-8";
    if (state.board[cell] !== "") return `cell ${cell} is already taken`;
    return null;
  },

  apply(state, move, by) {
    const next = structuredClone(state);
    next.board[move.cell] = next.players[by].mark;
    next.moves.push({ by, cell: move.cell });
    return finishMove(tictactoe, state, next, by);
  },

  result(state) {
    for (const line of LINES) {
      const [a, b, c] = line;
      const m = state.board[a];
      if (m !== "" && m === state.board[b] && m === state.board[c]) {
        const winner = state.players.agent.mark === m ? "agent" : "human";
        return { status: "win", winner, line };
      }
    }
    if (state.board.every((v) => v !== "")) return { status: "draw", winner: null };
    return { status: "active", winner: null };
  },

  render(el, state, { canMove = false, onMove } = {}) {
    const winLine = state.status === "win" ? tictactoe.result(state).line : [];
    const lastMove = state.moves.length ? state.moves[state.moves.length - 1].cell : -1;
    const grid = document.createElement("div");
    grid.className = "ttt-grid";
    state.board.forEach((mark, i) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "ttt-cell";
      if (mark) cell.classList.add("filled", mark === "X" ? "mark-x" : "mark-o");
      if (winLine.includes(i)) cell.classList.add("win");
      if (i === lastMove) cell.classList.add("last");
      cell.textContent = mark;
      cell.disabled = !canMove || mark !== "";
      cell.setAttribute("aria-label", mark ? `cell ${i}: ${mark}` : `cell ${i}: empty`);
      if (canMove && mark === "" && onMove) {
        cell.addEventListener("click", () => onMove({ cell: i }));
      }
      grid.appendChild(cell);
    });
    el.replaceChildren(grid);
  },
};
