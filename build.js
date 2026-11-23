const fs = require('fs');
const path = require('path');

const SITE_DOMAIN = 's.qch.jp';
const SITE_ORIGIN = `https://${SITE_DOMAIN}`;
const ROOT_DIR = __dirname;
const LINKS_PATH = path.join(ROOT_DIR, 'links.json');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeLinkEntry(slug, raw) {
  if (typeof raw === 'string') {
    return {
      slug,
      url: raw.trim(),
      title: slug,
      description: '',
      public: false,
    };
  }
  const entry = raw && typeof raw === 'object' ? raw : {};
  return {
    slug,
    url: typeof entry.url === 'string' ? entry.url.trim() : '',
    title: typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : slug,
    description: typeof entry.description === 'string' ? entry.description.trim() : '',
    public: Boolean(entry.public),
  };
}

function normalizeLinks(rawLinks) {
  if (!rawLinks || typeof rawLinks !== 'object' || Array.isArray(rawLinks)) {
    throw new Error('links.json must be a JSON object.');
  }
  return Object.entries(rawLinks).map(([slug, value]) => normalizeLinkEntry(slug, value));
}

function copyFolderSync(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const element of fs.readdirSync(from)) {
    const fromPath = path.join(from, element);
    const toPath = path.join(to, element);

    // ルートテンプレートは個別処理するためスキップ
    if (from === SRC_DIR && (element === 'home.html' || element === '404.html')) {
      continue;
    }

    if (fs.lstatSync(fromPath).isDirectory()) {
      copyFolderSync(fromPath, toPath);
    } else {
      fs.copyFileSync(fromPath, toPath);
    }
  }
}

function getDisplayHost(url) {
  try {
    const parsed = new URL(url);
    return parsed.host + (parsed.pathname === '/' ? '' : parsed.pathname);
  } catch {
    return url;
  }
}

function renderPublicLinksHtml(entries) {
  const publicEntries = entries.filter((entry) => entry.public && entry.url);
  if (publicEntries.length === 0) {
    return `<div class="empty-state">現在公開中のショートカットリンクはありません。</div>`;
  }

  return publicEntries
    .map((entry) => {
      const safeSlug = escapeHtml(entry.slug);
      const safeTitle = escapeHtml(entry.title);
      const safeDesc = escapeHtml(entry.description || getDisplayHost(entry.url));
      const shortPath = `/${encodeURI(entry.slug)}`;
      const fullShortUrl = `${SITE_ORIGIN}/${entry.slug}`;
      const safeShortUrl = escapeHtml(fullShortUrl);
      const safeShortLabel = escapeHtml(`${SITE_DOMAIN}/${entry.slug}`);
      const searchAttr = escapeHtml(
        `${entry.slug} ${entry.title} ${entry.description} ${entry.url}`.toLowerCase()
      );

      return `        <div class="link-card" data-search="${searchAttr}">
            <a href="${escapeHtml(shortPath)}" class="link-main" rel="noopener">
                <div class="link-badge">/${safeSlug}</div>
                <div class="link-body">
                    <div class="link-title">${safeTitle}</div>
                    <div class="link-meta">
                        <span class="link-short">${safeShortLabel}</span>
                        <span class="link-sep">·</span>
                        <span class="link-dest">${safeDesc}</span>
                    </div>
                </div>
                <span class="link-arrow" aria-hidden="true">→</span>
            </a>
            <button type="button" class="copy-btn" data-url="${safeShortUrl}" aria-label="${safeShortLabel} をコピー" title="URLをコピー">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
        </div>`;
    })
    .join('\n');
}

function renderRedirectHtml(entry) {
  const safeUrl = escapeHtml(entry.url);
  const safeTitle = escapeHtml(entry.title);
  const safeSlug = escapeHtml(entry.slug);
  const safeHost = escapeHtml(getDisplayHost(entry.url));
  const jsUrl = JSON.stringify(entry.url);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta http-equiv="refresh" content="0;url=${safeUrl}">
  <link rel="canonical" href="${safeUrl}">
  <title>${safeTitle} | ${SITE_DOMAIN}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f8fafc;
      --card: #ffffff;
      --border: #e2e8f0;
      --text: #0f172a;
      --muted: #64748b;
      --accent: #2563eb;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0b1120;
        --card: #111827;
        --border: #1e293b;
        --text: #f8fafc;
        --muted: #94a3b8;
        --accent: #60a5fa;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
    }
    .card {
      width: 100%;
      max-width: 440px;
      padding: 32px 28px;
      border-radius: 18px;
      background: var(--card);
      border: 1px solid var(--border);
      text-align: center;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
    }
    .spinner {
      width: 28px;
      height: 28px;
      margin: 0 auto 18px;
      border: 3px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .slug {
      display: inline-block;
      margin-bottom: 10px;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 12%, transparent);
    }
    h1 { font-size: 17px; font-weight: 600; margin-bottom: 8px; }
    .dest {
      font-size: 13px;
      color: var(--muted);
      word-break: break-all;
      margin-bottom: 18px;
    }
    a {
      color: var(--accent);
      font-size: 13px;
      text-decoration: none;
    }
    a:hover { text-decoration: underline; }
  </style>
  <script>window.location.replace(${jsUrl});</script>
