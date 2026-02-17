#!/usr/bin/env bash
# Resolve the real path of this script (follows symlinks)
SCRIPT_PATH="$(realpath "$0" 2>/dev/null || readlink -f "$0" 2>/dev/null || python3 -c "import os; print(os.path.realpath('$0'))")"
SCRIPT_DIR="$(dirname "$SCRIPT_PATH")"
exec deno run --allow-run --allow-read --allow-write --allow-env "$SCRIPT_DIR/mod.ts" "$@"
