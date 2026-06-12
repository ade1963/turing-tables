// Connect 4 game module. Board is a flat 42-array: 7 columns × 6 rows,
// index = row*7 + col, row 0 at the top. A move is { col: 0..6 }; the disc
// falls to the lowest empty cell. Rules mirrored in the skill's _lib.py.

import { normalizeCommon, baseInit, finishMove } from "./common.js";

const COLS = 7;
const ROWS = 6;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

function dropRow(board, col) {
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[row * COLS + col] === "") return row;
  }
  return null;
}

export const connect4 = {
  id: "connect4",
  name: "Connect 4",

  normalize(state) {
    return normalizeCommon(state, COLS * ROWS);
  },

  init(opts) {
    return baseInit("connect4", opts, COLS * ROWS);
  },

  validate(state, move, by) {
    if (state.status !== "active") return "game is over";
    if (state.turn !== by) return "not your turn";
    const col = move?.col;
    if (!Number.isInteger(col) || col < 0 || col >= COLS) return "column must be an integer 0-6";
    if (dropRow(state.board, col) === null) return `column ${col} is full`;
    return null;
  },

  apply(state, move, by) {
    const next = structuredClone(state);
    const row = dropRow(next.board, move.col);
    next.board[row * COLS + move.col] = next.players[by].mark;
    next.moves.push({ by, col: move.col, row });
    return finishMove(connect4, state, next, by);
  },

  result(state) {
    const b = state.board;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const mark = b[row * COLS + col];
        if (mark === "") continue;
        for (const [dr, dc] of DIRS) {
          const line = [0, 1, 2, 3].map((i) => [row + i * dr, col + i * dc]);
          const ok = line.every(([r, c]) =>
            r >= 0 && r < ROWS && c >= 0 && c < COLS && b[r * COLS + c] === mark
          );
          if (ok) {
            const winner = state.players.agent.mark === mark ? "agent" : "human";
            return { status: "win", winner, line: line.map(([r, c]) => r * COLS + c) };
          }
        }
      }
    }
    if (b.every((v) => v !== "")) return { status: "draw", winner: null };
    return { status: "active", winner: null };
  },

  placeAt(board, entry, mark) {
    board[entry.row * COLS + entry.col] = mark;
  },

  render(el, state, { canMove = false, onMove } = {}) {
    const winLine = state.status === "win" ? connect4.result(state).line : [];
    const last = state.moves.at(-1);
    const lastIdx = last && last.row !== undefined ? last.row * COLS + last.col : -1;
    const grid = document.createElement("div");
    grid.className = "c4-grid";
    state.board.forEach((mark, i) => {
      const col = i % COLS;
      const open = dropRow(state.board, col) !== null;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "c4-cell";
      if (mark) cell.classList.add("filled", mark === "X" ? "mark-x" : "mark-o");
      if (winLine.includes(i)) cell.classList.add("win");
      if (i === lastIdx) cell.classList.add("last");
      cell.dataset.col = col;
      cell.disabled = !canMove || !open;
      cell.setAttribute("aria-label", mark ? `disc ${mark}` : `drop in column ${col}`);
      if (canMove && open && onMove) {
        cell.addEventListener("click", () => onMove({ col }));
      }
      grid.appendChild(cell);
    });
    if (canMove) {
      grid.addEventListener("mouseover", (e) => {
        const c = e.target.dataset?.col;
        for (const x of grid.children) x.classList.toggle("col-hover", x.dataset.col === c);
      });
      grid.addEventListener("mouseleave", () => {
        for (const x of grid.children) x.classList.remove("col-hover");
      });
    }
    el.replaceChildren(grid);
  },
};
