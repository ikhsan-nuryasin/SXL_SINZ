'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { translateIndonesianSql, splitSqlStatements, isSafeBackupFilename, validateDatabaseName, getUserDatabases, isSystemDatabase, validateProjectUsername, assertBackupDoesNotRestoreSystemSchemas } = require('../database');

test('Indonesian SQL translates common database keywords', () => {
  assert.equal(translateIndonesianSql('BUAT DATABASE kampus;'), 'CREATE DATABASE kampus;');
  assert.equal(translateIndonesianSql('GUNAKAN kampus;'), 'USE kampus;');
  assert.equal(translateIndonesianSql('BUAT TABEL mahasiswa (id INT, nama VARCHAR(80));'), 'CREATE TABLE mahasiswa (id INT, nama VARCHAR(80));');
  assert.equal(translateIndonesianSql('PILIH nama DARI mahasiswa DIMANA id = 1 URUTKAN BERDASARKAN nama;'), 'SELECT nama FROM mahasiswa WHERE id = 1 ORDER BY nama;');
  assert.equal(translateIndonesianSql('TAMBAHKAN KE mahasiswa (nama) ISI (\'Ikhsan\');'), 'INSERT INTO mahasiswa (nama) VALUES (\'Ikhsan\');');
  assert.equal(translateIndonesianSql('UBAH mahasiswa ATUR nama = \'baru\' DIMANA id = 1;'), 'UPDATE mahasiswa SET nama = \'baru\' WHERE id = 1;');
  assert.equal(translateIndonesianSql('HAPUS DARI mahasiswa DIMANA id = 1;'), 'DELETE FROM mahasiswa WHERE id = 1;');
  assert.equal(translateIndonesianSql('HAPUS DATABASE kampus;'), 'DROP DATABASE kampus;');
  assert.equal(translateIndonesianSql('PILIH pelanggan.nama DARI pelanggan GABUNGKAN pesanan PADA pelanggan.id = pesanan.pelanggan_id;'), 'SELECT pelanggan.nama FROM pelanggan JOIN pesanan ON pelanggan.id = pesanan.pelanggan_id;');
  assert.equal(translateIndonesianSql('BUAT DATABASE JIKA BELUM ADA kampus;'), 'CREATE DATABASE IF NOT EXISTS kampus;');
  assert.equal(translateIndonesianSql('HAPUS pelanggan DIMANA id = 4;'), 'DELETE FROM pelanggan WHERE id = 4;');
});

test('Indonesian SQL translator does not change literals, comments, or backtick identifiers', () => {
  const input = "PILIH `dari`, 'PILIH DARI nama', \"BUAT DATABASE\" DARI mahasiswa -- HAPUS DATABASE\nDIMANA catatan = 'DAN ATAU BUAT';";
  const expected = "SELECT `dari`, 'PILIH DARI nama', \"BUAT DATABASE\" FROM mahasiswa -- HAPUS DATABASE\nWHERE catatan = 'DAN ATAU BUAT';";
  assert.equal(translateIndonesianSql(input), expected);
});

test('SQL statement scanner ignores semicolons inside literals/comments', () => {
  assert.deepEqual(splitSqlStatements("PILIH 'a;b'; -- comment;\n TAMPILKAN DATABASE;"), ["PILIH 'a;b'", '-- comment;\n TAMPILKAN DATABASE']);
  assert.deepEqual(splitSqlStatements("PILIH 'a;b';"), ["PILIH 'a;b'"]);
  assert.deepEqual(splitSqlStatements('   ;  ;'), []);
  assert.deepEqual(splitSqlStatements('PILIH 1; -- catatan di akhir'), ['PILIH 1']);
});


test('backup paths accept only SXL-generated SQL dump filenames', () => {
  assert.equal(isSafeBackupFilename('sxl-backup-all-20261026T125600123Z.sql'), true);
  assert.equal(isSafeBackupFilename('sxl-backup-db-kampus-20261026T125600123Z.sql'), true);
  assert.equal(isSafeBackupFilename('../settings.json'), false);
  assert.equal(isSafeBackupFilename('sxl-backup-all-20261026T125600Z.sql'), false);
  assert.throws(() => validateDatabaseName('../mysql'), /Nama database backup/);
  assert.equal(validateDatabaseName('kampus_2026'), 'kampus_2026');
});


test('all-database backups exclude MariaDB system schemas', () => {
  assert.deepEqual(getUserDatabases(['mysql', 'sys', 'information_schema', 'performance_schema', 'kampus', 'inventori', 'kampus']), ['kampus', 'inventori']);
  assert.deepEqual(getUserDatabases(['mysql', 'sys', 'information_schema', 'performance_schema']), []);
});

test('restore preflight accepts user schema dumps and blocks MariaDB system schema dumps', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-backup-check-'));
  const userDump = path.join(dir, 'user.sql');
  const systemDump = path.join(dir, 'system.sql');
  fs.writeFileSync(userDump, 'CREATE DATABASE /*!32312 IF NOT EXISTS*/ `kampus` /*!40100 DEFAULT CHARACTER SET utf8mb4 */;\nUSE `kampus`;\n');
  fs.writeFileSync(systemDump, 'CREATE DATABASE /*!32312 IF NOT EXISTS*/ `mysql`;\nUSE `mysql`;\n');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await assert.doesNotReject(assertBackupDoesNotRestoreSystemSchemas(userDump));
  await assert.rejects(assertBackupDoesNotRestoreSystemSchemas(systemDump), /schema sistem MariaDB/);
});


test('backup helper rejects MariaDB system schemas as targets', () => {
  assert.equal(isSystemDatabase('mysql'), true);
  assert.equal(isSystemDatabase('INFORMATION_SCHEMA'), true);
  assert.equal(isSystemDatabase('kampus'), false);
});


test('project database account names are constrained and root is not an application account', () => {
  assert.equal(validateProjectUsername('sxl_app_user'), 'sxl_app_user');
  assert.throws(() => validateProjectUsername('root'), /3–32 karakter|dicadangkan/);
  assert.throws(() => validateProjectUsername('unsafe user'), /3–32 karakter/);
  assert.throws(() => validateProjectUsername('AName'), /3–32 karakter/);
});
