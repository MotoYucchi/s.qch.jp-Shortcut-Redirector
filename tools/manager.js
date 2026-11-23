const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const {
  SITE_DOMAIN,
  SITE_ORIGIN,
  LINKS_PATH,
  build,
  normalizeLinks,
  validateSlug,
} = require('../build');

const ROOT_DIR = path.resolve(__dirname, '..');
const MANAGER_HTML_PATH = path.join(__dirname, 'manager.html');
const EDITOR_JS_PATH = path.join(__dirname, 'editor.js');
const PAGES_DIR = path.join(ROOT_DIR, 'src', 'pages');
const DEFAULT_PORT = Number(process.env.PORT) || 4173;
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const API_TOKEN = crypto.randomBytes(24).toString('hex');
const RESERVED_SLUGS = new Set(['pages', 'index.html', '404.html', 'CNAME', 'cname']);

const TEXT_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.json',
  '.txt', '.md', '.svg', '.xml', '.csv', '.yaml', '.yml',
]);

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif',
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml; charset=utf-8',
};

function ensurePagesDir() {
  if (!fs.existsSync(PAGES_DIR)) {
    fs.mkdirSync(PAGES_DIR, { recursive: true });
  }
}

function normalizeRelPath(relPath) {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function resolveSafePagesPath(relPath) {
  ensurePagesDir();
  const cleanRel = normalizeRelPath(relPath);
  const fullPath = path.resolve(PAGES_DIR, cleanRel);
  const rootWithSep = PAGES_DIR.endsWith(path.sep) ? PAGES_DIR : PAGES_DIR + path.sep;
  if (fullPath !== PAGES_DIR && !fullPath.startsWith(rootWithSep)) {
    throw new Error('不正なパスが指定されました（pages フォルダ外へのアクセスは禁止されています）');
  }
  return { fullPath, relPath: cleanRel };
}

function validateEntryName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '名前を入力してください';
  if (trimmed === '.' || trimmed === '..') return 'その名前は使用できません';
  if (/[\/\\:*?"<>|\0]/.test(trimmed)) return '名前に使用できない文字（/ \\ : * ? " < > |）が含まれています';
  return null;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function collectAllFolders(dirFullPath = PAGES_DIR, relPrefix = '') {
  ensurePagesDir();
  const result = [''];
  function walk(currentFull, currentRel) {
    const items = fs.readdirSync(currentFull, { withFileTypes: true });
    items.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    for (const item of items) {
      if (item.isDirectory()) {
        const nextRel = currentRel ? `${currentRel}/${item.name}` : item.name;
        result.push(nextRel);
        walk(path.join(currentFull, item.name), nextRel);
      }
    }
  }
  walk(dirFullPath, relPrefix);
  return result;
}

function encodePublicPagesPath(relPath) {
  return relPath
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function listPagesDirectory(relDir) {
  const { fullPath, relPath } = resolveSafePagesPath(relDir);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
    throw new Error(`フォルダが見つかりません: /pages/${relPath}`);
  }

  const rawItems = fs.readdirSync(fullPath, { withFileTypes: true });
  const entries = rawItems.map((dirent) => {
    const itemFull = path.join(fullPath, dirent.name);
    const stat = fs.statSync(itemFull);
    const itemRel = relPath ? `${relPath}/${dirent.name}` : dirent.name;
    const isDir = dirent.isDirectory();
    const ext = isDir ? '' : path.extname(dirent.name).toLowerCase();
    const encoded = encodePublicPagesPath(itemRel);
    return {
      name: dirent.name,
      relPath: itemRel,
      isDir,
      ext,
      isText: !isDir && TEXT_EXTENSIONS.has(ext),
      isImage: !isDir && IMAGE_EXTENSIONS.has(ext),
      size: isDir ? 0 : stat.size,
      mtime: stat.mtime.toISOString(),
      publicUrl: `${SITE_ORIGIN}/pages/${encoded}${isDir ? '/' : ''}`,
      previewUrl: `/preview/pages/${encoded}`,
    };
  });

  // フォルダ優先、次に名前順
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'ja');
  });

  return {
    dir: relPath,
    entries,
    allFolders: collectAllFolders(),
  };
}

function runGit(args) {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd: ROOT_DIR, maxBuffer: 1024 * 1024 * 4 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
          command: `git ${args.join(' ')}`,
          stdout: (stdout || '').trimEnd(),
          stderr: (stderr || '').trimEnd(),
        });
      }
    );
  });
}

