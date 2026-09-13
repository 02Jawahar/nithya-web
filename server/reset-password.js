'use strict';
// Usage: npm run reset-password -- [username] [password]
// With no password a strong one is generated and printed.
const crypto = require('crypto');
const store = require('./store');

const [, , userArg, passArg] = process.argv;
const existing = store.readAdmin();
const user = userArg || (existing && existing.user) || 'admin';

const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const password = passArg
  || Array.from(crypto.randomBytes(16)).map((b) => alphabet[b % alphabet.length]).join('');

store.setPassword(user, password);
console.log('');
console.log('  Admin credentials updated.');
console.log('    username  ' + user);
console.log('    password  ' + password);
console.log('');
