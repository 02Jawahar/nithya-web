'use strict';
const crypto = require('crypto');
const store = require('./store');
const { SESSION_DAYS } = require('./config');

const COOKIE = 'nl_admin';

function sign(payload) {
  return crypto.createHmac('sha256', store.sessionSecret()).update(payload).digest('hex');
}

function issue(user) {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(user + '\n' + expires).toString('base64url');
  return payload + '.' + sign(payload);
}

function read(req) {
  const raw = req.headers.cookie || '';
  const hit = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(COOKIE + '='));
  if (!hit) return null;

  const token = decodeURIComponent(hit.slice(COOKIE.length + 1));
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;

  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(payload);
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;

  const [user, expires] = Buffer.from(payload, 'base64url').toString('utf8').split('\n');
  if (!user || Number(expires) < Date.now()) return null;
  return { user };
}

function setCookie(res, req, value, maxAgeSeconds) {
  // Secure only behind TLS, otherwise the cookie never sticks on localhost.
  const https = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    COOKIE + '=' + encodeURIComponent(value),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + maxAgeSeconds,
  ];
  if (https) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function login(req, res, user) {
  setCookie(res, req, issue(user), SESSION_DAYS * 24 * 60 * 60);
}

function logout(req, res) {
  setCookie(res, req, '', 0);
}

function attach(req, _res, next) {
  req.admin = read(req);
  next();
}

function requireAdmin(req, res, next) {
  if (req.admin) return next();
  // req.path is relative to the mount, so test the full URL instead.
  if (/\/api\//.test(req.originalUrl)) return res.status(401).json({ error: 'Not signed in' });
  const mount = req.originalUrl.replace(/\/admin(\/.*)?$/, '');
  return res.redirect(mount + '/admin/login');
}

module.exports = { attach, requireAdmin, login, logout, read };
