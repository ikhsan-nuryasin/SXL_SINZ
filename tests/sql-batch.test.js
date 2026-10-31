'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_SQL_BATCH_STATEMENTS, createMarkedSql, parseMarkedSqlOutput } = require('../lib/sql-batch');

function splitRow(line) {
  return line.split('\t');
}

test('SQL batch runner preserves statement order and one MariaDB session', () => {
  const statements = ['CREATE DATABASE belajar', 'USE belajar', 'SELECT 1'];
  const batch = createMarkedSql(statements, 'test');
  assert.deepEqual(batch.markers, ['SXL_RESULT_test_1', 'SXL_RESULT_test_2', 'SXL_RESULT_test_3']);
  assert.match(batch.sql, /CREATE DATABASE belajar\n;\nSELECT 'SXL_RESULT_test_1' AS SXL_RESULT_test_1;/);
  assert.match(batch.sql, /USE belajar\n;\nSELECT 'SXL_RESULT_test_2' AS SXL_RESULT_test_2;/);
  assert.ok(batch.sql.indexOf('USE belajar\n;') < batch.sql.indexOf('SELECT 1\n;'));
});

test('SQL batch terminator is not swallowed by a trailing line comment', () => {
  const batch = createMarkedSql(['SELECT 1 -- catatan'], 'comment');
  assert.match(batch.sql, /SELECT 1 -- catatan\n;\nSELECT 'SXL_RESULT_comment_1'/);
});

test('SQL batch output is separated into results and supports statements without result sets', () => {
  const markers = ['M1', 'M2', 'M3'];
  const output = 'id\tnama\n1\tAyu\nM1\nM1\nM2\nM2\nnama\nBima\nM3\nM3\n';
  const parsed = parseMarkedSqlOutput(output, markers, splitRow);

  assert.equal(parsed.complete, true);
  assert.equal(parsed.results.length, 3);
  assert.deepEqual(parsed.results[0].columns, ['id', 'nama']);
  assert.deepEqual(parsed.results[0].rows, [['1', 'Ayu']]);
  assert.deepEqual(parsed.results[1].columns, []);
  assert.deepEqual(parsed.results[1].rows, []);
  assert.deepEqual(parsed.results[2].columns, ['nama']);
  assert.deepEqual(parsed.results[2].rows, [['Bima']]);
});

test('SQL batch parser keeps completed results when a later statement fails', () => {
  const parsed = parseMarkedSqlOutput('nilai\n1\nM1\nM1\n', ['M1', 'M2'], splitRow);
  assert.equal(parsed.complete, false);
  assert.equal(parsed.results.length, 1);
  assert.equal(parsed.remainingOutput, '');
});

test('SQL batch limit is explicit and bounded', () => {
  assert.equal(MAX_SQL_BATCH_STATEMENTS, 50);
});
