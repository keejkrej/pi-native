#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_file="$script_dir/src/linux.c"
output_dir="$script_dir/build"
output_lib="$output_dir/libsgui.a"

compiler="${CC:-cc}"
if ! command -v "$compiler" >/dev/null 2>&1; then
    echo "Linux C compiler not found: $compiler" >&2
    exit 1
fi

if ! command -v pkg-config >/dev/null 2>&1; then
    echo "pkg-config is required to build GTK 4 backend" >&2
    exit 1
fi

gtk_cflags=()
read -r -a gtk_cflags <<< "$(pkg-config --cflags gtk4)"

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/pi-gui-linux.XXXXXX")"
trap 'rm -rf "$temporary_dir"' EXIT

mkdir -p "$output_dir"

"$compiler" \
    -c \
    -std=c11 \
    -Wall \
    -Wextra \
    -Werror \
    -O2 \
    -fPIC \
    "${gtk_cflags[@]}" \
    -I"$script_dir/../include" \
    "$source_file" \
    -o "$temporary_dir/linux.o"

rm -f "$output_lib"
ar rcs "$output_lib" "$temporary_dir/linux.o"
echo "Built $output_lib"
