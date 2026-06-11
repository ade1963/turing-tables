// One-time setup: create a free Firebase Realtime Database and paste its URL.
//
//   1. https://console.firebase.google.com → Add project (no Analytics needed)
//   2. Build → Realtime Database → Create database
//   3. Rules tab → allow public access under /games (see README.md)
//   4. Copy the database URL here, e.g.
//        "https://my-agent-club-default-rtdb.europe-west1.firebasedatabase.app"
//
// For local development you can point this at the offline stand-in instead:
//   python3 tools/dev_store.py   →   "http://localhost:8001"

export const config = {
  dbUrl: "",
};
