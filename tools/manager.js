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
const DEFAULT_PORT = Number(process.env.PORT) || 4173;
const API_TOKEN = crypto.randomBytes(24).toString('hex');
const RESERVED_SLUGS = new Set(['pages', 'index.html', '404.html', 'CNAME', 'cname']);

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
      if (data.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
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
      const message = String(body.message || '').trim() || 'Update shortcuts in links.json';
      const steps = [];

      const addArgs = stageAll ? ['add', '-A'] : ['add', 'links.json'];
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
      const message = String(body.message || '').trim() || 'Update shortcuts in links.json';
      const steps = [];

      // 1. 変更があればステージ & コミット
      const addArgs = stageAll ? ['add', '-A'] : ['add', 'links.json'];
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
