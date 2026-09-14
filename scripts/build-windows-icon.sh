#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
icon="$project_root/build/icon.svg"

mkdir -p "$(dirname "$icon")"
cp "$project_root/public/favicon.svg" "$icon"
echo "Prepared Windows application icon at $icon"
