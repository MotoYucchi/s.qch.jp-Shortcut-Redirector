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
    return `<div class="empty-state">現在、公開されているショートカットリンクはありません。</div>`;
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

      return `        <div class="link-row" data-search="${searchAttr}">
            <div class="col-slug">
                <a href="${escapeHtml(shortPath)}" class="slug-link" rel="noopener">/${safeSlug}</a>
            </div>
            <div class="col-info">
                <a href="${escapeHtml(shortPath)}" class="title-link" rel="noopener">${safeTitle}</a>
                <div class="desc-line">
                    <span class="short-url">${safeShortLabel}</span>
                    <span class="sep">→</span>
                    <span class="dest-host">${safeDesc}</span>
                </div>
            </div>
            <div class="col-actions">
                <a href="${escapeHtml(shortPath)}" class="retro-btn btn-go" rel="noopener">開く</a>
                <button type="button" class="retro-btn copy-btn" data-url="${safeShortUrl}" aria-label="${safeShortLabel} をコピー" title="短縮URLをコピー">コピー</button>
            </div>
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
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background-color: #f3efe4;
      color: #2c2822;
      font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", "MS PGothic", sans-serif;
      line-height: 1.7;
    }
    .frame {
      width: 100%;
      max-width: 460px;
      background-color: #fdfbf6;
      border: 3px double #a89f8c;
      padding: 28px 24px;
      text-align: center;
      box-shadow: 3px 3px 0 #dcd5c5;
    }
    .tag {
      display: inline-block;
      padding: 2px 10px;
      margin-bottom: 12px;
      background-color: #ece6d8;
      border: 1px solid #bfb6a2;
      font-family: "Consolas", "Courier New", monospace;
      font-size: 13px;
      color: #3d362c;
    }
    h1 {
      font-size: 17px;
      font-weight: bold;
      color: #2c2822;
      margin-bottom: 8px;
    }
    .dest {
      font-size: 13px;
      color: #5b5347;
      word-break: break-all;
      margin-bottom: 18px;
      padding: 8px 10px;
      background-color: #f6f2e8;
      border: 1px dashed #c4bba6;
    }
    .go-link {
      display: inline-block;
      padding: 6px 16px;
      background-color: #ebe5d6;
      color: #1c4c7c;
      border: 2px solid;
      border-color: #ffffff #9c927d #9c927d #ffffff;
      text-decoration: underline;
      font-size: 13px;
      font-weight: bold;
    }
    .go-link:hover {
      background-color: #e2dac7;
    }
  </style>
  <script>window.location.replace(${jsUrl});</script>
</head>
<body>
  <main class="frame">
    <div class="tag">${SITE_DOMAIN}/${safeSlug}</div>
    <h1>移動しています…</h1>
    <p class="dest">${safeHost}</p>
    <a class="go-link" href="${safeUrl}">自動で移動しない場合はこちら</a>
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
