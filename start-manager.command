#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js が見つかりません。Node.js をインストールしてから再実行してください。"
  exit 1
fi

node tools/manager.js
