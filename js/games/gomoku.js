// Gomoku game module. Board is a flat 81-array: 9×9, index = row*9 + col,
// row 0 at the top. A move is { cell: 0..80 } on any empty cell; five (or
// more) in a row wins. Rules mirrored in the skill's _lib.py, where script
// I/O uses chess-style coordinates (columns a-i, rows 1-9 top to bottom).

import { normalizeCommon, baseInit, finishMove } from "./common.js";

const SIZE = 9;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

export const gomoku = {
  id: "gomoku",
  name: "Gomoku",
  cols: SIZE,

  normalize(state) {
    return normalizeCommon(state, SIZE * SIZE);
  },

  init(opts) {
    return baseInit("gomoku", opts, SIZE * SIZE);
  },

  validate(state, move, by) {
    if (state.status !== "active") return "game is over";
    if (state.turn !== by) return "not your turn";
    const cell = move?.cell;
    if (!Number.isInteger(cell) || cell < 0 || cell >= SIZE * SIZE) return "cell must be an integer 0-80";
    if (state.board[cell] !== "") return `cell ${cell} is already taken`;
    return null;
  },

  apply(state, move, by) {
    const next = structuredClone(state);
    next.board[move.cell] = next.players[by].mark;
    next.moves.push({ by, cell: move.cell });
    return finishMove(gomoku, state, next, by);
  },

  result(state) {
    const b = state.board;
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        const mark = b[row * SIZE + col];
        if (mark === "") continue;
        for (const [dr, dc] of DIRS) {
          const line = [0, 1, 2, 3, 4].map((i) => [row + i * dr, col + i * dc]);
          const ok = line.every(([r, c]) =>
            r >= 0 && r < SIZE && c >= 0 && c < SIZE && b[r * SIZE + c] === mark
          );
          if (ok) {
            const winner = state.players.agent.mark === mark ? "agent" : "human";
            return { status: "win", winner, line: line.map(([r, c]) => r * SIZE + c) };
          }
        }
      }
    }
    if (b.every((v) => v !== "")) return { status: "draw", winner: null };
    return { status: "active", winner: null };
  },

  placeAt(board, entry, mark) {
    board[entry.cell] = mark;
  },

  render(el, state, { canMove = false, onMove } = {}) {
    const winLine = state.status === "win" ? gomoku.result(state).line : [];
    const last = state.moves.at(-1);
    const lastIdx = last?.cell ?? -1;
    const grid = document.createElement("div");
    grid.className = "g5-grid";
    state.board.forEach((mark, i) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "g5-cell";
      if (mark) cell.classList.add("filled", mark === "X" ? "mark-x" : "mark-o");
      if (winLine.includes(i)) cell.classList.add("win");
      if (i === lastIdx) cell.classList.add("last");
      cell.disabled = !canMove || mark !== "";
      cell.setAttribute("aria-label", mark ? `stone ${mark}` : `place at cell ${i}`);
      if (canMove && mark === "" && onMove) {
        cell.addEventListener("click", () => onMove({ cell: i }));
      }
      grid.appendChild(cell);
    });
    el.replaceChildren(grid);
  },
};
