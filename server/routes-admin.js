'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const store = require('./store');
const auth = require('./auth');
const { renderPage, inspectPage, clearCache, isManaged } = require('./render');
const { cleanBlock, isEmpty } = require('./media');
const { PAGES, ADMIN_DIR, MAX_UPLOAD_MB } = require('./config');

const ALLOWED_UPLOADS = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif',
  'image/svg+xml', 'application/pdf',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { store.ensureDirs(); cb(null, store.UPLOADS_DIR); },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
      const stem = path.basename(file.originalname, path.extname(file.originalname))
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'file';
      cb(null, stem + '-' + Date.now().toString(36) + ext);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_UPLOADS.has(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported file type: ' + file.mimetype));
  },
});

// Reject cross-site writes. The session cookie is SameSite=Lax, so this is
// belt and braces rather than the only guard.
function sameOrigin(req, res, next) {
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    if (new URL(origin).host === req.headers.host) return next();
  } catch (_) { /* fall through */ }
  return res.status(403).json({ error: 'Cross-origin request refused' });
}

function pageOr404(req, res) {
  const file = req.params.file;
  if (!isManaged(file)) { res.status(404).json({ error: 'Unknown page' }); return null; }
  return file;
}

function buildRouter() {
  // Strict routing keeps "/admin" and "/admin/" distinct, so the
  // trailing-slash redirect below cannot match its own target.
  const router = express.Router({ strict: true });
  router.use(express.json({ limit: '1mb' }));
  router.use(express.urlencoded({ extended: false }));

  // ---- Login ----------------------------------------------------------
  router.get('/admin/login', (req, res) => {
    if (req.admin) return res.redirect((req.baseUrl || '') + '/admin/');
    res.sendFile(path.join(ADMIN_DIR, 'login.html'));
  });

  router.post('/admin/login', sameOrigin, (req, res) => {
    const { username, password } = req.body || {};
    if (!store.verify(username, password)) {
      return res.status(401).json({ error: 'Wrong username or password.' });
    }
    auth.login(req, res, String(username));
    res.json({ ok: true, redirect: (req.baseUrl || '') + '/admin/' });
  });

  router.post('/admin/logout', sameOrigin, (req, res) => {
    auth.logout(req, res);
    res.json({ ok: true });
  });

  // ---- Admin app ------------------------------------------------------
  // The bare path must redirect to the trailing slash, or the browser
  // resolves "assets/admin.css" against the site root instead of /admin/.
  router.get('/admin', (req, res) => res.redirect(301, (req.baseUrl || '') + '/admin/'));
  router.get('/admin/', auth.requireAdmin, (_req, res) => {
    res.sendFile(path.join(ADMIN_DIR, 'index.html'));
  });
  router.use('/admin/assets', express.static(path.join(ADMIN_DIR, 'assets')));

  // ---- API ------------------------------------------------------------
  const api = express.Router();
  api.use(auth.requireAdmin);

  api.get('/state', (req, res) => {
    const pending = store.pendingChanges();
    res.json({
      user: req.admin.user,
      basePath: req.baseUrl || '',
      revision: store.revision(),
      pending,
      pendingCount: store.pendingCount(),
      pages: PAGES.map((p) => Object.assign({}, p, { pending: (pending[p.file] || []).length })),
    });
  });

  api.get('/page/:file', (req, res) => {
    const file = pageOr404(req, res);
    if (!file) return;
    const result = inspectPage(file, store.pageDraft(file));
    const pending = new Set(store.pendingChanges()[file] || []);
    for (const f of result.fields) f.pending = pending.has(f.key);
    for (const g of result.groups) if (g.key) g.pending = pending.has(g.key);
    res.json({ file, groups: result.groups });
  });

  api.post('/page/:file/field', sameOrigin, (req, res) => {
    const file = pageOr404(req, res);
    if (!file) return;
    const body = req.body || {};
    const { key, patch } = body;
    if (!key || typeof key !== 'string') return res.status(400).json({ error: 'Missing key' });
    if (!patch || typeof patch !== 'object') return res.status(400).json({ error: 'Missing patch' });

    // Accept the reset flag at either level.
    if (patch.reset === true || body.reset === true) {
      store.resetField(file, key);
      return res.json({ ok: true, reset: true, pendingCount: store.pendingCount() });
    }

    const clean = {};
    for (const name of ['html', 'text', 'href', 'src', 'alt']) {
      if (typeof patch[name] === 'string') clean[name] = patch[name].slice(0, 20000);
    }
    if (typeof patch.hidden === 'boolean') clean.hidden = patch.hidden;
    store.setField(file, key, clean);
    res.json({ ok: true, pendingCount: store.pendingCount() });
  });

  // Images and videos added to a section. The whole list is replaced at
  // once, which keeps ordering and removal trivial.
  api.post('/page/:file/media', sameOrigin, (req, res) => {
    const file = pageOr404(req, res);
    if (!file) return;
    const { key, blocks } = req.body || {};
    if (!key || !String(key).startsWith('media:')) {
      return res.status(400).json({ error: 'Bad media key' });
    }
    if (!Array.isArray(blocks)) return res.status(400).json({ error: 'Missing blocks' });
    if (blocks.length > 20) return res.status(400).json({ error: 'At most 20 items per section.' });

    const cleaned = blocks.map(cleanBlock);
    const rejected = cleaned.filter(isEmpty).length;

    if (cleaned.length === 0) store.resetField(file, key);
    else store.setField(file, key, { blocks: cleaned });

    res.json({ ok: true, blocks: cleaned, rejected, pendingCount: store.pendingCount() });
  });

  api.post('/publish', sameOrigin, (req, res) => {
    const revision = store.publish((req.body && req.body.label) || '');
    clearCache();
    res.json({ ok: true, revision, pendingCount: store.pendingCount() });
  });

  api.post('/discard', sameOrigin, (_req, res) => {
    store.discardDraft();
    res.json({ ok: true, pendingCount: store.pendingCount() });
  });

  api.get('/versions', (_req, res) => res.json({ versions: store.listVersions() }));

  api.post('/versions/:id/restore', sameOrigin, (req, res) => {
    if (!store.restoreVersion(req.params.id)) return res.status(404).json({ error: 'No such version' });
    res.json({ ok: true, pendingCount: store.pendingCount() });
  });

  // ---- Media ----------------------------------------------------------
  api.get('/media', (req, res) => {
    store.ensureDirs();
    const base = req.baseUrl.replace(/\/api$/, '');
    const files = fs.readdirSync(store.UPLOADS_DIR)
      .filter((f) => !f.startsWith('.'))
      .map((f) => {
        const stat = fs.statSync(path.join(store.UPLOADS_DIR, f));
        return { name: f, url: base + '/uploads/' + f, size: stat.size, modified: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
    res.json({ files });
  });

  api.post('/media', sameOrigin, (req, res) => {
    upload.array('files', 10)(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      const base = req.baseUrl.replace(/\/api$/, '');
      res.json({
        ok: true,
        files: (req.files || []).map((f) => ({
          name: f.filename, url: base + '/uploads/' + f.filename, size: f.size,
        })),
      });
    });
  });

  api.delete('/media/:name', sameOrigin, (req, res) => {
    const name = path.basename(req.params.name);
    const target = path.join(store.UPLOADS_DIR, name);
    if (!target.startsWith(store.UPLOADS_DIR) || !fs.existsSync(target)) {
      return res.status(404).json({ error: 'No such file' });
    }
    fs.unlinkSync(target);
    res.json({ ok: true });
  });

  // ---- Account --------------------------------------------------------
  api.post('/password', sameOrigin, (req, res) => {
    const { current, next, username } = req.body || {};
    if (!store.verify(req.admin.user, current)) {
      return res.status(403).json({ error: 'Current password is wrong.' });
    }
    if (!next || String(next).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }
    const user = (username && String(username).trim()) || req.admin.user;
    store.setPassword(user, String(next));
    auth.login(req, res, user);
    res.json({ ok: true, user });
  });

  router.use('/api', api);

  // ---- Draft preview --------------------------------------------------
  router.get('/preview/:file', auth.requireAdmin, (req, res) => {
    const file = req.params.file;
    if (!isManaged(file)) return res.status(404).send('Unknown page');
    const out = renderPage(file, store.pageDraft(file), { preview: true, basePath: req.baseUrl });
    res.type('html').send(out.html);
  });

  return router;
}

module.exports = { buildRouter };
