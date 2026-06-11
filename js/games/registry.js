// Game registry: maps state.game id to its module.
// To add a game: create js/games/<id>.js implementing the engine interface
// (see tictactoe.js), import it here, and mirror its rules in
// skill/turing-tables/scripts/_lib.py so the agent can validate moves too.

import { tictactoe } from "./tictactoe.js";

export const games = {
  [tictactoe.id]: tictactoe,
};
