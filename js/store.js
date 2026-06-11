// Storage adapter. The shared game state lives in a single JSON document
// ("mailbox") that both the browser and the agent read/write by UID.
//
// Backend: any endpoint speaking the Firebase Realtime Database REST subset:
//   GET  <dbUrl>/games/<uid>.json   -> state JSON, or null if absent
//   PUT  <dbUrl>/games/<uid>.json   -> stores the request body
// Firebase RTDB (free tier) supports this natively with CORS; for offline
// development run tools/dev_store.py. Configure the URL in js/config.js.

import { config } from "./config.js";

export class StoreError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // "not_found" | "network" | "http" | "config"
  }
}

function gameUrl(id) {
  const base = (config.dbUrl || "").replace(/\/+$/, "");
  if (!base) {
    throw new StoreError(
      "config",
      "No database configured. Set dbUrl in js/config.js (see README.md)."
    );
  }
  return `${base}/games/${encodeURIComponent(id)}.json`;
}

async function request(url, options = {}) {
  let res;
  try {
    res = await fetch(url, { cache: "no-store", ...options });
  } catch (err) {
    throw new StoreError("network", `Network error: ${err.message}`);
  }
  if (!res.ok) {
    throw new StoreError("http", `Storage error (HTTP ${res.status})`);
  }
  return res;
}

export const store = {
  async create(state) {
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    await store.put(id, state);
    return id;
  },

  async get(id) {
    const res = await request(gameUrl(id));
    const data = await res.json();
    if (data === null) {
      throw new StoreError("not_found", "Game not found — the link is wrong or the game expired.");
    }
    return data;
  },

  async put(id, state) {
    await request(gameUrl(id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
    return state;
  },
};
