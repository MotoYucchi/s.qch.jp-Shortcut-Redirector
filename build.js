const fs = require('fs');
const path = require('path');

// 設定ファイルと出力先
const links = require('./links.json');
const distDir = path.join(__dirname, 'dist');

// distフォルダを初期化
if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true });
fs.mkdirSync(distDir);

// 独自ドメイン用のCNAMEファイルをdistにコピー（qgr.jpを設定）
fs.writeFileSync(path.join(distDir, 'CNAME'), 'qgr.jp');

// メインのトップページ（qgr.jp/ にアクセスしたとき用）
fs.writeFileSync(path.join(distDir, 'index.html'), '<h1>qgr.jp Shortener</h1>');

// 各短縮URLのHTMLを自動生成
Object.entries(links).forEach(([slug, url]) => {
  const slugDir = path.join(distDir, slug);
  fs.mkdirSync(slugDir, { recursive: true });

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${url}">
  <title>Redirecting...</title>
  <script>window.location.href = "${url}";</script>
</head>
<body>Redirecting to <a href="${url}">${url}</a>...</body>
</html>`;

  fs.writeFileSync(path.join(slugDir, 'index.html'), htmlContent);
  console.log(`Generated: /${slug} -> ${url}`);
});
