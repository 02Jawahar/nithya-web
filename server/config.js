'use strict';
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Pages the CMS manages. Order drives the admin sidebar.
const PAGES = [
  { file: 'index.html',       title: 'Home' },
  { file: 'music.html',       title: 'Music' },
  { file: 'nityaragam.html',  title: 'Nityaragam' },
  { file: 'internships.html', title: 'Internships' },
  { file: 'projects.html',    title: 'Projects' },
  { file: 'community.html',   title: 'Community' },
];

module.exports = {
  ROOT,
  PAGES,
  SITE_DIR: ROOT,
  ADMIN_DIR: path.join(ROOT, 'admin'),
  DATA_DIR: process.env.DATA_DIR || path.join(ROOT, 'data'),
  PORT: Number(process.env.PORT || 3000),
  // Serve the whole app under a path prefix, e.g. BASE_PATH=/nithya
  BASE_PATH: (process.env.BASE_PATH || '').replace(/\/+$/, ''),
  ADMIN_USER: process.env.ADMIN_USER || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  SESSION_DAYS: 14,
  MAX_UPLOAD_MB: Number(process.env.MAX_UPLOAD_MB || 25),
  MAX_VERSIONS: 50,
};