</head>
<body>
  <main class="card">
    <div class="spinner" aria-hidden="true"></div>
    <div class="slug">${SITE_DOMAIN}/${safeSlug}</div>
    <h1>リダイレクトしています…</h1>
    <p class="dest">${safeHost}</p>
    <a href="${safeUrl}">自動で移動しない場合はこちら</a>
  </main>
</body>
</html>
`;
}

function validateSlug(slug) {
  if (!slug || typeof slug !== 'string') return 'スラッグが空です';
  if (slug.startsWith('/') || slug.endsWith('/')) return 'スラッグの先頭・末尾に / は使えません';
  if (slug.includes('..') || slug.includes('\\')) return 'スラッグに .. や \\ は使えません';
  return null;
}

function build(options = {}) {
  const silent = Boolean(options.silent);
  const log = (...args) => {
    if (!silent) console.log(...args);
  };
  const warn = (...args) => {
    if (!silent) console.warn(...args);
  };

  const rawLinks = JSON.parse(fs.readFileSync(LINKS_PATH, 'utf8'));
  const entries = normalizeLinks(rawLinks);

  // 1. distフォルダを初期化
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // 2. src内の静的ファイル（pages等）をそのままdistへコピー
  if (fs.existsSync(SRC_DIR)) {
    copyFolderSync(SRC_DIR, DIST_DIR);
  }

  // 3. トップページ (src/home.html -> dist/index.html)
  const srcHome = path.join(SRC_DIR, 'home.html');
  if (fs.existsSync(srcHome)) {
    let homeHtml = fs.readFileSync(srcHome, 'utf8');
    const publicLinksHtml = renderPublicLinksHtml(entries);
    const publicCount = entries.filter((e) => e.public && e.url).length;
    homeHtml = homeHtml
      .replace('<!-- PUBLIC_LINKS -->', publicLinksHtml)
      .replace(/<!-- PUBLIC_COUNT -->/g, String(publicCount))
      .replace(/<!-- TOTAL_COUNT -->/g, String(entries.length))
      .replace(/<!-- BUILD_YEAR -->/g, String(new Date().getFullYear()));
    fs.writeFileSync(path.join(DIST_DIR, 'index.html'), homeHtml, 'utf8');
    log('Processed: home.html -> index.html');
  } else {
    warn('Warning: src/home.html not found!');
  }

  // 4. 404ページ (src/404.html -> dist/404.html)
  const src404 = path.join(SRC_DIR, '404.html');
  if (fs.existsSync(src404)) {
    let html404 = fs.readFileSync(src404, 'utf8');
    html404 = html404.replace(/<!-- BUILD_YEAR -->/g, String(new Date().getFullYear()));
    fs.writeFileSync(path.join(DIST_DIR, '404.html'), html404, 'utf8');
    log('Processed: 404.html');
  }

  // 5. 独自ドメイン用のCNAMEファイルを生成
  fs.writeFileSync(path.join(DIST_DIR, 'CNAME'), `${SITE_DOMAIN}\n`, 'utf8');

  // 6. links.jsonからリダイレクトHTMLを生成
  const generated = [];
  const skipped = [];

  for (const entry of entries) {
    const slugError = validateSlug(entry.slug);
    if (slugError) {
      warn(`Skip invalid slug "${entry.slug}": ${slugError}`);
      skipped.push({ slug: entry.slug, reason: slugError });
      continue;
    }
    if (!entry.url) {
      warn(`Skip "${entry.slug}": empty URL`);
      skipped.push({ slug: entry.slug, reason: 'URLが空です' });
      continue;
    }

    const slugDir = path.join(DIST_DIR, entry.slug);
    if (fs.existsSync(slugDir)) {
      warn(`Conflict Warning: "${entry.slug}" already exists! Skipping link.`);
      skipped.push({ slug: entry.slug, reason: '既存ファイルまたはディレクトリと衝突しています' });
      continue;
    }

    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, 'index.html'), renderRedirectHtml(entry), 'utf8');
    generated.push({ slug: entry.slug, url: entry.url, public: entry.public });
    log(`Generated Link: /${entry.slug} -> ${entry.url}`);
  }

  return {
    domain: SITE_DOMAIN,
    total: entries.length,
    generatedCount: generated.length,
    skippedCount: skipped.length,
    generated,
    skipped,
  };
}

if (require.main === module) {
  const result = build();
  console.log(`\nBuild complete: ${result.generatedCount}/${result.total} links generated for ${result.domain}`);
}

module.exports = {
  SITE_DOMAIN,
  SITE_ORIGIN,
  LINKS_PATH,
  build,
  normalizeLinkEntry,
  normalizeLinks,
  validateSlug,
};
