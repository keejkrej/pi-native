#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

SCRIPTC="${SCRIPTC:-$(command -v scriptc || echo /Users/jack/.local/share/mise/installs/node/24/bin/scriptc)}"
if [ ! -x "$SCRIPTC" ]; then
	echo "error: scriptc binary not found or not executable: $SCRIPTC" >&2
	exit 1
fi

EMIT_WORKERS="${SCRIPTC_EMIT_WORKERS:-1}"
EXAMPLES=(counter tasks desktop bench demo hopper gallery)
FFI_DARWIN_GUI="packages/pi-native-ffi/ffi/darwin-gui.json"

reap_daemons() {
	pkill -f 'tsc-ts --api' 2>/dev/null || true
	pkill -f 'scriptc-llvm-codegen serve' 2>/dev/null || true
}

build_native_pinative() {
	if [ "$(uname -s)" = "Darwin" ]; then
		./packages/pi-native-ffi/native/darwin/build.sh
	fi
}

build_native_sgui() {
	if [ "$(uname -s)" = "Darwin" ]; then
		local lib="packages/gui/native/darwin/build/libsgui.a"
		if [ ! -f "$lib" ] || [ "packages/gui/native/darwin/src/darwin.m" -nt "$lib" ] || [ "packages/gui/native/include/sgui.h" -nt "$lib" ] || [ "packages/gui/native/darwin/build.sh" -nt "$lib" ]; then
			./packages/gui/native/darwin/build.sh
		fi
	fi
}

build_native_libs() {
	build_native_sgui
	build_native_pinative
}

run_scriptc() {
	SCRIPTC_EMIT_WORKERS="$EMIT_WORKERS" taskpolicy -c utility "$SCRIPTC" "$@"
}

cleanup_artifacts() {
	local out="$1"
	rm -rf "${out}.dSYM" "${out}.libnode" "$(dirname "$out")"/*.ll
}

run_with_extensions() {
	build_native_libs
	reap_daemons
	if command -v bun >/dev/null 2>&1; then
		SCRIPTC="$SCRIPTC" SCRIPTC_EMIT_WORKERS="$EMIT_WORKERS" bun scripts/build-with-extensions.ts "$@"
	else
		SCRIPTC="$SCRIPTC" SCRIPTC_EMIT_WORKERS="$EMIT_WORKERS" node --experimental-strip-types scripts/build-with-extensions.ts "$@"
	fi
	reap_daemons
}

build_pi() {
	if [ "$#" -gt 0 ]; then
		run_with_extensions "$@"
		return
	fi
	mkdir -p dist
	rm -f dist/pi-gui
	build_native_libs
	reap_daemons
	local ffi_args=()
	if [ "$(uname -s)" = "Darwin" ]; then
		ffi_args=(--ffi "$FFI_DARWIN_GUI")
	fi
	run_scriptc build \
		--node-islands=off \
		--optimization=dev \
		--strip \
		--no-keep-llvm \
		--no-shape-overlay \
		packages/coding-agent/src/cli.ts \
		"${ffi_args[@]}" \
		-o dist/pi
	cleanup_artifacts dist/pi
	reap_daemons
}

build_examples() {
	mkdir -p dist/examples
	build_native_sgui
	reap_daemons
	for f in "${EXAMPLES[@]}"; do
		run_scriptc build \
			--node-islands=off \
			--optimization=dev \
			--strip \
			--no-keep-llvm \
			--no-shape-overlay \
			"packages/gui/examples/$f.ts" \
			--ffi packages/gui/ffi/darwin.json \
			-o "dist/examples/$f"
		cleanup_artifacts "dist/examples/$f"
	done
	reap_daemons
}

run_coverage() {
	build_native_libs
	reap_daemons
	local ffi_args=()
	if [ "$(uname -s)" = "Darwin" ]; then
		ffi_args=(--ffi "$FFI_DARWIN_GUI")
	fi
	run_scriptc coverage \
		--node-islands=off \
		--coverage=reached \
		"${ffi_args[@]}" \
		packages/coding-agent/src/cli.ts
	reap_daemons
}

run_test() {
	mkdir -p dist
	build_native_libs
	reap_daemons
	local ffi_args=()
	if [ "$(uname -s)" = "Darwin" ]; then
		ffi_args=(--ffi "$FFI_DARWIN_GUI")
	fi
	run_scriptc build \
		--node-islands=off \
		--optimization=dev \
		--strip \
		--no-keep-llvm \
		--no-shape-overlay \
		scripts/test-native.ts \
		"${ffi_args[@]}" \
		-o dist/test-native
	cleanup_artifacts dist/test-native
	reap_daemons
	SCRIPTC_LIBNODE=/nonexistent ./dist/test-native
}

run_clean() {
	reap_daemons
	rm -rf dist packages/*/dist .scriptc
}

trap reap_daemons EXIT

case "${1:-all}" in
	pi)
		shift
		build_pi "$@"
		;;
	examples)
		build_examples
		;;
	all)
		build_pi
		build_examples
		;;
	coverage)
		run_coverage
		;;
	test)
		run_test
		;;
	clean)
		run_clean
		;;
	*)
		echo "Usage: $0 {all|pi [--with-ext <file.ts> ...]|examples|coverage|test|clean}" >&2
		exit 2
		;;
esac
