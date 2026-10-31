'use strict';

function isTrustedAppUrl(rawUrl, baseUrl) {
  try {
    const target = new URL(rawUrl);
    const base = new URL(baseUrl);
    return target.origin === base.origin && target.protocol === 'http:' &&
      target.hostname === '127.0.0.1' && !target.username && !target.password;
  } catch { return false; }
}

function isAllowedExternalUrl(rawUrl) {
  try {
    const target = new URL(rawUrl);
    return ['https:', 'http:'].includes(target.protocol) && !target.username && !target.password;
  } catch { return false; }
}

module.exports = { isTrustedAppUrl, isAllowedExternalUrl };
