// Storage adapter. The shared game state lives in a single JSON document
// ("mailbox") that both the browser and the agent read/write by UID.
//
// Backend: any endpoint speaking the Firebase Realtime Database REST subset:
//   GET/PUT/DELETE  <dbUrl>/games/<uid>.json   -> the private, writable game
//   GET/PUT/DELETE  <dbUrl>/watch/<wid>.json   -> a public read-only mirror
//   GET             <dbUrl>/watch.json?orderBy="updatedAt"&limitToLast=N
//                                              -> the spectator lobby listing
// getPath/putPath/listWatch expose the /watch side. Firebase RTDB (free tier)
// supports all of this with CORS; for offline development run
// tools/dev_store.py. Configure the URL in js/config.js.

import { config } from "./config.js";

export class StoreError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // "not_found" | "network" | "http" | "config"
  }
}

function pathUrl(path, query = "") {
  const base = (config.dbUrl || "").replace(/\/+$/, "");
  if (!base) {
    throw new StoreError(
      "config",
      "No database configured. Set dbUrl in js/config.js (see README.md)."
    );
  }
  return `${base}/${path}.json${query}`;
}

function gameUrl(id) {
  return pathUrl(`games/${encodeURIComponent(id)}`);
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

  // Generic path access, used for the public /watch mirror (spectator lobby).
  async getPath(path) {
    const res = await request(pathUrl(path));
    return res.json();
  },

  async putPath(path, data) {
    await request(pathUrl(path), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return data;
  },

  // Last N spectator snapshots, newest first. Firebase bounds this server-side
  // via orderBy/limitToLast (needs ".indexOn": ["updatedAt"] on /watch).
  async listWatch(n = 30) {
    const query = `?orderBy=${encodeURIComponent('"updatedAt"')}&limitToLast=${n}`;
    const res = await request(pathUrl("watch", query));
    const data = (await res.json()) || {};
    return Object.entries(data)
      .map(([wid, snap]) => ({ wid, ...snap }))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  },
};
