/**
 * RetroCodeEditor — 依存ゼロの内蔵コードエディタライブラリ
 * - HTML / CSS / JS / JSON シンタックスハイライト
 * - インデント空白・タブの色分け（Indent Rainbow）＋行末空白可視化
 * - リアルタイム構文・ケアレスミスチェッカー（HTML / CSS / JS / JSON、HTML内style/script含む）
 */
(function (global) {
  'use strict';

  const VOID_TAGS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
  ]);

  const JS_KEYWORDS = new Set([
    'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'false',
    'finally', 'for', 'from', 'function', 'if', 'import', 'in', 'instanceof',
    'let', 'new', 'null', 'of', 'return', 'static', 'super', 'switch', 'this',
    'throw', 'true', 'try', 'typeof', 'undefined', 'var', 'void', 'while', 'yield',
  ]);

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function detectLanguage(filePath) {
    const ext = (String(filePath || '').split('.').pop() || '').toLowerCase();
    if (ext === 'html' || ext === 'htm' || ext === 'svg' || ext === 'xml') return 'html';
    if (ext === 'css') return 'css';
    if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'js';
    if (ext === 'json') return 'json';
    return 'text';
  }

  // ---- インデント空白の色分け（Indent Rainbow） ----
  function renderLeadingIndent(spaces, showIndent) {
    if (!spaces) return '';
    if (!showIndent) return escapeHtml(spaces);

    let out = '';
    let level = 0;
    let i = 0;
    while (i < spaces.length) {
      if (spaces[i] === '\t') {
        out += `<span class="tok-indent tok-indent-${level % 4}">→   </span>`;
        level += 1;
        i += 1;
      } else {
        let chunk = '';
        let count = 0;
        while (i < spaces.length && spaces[i] === ' ' && count < 2) {
          chunk += '·';
          i += 1;
          count += 1;
        }
        out += `<span class="tok-indent tok-indent-${level % 4}">${chunk}</span>`;
        level += 1;
      }
    }
    return out;
  }

  // ---- 各言語の行ベース・軽量シンタックスハイライト ----
  function highlightJsSegment(code) {
    let out = '';
    let i = 0;
    const n = code.length;
    while (i < n) {
      const ch = code[i];
      const next = code[i + 1];

      // 単行コメント
      if (ch === '/' && next === '/') {
        out += `<span class="tok-comment">${escapeHtml(code.slice(i))}</span>`;
        break;
      }
      // ブロックコメント（単行内）
      if (ch === '/' && next === '*') {
        const end = code.indexOf('*/', i + 2);
        const slice = end === -1 ? code.slice(i) : code.slice(i, end + 2);
        out += `<span class="tok-comment">${escapeHtml(slice)}</span>`;
        i += slice.length;
        continue;
      }
      // 文字列
      if (ch === '"' || ch === "'" || ch === '`') {
        let j = i + 1;
        while (j < n) {
          if (code[j] === '\\') {
            j += 2;
            continue;
          }
          if (code[j] === ch) {
            j += 1;
            break;
          }
          j += 1;
        }
        out += `<span class="tok-string">${escapeHtml(code.slice(i, j))}</span>`;
        i = j;
        continue;
      }
      // 数値
      if (/[0-9]/.test(ch) && (i === 0 || !/[a-zA-Z0-9_$]/.test(code[i - 1]))) {
        let j = i + 1;
        while (j < n && /[0-9a-fA-FxX._]/.test(code[j])) j += 1;
        out += `<span class="tok-number">${escapeHtml(code.slice(i, j))}</span>`;
        i = j;
        continue;
      }
      // 識別子・キーワード
      if (/[a-zA-Z_$]/.test(ch)) {
        let j = i + 1;
        while (j < n && /[a-zA-Z0-9_$]/.test(code[j])) j += 1;
        const word = code.slice(i, j);
        if (JS_KEYWORDS.has(word)) {
          out += `<span class="tok-keyword">${escapeHtml(word)}</span>`;
        } else {
          out += escapeHtml(word);
        }
        i = j;
        continue;
      }
      // 括弧
      if ('{}()[]'.includes(ch)) {
        out += `<span class="tok-punct">${escapeHtml(ch)}</span>`;
        i += 1;
        continue;
      }

      out += escapeHtml(ch);
      i += 1;
    }
    return out;
  }

  function highlightCssSegment(code) {
    let out = '';
    let i = 0;
    const n = code.length;
    while (i < n) {
      const ch = code[i];
      if (ch === '/' && code[i + 1] === '*') {
        const end = code.indexOf('*/', i + 2);
        const slice = end === -1 ? code.slice(i) : code.slice(i, end + 2);
        out += `<span class="tok-comment">${escapeHtml(slice)}</span>`;
        i += slice.length;
        continue;
      }
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < n && code[j] !== ch) {
          if (code[j] === '\\') j += 2;
          else j += 1;
        }
        if (j < n) j += 1;
        out += `<span class="tok-string">${escapeHtml(code.slice(i, j))}</span>`;
        i = j;
        continue;
      }
      // カラーコード #rrggbb
      if (ch === '#' && /^[0-9a-fA-F]{3,8}\b/.test(code.slice(i + 1))) {
        const m = code.slice(i).match(/^#[0-9a-fA-F]{3,8}/);
        out += `<span class="tok-number">${escapeHtml(m[0])}</span>`;
        i += m[0].length;
        continue;
      }
      // プロパティ名（: の手前）
      const propMatch = code.slice(i).match(/^([a-zA-Z-]+)(\s*:)/);
      if (propMatch && (i === 0 || /[\s{;]/.test(code[i - 1]))) {
        out += `<span class="tok-attr">${escapeHtml(propMatch[1])}</span><span class="tok-punct">${escapeHtml(propMatch[2])}</span>`;
        i += propMatch[0].length;
        continue;
      }
      // @ルール
      if (ch === '@') {
        const m = code.slice(i).match(/^@[a-zA-Z-]+/);
        if (m) {
          out += `<span class="tok-keyword">${escapeHtml(m[0])}</span>`;
          i += m[0].length;
          continue;
        }
      }
      if ('{};:()'.includes(ch)) {
        out += `<span class="tok-punct">${escapeHtml(ch)}</span>`;
        i += 1;
        continue;
      }
      out += escapeHtml(ch);
      i += 1;
    }
    return out;
  }

  function highlightHtmlTag(tagText) {
    if (tagText.startsWith('<!--')) {
      return `<span class="tok-comment">${escapeHtml(tagText)}</span>`;
    }
    if (tagText.startsWith('<!')) {
      return `<span class="tok-keyword">${escapeHtml(tagText)}</span>`;
    }
    // <tagName ... >
    const m = tagText.match(/^(<\/?)([a-zA-Z0-9:-]+)([\s\S]*?)(\/?>)$/);
    if (!m) return `<span class="tok-tag">${escapeHtml(tagText)}</span>`;

    const [, open, name, attrs, close] = m;
    const highlightedAttrs = attrs.replace(
      /([a-zA-Z0-9_:@-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+)|([a-zA-Z0-9_:@-]+)/g,
      (full, attrName, eq, val, boolAttr) => {
        if (boolAttr) {
          return `<span class="tok-attr">${escapeHtml(boolAttr)}</span>`;
        }
        return `<span class="tok-attr">${escapeHtml(attrName)}</span>${escapeHtml(eq)}<span class="tok-string">${escapeHtml(val)}</span>`;
      }
    );
    return `<span class="tok-punct">${escapeHtml(open)}</span><span class="tok-tag">${escapeHtml(name)}</span>${highlightedAttrs}<span class="tok-punct">${escapeHtml(close)}</span>`;
  }

  function highlightHtmlSegment(code) {
    let out = '';
    let i = 0;
    const n = code.length;
    while (i < n) {
      if (code[i] === '<') {
        if (code.startsWith('<!--', i)) {
          const end = code.indexOf('-->', i + 4);
          const slice = end === -1 ? code.slice(i) : code.slice(i, end + 3);
          out += `<span class="tok-comment">${escapeHtml(slice)}</span>`;
          i += slice.length;
          continue;
        }
        let j = i + 1;
        let quote = null;
        while (j < n) {
          const c = code[j];
          if (quote) {
            if (c === quote) quote = null;
          } else if (c === '"' || c === "'") {
            quote = c;
          } else if (c === '>') {
            j += 1;
            break;
          }
          j += 1;
        }
        out += highlightHtmlTag(code.slice(i, j));
        i = j;
        continue;
      }
      const nextLt = code.indexOf('<', i);
      const text = nextLt === -1 ? code.slice(i) : code.slice(i, nextLt);
      out += escapeHtml(text);
      i += text.length;
    }
    return out;
  }

  function highlightJsonSegment(code) {
    return code.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            return `<span class="tok-attr">${escapeHtml(match.slice(0, -1))}</span><span class="tok-punct">:</span>`;
          }
          return `<span class="tok-string">${escapeHtml(match)}</span>`;
        }
        if (/true|false|null/.test(match)) {
          return `<span class="tok-keyword">${escapeHtml(match)}</span>`;
        }
        return `<span class="tok-number">${escapeHtml(match)}</span>`;
      }
    );
  }

  function highlightLine(line, lang, showIndent) {
    const leadMatch = line.match(/^([ \t]*)/);
    const leading = leadMatch ? leadMatch[1] : '';
    const restWithTrail = line.slice(leading.length);
    const trailMatch = restWithTrail.match(/([ \t]+)$/);
    const trailing = trailMatch ? trailMatch[1] : '';
    const core = trailing ? restWithTrail.slice(0, -trailing.length) : restWithTrail;

    let highlightedCore = '';
    if (lang === 'html') highlightedCore = highlightHtmlSegment(core);
    else if (lang === 'css') highlightedCore = highlightCssSegment(core);
    else if (lang === 'js') highlightedCore = highlightJsSegment(core);
    else if (lang === 'json') highlightedCore = highlightJsonSegment(core);
    else highlightedCore = escapeHtml(core);

    const leadHtml = renderLeadingIndent(leading, showIndent);
    const trailHtml = trailing
      ? showIndent
        ? `<span class="tok-trailing">${escapeHtml(trailing.replace(/ /g, '·').replace(/\t/g, '→'))}</span>`
        : escapeHtml(trailing)
      : '';

    return leadHtml + highlightedCore + trailHtml;
  }

  function highlightCode(code, lang, showIndent) {
    const lines = String(code || '').split('\n');
    let mode = lang;
    return lines
      .map((line) => {
        let effectiveLang = mode;
        if (lang === 'html') {
          const lower = line.toLowerCase();
          if (mode === 'css' && lower.includes('</style>')) {
            mode = 'html';
            effectiveLang = 'html';
          } else if (mode === 'js' && lower.includes('</script>')) {
            mode = 'html';
            effectiveLang = 'html';
          }
        }
        const rendered = highlightLine(line, effectiveLang, showIndent);
        if (lang === 'html') {
          const lower = line.toLowerCase();
          if (/<style\b[^>]*>/.test(lower) && !lower.includes('</style>')) {
            mode = 'css';
          } else if (/<script\b(?![^>]*\bsrc=)[^>]*>/.test(lower) && !lower.includes('</script>')) {
            mode = 'js';
          }
        }
        return rendered;
      })
      .join('\n') + '\n';
  }

  // ---- リアルタイム構文・ケアレスミスチェッカー ----
  function checkBrackets(code, lineOffset) {
    const issues = [];
    const stack = [];
    const pairs = { '(': ')', '{': '}', '[': ']' };
    const closing = { ')': '(', '}': '{', ']': '[' };

    let line = 1 + lineOffset;
    let inString = null;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < code.length; i += 1) {
      const ch = code[i];
      const next = code[i + 1];

      if (ch === '\n') {
        line += 1;
        inLineComment = false;
        continue;
      }
      if (inLineComment) continue;
      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          i += 1;
        }
        continue;
      }
      if (inString) {
        if (ch === '\\') {
          i += 1;
          continue;
        }
        if (ch === inString) {
          inString = null;
        }
        continue;
      }

      if (ch === '/' && next === '/') {
        inLineComment = true;
        i += 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
        continue;
      }
      if (pairs[ch]) {
        stack.push({ ch, line });
      } else if (closing[ch]) {
        const last = stack.pop();
        if (!last || last.ch !== closing[ch]) {
          issues.push({
            severity: 'error',
            line,
            message: `対応する開き括弧がない "${ch}" があります`,
          });
        }
      }
    }

    if (inBlockComment) {
      issues.push({ severity: 'error', line, message: 'ブロックコメント /* ... */ が閉じられていません' });
    }
    if (inString) {
      issues.push({ severity: 'error', line, message: `文字列クォート (${inString}) が閉じられていません` });
    }
    for (const unclosed of stack) {
      issues.push({
        severity: 'error',
        line: unclosed.line,
        message: `"${unclosed.ch}" が閉じられていません`,
      });
    }
    return issues;
  }

  function lintJs(code, lineOffset = 0) {
    const issues = checkBrackets(code, lineOffset);
    try {
      // eslint-disable-next-line no-new-func
      new Function(code);
    } catch (err) {
      if (issues.length === 0) {
        issues.push({
          severity: 'error',
          line: 1 + lineOffset,
          message: `JS構文エラー: ${err.message}`,
        });
      }
    }
    return issues;
  }

  function lintCss(code, lineOffset = 0) {
    const issues = [];
    let line = 1 + lineOffset;
    let depth = 0;
    let inComment = false;
    let inString = null;

    for (let i = 0; i < code.length; i += 1) {
      const ch = code[i];
      const next = code[i + 1];
      if (ch === '\n') {
        line += 1;
        continue;
      }
      if (inComment) {
        if (ch === '*' && next === '/') {
          inComment = false;
          i += 1;
        }
        continue;
      }
      if (inString) {
        if (ch === '\\') { i += 1; continue; }
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '/' && next === '*') {
        inComment = true;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = ch;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth < 0) {
          issues.push({ severity: 'error', line, message: 'CSS: 余分な閉じ括弧 "}" があります' });
          depth = 0;
        }
      }
    }

    if (inComment) {
      issues.push({ severity: 'error', line, message: 'CSS: コメント /* ... */ が閉じられていません' });
    }
    if (depth > 0) {
      issues.push({ severity: 'error', line, message: `CSS: "{" が ${depth} 個閉じられていません` });
    }

    // セミコロン抜けの簡易警告
    const lines = code.split('\n');
    let braceLevel = 0;
    for (let idx = 0; idx < lines.length; idx += 1) {
      const raw = lines[idx].replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (raw.includes('{')) braceLevel += (raw.match(/\{/g) || []).length;
      if (raw.includes('}')) braceLevel = Math.max(0, braceLevel - (raw.match(/\}/g) || []).length);
      if (
        braceLevel > 0 &&
        /^[a-zA-Z-]+\s*:\s*[^;{}]+$/.test(raw) &&
        !raw.endsWith(',') &&
        idx + 1 < lines.length &&
        !/^\s*\}/.test(lines[idx + 1])
      ) {
        issues.push({
          severity: 'warn',
          line: idx + 1 + lineOffset,
          message: `CSS: 行末のセミコロン ";" が抜けている可能性があります (${raw.slice(0, 28)})`,
        });
      }
    }

    return issues;
  }

  function lintJson(code) {
    try {
      JSON.parse(code);
      return [];
    } catch (err) {
      return [{ severity: 'error', line: 1, message: `JSON構文エラー: ${err.message}` }];
    }
  }

  function lintHtml(code) {
    const issues = [];
    const stack = [];
    const seenIds = new Map();

    // 1. HTMLコメントの閉じ忘れチェック
    let searchPos = 0;
    while (true) {
      const start = code.indexOf('<!--', searchPos);
      if (start === -1) break;
      const end = code.indexOf('-->', start + 4);
      if (end === -1) {
        const line = code.slice(0, start).split('\n').length;
        issues.push({ severity: 'error', line, message: 'HTMLコメント <!-- が閉じられていません' });
        break;
      }
      searchPos = end + 3;
    }

    // 2. <style> と <script> ブロックを検証しつつタグ構造を解析
    const tagRegex = /<!--[\s\S]*?-->|<style\b[^>]*>([\s\S]*?)<\/style>|<script\b([^>]*)>([\s\S]*?)<\/script>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)([^>]*)>/gi;
    let match;
    while ((match = tagRegex.exec(code)) !== null) {
      const full = match[0];
      const line = code.slice(0, match.index).split('\n').length;

      if (full.startsWith('<!--')) continue;

      if (match[1] !== undefined) {
        // <style> ブロック
        const openEndOffset = full.indexOf('>') + 1;
        const styleStartLine = code.slice(0, match.index + openEndOffset).split('\n').length - 1;
        issues.push(...lintCss(match[1], styleStartLine));
        continue;
      }

      if (match[3] !== undefined) {
        // <script> ブロック
        const attrs = match[2] || '';
        const hasSrc = /\bsrc\s*=/i.test(attrs);
        const typeMatch = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i);
        const isJs = !typeMatch || /javascript|module/i.test(typeMatch[1]);
        if (!hasSrc && isJs && match[3].trim()) {
          const openEndOffset = full.indexOf('>') + 1;
          const scriptStartLine = code.slice(0, match.index + openEndOffset).split('\n').length - 1;
          issues.push(...lintJs(match[3], scriptStartLine));
        }
        continue;
      }

      const isClosing = match[4] === '/';
      const tagName = match[5].toLowerCase();
      const attrs = match[6] || '';
      const isSelfClosing = /\/\s*$/.test(attrs) || VOID_TAGS.has(tagName);

      // 重複 id チェック
      if (!isClosing) {
        const idMatch = attrs.match(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
        if (idMatch) {
          const idVal = idMatch[1] || idMatch[2];
          if (seenIds.has(idVal)) {
            issues.push({
              severity: 'warn',
              line,
              message: `重複した id="${idVal}" があります（最初の定義: ${seenIds.get(idVal)}行目）`,
            });
          } else {
            seenIds.set(idVal, line);
          }
        }
        // <img> の alt 抜け警告
        if (tagName === 'img' && !/\balt\s*=/i.test(attrs)) {
          issues.push({ severity: 'warn', line, message: '<img> タグに alt 属性がありません' });
        }
      }

      if (isSelfClosing) continue;

      if (!isClosing) {
        stack.push({ tagName, line });
      } else {
        if (stack.length === 0) {
          issues.push({ severity: 'error', line, message: `対応する開始タグがない終了タグ </${tagName}> があります` });
        } else if (stack[stack.length - 1].tagName === tagName) {
          stack.pop();
        } else {
          // スタック内に一致する開始タグがあるか探す
          const idx = stack.map((s) => s.tagName).lastIndexOf(tagName);
          if (idx !== -1) {
            for (let k = stack.length - 1; k > idx; k -= 1) {
              issues.push({
                severity: 'error',
                line: stack[k].line,
                message: `<${stack[k].tagName}> の閉じタグが抜けているか、入れ子順序が誤っています`,
              });
            }
            stack.splice(idx);
          } else {
            issues.push({ severity: 'error', line, message: `対応する開始タグがない終了タグ </${tagName}> があります` });
          }
        }
      }
    }

    for (const unclosed of stack) {
      issues.push({
        severity: 'error',
        line: unclosed.line,
        message: `<${unclosed.tagName}> が閉じられていません`,
      });
    }

    return issues;
  }

  function lintCode(code, lang) {
    if (!code || !code.trim()) return [];
    if (lang === 'html') return lintHtml(code);
    if (lang === 'css') return lintCss(code, 0);
    if (lang === 'js') return lintJs(code, 0);
    if (lang === 'json') return lintJson(code);
    return [];
  }

  // ---- エディタ UI コントローラー ----
  function createEditor(options) {
    const {
      textarea,
      highlightEl,
      gutterEl,
      diagListEl,
      diagSummaryEl,
      cursorInfoEl,
      onChange,
      onSave,
    } = options;

    let currentLang = 'html';
    let showIndent = true;
    let lintTimer = null;
    let lastIssues = [];

    function updateGutter(lineCount, issues) {
      const errorLines = new Set(issues.filter((i) => i.severity === 'error').map((i) => i.line));
      const warnLines = new Set(issues.filter((i) => i.severity === 'warn').map((i) => i.line));
      let html = '';
      for (let i = 1; i <= lineCount; i += 1) {
        if (errorLines.has(i)) {
          html += `<div class="gutter-line gutter-err" title="エラー">${i}●</div>`;
        } else if (warnLines.has(i)) {
          html += `<div class="gutter-line gutter-warn" title="警告">${i}▲</div>`;
        } else {
          html += `<div class="gutter-line">${i}</div>`;
        }
      }
      gutterEl.innerHTML = html;
    }

    function renderDiagnostics(issues) {
      lastIssues = issues;
      const errCount = issues.filter((i) => i.severity === 'error').length;
      const warnCount = issues.filter((i) => i.severity === 'warn').length;

      if (diagSummaryEl) {
        if (errCount === 0 && warnCount === 0) {
          diagSummaryEl.textContent = '✓ 構文チェック OK（問題なし）';
          diagSummaryEl.className = 'status-pill pill-ok';
        } else if (errCount > 0) {
          diagSummaryEl.textContent = `✕ エラー ${errCount}件 / 警告 ${warnCount}件`;
          diagSummaryEl.className = 'status-pill pill-err';
        } else {
          diagSummaryEl.textContent = `▲ 警告 ${warnCount}件`;
          diagSummaryEl.className = 'status-pill pill-warn';
        }
      }

      if (!diagListEl) return;
      if (issues.length === 0) {
        diagListEl.innerHTML = `<div class="diag-ok">構文エラーや閉じタグ忘れ等のケアレスミスは見つかりませんでした。</div>`;
        return;
      }

      diagListEl.innerHTML = issues
        .slice(0, 50)
        .map((issue) => {
          const cls = issue.severity === 'error' ? 'diag-item diag-err' : 'diag-item diag-warn';
          const badge = issue.severity === 'error' ? 'エラー' : '警告';
          return `<button type="button" class="${cls}" data-line="${issue.line}">
            <span class="diag-line">${issue.line}行目</span>
            <span class="diag-badge">${badge}</span>
            <span class="diag-msg">${escapeHtml(issue.message)}</span>
          </button>`;
        })
        .join('');
    }

    function syncScroll() {
      highlightEl.scrollTop = textarea.scrollTop;
      highlightEl.scrollLeft = textarea.scrollLeft;
      gutterEl.scrollTop = textarea.scrollTop;
    }

    function updateCursorInfo() {
      if (!cursorInfoEl) return;
      const pos = textarea.selectionStart || 0;
      const before = textarea.value.slice(0, pos);
      const lines = before.split('\n');
      const line = lines.length;
      const col = lines[lines.length - 1].length + 1;
      cursorInfoEl.textContent = `行 ${line}, 列 ${col} · ${currentLang.toUpperCase()}`;
    }

    function render(immediateLint = false) {
      const code = textarea.value;
      highlightEl.innerHTML = highlightCode(code, currentLang, showIndent);
      const lineCount = code.split('\n').length;
      updateGutter(lineCount, lastIssues);
      syncScroll();
      updateCursorInfo();

      clearTimeout(lintTimer);
      const runLint = () => {
        const issues = lintCode(textarea.value, currentLang);
        renderDiagnostics(issues);
        updateGutter(textarea.value.split('\n').length, issues);
      };
      if (immediateLint) runLint();
      else lintTimer = setTimeout(runLint, 220);
    }

    function jumpToLine(lineNumber) {
      const lines = textarea.value.split('\n');
      const target = Math.max(1, Math.min(lineNumber, lines.length));
      let offset = 0;
      for (let i = 0; i < target - 1; i += 1) {
        offset += lines[i].length + 1;
      }
      textarea.focus();
      textarea.setSelectionRange(offset, offset + (lines[target - 1] || '').length);
      const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
      textarea.scrollTop = Math.max(0, (target - 4) * lineHeight);
      syncScroll();
      updateCursorInfo();
    }

    textarea.addEventListener('input', () => {
      render(false);
      if (onChange) onChange();
    });

    textarea.addEventListener('scroll', syncScroll);
    textarea.addEventListener('click', updateCursorInfo);
    textarea.addEventListener('keyup', updateCursorInfo);

    textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (onSave) onSave();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;
        if (!e.shiftKey) {
          textarea.value = val.slice(0, start) + '  ' + val.slice(end);
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        } else {
          const lineStart = val.lastIndexOf('\n', start - 1) + 1;
          if (val.slice(lineStart, lineStart + 2) === '  ') {
            textarea.value = val.slice(0, lineStart) + val.slice(lineStart + 2);
            textarea.selectionStart = Math.max(lineStart, start - 2);
            textarea.selectionEnd = Math.max(lineStart, end - 2);
          } else if (val[lineStart] === '\t') {
            textarea.value = val.slice(0, lineStart) + val.slice(lineStart + 1);
            textarea.selectionStart = Math.max(lineStart, start - 1);
            textarea.selectionEnd = Math.max(lineStart, end - 1);
          }
        }
        render(false);
        if (onChange) onChange();
      }
    });

    if (diagListEl) {
      diagListEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.diag-item');
        if (!btn) return;
        const line = Number(btn.dataset.line);
        if (line) jumpToLine(line);
      });
    }

    return {
      setContent(code, filePath) {
        currentLang = detectLanguage(filePath);
        textarea.value = code || '';
        textarea.scrollTop = 0;
        textarea.scrollLeft = 0;
        render(true);
      },
      getContent() {
        return textarea.value;
      },
      setShowIndent(flag) {
        showIndent = Boolean(flag);
        render(false);
      },
      getIssues() {
        return lastIssues;
      },
      jumpToLine,
    };
  }

  global.RetroCodeEditor = {
    createEditor,
    detectLanguage,
    highlightCode,
    lintCode,
  };
})(window);
