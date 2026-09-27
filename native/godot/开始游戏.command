#!/bin/zsh
set -e
# Finder 不继承 shell 的 PATH；优先寻找常见本机引擎安装位置。
project_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
godot_bin="${GODOT_BIN:-}"
if [[ -z "$godot_bin" ]]; then
  for candidate in /opt/homebrew/bin/godot /usr/local/bin/godot /Applications/Godot.app/Contents/MacOS/Godot; do
    if [[ -x "$candidate" ]]; then
      godot_bin="$candidate"
      break
    fi
  done
fi
if [[ -z "$godot_bin" ]] && command -v godot >/dev/null 2>&1; then
  godot_bin="$(command -v godot)"
fi
if [[ -z "$godot_bin" ]]; then
  print "请先安装 Godot 4.7.2：https://godotengine.org/download/"
  read -r "?按回车关闭..."
  exit 1
fi
# 本机导入缓存不随 Git 分发；首启和资源更新时先导入，避免空白角色。
"$godot_bin" --headless --editor --path "$project_dir" --import
exec "$godot_bin" --path "$project_dir"
