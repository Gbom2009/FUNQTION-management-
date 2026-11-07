/// <reference path="../pb_data/types.d.ts" />
// Funqtion Requests: guest routes (no login) and DJ routes (login), plus the
// nightly clean-up that removes personal data 30 days after a gig.
// Each handler runs in its own JS runtime, so helpers are required inside it.

// ---- guests --------------------------------------------------------------------

/** Public session info for the guest page. */
routerAdd("GET", "/api/fq/s/{code}", (e) => {
  const lib = require(`${__hooks}/lib/requests.js`);
  let s;
  try { s = $app.findFirstRecordByData("sessions", "code", e.request.pathValue("code").toUpperCase()); } catch (_) { return e.json(404, { error: "not_found" }); }
  if (s.getString("status") === "closed") return e.json(410, { error: "closed" });
  const rules = lib.jsonField(s, "rules", {});
  const wedding = lib.jsonField(s, "wedding", {});
  const paused = lib.isPaused(s.getString("status"), rules, Date.now());
  return e.json(200, {
    id: s.id, code: s.getString("code"), title: s.getString("title"),
    paused: !!paused, pausedLabel: typeof paused === "string" ? paused : "",
    allowShoutouts: !!rules.allowShoutouts,
    nowPlaying: rules.showNowPlaying ? lib.jsonField(s, "nowPlaying", null) : null,
    wedding: wedding.names ? { names: wedding.names, wishes: wedding.wishes || [] } : null,
  });
});

/** Search: our library first (only matches, never the full list), then a public catalogue. */
routerAdd("GET", "/api/fq/search", (e) => {
  const lib = require(`${__hooks}/lib/requests.js`);
  const q = String(e.request.url.query().get("q") || "").slice(0, 80);
  const code = String(e.request.url.query().get("c") || "").toUpperCase();
  let s;
  try { s = $app.findFirstRecordByData("sessions", "code", code); } catch (_) { return e.json(404, { error: "not_found" }); }
  const ours = lib.searchIndex(lib.jsonField(s, "libraryIndex", []), q, 5);
  let catalog = [];
  if (q.trim().length >= 3) {
    try {
      const res = $http.send({ url: "https://api.deezer.com/search?limit=8&q=" + encodeURIComponent(q), timeout: 6 });
      if (res.statusCode === 200 && res.json && res.json.data) {
        catalog = res.json.data.map((d) => ({ artist: d.artist && d.artist.name, title: d.title_short || d.title, cover: d.album && d.album.cover_small, ref: "deezer:" + d.id, explicit: !!d.explicit_lyrics }));
      }
    } catch (_) { /* offline: our library only */ }
  }
  const seen = {};
  const out = [];
  for (const r of ours.concat(catalog)) {
    if (!r.artist || !r.title) continue;
    const k = lib.normKey(r.artist, r.title);
    if (seen[k]) continue;
    seen[k] = true;
    out.push(r);
  }
  return e.json(200, { results: out.slice(0, 10) });
});

