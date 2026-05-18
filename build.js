const fs = require('fs');
const path = require('path');

// 設定ファイルとパスの定義
const links = require('./links.json');
const srcDir = path.join(__dirname, 'src');
const distDir = path.join(__dirname, 'dist');

// 1. distフォルダを完全に初期化（クリーンアップ）
if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true });
fs.mkdirSync(distDir);

// 2. フォルダを丸ごとコピーする関数
function copyFolderSync(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach(element => {
    const fromPath = path.join(from, element);
    const toPath = path.join(to, element);
    
    // ルートにある特定のファイルはスキップ（個別に処理するため）
    if (from === srcDir && (element === 'home.html' || element === '404.html')) {
      return;
    }

    if (fs.lstatSync(fromPath).isDirectory()) {
      copyFolderSync(fromPath, toPath);
    } else {
      fs.copyFileSync(fromPath, toPath);
    }
  });
}

// src内のファイルをdistにコピー（home.html / 404.html 以外）
if (fs.existsSync(srcDir)) {
  copyFolderSync(srcDir, distDir);
}

// 3. ルート用の特別処理
// src/home.html -> dist/index.html (トップページ化)
const srcHome = path.join(srcDir, 'home.html');
if (fs.existsSync(srcHome)) {
  fs.copyFileSync(srcHome, path.join(distDir, 'index.html'));
  console.log('Processed: home.html -> index.html');
} else {
  console.warn('⚠️ Warning: src/home.html not found!');
}

// src/404.html -> dist/404.html (GitHub Pages用エラーページ)
const src404 = path.join(srcDir, '404.html');
if (fs.existsSync(src404)) {
  fs.copyFileSync(src404, path.join(distDir, '404.html'));
  console.log('Processed: 404.html');
}

// 4. 独自ドメイン用のCNAMEファイルをdistに生成
fs.writeFileSync(path.join(distDir, 'CNAME'), 'qgr.jp');

// 5. links.jsonから短縮URL用のHTML群を自動生成
Object.entries(links).forEach(([slug, url]) => {
  const slugDir = path.join(distDir, slug);
  
  // 上書き衝突防止
  if (fs.existsSync(slugDir)) {
     console.error(`⚠️ Conflict Warning: "${slug}" already exists! Skipping link.`);
     return;
  }

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
  console.log(`Generated Link: /${slug} -> ${url}`);
});
