'use strict';

const $ = id => document.getElementById(id);
let busy = false;

const SQL_EXAMPLES = {
  createDatabase: {
    id: 'BUAT BASIS DATA JIKA BELUM ADA belajar_mariadb;\nGUNAKAN belajar_mariadb;\nBUAT TABEL pelanggan (id INT, nama VARCHAR(100) BUKAN KOSONG, kota VARCHAR(80));\nTAMPILKAN TABEL;',
    native: 'CREATE DATABASE IF NOT EXISTS belajar_mariadb;\nUSE belajar_mariadb;\nCREATE TABLE pelanggan (id INT, nama VARCHAR(100) NOT NULL, kota VARCHAR(80));\nSHOW TABLES;'
  },
  insertSelect: {
    id: "TAMBAHKAN KE pelanggan (id, nama, kota) ISI (1, 'Ayu', 'Bandung');\nTAMBAHKAN KE pelanggan (id, nama, kota) ISI (2, 'Bima', 'Jakarta');\nPILIH * DARI pelanggan;",
    native: "INSERT INTO pelanggan (id, nama, kota) VALUES (1, 'Ayu', 'Bandung');\nINSERT INTO pelanggan (id, nama, kota) VALUES (2, 'Bima', 'Jakarta');\nSELECT * FROM pelanggan;"
  },
  filterSort: {
    id: "PILIH nama, kota DARI pelanggan DIMANA kota = 'Bandung' URUTKAN BERDASARKAN nama BATASI 20;",
    native: "SELECT nama, kota FROM pelanggan WHERE kota = 'Bandung' ORDER BY nama LIMIT 20;"
  },
  updateDelete: {
    id: "UBAH pelanggan ATUR kota = 'Surabaya' DIMANA id = 1;\nHAPUS DARI pelanggan DIMANA id = 2;",
    native: "UPDATE pelanggan SET kota = 'Surabaya' WHERE id = 1;\nDELETE FROM pelanggan WHERE id = 2;"
  },
  join: {
    id: 'PILIH pelanggan.nama, pesanan.total DARI pelanggan GABUNGKAN pesanan PADA pelanggan.id = pesanan.pelanggan_id;',
    native: 'SELECT pelanggan.nama, pesanan.total FROM pelanggan JOIN pesanan ON pelanggan.id = pesanan.pelanggan_id;'
  },
  aggregate: {
    id: 'PILIH kota, HITUNG(*) SEBAGAI jumlah_pelanggan DARI pelanggan GRUPKAN BERDASARKAN kota URUTKAN BERDASARKAN jumlah_pelanggan;',
    native: 'SELECT kota, COUNT(*) AS jumlah_pelanggan FROM pelanggan GROUP BY kota ORDER BY jumlah_pelanggan;'
  },
  transaction: {
    id: "MULAI TRANSAKSI;\nUBAH pelanggan ATUR kota = 'Yogyakarta' DIMANA id = 1;\nSIMPAN PERUBAHAN;",
    native: "START TRANSACTION;\nUPDATE pelanggan SET kota = 'Yogyakarta' WHERE id = 1;\nCOMMIT;"
  }
};

function showFeedback(message, isError = false) {
  const output = $('sqlFeedback');
  output.textContent = String(message || 'Selesai.');
  output.classList.toggle('error', isError);
  output.hidden = false;
}

function renderTable(container, columns, rows) {
  if (!columns.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'result-wrap';
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const body = document.createElement('tbody');
  const headerRow = document.createElement('tr');
  for (const column of columns) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = String(column);
    headerRow.appendChild(cell);
  }
  head.appendChild(headerRow);
  for (const values of rows) {
    const row = document.createElement('tr');
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value === null || value === undefined ? 'NULL' : String(value);
      row.appendChild(cell);
    }
    body.appendChild(row);
  }
  table.append(head, body);
  wrap.appendChild(table);
  container.appendChild(wrap);
}

function renderBatchResults(results) {
  const output = $('batchResults');
  output.replaceChildren();
  output.hidden = false;
  $('resultWrap').hidden = true;
  for (const [index, result] of results.entries()) {
    const item = document.createElement('section');
    item.className = 'batch-result';
    const head = document.createElement('div');
    head.className = 'batch-result-head';
    const title = document.createElement('span');
    title.textContent = `Perintah ${index + 1}`;
    const meta = document.createElement('span');
    meta.textContent = `${result.rowCount || 0} baris hasil`;
    head.append(title, meta);
    const statement = document.createElement('pre');
    statement.textContent = String(result.statement || '');
    item.append(head, statement);
    if (result.columns?.length) {
      renderTable(item, result.columns, result.rows || []);
    } else {
      const message = document.createElement('p');
      message.textContent = result.message || 'Perintah berhasil; tidak ada tabel hasil.';
      item.appendChild(message);
    }
    output.appendChild(item);
  }
  $('resultMeta').textContent = `${results.length} perintah selesai`;
}

