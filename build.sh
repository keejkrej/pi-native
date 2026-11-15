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

reap_daemons() {
	pkill -f 'tsc-ts --api' 2>/dev/null || true
	pkill -f 'scriptc-llvm-codegen serve' 2>/dev/null || true
}

run_scriptc() {
	SCRIPTC_EMIT_WORKERS="$EMIT_WORKERS" taskpolicy -c utility "$SCRIPTC" "$@"
}

cleanup_artifacts() {
	local out="$1"
	rm -rf "${out}.dSYM" "${out}.libnode" "$(dirname "$out")"/*.ll
}

build_pi() {
	mkdir -p dist
	reap_daemons
	run_scriptc build \
		--node-islands=off \
		--optimization=dev \
		--strip \
		--no-keep-llvm \
		--no-shape-overlay \
		packages/coding-agent/src/cli.ts \
		-o dist/pi
	cleanup_artifacts dist/pi
	reap_daemons
}

build_gui() {
	mkdir -p dist
	reap_daemons
	run_scriptc build \
		--node-islands=off \
		--optimization=dev \
		--strip \
		--no-keep-llvm \
		--no-shape-overlay \
		packages/coding-agent/src/gui-cli.ts \
		--ffi packages/gui/ffi/darwin.json \
		-o dist/pi-gui
	cleanup_artifacts dist/pi-gui
	reap_daemons
}

build_examples() {
	mkdir -p dist/examples
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
	reap_daemons
	run_scriptc coverage \
		--node-islands=off \
		--coverage=reached \
		packages/coding-agent/src/cli.ts
	reap_daemons
}

run_test() {
	mkdir -p dist
	reap_daemons
	run_scriptc build \
		--node-islands=off \
		--optimization=dev \
		--strip \
		--no-keep-llvm \
		--no-shape-overlay \
		scripts/test-native.ts \
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
		build_pi
		;;
	gui)
		build_gui
		;;
	examples)
		build_examples
		;;
	all)
		build_pi
		build_gui
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
		echo "Usage: $0 {all|pi|gui|examples|coverage|test|clean}" >&2
		exit 2
		;;
esac
