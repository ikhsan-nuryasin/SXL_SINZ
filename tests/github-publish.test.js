'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGitHubPublisher, validateRepositoryName, GITIGNORE_RULES } = require('../lib/github-publish');

function makeProject(files = { 'index.php': '<?php echo "ready";', '.env': 'DB_PASSWORD=private', 'src/app.js': 'console.log("app");' }) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-gh-preview-'));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(folder, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return folder;
}

function fakeRunner({ ignored = '', statusCode = 128, remotes = '', staged = '', failAt = null } = {}) {
  const calls = [];
  const run = async (executable, args, options = {}) => {
    calls.push({ executable, args, options });
    const command = args.join(' ');
    if (command === 'auth status --hostname github.com') return { code: 0, stdout: '', stderr: '' };
    if (command === 'check-ignore --no-index -z --stdin') return { code: ignored ? 0 : 1, stdout: ignored, stderr: '' };
    if (command === 'status --porcelain -z --untracked-files=all') return { code: statusCode, stdout: '', stderr: '' };
    if (command === 'remote') return { code: 0, stdout: remotes, stderr: '' };
    if (command === 'diff --cached --quiet') return { code: 0, stdout: '', stderr: '' };
    if (command === 'var GIT_AUTHOR_IDENT' || command === 'var GIT_COMMITTER_IDENT') return { code: 0, stdout: '', stderr: '' };
    if (command === 'rev-parse --verify HEAD') return { code: 128, stdout: '', stderr: 'fatal: Needed a single revision' };
    if (args[0] === 'diff' && args[1] === '--cached' && args[2] === '--name-only') return { code: 0, stdout: staged || '.gitignore\0index.php\0src/app.js\0', stderr: '' };
    if (args[0] === 'remote' && args[1] === 'get-url') return { code: 0, stdout: 'git@github.com:demo/app.git\n', stderr: '' };
    if (args[0] === 'repo' && args[1] === 'create') return { code: failAt === 'create' ? 1 : 0, stdout: '', stderr: '' };
    if (args[0] === 'commit') return { code: failAt === 'commit' ? 1 : 0, stdout: '', stderr: '' };
    if (args[0] === 'add') return { code: failAt === 'add' ? 1 : 0, stdout: '', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

test('repository names and visibility are validated before any GitHub command', async () => {
  assert.equal(validateRepositoryName('demo/my-app'), 'demo/my-app');
  for (const name of ['', '../app', '-flag', 'owner;gh auth logout', 'owner//app'  ]) {
    assert.throws(() => validateRepositoryName(name));
  }
  assert.equal(validateRepositoryName(`${'a'.repeat(100)}/${'b'.repeat(100)}`).length, 201);
  const folder = makeProject();
  const fake = fakeRunner();
  const publisher = createGitHubPublisher({ findExecutable: name => name, runCommand: fake.run });
  try {
    await assert.rejects(() => publisher.publishProject({
      projectPath: folder, name: 'demo/app', visibility: 'unlisted', confirmFiles: []
    }), /visibilitas/);
    assert.equal(fake.calls.length, 0);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('preview excludes credential and database dump files and returns a deterministic file list', async () => {
  const folder = makeProject({
    'index.php': '<?php echo "ready";',
    '.env': 'DB_PASSWORD=private',
    'database.sql': 'INSERT INTO users VALUES ("private");',
    'src/app.js': 'console.log("app");'
  });
  const fake = fakeRunner();
  const publisher = createGitHubPublisher({ findExecutable: name => name, runCommand: fake.run });
  try {
    const result = await publisher.previewProject({ projectPath: folder });
    assert.deepEqual(result.files.map(file => file.path), ['.gitignore', 'index.php', 'src/app.js']);
    assert.match(result.files[1].sha256, /^[a-f0-9]{64}$/);
    assert.ok(result.excluded.some(item => item.path === '.env'));
    assert.ok(result.excluded.some(item => item.path === 'database.sql'));
    assert.ok(result.totalBytes > 0);
    assert.equal(result.gitignore.action, 'created');
    assert.deepEqual(result.gitignore.addedRules, GITIGNORE_RULES.filter(rule => rule));
    assert.equal(fs.existsSync(path.join(folder, '.gitignore')), false, 'preview does not modify project files');
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('preview accounts for automatically ignored logs and temporary files without writing .gitignore', async () => {
  const folder = makeProject({
    'index.php': 'ready',
    'app.log': 'log',
    'logs/server.log': 'log',
    'scratch.tmp': 'temp',
    'src/app.js': 'console.log("app");'
  });
  const publisher = createGitHubPublisher({ findExecutable: name => name, runCommand: fakeRunner().run });
  try {
    const result = await publisher.previewProject({ projectPath: folder });
    assert.deepEqual(result.files.map(file => file.path), ['.gitignore', 'index.php', 'src/app.js']);
    assert.ok(result.excluded.some(item => item.path === 'app.log' && item.reason.includes('otomatis')));
    assert.ok(result.excluded.some(item => item.path === 'logs/server.log' && item.reason.includes('otomatis')));
    assert.ok(result.excluded.some(item => item.path === 'scratch.tmp' && item.reason.includes('otomatis')));
    assert.equal(fs.existsSync(path.join(folder, '.gitignore')), false);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('publish invalidates a preview when a file changes after the user reviewed it', async () => {
  const folder = makeProject();
  const fake = fakeRunner();
  const publisher = createGitHubPublisher({ findExecutable: name => name, runCommand: fake.run });
  try {
    const preview = await publisher.previewProject({ projectPath: folder });
    fs.writeFileSync(path.join(folder, 'src', 'app.js'), 'changed after review');
    await assert.rejects(() => publisher.publishProject({
      projectPath: folder, name: 'demo/app', visibility: 'private', confirmFiles: preview.files, confirmGitignore: preview.gitignore
    }), /berubah sejak ditinjau/i);
    assert.equal(fake.calls.some(call => call.args[0] === 'init'), false);
    assert.equal(fake.calls.some(call => call.args[0] === 'repo' && call.args[1] === 'create'), false);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('publish requires the exact fresh preview and never uses a shell', async () => {
  const folder = makeProject();
  const fake = fakeRunner();
  const publisher = createGitHubPublisher({ findExecutable: name => name, runCommand: fake.run });
  try {
    await assert.rejects(() => publisher.publishProject({
      projectPath: folder, name: 'demo/app', visibility: 'private', confirmFiles: [{path:'index.php',size:20,sha256:'0'.repeat(64)}]
    }), /berubah|pratinjau/i);
    assert.equal(fake.calls.some(call => call.args[0] === 'repo' && call.args[1] === 'create'), false);

    const preview = await publisher.previewProject({ projectPath: folder });
    const result = await publisher.publishProject({
      projectPath: folder, name: 'demo/app', visibility: 'private', confirmFiles: preview.files, confirmGitignore: preview.gitignore
    });
    assert.equal(result.url, 'https://github.com/demo/app');
    assert.equal(result.gitignore, 'created');
    assert.equal(fs.readFileSync(path.join(folder, '.gitignore'), 'utf8').includes('.env*'), true);
    assert.ok(fake.calls.every(call => call.options.shell === undefined || call.options.shell === false));
    assert.ok(fake.calls.some(call => call.args.join(' ') === 'add -f -- .gitignore'));
    const create = fake.calls.find(call => call.args[0] === 'repo' && call.args[1] === 'create');
    assert.ok(create.args.includes('--private'));
    assert.ok(create.args.includes('--push'));
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('publish requires authenticated GitHub CLI and refuses projects with an existing remote', async () => {
  const folder = makeProject();
  const unauth = fakeRunner();
  const publisherNoAuth = createGitHubPublisher({
    findExecutable: name => name,
    runCommand: async (executable, args, options) => args[0] === 'auth' ? { code: 1, stdout: '', stderr: 'secret output must not leak' } : unauth.run(executable, args, options)
  });
  const publisherRemote = createGitHubPublisher({
    findExecutable: name => name,
    runCommand: fakeRunner({ statusCode: 0, remotes: 'origin\n' }).run
  });
  try {
    let authError;
    try { await publisherNoAuth.previewProject({ projectPath: folder }); } catch (error) { authError = error; }
    assert.match(authError?.message || '', /gh auth login/);
    assert.doesNotMatch(authError.message, /secret output must not leak/);
    const remotePreview = await publisherRemote.previewProject({ projectPath: folder });
    await assert.rejects(() => publisherRemote.publishProject({
      projectPath: folder, name: 'demo/app', visibility: 'private', confirmFiles: remotePreview.files, confirmGitignore: remotePreview.gitignore
    }), /remote Git/i);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('publish refuses staged changes and does not upload when a command fails', async () => {
  const folder = makeProject();
  const stagedRunner = fakeRunner({ statusCode: 0 });
  const publisher = createGitHubPublisher({
    findExecutable: name => name,
    runCommand: async (executable, args, options) => {
      if (args.join(' ') === 'diff --cached --quiet') return { code: 1, stdout: '', stderr: '' };
      return stagedRunner.run(executable, args, options);
    }
  });
  const failRunner = fakeRunner({ failAt: 'create' });
  const publisherFail = createGitHubPublisher({ findExecutable: name => name, runCommand: failRunner.run });
  try {
    const stagedPreview = await publisher.previewProject({ projectPath: folder });
    await assert.rejects(() => publisher.publishProject({
      projectPath: folder, name: 'demo/app', visibility: 'private', confirmFiles: stagedPreview.files, confirmGitignore: stagedPreview.gitignore
    }), /staged/i);
    const failPreview = await publisherFail.previewProject({ projectPath: folder });
    await assert.rejects(() => publisherFail.publishProject({
      projectPath: folder, name: 'demo/app', visibility: 'private', confirmFiles: failPreview.files, confirmGitignore: failPreview.gitignore
    }), /kode 1/i);
    assert.ok(failRunner.calls.some(call => call.args[0] === 'repo' && call.args[1] === 'create'));
    assert.equal(failRunner.calls.some(call => call.args[0] === 'remote' && call.args[1] === 'get-url'), false);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('publish preserves existing gitignore rules and appends only missing rules', async () => {
  const folder = makeProject({ '.gitignore': 'custom-file\nnode_modules/\n', 'index.php': 'ready' });
  const fake = fakeRunner({ statusCode: 0, staged: '.gitignore\0index.php\0' });
  const publisher = createGitHubPublisher({ findExecutable: name => name, runCommand: fake.run });
  try {
    const preview = await publisher.previewProject({ projectPath: folder });
    assert.equal(preview.gitignore.action, 'updated');
    assert.ok(preview.gitignore.addedRules.every(rule => rule !== 'node_modules/'));
    const original = fs.readFileSync(path.join(folder, '.gitignore'), 'utf8');
    await publisher.publishProject({
      projectPath: folder, name: 'demo/app', visibility: 'private',
      confirmFiles: preview.files, confirmGitignore: preview.gitignore
    });
    const updated = fs.readFileSync(path.join(folder, '.gitignore'), 'utf8');
    assert.ok(updated.startsWith(original));
    assert.ok(updated.includes('.env*'));
    assert.ok(updated.includes('custom-file'));
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('publish refuses a stale gitignore plan and repositories with existing commit history', async () => {
  const folder = makeProject();
  const publisher = createGitHubPublisher({ findExecutable: name => name, runCommand: fakeRunner({ statusCode: 0 }).run });
  try {
    const preview = await publisher.previewProject({ projectPath: folder });
    const alteredPlan = { ...preview.gitignore, addedRules: [...preview.gitignore.addedRules, 'other-secret-pattern'] };
    await assert.rejects(() => publisher.publishProject({
      projectPath: folder, name: 'demo/app', visibility: 'private',
      confirmFiles: preview.files, confirmGitignore: alteredPlan
    }), /rencana \.gitignore berubah/i);
    assert.equal(fs.existsSync(path.join(folder, '.gitignore')), false);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }

  const historyFolder = makeProject();
  const historyRunner = fakeRunner({ statusCode: 0 });
  const publisherWithHistory = createGitHubPublisher({
    findExecutable: name => name,
    runCommand: async (executable, args, options) => args.join(' ') === 'rev-parse --verify HEAD'
      ? { code: 0, stdout: 'existing-commit\n', stderr: '' }
      : historyRunner.run(executable, args, options)
  });
  try {
    const preview = await publisherWithHistory.previewProject({ projectPath: historyFolder });
    await assert.rejects(() => publisherWithHistory.publishProject({
      projectPath: historyFolder, name: 'demo/app', visibility: 'private',
      confirmFiles: preview.files, confirmGitignore: preview.gitignore
    }), /riwayat commit/i);
    assert.equal(historyRunner.calls.some(call => call.args[0] === 'repo' && call.args[1] === 'create'), false);
  } finally { fs.rmSync(historyFolder, { recursive: true, force: true }); }
});