function renderResults(result) {
  const batchResults = $('batchResults');
  batchResults.replaceChildren();
  batchResults.hidden = true;
  if (Array.isArray(result.results) && result.results.length > 1) {
    renderBatchResults(result.results);
    $('resultMeta').textContent = `${result.results.length} perintah · ${result.rowCount || 0} baris hasil`;
    $('translatedSql').textContent = result.translatedSql || '';
    $('translationDetails').hidden = !result.translatedSql || result.translatedSql === $('sqlInput').value.trim();
    return;
  }
  const head = $('resultHead');
  const body = $('resultBody');
  head.replaceChildren();
  body.replaceChildren();
  const columns = Array.isArray(result.columns) ? result.columns : [];
  const rows = Array.isArray(result.rows) ? result.rows : [];

  if (columns.length) {
    const row = document.createElement('tr');
    for (const column of columns) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = String(column);
      row.appendChild(cell);
    }
    head.appendChild(row);
  }
  for (const values of rows) {
    if (!Array.isArray(values)) continue;
    const row = document.createElement('tr');
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value === null || value === undefined ? 'NULL' : String(value);
      row.appendChild(cell);
    }
    body.appendChild(row);
  }
  $('resultWrap').hidden = !columns.length;
  $('resultMeta').textContent = `${result.rowCount ?? rows.length} baris${result.truncated ? ' · hasil dipotong' : ''}`;
  const translated = typeof result.translatedSql === 'string' ? result.translatedSql : '';
  $('translatedSql').textContent = translated;
  $('translationDetails').hidden = !translated || translated === $('sqlInput').value.trim();
}

async function loadDatabaseStatus() {
  const label = $('databaseStatus');
  const dot = $('databaseDot');
  try {
    const response = await fetch('/api/database/status', { cache: 'no-store' });
    const status = await response.json();
    if (!response.ok) throw new Error(status.error || `Status gagal (${response.status}).`);
    const running = Boolean(status.running);
    label.textContent = running
      ? `MariaDB berjalan · port ${status.port || 'lokal'}`
      : 'MariaDB belum berjalan';
    dot.classList.toggle('good', running);
    dot.classList.toggle('warn', !running);
  } catch (error) {
    label.textContent = `Status tidak tersedia: ${error.message}`;
    dot.classList.add('warn');
  }
}

async function runSql() {
  if (busy) return;
  const sql = $('sqlInput').value;
  if (!sql.trim()) {
    showFeedback('Tulis minimal satu perintah SQL terlebih dahulu.', true);
    return;
  }
  const button = $('runSql');
  busy = true;
  button.disabled = true;
  button.textContent = 'Menjalankan…';
  $('sqlFeedback').hidden = true;
  $('resultMeta').textContent = 'Menjalankan perintah…';
  $('resultWrap').hidden = true;
  $('batchResults').replaceChildren();
  $('batchResults').hidden = true;
  try {
    const csrfToken = document.querySelector('meta[name="sxl-csrf"]')?.content || '';
    const response = await fetch('/api/database/query', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-SXL-CSRF': csrfToken },
      body: JSON.stringify({
        sql,
        language: $('language').value,
        database: $('databaseName').value.trim()
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || `Query gagal (${response.status}).`);
      error.partialResults = result.partialResults;
      error.failedStatementIndex = result.failedStatementIndex;
      throw error;
    }
    renderResults(result);
    showFeedback(result.message || 'Perintah berhasil dijalankan.');
  } catch (error) {
    if (Array.isArray(error.partialResults) && error.partialResults.length) {
      renderBatchResults(error.partialResults);
      $('resultMeta').textContent = `Berhenti pada perintah ${error.failedStatementIndex}`;
    } else {
      $('resultMeta').textContent = 'Perintah gagal';
    }
    showFeedback(error.message, true);
  } finally {
    busy = false;
    button.disabled = false;
    button.textContent = 'Jalankan SQL';
  }
}

$('runSql').addEventListener('click', runSql);
$('clearSql').addEventListener('click', () => {
  $('sqlInput').value = '';
  $('sqlInput').focus();
});
$('insertSqlExample').addEventListener('click', () => {
  const example = SQL_EXAMPLES[$('sqlExample').value];
  if (!example) {
    showFeedback('Pilih contoh kode yang ingin disisipkan.', true);
    return;
  }
  const editor = $('sqlInput');
  const snippet = example[$('language').value] || example.native;
  const hasSelection = editor.selectionStart !== editor.selectionEnd;
  const start = hasSelection ? editor.selectionStart : editor.value.length;
  const end = hasSelection ? editor.selectionEnd : editor.value.length;
  const before = editor.value.slice(0, start);
  const after = editor.value.slice(end);
  const prefix = before && !before.endsWith('\n') ? '\n' : '';
  const suffix = after && !after.startsWith('\n') ? '\n' : '';
  editor.setRangeText(`${prefix}${snippet}${suffix}`, start, end, 'end');
  editor.focus();
  showFeedback('Contoh kode disisipkan. Periksa dan sesuaikan sebelum dijalankan.');
});
$('glossarySearch').addEventListener('input', event => {
  const search = event.target.value.trim().toLocaleLowerCase('id');
  for (const row of $('glossaryRows').rows) {
    row.hidden = !row.textContent.toLocaleLowerCase('id').includes(search);
  }
});
$('sqlInput').addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    runSql();
  }
});
loadDatabaseStatus();
