'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const MAX_FILES = 2000;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_ARGUMENT_LENGTH = 20000;
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'vendor', '.idea', '.vscode', '.next', '.cache', 'coverage']);
const PRIVATE_DIRECTORIES = new Set(['.aws', '.ssh', '.gnupg']);
const PRIVATE_FILE_NAMES = new Set([
  'credentials', 'secrets', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa',
  '.npmrc', '.pypirc', '.netrc', '.git-credentials', 'known_hosts'
]);
const PRIVATE_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.p8', '.ppk', '.sqlite', '.sqlite3', '.db', '.bak', '.backup', '.dump', '.dmp', '.tfstate']);
const GITIGNORE_RULES = [
  '# File konfigurasi lokal dan rahasia',
  '.env*',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  '.aws/',
  '.ssh/',
  '.gnupg/',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.p8',
  '*.ppk',
  '*.tfstate',
  '*.tfstate.*',
  '',
  '# Dependensi dan cache',
  'node_modules/',
  'vendor/',
  '.next/',
  '.cache/',
  'coverage/',
  '',
  '# Log dan file sementara',
  '*.log',
  'logs/',
  '*.tmp',
  '*.temp',
  '',
  '# Database lokal, backup, dan dump',
  '*.sqlite',
  '*.sqlite3',
  '*.db',
  '*.bak',
  '*.backup',
  '*.dump',
  '*.dmp',
  'database*.sql',
  'dump*.sql',
  'backup*.sql',
  '*.sql.gz',
  '',
  '# Pengaturan editor dan sistem operasi',
  '.idea/',
  '.vscode/',
  '.DS_Store',
  'Thumbs.db',
  'Desktop.ini'
];

function findOnPath(command, env = process.env, platform = process.platform) {
  const extensions = platform === 'win32' ? ['.EXE', '.COM'] : [''];
  for (const directory of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const suffix = extension && !command.toLowerCase().endsWith(extension.toLowerCase()) ? extension : '';
      const candidate = path.join(directory, `${command}${suffix}`);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch {}
    }
  }
  return null;
}

function runProcess(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        env: options.env || process.env,
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const maxBuffer = options.maxBuffer || 1024 * 1024;
    const append = (current, chunk) => (current + chunk.toString()).slice(-maxBuffer);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs || 30000);
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    if (options.stdin !== undefined) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

function safeFailure(action, result) {
  if (result.timedOut) throw new Error(`${action}: perintah melewati batas waktu.`);
  if (result.code !== 0) throw new Error(`${action}: perintah gagal dengan kode ${result.code === null ? 'tidak diketahui' : result.code}.`);
  return result;
}

function resolveProject(projectPath) {
  if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) throw new Error('Folder proyek harus berupa path absolut.');
  const absolute = path.resolve(projectPath);
  let stat;
  try { stat = fs.lstatSync(absolute); } catch { throw new Error('Folder proyek tidak ditemukan.'); }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Folder proyek harus berupa direktori nyata, bukan tautan.');
  try { return fs.realpathSync(absolute); } catch { throw new Error('Lokasi asli folder proyek tidak dapat diverifikasi.'); }
}

