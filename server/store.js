'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, MAX_VERSIONS } = require('./config');

const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const VERSIONS_DIR = path.join(DATA_DIR, 'versions');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

const EMPTY = { revision: 0, live: {}, draft: {}, updatedAt: null, publishedAt: null };

function ensureDirs() {
  for (const dir of [DATA_DIR, VERSIONS_DIR, UPLOADS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[store] unreadable ' + file + ':', err.message);
    return fallback;
  }
}

// Write to a sibling temp file first so a crash mid-write cannot leave
// the client's content truncated.
function writeJson(file, value) {
  ensureDirs();
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

let state = null;

function load() {
  if (!state) {
    state = Object.assign({}, EMPTY, readJson(CONTENT_FILE, EMPTY));
    state.live = state.live || {};
    state.draft = state.draft || {};
  }
  return state;
}

function persist() {
  state.updatedAt = new Date().toISOString();
  writeJson(CONTENT_FILE, state);
}

// Settings that apply to every page (the logo, for now) live under a
// reserved page key, so draft/publish/versioning all work unchanged.
const SITE_KEY = '@site';

function pageDraft(file) {
  const s = load();
  return s.draft[file] || {};
}

function siteDraft() {
  return load().draft[SITE_KEY] || {};
}

function siteLive() {
  return load().live[SITE_KEY] || {};
}

function pageLive(file) {
  const s = load();
  return s.live[file] || {};
}

/**
 * Merge a patch into one field of the draft.
 * Keys whose value matches the original are dropped, so an edit that is
 * undone by hand leaves no residue behind.
 */
function setField(file, key, patch) {
  const s = load();
  if (!s.draft[file]) s.draft[file] = {};
  const current = s.draft[file][key] || {};
  const next = Object.assign({}, current, patch);

  for (const k of Object.keys(next)) {
    if (next[k] === null || next[k] === undefined) delete next[k];
  }
  if (next.hidden === false) delete next.hidden;

  if (Object.keys(next).length === 0) delete s.draft[file][key];
  else s.draft[file][key] = next;

  if (Object.keys(s.draft[file]).length === 0) delete s.draft[file];
  persist();
  return next;
}

function resetField(file, key) {
  const s = load();
  if (s.draft[file]) {
    delete s.draft[file][key];
    if (Object.keys(s.draft[file]).length === 0) delete s.draft[file];
  }
  persist();
}

function stable(value) {
  return JSON.stringify(value, Object.keys(value || {}).sort());
}

// Per-page list of keys where draft and live disagree.
function pendingChanges() {
  const s = load();
  const out = {};
  const files = new Set([...Object.keys(s.draft), ...Object.keys(s.live)]);
  for (const file of files) {
    const draft = s.draft[file] || {};
    const live = s.live[file] || {};
    const keys = new Set([...Object.keys(draft), ...Object.keys(live)]);
    const changed = [...keys].filter((k) => stable(draft[k]) !== stable(live[k]));
    if (changed.length) out[file] = changed;
  }
  return out;
}

function pendingCount() {
  return Object.values(pendingChanges()).reduce((n, list) => n + list.length, 0);
}

function snapshot(label) {
  ensureDirs();
  const s = load();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeJson(path.join(VERSIONS_DIR, stamp + '.json'), {
    savedAt: new Date().toISOString(),
    revision: s.revision,
    label: label || '',
    content: s.live,
  });
  const files = fs.readdirSync(VERSIONS_DIR).filter((f) => f.endsWith('.json')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - MAX_VERSIONS))) {
    fs.unlinkSync(path.join(VERSIONS_DIR, old));
  }
}

function publish(label) {
  const s = load();
  snapshot(label || 'before publish');
  s.live = JSON.parse(JSON.stringify(s.draft));
  s.revision += 1;
  s.publishedAt = new Date().toISOString();
  persist();
  return s.revision;
}

function discardDraft() {
  const s = load();
  s.draft = JSON.parse(JSON.stringify(s.live));
  persist();
}

function listVersions() {
  ensureDirs();
  return fs.readdirSync(VERSIONS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort().reverse()
    .map((f) => {
      const v = readJson(path.join(VERSIONS_DIR, f), {});
      return { id: f.replace(/\.json$/, ''), savedAt: v.savedAt, revision: v.revision, label: v.label };
    });
}

// Restore lands in the draft, so a restore still goes through Publish.
function restoreVersion(id) {
  const file = path.join(VERSIONS_DIR, path.basename(id) + '.json');
  const v = readJson(file, null);
  if (!v) return false;
  const s = load();
  s.draft = JSON.parse(JSON.stringify(v.content || {}));
  persist();
  return true;
}

function revision() {
  return load().revision;
}

// ---- Admin credentials ------------------------------------------------

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function randomPassword() {
  // Ambiguous characters left out so it survives being read aloud.
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(16)).map((b) => alphabet[b % alphabet.length]).join('');
}

function readAdmin() {
  return readJson(ADMIN_FILE, null);
}

function setPassword(user, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const admin = readAdmin() || {};
  writeJson(ADMIN_FILE, {
    user: user || admin.user || 'admin',
    salt,
    hash: hashPassword(password, salt),
    secret: admin.secret || crypto.randomBytes(32).toString('hex'),
    updatedAt: new Date().toISOString(),
  });
}

/** Create credentials on first boot. Returns the plaintext only when generated. */
function ensureAdmin(envUser, envPassword) {
  ensureDirs();
  const existing = readAdmin();
  if (existing && existing.hash) {
    // An explicit env password always wins, so redeploys can rotate it.
    if (envPassword && hashPassword(envPassword, existing.salt) !== existing.hash) {
      setPassword(envUser || existing.user, envPassword);
      return { user: envUser || existing.user, password: null, rotated: true };
    }
    return { user: existing.user, password: null, rotated: false };
  }
  const user = envUser || 'admin';
  const password = envPassword || randomPassword();
  setPassword(user, password);
  return { user, password: envPassword ? null : password, generated: !envPassword };
}

function verify(user, password) {
  const admin = readAdmin();
  if (!admin || !admin.hash) return false;
  if (String(user) !== admin.user) return false;
  const candidate = Buffer.from(hashPassword(String(password), admin.salt), 'hex');
  const expected = Buffer.from(admin.hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function sessionSecret() {
  const admin = readAdmin();
  return (admin && admin.secret) || 'insecure-fallback-secret';
}

module.exports = {
  DATA_DIR, UPLOADS_DIR, VERSIONS_DIR, SITE_KEY,
  ensureDirs, load, pageDraft, pageLive, siteDraft, siteLive, setField, resetField,
  pendingChanges, pendingCount, publish, discardDraft,
  listVersions, restoreVersion, revision,
  ensureAdmin, setPassword, verify, sessionSecret, readAdmin,
};
