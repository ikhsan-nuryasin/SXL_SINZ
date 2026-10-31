'use strict';

const MAX_SQL_BATCH_STATEMENTS = 50;

function createMarkedSql(statements, nonce) {
  const markers = statements.map((_statement, index) => `SXL_RESULT_${nonce}_${index + 1}`);
  const sql = statements.map((statement, index) =>
    `${statement}\n;\nSELECT '${markers[index]}' AS ${markers[index]};`
  ).join('\n');
  return { markers, sql };
}

function parseMarkedSqlOutput(stdout, markers, splitBatchRow) {
  const lines = String(stdout).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const results = [];
  let cursor = 0;
  for (const marker of markers) {
    let markerIndex = -1;
    for (let index = cursor + 1; index < lines.length; index++) {
      if (lines[index] === marker && lines[index - 1] === marker) {
        markerIndex = index;
        break;
      }
    }
    if (markerIndex < 0) break;
    const resultLines = lines.slice(cursor, markerIndex - 1);
    const columns = resultLines.length && resultLines[0] ? splitBatchRow(resultLines[0]) : [];
    const rows = columns.length
      ? resultLines.slice(1, 501).map(splitBatchRow).map(row => row.map(value => value === '\\N' ? null : value))
      : [];
    results.push({
      columns,
      rows,
      rowCount: rows.length,
      truncated: columns.length > 0 && resultLines.length > 501,
      rawOutput: resultLines.join('\n')
    });
    cursor = markerIndex + 1;
  }
  return {
    results,
    complete: results.length === markers.length,
    remainingOutput: lines.slice(cursor).join('\n')
  };
}

module.exports = { MAX_SQL_BATCH_STATEMENTS, createMarkedSql, parseMarkedSqlOutput };
