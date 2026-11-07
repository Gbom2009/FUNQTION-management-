// Funqtion Requests: pure helpers shared by the PocketBase hooks and the tests.
// Plain CommonJS / ES2015 so it runs in PocketBase's JS engine (goja).

var BAD = [
  // NL
  'kanker', 'kk', 'tering', 'tyfus', 'klootzak', 'kut', 'lul', 'hoer', 'slet', 'mongool', 'debiel', 'neger', 'flikker', 'homo', 'nazi', 'sieg heil',
  'kankerlijer', 'teringlijer', 'pedo', 'verkracht',
  // EN
  'fuck', 'fucking', 'shit', 'bitch', 'cunt', 'whore', 'slut', 'nigger', 'nigga', 'faggot', 'retard', 'rape', 'dick', 'pussy',
];

function fold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/[5$]/g, 's').replace(/7/g, 't');
}

/** True when the text contains a word from the list (also with l33t/accents, whole words). */
function hasBadWords(s) {
  var f = ' ' + fold(s).replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  var squashed = fold(s).replace(/[^a-z]+/g, '');
  for (var i = 0; i < BAD.length; i++) {
    var w = BAD[i];
    if (f.indexOf(' ' + w + ' ') >= 0) return true;
    if (w.length >= 5 && squashed.indexOf(w.replace(/ /g, '')) >= 0) return true;
  }
  return false;
}

function hasLink(s) { return /(https?:\/\/|www\.|\.(com|nl|net|org|be|io|ly|gg)\b)/i.test(String(s || '')); }

/** Trim, drop control characters, collapse whitespace, cap length and emoji runs. */
function cleanText(s, max) {
  var t = String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/([\s\S]{1,2}?)\1{3,}/g, "$1$1$1"); // no "heyyyyyy" or emoji walls (emoji are 2 code units)
  return t.slice(0, max || 120);
}

/** Same normalisation as the hub (src/apps/library/domain/names.ts normKey). */
function normKey(artist, title) {
  function n(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s*[([].*?[)\]]/g, '').replace(/\b(feat|ft|featuring)\.?\b.*$/, '')
      .replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|de|het)\b/g, '').replace(/\s+/g, ' ').trim();
  }
  var first = String(artist || '').split(/\s*(?:,|&| x | vs\.? | and )\s*/i)[0];
  return n(first) + '|' + n(title);
}

/** Sliding-window rate limit: returns { ok, hits } (hits = kept timestamps incl. this one when ok). */
function allowHit(hits, now, windowMs, max) {
  var kept = (hits || []).filter(function (t) { return now - t < windowMs; });
  if (kept.length >= max) return { ok: false, hits: kept };
  kept.push(now);
  return { ok: true, hits: kept };
}

/** Requests paused: by the DJ, or inside a pause window (e.g. the first dance) from Gig Day. */
function isPaused(status, rules, nowMs) {
  if (status === 'paused') return true;
  var w = (rules && rules.pauseWindows) || [];
  for (var i = 0; i < w.length; i++) {
    var from = Date.parse(w[i].from), to = Date.parse(w[i].to);
    if (nowMs >= from && nowMs <= to) return w[i].label || true;
  }
  return false;
}

/** A blocked track or artist (gig blocks + standing blocks), as normKey / "artist:<name>". */
function isBlocked(artist, title, blocks) {
  var k = normKey(artist, title);
  var artists = String(artist || '').toLowerCase().split(/\s*(?:,|&| x | feat\.? | vs\.? )\s*/);
  for (var i = 0; i < (blocks || []).length; i++) {
    var b = blocks[i];
    if (b === k) return true;
    for (var j = 0; j < artists.length; j++) if (b === 'artist:' + artists[j].trim()) return true;
  }
  return false;
}

/** Short, unambiguous session codes ("FQ7K2"). */
var ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function sessionCode(rand) {
  var s = 'FQ';
  for (var i = 0; i < 3; i++) s += ALPHA[Math.floor(rand() * ALPHA.length)];
  return s;
}

/** Search the library index (array of [artist, title, trackId]) without exposing it as a list. */
function searchIndex(index, q, limit) {
  var words = fold(q).split(/\s+/).filter(function (w) { return w.length > 0; });
  if (!words.length || fold(q).replace(/\s/g, '').length < 3) return [];
  var out = [];
  for (var i = 0; i < (index || []).length && out.length < (limit || 5); i++) {
    var hay = fold(index[i][0] + ' ' + index[i][1]);
    var ok = true;
    for (var j = 0; j < words.length; j++) if (hay.indexOf(words[j]) < 0) { ok = false; break; }
    if (ok) out.push({ artist: index[i][0], title: index[i][1], inLibrary: true });
  }
  return out;
}

/** A JSON field of a PocketBase record as an object (hooks get it as raw text). */
function jsonField(rec, name, fallback) {
  try { var raw = rec.getString(name); return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
}

module.exports = { jsonField: jsonField, hasBadWords: hasBadWords, hasLink: hasLink, cleanText: cleanText, normKey: normKey, allowHit: allowHit, isPaused: isPaused, isBlocked: isBlocked, sessionCode: sessionCode, searchIndex: searchIndex, fold: fold };
