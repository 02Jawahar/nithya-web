'use strict';
const path = require('path');
const express = require('express');
const config = require('./config');
const store = require('./store');
const auth = require('./auth');
const { renderPage, isManaged } = require('./render');
const { buildRouter } = require('./routes-admin');

const { PAGES, SITE_DIR, BASE_PATH, PORT } = config;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
// Keeps BASE_PATH and BASE_PATH + "/" distinct, so the trailing-slash
// redirect below cannot match its own target and loop.
app.set('strict routing', true);

const site = express.Router();
site.use(auth.attach);

// Admin, API and preview live above the public site.
site.use(buildRouter());

// Uploaded media.
site.use('/uploads', express.static(store.UPLOADS_DIR, {
  maxAge: '7d',
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
}));

// Managed pages, rendered with whatever is currently published.
function servePage(file, res) {
  const out = renderPage(file, store.pageLive(file), { revision: store.revision() });
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(out.html);
}

site.get('/', (_req, res) => servePage('index.html', res));

for (const page of PAGES) {
  const stem = page.file.replace(/\.html$/, '');
  site.get('/' + page.file, (_req, res) => servePage(page.file, res));
  site.get('/' + stem, (_req, res) => servePage(page.file, res));   // clean URL
}

// Only the site's own asset tree is public. Serving the whole project
// directory would hand out server/, data/ and node_modules/ as well.
site.use('/assets', express.static(path.join(SITE_DIR, 'assets'), {
  index: false,
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    if (filePath.endsWith('banyan-nation-research-report.pdf')) {
      res.setHeader('Content-Disposition', 'inline; filename="Nitya-Lanka-Banyan-Nation-Report.pdf"');
    }
  },
}));

site.use((req, res) => {
  if (isManaged(req.path.replace(/^\//, ''))) return servePage(req.path.replace(/^\//, ''), res);
  res.status(404);
  servePage('index.html', res);
});

if (BASE_PATH) {
  // A bare prefix must redirect to the trailing slash, or the browser
  // resolves the relative asset URLs against the domain root and misses.
  app.get(BASE_PATH, (_req, res) => res.redirect(301, BASE_PATH + '/'));
  app.use(BASE_PATH, site);
} else {
  app.use(site);
}

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).type('text').send('Server error');
});

// ---- Boot -------------------------------------------------------------
store.ensureDirs();
const admin = store.ensureAdmin(config.ADMIN_USER, config.ADMIN_PASSWORD);
const where = (BASE_PATH || '') + '/admin';

app.listen(PORT, () => {
  console.log('');
  console.log('  Nitya Lanka site   http://localhost:' + PORT + (BASE_PATH || '') + '/');
  console.log('  Admin panel        http://localhost:' + PORT + where);
  console.log('');
  if (admin.password) {
    console.log('  First run - admin account created:');
    console.log('    username  ' + admin.user);
    console.log('    password  ' + admin.password);
    console.log('  Save this now; it is not shown again. Change it under Account in the panel.');
  } else if (admin.rotated) {
    console.log('  Admin password reset from ADMIN_PASSWORD (user: ' + admin.user + ').');
  } else {
    console.log('  Admin user: ' + admin.user + '  (run "npm run reset-password" if it is lost)');
  }
  console.log('');
});
