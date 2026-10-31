'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseEngineManager, validatePort, validateDatabaseName, validateSql, escapePgPass, within } = require('../lib/database-engines');

function makeTemp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-db-engines-')); }
function makeBins(root, names) {
  const dir = path.join(root, 'bin'); fs.mkdirSync(dir, { recursive: true });
  for (const name of names) fs.writeFileSync(path.join(dir, name), '# mock executable\n');
  return dir;
}
function fakeCommands(root) {
  let postgresRunning = false;
  const command = async (exe, args, options = {}) => {
    const name = path.basename(exe).replace(/\.exe$/i, '').toLowerCase();
    if (name === 'postgres' && args[0] === '--version') return { stdout: 'postgres (PostgreSQL) 17.6', stderr: '' };
    if (name === 'initdb') {
      const darg = args.find(v => v.startsWith('-D'));
      const dataDir = darg === '-D' ? args[args.indexOf('-D') + 1] : darg.slice(2);
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, 'PG_VERSION'), '17\n');
      return { stdout: 'database system initialized', stderr: '' };
    }
    if (name === 'pg_ctl') {
      if (args.includes('status')) {
        if (!postgresRunning) throw new Error('no server running');
        return { stdout: 'server is running', stderr: '' };
      }
      if (args.includes('start')) { postgresRunning = true; fs.mkdirSync(path.dirname(args[args.indexOf('-l') + 1]), { recursive: true }); fs.writeFileSync(args[args.indexOf('-l') + 1], 'started\n'); return { stdout: 'server started', stderr: '' }; }
      if (args.includes('stop')) { postgresRunning = false; return { stdout: 'server stopped', stderr: '' }; }
    }
    if (name === 'psql') return { stdout: 'postgres\n', stderr: '' };
    if (name === 'pg_dump') {
      const file = args[args.indexOf('-f') + 1]; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'FAKE-PG-DUMP'); return { stdout: '', stderr: '' };
    }
    if (name === 'sqlite3' && args[0] === '--version') return { stdout: '3.50.0 2025-01-01', stderr: '' };
    if (name === 'sqlite3') {
      const databasePath = args.find(a => typeof a === 'string' && (a.endsWith('.sqlite3') || a.endsWith('.sqlite')) && !a.includes('.backup'));
      if (args.some(a => /^PRAGMA user_version/i.test(a))) {
        if (databasePath) { fs.mkdirSync(path.dirname(databasePath), { recursive: true }); fs.writeFileSync(databasePath, 'SQLite mock'); }
        return { stdout: '0\n', stderr: '' };
      }
      const backupArg = args.find(a => /^\.backup\s/.test(a));
      if (backupArg) {
        const match = backupArg.match(/^\.backup\s+"(.+)"$/);
        if (!match) throw new Error('bad backup path');
        const dest = match[1].replace(/""/g, '"'); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, 'SQLite backup'); return { stdout: '', stderr: '' };
      }
      if (args.includes('-json')) return { stdout: '[{"sqlite_version":"3.50.0"}]', stderr: '' };
    }
    throw new Error(`Unexpected mock command: ${name} ${args.join(' ')}`);
  };
  return { command, isRunning: () => postgresRunning };
}

test('validates ports, identifiers and SQL input', () => {
  assert.equal(validatePort('5433'), 5433);
  assert.throws(() => validatePort(80), /1024/);
  assert.throws(() => validatePort(65536), /1024/);
  assert.equal(validateDatabaseName('app_1'), 'app_1');
  assert.throws(() => validateDatabaseName('../private'), /Nama database/);
  assert.equal(validateDatabaseName(' leading '), 'leading');
  assert.throws(() => validateSql(''), /tidak boleh kosong/);
  assert.throws(() => validateSql('SELECT \0'), /NUL/);
  assert.equal(within('/sxl/data/sqlite', '/sxl/data/sqlite/demo.sqlite3'), true);
  assert.equal(within('/sxl/data/sqlite', '/sxl/data/other.sqlite3'), false);
  assert.equal(escapePgPass('a:b\\c'), 'a\\:b\\\\c');
});

test('PostgreSQL config, initialize, start, query, backup and graceful stop are managed in an isolated SXL path', async t => {
  const root = makeTemp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bins = makeBins(root, ['postgres', 'initdb', 'pg_ctl', 'psql', 'pg_dump']);
  const fake = fakeCommands(root);
  const manager = new DatabaseEngineManager(root, { platform: 'linux', runCommand: fake.command, portAvailable: async () => true });
  const config = await manager.configurePostgres({ binDir: bins, port: 55433 });
  assert.equal(config.status.configured, true);
  assert.equal(config.status.port, 55433);
  assert.equal(config.status.initialized, false);
  assert.match(config.status.version, /PostgreSQL/);
  const initialized = await manager.initializePostgres();
  assert.equal(initialized.status.initialized, true);
  assert.equal(fs.existsSync(path.join(root, 'data', 'database-engines', 'postgresql', 'default', 'PG_VERSION')), true);
  const started = await manager.startPostgres();
  assert.equal(started.status.running, true);
  const query = await manager.queryPostgres({ database: 'postgres', sql: 'SELECT current_database();' });
  assert.equal(query.output, 'postgres');
  const backups = await manager.backupPostgres({ database: 'postgres' });
  assert.equal(fs.statSync(backups.backup).size > 0, true);
  const stop = await manager.stopPostgres();
  assert.equal(stop.stopped, true);
  assert.equal(fake.isRunning(), false);
});

