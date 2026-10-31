'use strict';

const MAX_ALLOWED_EMAILS = 20;

function normalizeAllowedEmails(input) {
  if (input == null || input === '') return [];
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\r\n,;]+/) : null;
  if (!raw) throw new Error('Daftar email Cloudflare harus berupa teks atau daftar email.');
  const values = raw.map(item => typeof item === 'string' ? item.trim().toLowerCase() : '').filter(Boolean);
  if (values.length > MAX_ALLOWED_EMAILS) throw new Error(`Maksimal ${MAX_ALLOWED_EMAILS} email diizinkan untuk Quick Tunnel.`);
  const emails = [...new Set(values)];
  for (const email of emails) {
    if (email.length > 254 || /[\s\u0000-\u001f\u007f]/.test(email)) {
      throw new Error(`Format email Cloudflare tidak valid: ${email.slice(0, 80)}`);
    }
    const wildcard = /^\*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(email);
    const normal = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(email);
    if (!wildcard && !normal) throw new Error(`Format email Cloudflare tidak valid: ${email.slice(0, 80)}`);
  }
  return emails;
}

function getProtectionMode({ accessPassword = '', allowedEmails = [] } = {}) {
  if (accessPassword && allowedEmails.length) return 'email+password';
  if (allowedEmails.length) return 'email';
  if (accessPassword) return 'password';
  return 'public';
}

function buildTunnelArgs(previewPort, allowedEmails = []) {
  const port = Number(previewPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port preview untuk Cloudflare Tunnel tidak valid.');
  const emails = normalizeAllowedEmails(allowedEmails);
  const args = ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'];
  for (const email of emails) args.push('--allowed-mail', email);
  return args;
}

function validatePublicAccess({ accessPassword = '', allowedEmails = [], confirmPublicAccess = false } = {}) {
  const emails = normalizeAllowedEmails(allowedEmails);
  if (!accessPassword && emails.length === 0 && confirmPublicAccess !== true) {
    throw new Error('Akses publik tanpa autentikasi belum dikonfirmasi. Gunakan kata sandi, batasi email melalui Cloudflare, atau setujui peringatan akses publik.');
  }
  return { allowedEmails: emails, protectionMode: getProtectionMode({ accessPassword, allowedEmails: emails }) };
}

module.exports = { MAX_ALLOWED_EMAILS, normalizeAllowedEmails, getProtectionMode, buildTunnelArgs, validatePublicAccess };
