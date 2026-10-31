'use strict';
const crypto = require('node:crypto');

function isValidSharePassword(value) {
  return typeof value === 'string' && value.length >= 10 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}
function isBasicAuthorized(req, expectedPassword) {
  if (!expectedPassword) return true;
  const header = String(req?.headers?.authorization || '');
  const match = header.match(/^Basic\s+([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return false;
  let decoded;
  try { decoded = Buffer.from(match[1], 'base64').toString('utf8'); } catch { return false; }
  const split = decoded.indexOf(':');
  if (split < 0) return false;
  const username = decoded.slice(0, split);
  const password = decoded.slice(split + 1);
  if (username !== 'sxl') return false;
  const actual = Buffer.from(password, 'utf8');
  const expected = Buffer.from(expectedPassword, 'utf8');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function basicChallengeHeaders() {
  return {
    'WWW-Authenticate': 'Basic realm="SXL Website", charset="UTF-8"',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  };
}
function sendBasicChallenge(res) {
  res.writeHead(401, { ...basicChallengeHeaders(), 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Autentikasi diperlukan.');
}
module.exports = { isValidSharePassword, isBasicAuthorized, basicChallengeHeaders, sendBasicChallenge };