/** A guest's request (or a vote, when someone already asked for the same song). */
routerAdd("POST", "/api/fq/request", (e) => {
  const lib = require(`${__hooks}/lib/requests.js`);
  const body = e.requestInfo().body || {};
  let s;
  try { s = $app.findFirstRecordByData("sessions", "code", String(body.c || "").toUpperCase()); } catch (_) { return e.json(404, { error: "not_found" }); }
  const rules = lib.jsonField(s, "rules", {});
  if (s.getString("status") === "closed") return e.json(410, { error: "closed" });
  if (lib.isPaused(s.getString("status"), rules, Date.now())) return e.json(423, { error: "paused" });
  const device = String(body.device || "");
  if (device.length < 16) return e.json(400, { error: "device" });
  const deviceHash = $security.sha256(device + ":" + s.id);
  const artist = lib.cleanText(body.artist, 120), title = lib.cleanText(body.title, 160);
  if (!artist || !title) return e.json(400, { error: "empty" });
  if (lib.hasBadWords(artist + " " + title) || lib.hasLink(artist + " " + title)) return e.json(422, { error: "filtered" });
  const shout = lib.cleanText(body.shoutout, 200), shoutName = lib.cleanText(body.name, 40);
  if (shout && (!rules.allowShoutouts || lib.hasBadWords(shout + " " + shoutName) || lib.hasLink(shout))) return e.json(422, { error: "filtered" });
  const blocks = (rules.blocks || []).concat($app.findRecordsByFilter("blocks", "id != ''", "", 2000, 0).map((b) => b.getString("value")));
  if (lib.isBlocked(artist, title, blocks)) return e.json(422, { error: "not_tonight" });
  if (body.explicit && rules.explicitAllowed === false) return e.json(422, { error: "not_tonight" });

  // Limits: per phone (open requests + per hour) and per network (memory only, never stored).
  const now = Date.now();
  const ipKey = "fqip:" + $security.sha256(e.realIP() + ":" + s.id);
  const ipHit = lib.allowHit($app.store().get(ipKey) || [], now, 10 * 60 * 1000, rules.maxPerNetwork || 40);
  if (!ipHit.ok) return e.json(429, { error: "slow_down" });
  $app.store().set(ipKey, ipHit.hits);
  const mine = $app.findRecordsByFilter("requests", "session = {:s} && deviceHash = {:d}", "-created", 200, 0, { s: s.id, d: deviceHash });
  const open = mine.filter((r) => ["new", "accepted", "later"].indexOf(r.getString("status")) >= 0).length;
  const lastHour = mine.filter((r) => now - new Date(r.getString("created").replace(" ", "T")).getTime() < 3600000).length;
  if (open >= (rules.maxOpen || 3) || lastHour >= (rules.maxPerHour || 10)) return e.json(429, { error: "limit" });

  const key = lib.normKey(artist, title);
  let existing = null;
  try { existing = $app.findFirstRecordByFilter("requests", "session = {:s} && normKey = {:k}", { s: s.id, k: key }); } catch (_) { existing = null; }
  if (existing) {
    if (existing.getString("status") === "blocked" || existing.getString("status") === "declined") return e.json(422, { error: "not_tonight" });
    try {
      const v = new Record($app.findCollectionByNameOrId("votes"));
      v.set("request", existing.id); v.set("deviceHash", deviceHash);
      $app.save(v);
      existing.set("votes", existing.getInt("votes") + 1);
      $app.save(existing);
    } catch (_) { /* already voted */ }
    return e.json(200, { id: existing.id, merged: true });
  }
  const index = lib.jsonField(s, "libraryIndex", []);
  let inLibrary = false;
  for (let i = 0; i < index.length; i++) if (lib.normKey(index[i][0], index[i][1]) === key) { inLibrary = true; break; }
  const wedding = lib.jsonField(s, "wedding", {});
  const r = new Record($app.findCollectionByNameOrId("requests"));
  r.set("session", s.id); r.set("artist", artist); r.set("title", title); r.set("normKey", key);
  r.set("cover", String(body.cover || "").slice(0, 500)); r.set("catalogRef", String(body.ref || "").slice(0, 120));
  r.set("status", "new"); r.set("votes", 1); r.set("inLibrary", inLibrary);
  r.set("priority", !!(wedding.priorityCode && body.priorityCode && String(body.priorityCode).toUpperCase() === String(wedding.priorityCode).toUpperCase()));
  r.set("deviceHash", deviceHash);
  if (shout) { r.set("shoutout", shout); r.set("shoutName", shoutName); }
  $app.save(r);
  const v = new Record($app.findCollectionByNameOrId("votes"));
  v.set("request", r.id); v.set("deviceHash", deviceHash);
  $app.save(v);
  return e.json(200, { id: r.id, merged: false });
});

/** Upvote someone else's request (once per phone). */
routerAdd("POST", "/api/fq/vote", (e) => {
  const lib = require(`${__hooks}/lib/requests.js`);
  const body = e.requestInfo().body || {};
  let r;
  try { r = $app.findRecordById("requests", String(body.id || "")); } catch (_) { return e.json(404, { error: "not_found" }); }
  const s = $app.findRecordById("sessions", r.getString("session"));
  if (s.getString("status") === "closed" || ["blocked", "declined", "played"].indexOf(r.getString("status")) >= 0) return e.json(409, { error: "closed" });
  const device = String(body.device || "");
  if (device.length < 16) return e.json(400, { error: "device" });
  const ipKey = "fqvote:" + $security.sha256(e.realIP() + ":" + s.id);
  const hit = lib.allowHit($app.store().get(ipKey) || [], Date.now(), 60 * 1000, 60);
  if (!hit.ok) return e.json(429, { error: "slow_down" });
  $app.store().set(ipKey, hit.hits);
  const deviceHash = $security.sha256(device + ":" + s.id);
  try {
    const v = new Record($app.findCollectionByNameOrId("votes"));
    v.set("request", r.id); v.set("deviceHash", deviceHash);
    $app.save(v);
  } catch (_) { return e.json(200, { votes: r.getInt("votes"), already: true }); }
  r.set("votes", r.getInt("votes") + 1);
  $app.save(r);
  return e.json(200, { votes: r.getInt("votes") });
});

