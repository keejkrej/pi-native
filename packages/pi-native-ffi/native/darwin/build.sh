#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/src/pi_native_darwin.m"
BUILD_DIR="$SCRIPT_DIR/build"
OBJ="$BUILD_DIR/pi_native_darwin.o"
ARCHIVE="$BUILD_DIR/libpinative.a"

mkdir -p "$BUILD_DIR"

SDK_PATH="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null || xcrun --show-sdk-path)"
ARCH="$(uname -m)"
if [ "$ARCH" = "x86_64" ]; then
	TARGET="x86_64-apple-macos13.0"
else
	TARGET="arm64-apple-macos14.0"
fi

rm -f "$OBJ" "$ARCHIVE"
clang -c -fobjc-arc -std=c11 -Wall -Wextra -Werror -O2 -target "$TARGET" -isysroot "$SDK_PATH" -o "$OBJ" "$SRC"
ar rcs "$ARCHIVE" "$OBJ"
rm -f "$OBJ"
echo "Built $ARCHIVE ($TARGET)"