function inspectFiles(projectPath) {
  const files = [];
  const excluded = [];
  let totalBytes = 0;
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const absolute = path.join(folder, entry.name);
      const relative = path.relative(projectPath, absolute).split(path.sep).join('/');
      if (entry.isSymbolicLink()) {
        excluded.push({ path: relative, reason: 'tautan simbolis' });
        continue;
      }
      if (entry.isDirectory()) {
        if (PRIVATE_DIRECTORIES.has(entry.name.toLowerCase())) {
          excluded.push({ path: relative, reason: 'folder kredensial privat' });
          continue;
        }
        if (SKIP_DIRECTORIES.has(entry.name.toLowerCase())) continue;
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (relative === '.gitignore') continue;
      const lower = entry.name.toLowerCase();
      const extension = path.extname(lower);
      const basename = path.basename(lower, extension);
      const databaseDump = /(?:^|\/)(?:database|dump|backup)(?:[-_.].*)?\.sql(?:\.gz)?$/i.test(relative) || /\.sql\.gz$/i.test(lower);
      if (/^\.env(?:\.|$)/i.test(entry.name) || PRIVATE_FILE_NAMES.has(lower) || PRIVATE_FILE_NAMES.has(basename) || PRIVATE_EXTENSIONS.has(extension) || /\.tfstate(?:\.|$)/i.test(lower) || databaseDump) {
        excluded.push({ path: relative, reason: 'nama file berpotensi berisi kredensial atau data privat' });
        continue;
      }
      const stat = fs.statSync(absolute);
      if (stat.size > MAX_FILE_BYTES || totalBytes + stat.size > MAX_TOTAL_BYTES) {
        excluded.push({ path: relative, reason: 'batas ukuran upload' });
        continue;
      }
      totalBytes += stat.size;
      files.push({
        path: relative,
        size: stat.size,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')
      });
      if (files.length > MAX_FILES) throw new Error(`Proyek berisi lebih dari ${MAX_FILES} file untuk ditinjau. Kurangi file terlebih dahulu.`);
    }
  }
  walk(projectPath);
  return { files: files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0), excluded, totalBytes };
}

function hashText(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function getGitignorePlan(projectPath) {
  const filename = path.join(projectPath, '.gitignore');
  let original = '';
  let originalSha256 = null;
  try {
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('File .gitignore harus berupa file lokal biasa, bukan tautan atau direktori.');
    original = fs.readFileSync(filename, 'utf8');
    originalSha256 = hashText(original);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const existingRules = new Set(original.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
  const addedRules = GITIGNORE_RULES.filter(rule => rule && !existingRules.has(rule));
  const content = addedRules.length
    ? `${original}${original && !/[\r\n]$/.test(original) ? '\n' : ''}${addedRules.join('\n')}\n`
    : original;
  const action = originalSha256 === null ? 'created' : addedRules.length ? 'updated' : 'unchanged';
  return {
    action,
    originalSha256,
    sha256: hashText(content),
    addedRules,
    content
  };
}

function publicGitignorePlan(plan) {
  return {
    action: plan.action,
    originalSha256: plan.originalSha256,
    sha256: plan.sha256,
    addedRules: plan.addedRules
  };
}

function matchesIgnoreRule(relativePath, rule) {
  const directoryRule = rule.endsWith('/');
  const pattern = directoryRule ? rule.slice(0, -1) : rule;
  const escapeRegex = value => value.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  const segments = relativePath.split('/');
  if (pattern.includes('/')) {
    const matcher = new RegExp(`^${escapeRegex(pattern)}$`, 'i');
    return segments.some((_, index) => matcher.test(segments.slice(index).join('/')));
  }
  const matcher = new RegExp(`^${escapeRegex(pattern)}$`, 'i');
  return segments.some((segment, index) => matcher.test(segment) && (!directoryRule || index < segments.length - 1));
}

function validateRepositoryName(name) {
  if (typeof name !== 'string') throw new Error('Nama repository harus berupa teks.');
  const value = name.trim();
  if (value.length > 201 || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})(?:\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99}))?$/.test(value)) {
    throw new Error('Nama repository GitHub tidak valid. Gunakan nama atau pemilik/nama dengan huruf, angka, titik, garis bawah, dan tanda hubung.');
  }
  if (value.split('/').some(part => part === '.' || part === '..')) throw new Error('Nama repository GitHub tidak valid.');
  return value;
}