/** The status of my own requests (by phone token, nothing else). */
routerAdd("GET", "/api/fq/mine", (e) => {
  const q = e.request.url.query();
  let s;
  try { s = $app.findFirstRecordByData("sessions", "code", String(q.get("c") || "").toUpperCase()); } catch (_) { return e.json(404, { error: "not_found" }); }
  const device = String(q.get("device") || "");
  if (device.length < 16) return e.json(200, { mine: [], voted: [] });
  const deviceHash = $security.sha256(device + ":" + s.id);
  const mine = $app.findRecordsByFilter("requests", "session = {:s} && deviceHash = {:d}", "-created", 50, 0, { s: s.id, d: deviceHash });
  const voted = $app.findRecordsByFilter("votes", "request.session = {:s} && deviceHash = {:d}", "", 500, 0, { s: s.id, d: deviceHash });
  return e.json(200, {
    mine: mine.map((r) => ({ id: r.id, artist: r.getString("artist"), title: r.getString("title"), status: r.getString("status") })),
    voted: voted.map((v) => v.getString("request")),
  });
});

// ---- DJ (login required) ----------------------------------------------------------

/** The full queue for a session, with shout-outs to approve. */
routerAdd("GET", "/api/fq/dj/requests/{session}", (e) => {
  const list = $app.findRecordsByFilter("requests", "session = {:s}", "-priority,-votes,created", 500, 0, { s: e.request.pathValue("session") });
  return e.json(200, {
    items: list.map((r) => ({
      id: r.id, artist: r.getString("artist"), title: r.getString("title"), normKey: r.getString("normKey"), cover: r.getString("cover"),
      status: r.getString("status"), votes: r.getInt("votes"), inLibrary: r.getBool("inLibrary"), priority: r.getBool("priority"),
      shoutout: r.getString("shoutout"), shoutName: r.getString("shoutName"), shoutPublic: r.getString("shoutPublic"), created: r.getString("created"),
    })),
  });
}, $apis.requireAuth("users"));

/** DJ actions on one request. */
routerAdd("POST", "/api/fq/dj/act", (e) => {
  const lib = require(`${__hooks}/lib/requests.js`);
  const body = e.requestInfo().body || {};
  const r = $app.findRecordById("requests", String(body.id || ""));
  const a = String(body.action || "");
  const map = { accept: "accepted", later: "later", decline: "declined", played: "played", reopen: "new" };
  if (map[a]) r.set("status", map[a]);
  else if (a === "block" || a === "block_artist") {
    r.set("status", "blocked");
    const b = new Record($app.findCollectionByNameOrId("blocks"));
    b.set("value", a === "block" ? lib.normKey(r.getString("artist"), r.getString("title")) : "artist:" + r.getString("artist").toLowerCase().trim());
    b.set("label", a === "block" ? r.getString("artist") + " – " + r.getString("title") : r.getString("artist"));
    $app.save(b);
  } else if (a === "approve_shout") {
    const name = r.getString("shoutName");
    r.set("shoutPublic", (name ? name + ": " : "") + r.getString("shoutout"));
  } else if (a === "reject_shout") { r.set("shoutout", ""); r.set("shoutName", ""); r.set("shoutPublic", ""); }
  else return e.json(400, { error: "action" });
  $app.save(r);
  return e.json(200, { ok: true, status: r.getString("status") });
}, $apis.requireAuth("users"));

// ---- privacy: personal data goes 30 days after the gig ---------------------------

cronAdd("fq_retention", "17 4 * * *", () => {
  const now = new Date();
  const day = 24 * 3600 * 1000;
  // Close sessions that were left open for more than 36 hours.
  for (const s of $app.findRecordsByFilter("sessions", "status != 'closed'", "", 500, 0)) {
    if (now.getTime() - new Date(s.getString("created").replace(" ", "T")).getTime() > 1.5 * day) {
      s.set("status", "closed"); s.set("closedAt", now.toISOString()); $app.save(s);
    }
  }
  const cutoff = new Date(now.getTime() - 30 * day).toISOString().replace("T", " ");
  for (const s of $app.findRecordsByFilter("sessions", "status = 'closed' && closedAt != '' && closedAt < {:c}", "", 500, 0, { c: cutoff })) {
    for (const r of $app.findRecordsByFilter("requests", "session = {:s}", "", 5000, 0, { s: s.id })) {
      if (r.getString("deviceHash") || r.getString("shoutout") || r.getString("shoutName") || r.getString("shoutPublic")) {
        r.set("deviceHash", ""); r.set("shoutout", ""); r.set("shoutName", ""); r.set("shoutPublic", "");
        $app.save(r);
      }
    }
    for (const v of $app.findRecordsByFilter("votes", "request.session = {:s}", "", 20000, 0, { s: s.id })) $app.delete(v);
    if (s.getString("libraryIndex")) { s.set("libraryIndex", null); $app.save(s); }
  }
});