test('PostgreSQL refuses unregistered non-empty existing data directory', async t => {
  const root = makeTemp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = new DatabaseEngineManager(root, { platform: 'linux', runCommand: async (exe, args) => args[0] === '--version' ? ({ stdout: 'postgres (PostgreSQL) 17.5', stderr: '' }) : ({ stdout: '', stderr: '' }) });
  fs.mkdirSync(manager.pgDataDir, { recursive: true });
  fs.writeFileSync(path.join(manager.pgDataDir, 'important.db'), 'must not be adopted');
  const bins = makeBins(root, ['postgres', 'initdb', 'pg_ctl', 'psql', 'pg_dump']);
  await assert.rejects(manager.configurePostgres({ binDir: bins }), /tidak diadopsi otomatis/);
  assert.equal(fs.readFileSync(path.join(manager.pgDataDir, 'important.db'), 'utf8'), 'must not be adopted');
});

test('PostgreSQL port conflict blocks start without killing another process', async t => {
  const root = makeTemp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bins = makeBins(root, ['postgres', 'initdb', 'pg_ctl', 'psql', 'pg_dump']);
  const fake = fakeCommands(root);
  const manager = new DatabaseEngineManager(root, { platform: 'linux', runCommand: fake.command, portAvailable: async () => false });
  await manager.configurePostgres({ binDir: bins, port: 55434 });
  await manager.initializePostgres();
  await assert.rejects(manager.startPostgres(), /Port 55434 sedang digunakan/);
  assert.equal(fake.isRunning(), false);
});

test('failed PostgreSQL initdb preserves partial folder in recovery, not by deleting it', async t => {
  const root = makeTemp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bins = makeBins(root, ['postgres', 'initdb', 'pg_ctl', 'psql', 'pg_dump']);
  const fake = fakeCommands(root);
  const runCommand = async (exe, args, options) => {
    if (path.basename(exe).replace(/\.exe$/i, '') === 'initdb') {
      const idx = args.indexOf('-D'); const data = args[idx + 1]; fs.mkdirSync(data, { recursive: true }); fs.writeFileSync(path.join(data, 'partial-config'), 'keep me'); throw new Error('simulated initdb failure');
    }
    return fake.command(exe, args, options);
  };
  const manager = new DatabaseEngineManager(root, { platform: 'linux', runCommand, portAvailable: async () => true });
  await manager.configurePostgres({ binDir: bins });
  await assert.rejects(manager.initializePostgres(), /recovery-default/);
  const parent = path.dirname(manager.pgDataDir);
  const recovery = fs.readdirSync(parent).find(name => name.startsWith('recovery-default-'));
  assert.ok(recovery);
  assert.equal(fs.readFileSync(path.join(parent, recovery, 'partial-config'), 'utf8'), 'keep me');
  assert.equal(fs.existsSync(manager.pgDataDir), false);
});

test('SQLite allows only sqlite3 executable and creates, queries, and backs up SXL-owned files', async t => {
  const root = makeTemp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cliDir = path.join(root, 'tools'); fs.mkdirSync(cliDir); const cli = path.join(cliDir, 'sqlite3'); fs.writeFileSync(cli, 'mock');
  const fake = fakeCommands(root);
  const manager = new DatabaseEngineManager(root, { platform: 'linux', runCommand: fake.command });
  await assert.rejects(manager.configureSqlite({ executable: path.join(cliDir, 'bad-cli') }), /tidak ditemukan/);
  await manager.configureSqlite({ executable: cli });
  const created = await manager.createSqlite({ name: 'sample_db' });
  assert.equal(fs.existsSync(created.file), true);
  const query = await manager.querySqlite({ database: 'sample_db', sql: 'SELECT sqlite_version();' });
  assert.match(query.output, /sqlite_version/);
  const backup = await manager.backupSqlite({ database: 'sample_db' });
  assert.equal(fs.statSync(backup.backup).size > 0, true);
  await assert.rejects(manager.createSqlite({ name: 'sample_db' }), /sudah ada/);
});

test('PostgreSQL refuses runtime or port changes while a cluster is running', async t => {
  const root = makeTemp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bins = makeBins(root, ['postgres', 'initdb', 'pg_ctl', 'psql', 'pg_dump']);
  const fake = fakeCommands(root);
  const manager = new DatabaseEngineManager(root, { platform: 'linux', runCommand: fake.command, portAvailable: async () => true });
  await manager.configurePostgres({ binDir: bins, port: 55435 });
  await manager.initializePostgres();
  await manager.startPostgres();
  await assert.rejects(manager.configurePostgres({ binDir: bins, port: 55436 }), /sedang berjalan/);
  assert.equal(manager.readSettings().postgresql.port, 55435, 'old port configuration must remain unchanged');
});

test('PostgreSQL refuses runtime replacement when an initialized cluster status cannot be verified', async t => {
  const root = makeTemp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const oldBin = makeBins(path.join(root, 'old-install'), ['postgres', 'initdb', 'pg_ctl', 'psql', 'pg_dump']);
  const newBin = makeBins(path.join(root, 'new-install'), ['postgres', 'initdb', 'pg_ctl', 'psql', 'pg_dump']);
  const fake = fakeCommands(root);
  const manager = new DatabaseEngineManager(root, { platform: 'linux', runCommand: fake.command, portAvailable: async () => true });
  await manager.configurePostgres({ binDir: oldBin, port: 55437 });
  await manager.initializePostgres();
  fs.rmSync(oldBin, { recursive: true, force: true });
  await assert.rejects(manager.configurePostgres({ binDir: newBin, port: 55438 }), /Tidak dapat memverifikasi status cluster/);
  assert.equal(manager.readSettings().postgresql.binDir, oldBin, 'configuration is kept intact when old service cannot be verified');
});