function readRawLinks() {
  const rawText = fs.readFileSync(LINKS_PATH, 'utf8');
  return JSON.parse(rawText);
}

function writeLinksEntries(entries) {
  const output = {};
  for (const entry of entries) {
    output[entry.slug] = {
      url: entry.url,
      title: entry.title || entry.slug,
      description: entry.description || '',
      public: Boolean(entry.public),
    };
  }
  fs.writeFileSync(LINKS_PATH, `${JSON.stringify(output, null, 4)}\n`, 'utf8');
}

function validateUrl(url) {
  if (!url || typeof url !== 'string') return '遷移先URLを入力してください';
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'URLは http:// または https:// で始まる必要があります';
    }
    return null;
  } catch {
    return '有効なURL形式で入力してください（例: https://example.com）';
  }
}

function checkSlug(slug) {
  const baseErr = validateSlug(slug);
  if (baseErr) return baseErr;
  if (RESERVED_SLUGS.has(slug)) {
    return `"${slug}" はシステム予約パスのため使用できません`;
  }
  if (/\s/.test(slug)) {
    return 'スラッグに空白文字は使用できません';
  }
  return null;
}

async function getGitStatus() {
  const [branchRes, statusRes, remoteRes, logRes, diffRes] = await Promise.all([
    runGit(['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(['status', '--porcelain']),
    runGit(['remote', 'get-url', 'origin']),
    runGit(['log', '-n', '10', '--pretty=format:%h%x1f%s%x1f%cr%x1f%an']),
    runGit(['diff', '--', 'links.json']),
  ]);

  const branch = branchRes.ok ? branchRes.stdout.trim() : 'unknown';
  const files = statusRes.ok && statusRes.stdout
    ? statusRes.stdout.split('\n').filter(Boolean).map((line) => ({
        status: line.slice(0, 2).trim() || 'M',
        file: line.slice(3),
      }))
    : [];

  let ahead = 0;
  let behind = 0;
  const revList = await runGit(['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
  if (revList.ok && revList.stdout) {
    const parts = revList.stdout.trim().split(/\s+/);
    ahead = Number(parts[0]) || 0;
    behind = Number(parts[1]) || 0;
  }

  const commits = logRes.ok && logRes.stdout
    ? logRes.stdout.split('\n').filter(Boolean).map((line) => {
        const [hash, subject, relativeDate, author] = line.split('\x1f');
        return { hash, subject, relativeDate, author };
      })
    : [];

  const remoteUrl = remoteRes.ok ? remoteRes.stdout.trim() : '';
  const actionsUrl = remoteUrl
    ? remoteUrl
        .replace(/^git@github\.com:/, 'https://github.com/')
        .replace(/\.git$/, '') + '/actions'
    : '';

  return {
    branch,
    remoteUrl,
    actionsUrl,
    dirty: files.length > 0,
    linksDirty: files.some((f) => f.file === 'links.json'),
    files,
    ahead,
    behind,
    diff: diffRes.ok ? diffRes.stdout : '',
    commits,
  };
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY_BYTES) {
        reject(new Error('Request body too large (max 25MB)'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function verifyToken(req) {
  return req.headers['x-manager-token'] === API_TOKEN;
}

function openBrowser(url) {
  if (process.argv.includes('--no-open')) return;
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // ブラウザ自動起動に失敗してもサーバー自体は継続
  }
}

const SLUG_CHARSETS = {
  alnum_lower: 'abcdefghijklmnopqrstuvwxyz0123456789',
  alnum_safe: 'abcdefghjkmnpqrstuvwxyz23456789',
  alnum_mixed: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
};

function randomStringFromAlphabet(length, alphabet) {
  const len = alphabet.length;
  // 剰余バイアスを除去するための閾値
  const maxValidByte = Math.floor(256 / len) * len;
  let result = '';
  while (result.length < length) {
    const needed = length - result.length;
    const buf = crypto.randomBytes(Math.max(needed * 2, 16));
    for (let i = 0; i < buf.length && result.length < length; i += 1) {
      if (buf[i] < maxValidByte) {
        result += alphabet[buf[i] % len];
      }
    }
  }
  return result;
}

function indexToSlug(index, length, alphabet) {
  const base = alphabet.length;
  const chars = new Array(length);
  let n = index;
  for (let i = length - 1; i >= 0; i -= 1) {
    chars[i] = alphabet[n % base];
    n = Math.floor(n / base);
  }
  return chars.join('');
}

function generateUniqueSlug(length, charsetKey, entries) {
  const alphabet = SLUG_CHARSETS[charsetKey] || SLUG_CHARSETS.alnum_lower;
  const resolvedCharset = SLUG_CHARSETS[charsetKey] ? charsetKey : 'alnum_lower';

  if (!Number.isInteger(length) || length < 1 || length > 32) {
    throw new Error('桁数は 1〜32 の整数で指定してください');
  }

  // O(1) で重複判定できるよう小文字正規化した Set を構築（大文字小文字を区別しないFSでの衝突も防止）
  const usedLower = new Set();
  for (const r of RESERVED_SLUGS) usedLower.add(r.toLowerCase());
  for (const e of entries) usedLower.add(e.slug.toLowerCase());

  const totalSpace = Math.pow(alphabet.length, length);

  // 候補空間が小さい場合（1〜2桁など）は占有率を見て無駄なリトライを回避
  if (totalSpace <= 10000) {
    const lowerAlphabetSet = new Set(alphabet.toLowerCase().split(''));
    let occupiedInSpace = 0;
    for (const s of usedLower) {
      if (s.length === length && [...s].every((ch) => lowerAlphabetSet.has(ch))) {
        occupiedInSpace += 1;
      }
    }
    if (occupiedInSpace >= totalSpace) {
      throw new Error(`${length}桁の組み合わせはすべて使用済みです。桁数を増やしてください。`);
    }
    // 占有率が50%以上の場合は、ランダム開始位置からの線形プローブに切替（無限リトライ防止）
    if (occupiedInSpace * 2 >= totalSpace) {
      const start = crypto.randomInt(0, totalSpace);
      for (let offset = 0; offset < totalSpace; offset += 1) {
        const candidate = indexToSlug((start + offset) % totalSpace, length, alphabet);
        if (!usedLower.has(candidate.toLowerCase())) {
          return {
            slug: candidate,
            length,
            charset: resolvedCharset,
            attempts: offset + 1,
            strategy: 'linear-probe',
          };
        }
      }
      throw new Error(`${length}桁の空きスラッグが見つかりませんでした。桁数を増やしてください。`);
    }
  }

  // 通常ケース：O(1) Set判定による高速ランダムサンプリング（ほぼ1回でヒット）
  const maxAttempts = 32;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = randomStringFromAlphabet(length, alphabet);
    if (!usedLower.has(candidate.toLowerCase())) {
      return {
        slug: candidate,
        length,
        charset: resolvedCharset,
        attempts: attempt,
        strategy: 'random-sample',
      };
    }
  }

  throw new Error('一意なスラッグの生成に失敗しました。桁数を増やして再試行してください。');
}

async function handleApi(req, res, pathname) {
  if (req.method !== 'GET' && !verifyToken(req)) {
    return sendJson(res, 403, { error: 'Invalid session token' });
  }

  try {
    if (pathname === '/api/links' && req.method === 'GET') {
      const entries = normalizeLinks(readRawLinks());
      return sendJson(res, 200, {
        domain: SITE_DOMAIN,
        origin: SITE_ORIGIN,
        links: entries,
      });
    }

    if (pathname === '/api/links/generate-slug' && req.method === 'GET') {
      const urlObj = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const lengthParam = Number(urlObj.searchParams.get('length') || '6');
      const charsetParam = String(urlObj.searchParams.get('charset') || 'alnum_lower');
      const entries = normalizeLinks(readRawLinks());
      try {
        const generated = generateUniqueSlug(lengthParam, charsetParam, entries);
        return sendJson(res, 200, { ok: true, ...generated });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (pathname === '/api/links' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const slug = String(body.slug || '').trim();
      const url = String(body.url || '').trim();
      const title = String(body.title || '').trim() || slug;
      const description = String(body.description || '').trim();
      const isPublic = Boolean(body.public);

      const slugErr = checkSlug(slug);
      if (slugErr) return sendJson(res, 400, { error: slugErr });
      const urlErr = validateUrl(url);
      if (urlErr) return sendJson(res, 400, { error: urlErr });

      const entries = normalizeLinks(readRawLinks());
      if (entries.some((e) => e.slug === slug)) {
        return sendJson(res, 409, { error: `スラッグ "/${slug}" は既に登録されています` });
      }

      entries.push({ slug, url, title, description, public: isPublic });
      writeLinksEntries(entries);
      return sendJson(res, 201, { ok: true, links: entries });
    }

    if (pathname === '/api/links' && req.method === 'PUT') {
      const body = await parseJsonBody(req);
      const originalSlug = String(body.originalSlug || body.slug || '').trim();
      const slug = String(body.slug || '').trim();
      const url = String(body.url || '').trim();
      const title = String(body.title || '').trim() || slug;
      const description = String(body.description || '').trim();
      const isPublic = Boolean(body.public);

      const slugErr = checkSlug(slug);
      if (slugErr) return sendJson(res, 400, { error: slugErr });
      const urlErr = validateUrl(url);
      if (urlErr) return sendJson(res, 400, { error: urlErr });

      const entries = normalizeLinks(readRawLinks());
      const index = entries.findIndex((e) => e.slug === originalSlug);
      if (index === -1) {
        return sendJson(res, 404, { error: `スラッグ "/${originalSlug}" が見つかりません` });
      }
      if (slug !== originalSlug && entries.some((e) => e.slug === slug)) {
        return sendJson(res, 409, { error: `変更先スラッグ "/${slug}" は既に存在します` });
      }

      entries[index] = { slug, url, title, description, public: isPublic };
      writeLinksEntries(entries);
      return sendJson(res, 200, { ok: true, links: entries });
    }

    if (pathname === '/api/links' && req.method === 'DELETE') {
      const urlObj = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const querySlug = urlObj.searchParams.get('slug');
      const body = querySlug ? {} : await parseJsonBody(req);
      const slug = String(querySlug || body.slug || '').trim();
      const entries = normalizeLinks(readRawLinks());
      const next = entries.filter((e) => e.slug !== slug);
      if (next.length === entries.length) {
        return sendJson(res, 404, { error: `スラッグ "/${slug}" が見つかりません` });
      }
      writeLinksEntries(next);
      return sendJson(res, 200, { ok: true, links: next });
    }

    // ---- Pages Explorer APIs (src/pages 管理) ----
    if (pathname === '/api/pages/list' && req.method === 'GET') {
      const urlObj = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const relDir = urlObj.searchParams.get('dir') || '';
      const data = listPagesDirectory(relDir);
      return sendJson(res, 200, { ok: true, ...data });
    }

    if (pathname === '/api/pages/file' && req.method === 'GET') {
      const urlObj = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const relFile = urlObj.searchParams.get('path') || '';
      const { fullPath, relPath } = resolveSafePagesPath(relFile);
      if (!relPath || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
        return sendJson(res, 404, { error: 'ファイルが見つかりません' });
      }
      const stat = fs.statSync(fullPath);
      const ext = path.extname(fullPath).toLowerCase();
      const isText = TEXT_EXTENSIONS.has(ext);
      const isImage = IMAGE_EXTENSIONS.has(ext);
      const encoded = encodePublicPagesPath(relPath);
      return sendJson(res, 200, {
        ok: true,
        relPath,
        name: path.basename(fullPath),
        ext,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        isText,
        isImage,
        content: isText ? fs.readFileSync(fullPath, 'utf8') : null,
        publicUrl: `${SITE_ORIGIN}/pages/${encoded}`,
        previewUrl: `/preview/pages/${encoded}`,
      });
    }

    if (pathname === '/api/pages/file' && req.method === 'PUT') {
      const body = await parseJsonBody(req);
      const relFile = String(body.path || '').trim();
      const content = typeof body.content === 'string' ? body.content : '';
      const { fullPath, relPath } = resolveSafePagesPath(relFile);
      if (!relPath) return sendJson(res, 400, { error: 'ファイルパスを指定してください' });
      const nameErr = validateEntryName(path.basename(relPath));
      if (nameErr) return sendJson(res, 400, { error: nameErr });

      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf8');
      const dirRel = path.posix.dirname(relPath) === '.' ? '' : path.posix.dirname(relPath);
      return sendJson(res, 200, {
        ok: true,
        relPath,
        listing: listPagesDirectory(dirRel),
      });
    }

    if (pathname === '/api/pages/folder' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const dir = normalizeRelPath(body.dir || '');
      const name = String(body.name || '').trim();
      const nameErr = validateEntryName(name);
      if (nameErr) return sendJson(res, 400, { error: nameErr });

      const targetRel = dir ? `${dir}/${name}` : name;
      const { fullPath } = resolveSafePagesPath(targetRel);
      if (fs.existsSync(fullPath)) {
        return sendJson(res, 409, { error: `"${name}" は既に存在します` });
      }
      fs.mkdirSync(fullPath, { recursive: true });
      return sendJson(res, 201, {
        ok: true,
        relPath: targetRel,
        listing: listPagesDirectory(dir),
      });
    }

    if (pathname === '/api/pages/upload' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const dir = normalizeRelPath(body.dir || '');
      const filename = String(body.filename || '').trim();
      const dataBase64 = String(body.dataBase64 || '');
      const nameErr = validateEntryName(filename);
      if (nameErr) return sendJson(res, 400, { error: nameErr });
      if (!dataBase64) return sendJson(res, 400, { error: 'ファイルデータが空です' });

      const targetRel = dir ? `${dir}/${filename}` : filename;
      const { fullPath } = resolveSafePagesPath(targetRel);
      const buffer = Buffer.from(dataBase64, 'base64');
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, buffer);
      return sendJson(res, 201, {
        ok: true,
        relPath: targetRel,
        size: buffer.length,
        listing: listPagesDirectory(dir),
      });
    }

    if (pathname === '/api/pages/rename' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const fromRel = normalizeRelPath(body.from || '');
      const toRel = normalizeRelPath(body.to || '');
      if (!fromRel || !toRel) {
        return sendJson(res, 400, { error: '移動元と移動先のパスを指定してください' });
      }
      const nameErr = validateEntryName(path.posix.basename(toRel));
      if (nameErr) return sendJson(res, 400, { error: nameErr });

      const src = resolveSafePagesPath(fromRel);
      const dst = resolveSafePagesPath(toRel);
      if (!fs.existsSync(src.fullPath)) {
        return sendJson(res, 404, { error: '対象のファイルまたはフォルダが見つかりません' });
      }
      if (src.fullPath === PAGES_DIR) {
        return sendJson(res, 400, { error: 'pages ルートフォルダは変更できません' });
      }
      if (src.fullPath === dst.fullPath) {
        return sendJson(res, 200, { ok: true, relPath: dst.relPath });
      }
      if (dst.fullPath.startsWith(src.fullPath + path.sep)) {
        return sendJson(res, 400, { error: 'フォルダを自分自身の配下へ移動することはできません' });
      }
      if (fs.existsSync(dst.fullPath)) {
        return sendJson(res, 409, { error: `移動先 "${dst.relPath}" は既に存在します` });
      }

      fs.mkdirSync(path.dirname(dst.fullPath), { recursive: true });
      fs.renameSync(src.fullPath, dst.fullPath);
      const parentDir = path.posix.dirname(dst.relPath) === '.' ? '' : path.posix.dirname(dst.relPath);
      return sendJson(res, 200, {
        ok: true,
        from: src.relPath,
        to: dst.relPath,
        listing: listPagesDirectory(parentDir),
      });
    }

    if (pathname === '/api/pages/entry' && req.method === 'DELETE') {
      const urlObj = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const relTarget = normalizeRelPath(urlObj.searchParams.get('path') || '');
      if (!relTarget) {
        return sendJson(res, 400, { error: '削除対象を指定してください' });
      }
      const target = resolveSafePagesPath(relTarget);
      if (target.fullPath === PAGES_DIR) {
        return sendJson(res, 400, { error: 'pages ルートフォルダは削除できません' });
      }
      if (!fs.existsSync(target.fullPath)) {
        return sendJson(res, 404, { error: '削除対象が見つかりません' });
      }
      fs.rmSync(target.fullPath, { recursive: true, force: true });
      const parentDir = path.posix.dirname(relTarget) === '.' ? '' : path.posix.dirname(relTarget);
      return sendJson(res, 200, {
        ok: true,
        deleted: relTarget,
        listing: listPagesDirectory(parentDir),
      });
    }

    if (pathname === '/api/build' && req.method === 'POST') {
      const result = build({ silent: true });
      return sendJson(res, 200, { ok: true, result });
    }

    if (pathname === '/api/git/status' && req.method === 'GET') {
      const status = await getGitStatus();
      return sendJson(res, 200, status);
    }

    if (pathname === '/api/git/pull' && req.method === 'POST') {
      const pullRes = await runGit(['pull', '--rebase']);
      const status = await getGitStatus();
      return sendJson(res, pullRes.ok ? 200 : 500, {
        ok: pullRes.ok,
        steps: [pullRes],
        status,
      });
    }

    if (pathname === '/api/git/commit' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const stageAll = Boolean(body.stageAll);
      const message = String(body.message || '').trim() || 'Update shortcuts and pages';
      const steps = [];

      const addArgs = stageAll ? ['add', '-A'] : ['add', '--', 'links.json', 'src/pages'];
      const addRes = await runGit(addArgs);
      steps.push(addRes);
      if (!addRes.ok) {
        return sendJson(res, 500, { ok: false, steps, status: await getGitStatus() });
      }

      const diffCached = await runGit(['diff', '--cached', '--quiet']);
      if (diffCached.ok) {
        return sendJson(res, 200, {
          ok: true,
          message: 'コミットする変更はありませんでした',
          steps,
          status: await getGitStatus(),
        });
      }

      const commitRes = await runGit(['commit', '-m', message]);
      steps.push(commitRes);
      return sendJson(res, commitRes.ok ? 200 : 500, {
        ok: commitRes.ok,
        steps,
        status: await getGitStatus(),
      });
    }

    if (pathname === '/api/git/push' && req.method === 'POST') {
      const statusBefore = await getGitStatus();
      const pushRes = await runGit(['push', 'origin', statusBefore.branch]);
      return sendJson(res, pushRes.ok ? 200 : 500, {
        ok: pushRes.ok,
        steps: [pushRes],
        status: await getGitStatus(),
      });
    }

    if (pathname === '/api/git/sync' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const stageAll = Boolean(body.stageAll);
      const message = String(body.message || '').trim() || 'Update shortcuts and pages';
      const steps = [];

      // 1. 変更があればステージ & コミット（links.json と src/pages を対象）
      const addArgs = stageAll ? ['add', '-A'] : ['add', '--', 'links.json', 'src/pages'];
      const addRes = await runGit(addArgs);
      steps.push(addRes);
      if (!addRes.ok) {
        return sendJson(res, 500, { ok: false, steps, status: await getGitStatus() });
      }

      const diffCached = await runGit(['diff', '--cached', '--quiet']);
      if (!diffCached.ok) {
        const commitRes = await runGit(['commit', '-m', message]);
        steps.push(commitRes);
        if (!commitRes.ok) {
          return sendJson(res, 500, { ok: false, steps, status: await getGitStatus() });
        }
      }

      // 2. リモートの最新を取得 (pull --rebase)
      const pullRes = await runGit(['pull', '--rebase']);
      steps.push(pullRes);
      if (!pullRes.ok) {
        return sendJson(res, 500, { ok: false, steps, status: await getGitStatus() });
      }

      // 3. プッシュして GitHub Pages デプロイをトリガー
      const current = await getGitStatus();
      const pushRes = await runGit(['push', 'origin', current.branch]);
      steps.push(pushRes);

      return sendJson(res, pushRes.ok ? 200 : 500, {
        ok: pushRes.ok,
        steps,
        status: await getGitStatus(),
      });
    }

    if (pathname === '/api/git/discard' && req.method === 'POST') {
      const resCheckout = await runGit(['checkout', '--', 'links.json']);
      const status = await getGitStatus();
      const links = normalizeLinks(readRawLinks());
      return sendJson(res, resCheckout.ok ? 200 : 500, {
        ok: resCheckout.ok,
        steps: [resCheckout],
        status,
        links,
      });
    }

    return sendJson(res, 404, { error: 'Not Found' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'Internal Server Error' });
  }
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = urlObj.pathname;

  if (pathname === '/' && req.method === 'GET') {
    const html = fs
      .readFileSync(MANAGER_HTML_PATH, 'utf8')
      .replace('__MANAGER_TOKEN__', API_TOKEN)
      .replace(/__SITE_DOMAIN__/g, SITE_DOMAIN);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(html);
    return;
  }

  if (pathname === '/assets/editor.js' && req.method === 'GET') {
    const js = fs.readFileSync(EDITOR_JS_PATH, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(js);
    return;
  }

  if (pathname.startsWith('/preview/pages/') && req.method === 'GET') {
    try {
      const rawRel = decodeURIComponent(pathname.slice('/preview/pages/'.length));
      const { fullPath } = resolveSafePagesPath(rawRel);
      let target = fullPath;
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        target = path.join(target, 'index.html');
      }
      if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Preview target not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': getMimeType(target),
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(target).pipe(res);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(err.message);
    }
    return;
  }

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

function listenOnAvailablePort(port) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < DEFAULT_PORT + 20) {
      listenOnAvailablePort(port + 1);
    } else {
      console.error('Failed to start manager server:', err);
      process.exit(1);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`\n🚀 s.qch.jp Local Manager (MotoYucchi Admin)`);
    console.log(`   URL: ${url}`);
    console.log(`   Ctrl+C で終了します\n`);
    openBrowser(url);
  });
}

listenOnAvailablePort(DEFAULT_PORT);
