#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_file="$script_dir/src/darwin.m"
output_dir="$script_dir/build"
output_lib="$output_dir/libsgui.a"

if [[ -n "${CC:-}" ]]; then
    compiler="$CC"
elif [[ "$(uname -s)" == "Darwin" ]] && command -v xcrun >/dev/null 2>&1; then
    compiler="$(xcrun --find clang)"
else
    compiler="clang"
fi

if ! command -v "$compiler" >/dev/null 2>&1; then
    echo "Darwin C compiler not found: $compiler" >&2
    exit 1
fi

ar_bin="ar"
if [[ "$(uname -s)" == "Darwin" ]] && command -v xcrun >/dev/null 2>&1; then
    ar_bin="$(xcrun --find ar)"
fi

host_arch="${ARCH:-$(uname -m)}"
case "$host_arch" in
    arm64|aarch64)
        target="arm64-apple-macos14.0"
        ;;
    x86_64|x64)
        target="x86_64-apple-macos13.0"
        ;;
    *)
        echo "Unsupported Darwin arch: $host_arch" >&2
        exit 1
        ;;
esac

sdk_flags=()
if [[ -n "${SDKROOT:-}" ]]; then
    sdk_flags=(-isysroot "$SDKROOT")
elif [[ "$(uname -s)" == "Darwin" ]]; then
    sdkroot="$(xcrun --sdk macosx --show-sdk-path)"
    sdk_flags=(-isysroot "$sdkroot")
fi

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/pi-gui-darwin.XXXXXX")"
trap 'rm -rf "$temporary_dir"' EXIT

mkdir -p "$output_dir"

"$compiler" \
    -c \
    -fobjc-arc \
    -std=c11 \
    -Wall \
    -Wextra \
    -Werror \
    -O2 \
    "-target" "$target" \
    "${sdk_flags[@]}" \
    -I"$script_dir/../include" \
    "$source_file" \
    -o "$temporary_dir/darwin.o"

rm -f "$output_lib"
"$ar_bin" rcs "$output_lib" "$temporary_dir/darwin.o"
echo "Built $output_lib ($target)"