function createGitHubPublisher(options = {}) {
  const discover = options.findExecutable || findOnPath;
  const run = options.runCommand || runProcess;

  function executables() {
    const git = discover('git');
    const gh = discover('gh');
    if (!git) throw new Error('Git tidak ditemukan. Pasang Git for Windows, lalu buka ulang SXL.');
    if (!gh) throw new Error('GitHub CLI (gh) tidak ditemukan. Pasang GitHub CLI, lalu buka ulang SXL.');
    return { git, gh };
  }

  async function ensureGitHubLogin(gh) {
    const result = await run(gh, ['auth', 'status', '--hostname', 'github.com'], { timeoutMs: 15000 });
    if (result.timedOut || result.code !== 0) throw new Error('GitHub CLI belum login. Jalankan `gh auth login` dari terminal, lalu coba lagi.');
  }

  async function collectProject(projectPath) {
    const folder = resolveProject(projectPath);
    const commands = executables();
    await ensureGitHubLogin(commands.gh);
    const gitignore = getGitignorePlan(folder);
    const { files, excluded, totalBytes } = inspectFiles(folder);
    const gitignoreSize = Buffer.byteLength(gitignore.content);
    if (gitignoreSize > MAX_FILE_BYTES || totalBytes + gitignoreSize > MAX_TOTAL_BYTES) {
      throw new Error('Ukuran file .gitignore melewati batas publikasi. Periksa dan ringkas file tersebut.');
    }
    files.push({
      path: '.gitignore',
      size: gitignoreSize,
      sha256: gitignore.sha256
    });
    if (files.length > MAX_FILES) throw new Error(`Proyek berisi lebih dari ${MAX_FILES} file untuk ditinjau. Kurangi file terlebih dahulu.`);

    const filesToCheck = files.filter(file => file.path !== '.gitignore');
    if (filesToCheck.length) {
      const ignored = await run(commands.git, ['check-ignore', '--no-index', '-z', '--stdin'], {
        cwd: folder,
        stdin: Buffer.from(`${filesToCheck.map(file => file.path).join('\0')}\0`),
        timeoutMs: 15000
      });
      if (ignored.timedOut) throw new Error('Pemeriksaan .gitignore melewati batas waktu.');
      if (ignored.code === 0) {
        const ignoredFiles = new Set(ignored.stdout.split('\0').filter(Boolean));
        for (const file of ignoredFiles) excluded.push({ path: file, reason: 'diabaikan oleh aturan .gitignore proyek' });
        for (let index = files.length - 1; index >= 0; index--) {
          if (ignoredFiles.has(files[index].path)) files.splice(index, 1);
        }
      } else if (ignored.code !== 1) {
        throw new Error('Git gagal memeriksa aturan .gitignore proyek.');
      }
    }
    for (let index = files.length - 1; index >= 0; index--) {
      if (files[index].path !== '.gitignore' && gitignore.addedRules.some(rule => matchesIgnoreRule(files[index].path, rule))) {
        excluded.push({ path: files[index].path, reason: 'akan diabaikan oleh aturan .gitignore otomatis' });
        files.splice(index, 1);
      }
    }
    if (files.length === 1) throw new Error('Tidak ada file proyek yang aman untuk diterbitkan selain .gitignore. Periksa file privat atau aturan pengabaian.');

    const included = files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    const includedBytes = included.reduce((sum, file) => sum + file.size, 0);
    return { folder, commands, files: included, excluded, totalBytes: includedBytes, gitignore };
  }

  function applyGitignorePlan(folder, plan) {
    const filename = path.join(folder, '.gitignore');
    if (plan.action === 'created') {
      let descriptor;
      try {
        descriptor = fs.openSync(filename, 'wx', 0o600);
        fs.writeFileSync(descriptor, plan.content, 'utf8');
      } catch (error) {
        if (error.code === 'EEXIST') throw new Error('File .gitignore dibuat atau diubah setelah pratinjau. Buat pratinjau baru sebelum melanjutkan.');
        throw new Error(`File .gitignore otomatis tidak dapat dibuat: ${error.message}`);
      } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
      }
    } else if (plan.action === 'updated') {
      let stat;
      let current;
      try {
        stat = fs.lstatSync(filename);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('File .gitignore bukan file lokal biasa.');
        current = fs.readFileSync(filename, 'utf8');
      } catch (error) {
        throw new Error(`File .gitignore berubah setelah pratinjau. Buat pratinjau baru. ${error.message}`);
      }
      if (hashText(current) !== plan.originalSha256) {
        throw new Error('File .gitignore berubah setelah pratinjau. Buat pratinjau baru sebelum melanjutkan.');
      }
      const addition = plan.content.slice(current.length);
      fs.appendFileSync(filename, addition, { encoding: 'utf8', flag: 'a' });
    }

    let written;
    try { written = fs.readFileSync(filename, 'utf8'); }
    catch (error) { throw new Error(`File .gitignore tidak dapat diverifikasi setelah disiapkan: ${error.message}`); }
    if (hashText(written) !== plan.sha256) {
      throw new Error('File .gitignore berubah saat disiapkan. Tidak ada commit atau upload yang dilakukan.');
    }
  }

  return {
    async previewProject({ projectPath } = {}) {
      const project = await collectProject(projectPath);
      return {
        files: project.files,
        excluded: project.excluded,
        totalBytes: project.totalBytes,
        gitRepository: fs.existsSync(path.join(project.folder, '.git')),
        gitignore: publicGitignorePlan(project.gitignore)
      };
    },
    async publishProject({ projectPath, repositoryName, name, visibility, confirmFiles, confirmGitignore } = {}) {
      const repo = validateRepositoryName(repositoryName ?? name);
      if (!['public', 'private'].includes(visibility)) throw new Error('Pilih visibilitas repository public atau private.');
      if (!Array.isArray(confirmFiles) || confirmFiles.length === 0 || confirmFiles.some(file => !file || typeof file !== 'object')) {
        throw new Error('Tinjau dan konfirmasi daftar file proyek sebelum mengirim ke GitHub.');
      }

      const project = await collectProject(projectPath);
      const expectedGitignore = publicGitignorePlan(project.gitignore);
      if (!confirmGitignore || JSON.stringify(confirmGitignore) !== JSON.stringify(expectedGitignore)) {
        throw new Error('Rencana .gitignore berubah sejak pratinjau. Buat pratinjau baru dan periksa aturan yang akan ditambahkan.');
      }
      const confirmed = confirmFiles.map(file => {
        if (!file || typeof file !== 'object' || typeof file.path !== 'string' || !Number.isSafeInteger(file.size) || !/^[a-f0-9]{64}$/.test(file.sha256)) {
          throw new Error('Daftar file konfirmasi tidak valid. Muat ulang pratinjau sebelum menerbitkan.');
        }
        return { path: file.path, size: file.size, sha256: file.sha256 };
      });
      if (JSON.stringify(confirmed) !== JSON.stringify(project.files)) {
        throw new Error('Daftar file proyek berubah sejak ditinjau. Muat ulang pratinjau dan tinjau ulang sebelum menerbitkan.');
      }
      const argumentLength = project.files.reduce((sum, file) => sum + file.path.length + 16, 0);
      if (argumentLength > MAX_ARGUMENT_LENGTH) throw new Error('Daftar file proyek terlalu besar untuk diproses sekaligus. Kurangi file yang akan diterbitkan.');

      const { git, gh } = project.commands;
      const status = await run(git, ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: project.folder });
      if (status.timedOut) throw new Error('Pemeriksaan status Git melewati batas waktu.');
      const initialized = status.code === 0;
      if (!initialized && fs.existsSync(path.join(project.folder, '.git'))) {
        throw new Error('Repository Git proyek tidak dapat dibaca; perbaiki repository sebelum menerbitkan.');
      }

      if (initialized) {
        const remotes = safeFailure('Memeriksa remote Git', await run(git, ['remote'], { cwd: project.folder }));
        if (remotes.stdout.trim()) throw new Error('Proyek sudah memiliki remote Git. Periksa remote tersebut dan gunakan push manual agar SXL tidak mengirim ke repository yang salah.');
        const staged = await run(git, ['diff', '--cached', '--quiet'], { cwd: project.folder });
        if (staged.code === 1) throw new Error('Repository memiliki perubahan staged yang belum ditinjau. Commit atau batalkan staging sebelum menerbitkan.');
        if (staged.code !== 0) throw new Error('Status staging Git tidak dapat diperiksa.');
        const head = await run(git, ['rev-parse', '--verify', 'HEAD'], { cwd: project.folder });
        if (head.timedOut) throw new Error('Pemeriksaan riwayat commit Git melewati batas waktu.');
        if (head.code === 0) throw new Error('Repository ini sudah memiliki riwayat commit. Demi mencegah rahasia lama ikut terunggah, terbitkan salinan proyek baru tanpa folder .git.');
        if (head.code !== 1 && head.code !== 128) throw new Error('Riwayat commit Git tidak dapat diperiksa. Perbaiki repository sebelum menerbitkan.');
      } else {
        safeFailure('Menyiapkan repository Git', await run(git, ['init'], { cwd: project.folder }));
      }

      for (const [label, args] of [
        ['Memeriksa identitas commit', ['var', 'GIT_AUTHOR_IDENT']],
        ['Memeriksa identitas commit', ['var', 'GIT_COMMITTER_IDENT']]
      ]) {
        const identity = await run(git, args, { cwd: project.folder });
        if (identity.code !== 0) throw new Error('Identitas Git belum dikonfigurasi. Atur user.name dan user.email melalui Git, lalu coba lagi.');
      }
      safeFailure('Memilih branch utama', await run(git, ['branch', '-M', 'main'], { cwd: project.folder }));

      applyGitignorePlan(project.folder, project.gitignore);
      const refreshedProject = await collectProject(project.folder);
      if (JSON.stringify(refreshedProject.files) !== JSON.stringify(project.files)) {
        throw new Error('Daftar file berubah setelah .gitignore disiapkan. Periksa pratinjau terbaru sebelum mengirim ke GitHub.');
      }
      const stagingFiles = refreshedProject.files.filter(file => file.path !== '.gitignore');
      if (stagingFiles.length) {
        safeFailure('Menambahkan file yang telah ditinjau ke Git', await run(git, [
          'add', '--', ...stagingFiles.map(file => `./${file.path}`)
        ], { cwd: project.folder }));
      }
      safeFailure('Menambahkan .gitignore otomatis', await run(git, ['add', '-f', '--', '.gitignore'], { cwd: project.folder }));
      const stagedStatus = safeFailure('Memeriksa file staged', await run(git, ['diff', '--cached', '--name-only', '-z'], { cwd: project.folder }));
      const stagedFiles = stagedStatus.stdout.split('\0').filter(Boolean).map(file => file.replace(/^\.\//, '')).sort();
      const expectedStagedFiles = project.files.map(file => file.path);
      if (stagedFiles.length !== expectedStagedFiles.length || stagedFiles.some((file, index) => file !== expectedStagedFiles[index])) {
        throw new Error('Daftar file staged berbeda dari pratinjau. Tidak ada commit atau upload yang dilakukan.');
      }
      safeFailure('Membuat commit proyek', await run(git, ['commit', '-m', 'Initial project publish from SXL Localhost'], { cwd: project.folder }));

      const visibilityFlag = visibility === 'public' ? '--public' : '--private';
      safeFailure('Membuat repository dan mengirim commit ke GitHub', await run(gh, [
        'repo', 'create', repo, visibilityFlag, '--source', project.folder, '--remote', 'origin', '--push'
      ], { cwd: project.folder, timeoutMs: 120000, maxBuffer: 128 * 1024 }));
      const remote = safeFailure('Memverifikasi repository GitHub', await run(git, ['remote', 'get-url', 'origin'], { cwd: project.folder }));
      const remoteUrl = remote.stdout.trim();
      const githubRemote = remoteUrl.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/i);
      if (!githubRemote) {
        throw new Error('Repository dibuat, tetapi URL remote GitHub tidak dapat diverifikasi. Periksa repository secara manual.');
      }
      return {
        message: 'Proyek berhasil dikirim ke GitHub.',
        url: `https://github.com/${githubRemote[1]}/${githubRemote[2]}`,
        repository: `${githubRemote[1]}/${githubRemote[2]}`,
        visibility,
        branch: 'main',
        filesPublished: project.files.length,
        gitignore: expectedGitignore.action
      };
    }
  };
}

module.exports = { createGitHubPublisher, findOnPath, runProcess, validateRepositoryName, GITIGNORE_RULES };
