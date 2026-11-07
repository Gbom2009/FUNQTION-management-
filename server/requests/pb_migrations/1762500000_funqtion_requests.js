/// <reference path="../pb_data/types.d.ts" />
// Funqtion Requests (app 9): sessions per gig, guests' requests and votes,
// standing blocks. Guests never write collections directly: they go through
// the routes in pb_hooks (limits, filter). DJs are users of the "users" collection.

migrate((app) => {
  const authed = "@request.auth.id != ''";

  // DJs log in as "users". No public sign-up: only the admin creates the two accounts.
  const users = app.findCollectionByNameOrId("users");
  users.createRule = null;
  app.save(users);

  const sessions = new Collection({
    type: "base",
    name: "sessions",
    listRule: authed, viewRule: authed, createRule: authed, updateRule: authed, deleteRule: authed,
    fields: [
      { name: "code", type: "text", required: true, min: 4, max: 12 },
      { name: "gigId", type: "text" },
      { name: "title", type: "text", max: 120 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["open", "paused", "closed"] },
      { name: "rules", type: "json", maxSize: 20000 },          // {maxOpen, maxPerHour, allowShoutouts, explicitAllowed, showNowPlaying, pauseWindows:[{from,to,label}], blocks:[...]}
      { name: "wedding", type: "json", maxSize: 20000 },        // {names, wishes:[...], priorityCode}
      { name: "nowPlaying", type: "json", maxSize: 2000 },      // {artist, title, at}
      { name: "libraryIndex", type: "json", maxSize: 5000000 }, // [[artist, title, trackId], …] (no files, no paths)
      { name: "closedAt", type: "date" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_sessions_code ON sessions (code)"],
  });
  app.save(sessions);

  const requests = new Collection({
    type: "base",
    name: "requests",
    // Guests may read the live list (for realtime updates), never personal fields.
    listRule: authed + " || (status != 'blocked' && status != 'declined' && session.status != 'closed')",
    viewRule: authed + " || (status != 'blocked' && status != 'declined' && session.status != 'closed')",
    createRule: null, updateRule: null, deleteRule: authed,
    fields: [
      { name: "session", type: "relation", required: true, collectionId: sessions.id, cascadeDelete: true, maxSelect: 1 },
      { name: "artist", type: "text", required: true, max: 120 },
      { name: "title", type: "text", required: true, max: 160 },
      { name: "normKey", type: "text", max: 300 },
      { name: "cover", type: "text", max: 500 },
      { name: "catalogRef", type: "text", max: 120 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["new", "accepted", "later", "declined", "played", "blocked"] },
      { name: "votes", type: "number", min: 0 },
      { name: "inLibrary", type: "bool" },
      { name: "priority", type: "bool" },
      { name: "shoutPublic", type: "text", max: 200 },        // approved shout-out (shown to guests)
      { name: "shoutout", type: "text", max: 200, hidden: true },
      { name: "shoutName", type: "text", max: 40, hidden: true },
      { name: "deviceHash", type: "text", max: 80, hidden: true },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_requests_session ON requests (session)",
      "CREATE INDEX idx_requests_norm ON requests (session, normKey)",
    ],
  });
  app.save(requests);

  const votes = new Collection({
    type: "base",
    name: "votes",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "request", type: "relation", required: true, collectionId: requests.id, cascadeDelete: true, maxSelect: 1 },
      { name: "deviceHash", type: "text", required: true, max: 80, hidden: true },
      { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_votes_once ON votes (request, deviceHash)"],
  });
  app.save(votes);

  const blocks = new Collection({
    type: "base",
    name: "blocks",
    listRule: authed, viewRule: authed, createRule: authed, updateRule: authed, deleteRule: authed,
    fields: [
      { name: "value", type: "text", required: true, max: 200 }, // normKey "artist|title" or "artist:<name>"
      { name: "label", type: "text", max: 200 },
      { name: "created", type: "autodate", onCreate: true },
    ],
  });
  app.save(blocks);
}, (app) => {
  for (const name of ["votes", "requests", "blocks", "sessions"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) { /* already gone */ }
  }
});
