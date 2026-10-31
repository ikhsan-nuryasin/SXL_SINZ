'use strict';

const MANAGED_SECTIONS = new Set(['client', 'mysqld', 'mariadbd', 'server', 'mariadb']);

/** Update port directives only in the database client/server option groups. */
function updateDatabaseIniPort(source, port) {
  if (typeof source !== 'string') throw new TypeError('Isi my.ini harus berupa teks.');
  if (!Number.isInteger(Number(port)) || Number(port) < 1024 || Number(port) > 65535) {
    throw new RangeError('Port harus bilangan bulat antara 1024 dan 65535.');
  }
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const content = bom ? source.slice(1) : source;
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const hadFinalNewline = /(?:\r?\n)$/.test(content);
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (hadFinalNewline) lines.pop();

  const output = [];
  let activeSection = '';
  let sectionHasPort = false;
  let hasServerSection = false;

  const flushMissingPort = () => {
    if (MANAGED_SECTIONS.has(activeSection) && !sectionHasPort) output.push(`port=${Number(port)}`);
  };

  for (const line of lines) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*(?:[;#].*)?$/);
    if (sectionMatch) {
      flushMissingPort();
      activeSection = sectionMatch[1].trim().toLowerCase();
      sectionHasPort = false;
      if (activeSection === 'mysqld' || activeSection === 'mariadbd' || activeSection === 'server' || activeSection === 'mariadb') {
        hasServerSection = true;
      }
      output.push(line);
      continue;
    }
    if (MANAGED_SECTIONS.has(activeSection) && /^\s*port\s*=/i.test(line)) {
      const match = line.match(/^(\s*port\s*=\s*)(.*?)(\s*(?:[;#].*)?)$/i);
      output.push(match ? `${match[1]}${Number(port)}${match[3]}` : `port=${Number(port)}`);
      sectionHasPort = true;
    } else {
      output.push(line);
    }
  }
  flushMissingPort();
  if (!hasServerSection) {
    if (output.length && output[output.length - 1].trim()) output.push('');
    output.push('[mysqld]', `port=${Number(port)}`);
  }
  return bom + output.join(eol) + (hadFinalNewline ? eol : '');
}

module.exports = { updateDatabaseIniPort };
