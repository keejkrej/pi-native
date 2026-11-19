import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import {
	align8,
	NativeBackend,
	NativeDriver,
	SGUI_EVT_KEY,
	SGUI_KEY_DOWN,
	SGUI_MOD_SUPER,
	SGUI_TEXT_METRICS_SIZE,
	SGUI_WINDOW_METRICS_SIZE,
} from "../src/index.ts";

class MockNativeDriver extends NativeDriver {
	clipboardValue = "initial";
	lastIme = { windowId: 0, x: 0, y: 0, width: 0, height: 0 };
	lastChrome: { windowId: number; darkMode: number; sidebarWidth: number; vibrancyEnabled: number } | undefined = undefined;
	lastActions: number[] = [];
	lastPresentedBytes = 0;

	init(): number {
		return 0;
	}

	shutdown(): void {}

	windowCreate(_title: string, _width: number, _height: number, _flags: number): number {
		return 1;
	}

	windowDestroy(_windowId: number): void {}

	windowSetTitle(_windowId: number, _title: string): void {}

	windowSetChrome(windowId: number, darkMode: number, sidebarWidth: number, vibrancyEnabled: number): void {
		this.lastChrome = { windowId, darkMode, sidebarWidth, vibrancyEnabled };
	}

	windowAction(_windowId: number, action: number): void {
		this.lastActions.push(action);
	}

	windowGetMetrics(_windowId: number, outMetrics: Uint8Array): number {
		const view = new DataView(outMetrics.buffer, outMetrics.byteOffset, SGUI_WINDOW_METRICS_SIZE);
		view.setFloat64(0, 1024, true);
		view.setFloat64(8, 768, true);
		view.setFloat64(16, 2, true);
		view.setFloat64(24, 0, true);
		view.setFloat64(32, 28, true);
		view.setUint32(40, 1, true);
		view.setUint32(44, 1, true);
		return 0;
	}

	measureText(
		_fontFamily: number,
		fontSize: number,
		_fontWeight: number,
		_fontFlags: number,
		_maxWidth: number,
		text: string,
		outMetrics: Uint8Array,
	): number {
		const view = new DataView(outMetrics.buffer, outMetrics.byteOffset, SGUI_TEXT_METRICS_SIZE);
		view.setFloat64(0, text.length * fontSize * 0.6, true);
		view.setFloat64(8, Math.ceil(fontSize * 1.35), true);
		view.setFloat64(16, Math.ceil(fontSize * 1.35), true);
		view.setFloat64(24, Math.ceil(fontSize * 0.85), true);
		view.setUint32(32, 1, true);
		return 0;
	}

	textCaretX(
		_fontFamily: number,
		fontSize: number,
		_fontWeight: number,
		_fontFlags: number,
		_line: string,
		byteOffset: number,
	): number {
		// 10px per UTF-8 byte in mock to verify byteOffset conversion cleanly
		return byteOffset * (fontSize > 0 ? 10 : 10);
	}

	textHitIndex(
		_fontFamily: number,
		_fontSize: number,
		_fontWeight: number,
		_fontFlags: number,
		_line: string,
		x: number,
	): number {
		return Math.round(x / 10);
	}

	present(_windowId: number, commands: Uint8Array): number {
		this.lastPresentedBytes = commands.byteLength;
		return 0;
	}

	pollEvents(_waitMs: number, outEvents: Uint8Array): number {
		const view = new DataView(outEvents.buffer, outEvents.byteOffset, outEvents.byteLength);
		const nameBytes = new TextEncoder().encode("a");
		const len = align8(32 + nameBytes.byteLength);
		view.setUint32(0, SGUI_EVT_KEY, true);
		view.setUint32(4, len, true);
		view.setUint32(8, 1, true);
		view.setUint32(12, SGUI_MOD_SUPER, true);
		view.setUint32(16, SGUI_KEY_DOWN, true);
		view.setUint32(20, 0, true);
		view.setUint32(24, nameBytes.byteLength, true);
		outEvents.set(nameBytes, 32);
		return len;
	}

	clipboardGetText(outUtf8: Uint8Array): number {
		const encoded = new TextEncoder().encode(this.clipboardValue);
		if (encoded.byteLength <= outUtf8.byteLength) {
			outUtf8.set(encoded, 0);
		}
		return encoded.byteLength;
	}

	clipboardSetText(text: string): number {
		this.clipboardValue = text;
		return 0;
	}

	setCursor(_windowId: number, _cursorKind: number): void {}

	setImeRect(windowId: number, x: number, y: number, width: number, height: number): void {
		this.lastIme = { windowId, x, y, width, height };
	}

	setAppMenu(_spec: Uint8Array): number {
		return 0;
	}

	setA11yTree(_windowId: number, _nodes: Uint8Array): number {
		return 0;
	}
}

describe("NativeBackend FFI adapter marshaling", () => {
	it("decodes window metrics, translates UTF-16 <-> UTF-8 byte offsets, grows clipboard buffer, and dispatches menus", () => {
		const driver = new MockNativeDriver();
		const backend = new NativeBackend(driver, "darwin");
		backend.init();
		const winId = backend.createWindow({ title: "Mock", width: 1024, height: 768 });

		const wm = backend.getWindowMetrics(winId);
		assert.deepEqual(wm, {
			width: 1024,
			height: 768,
			scale: 2,
			insetLeft: 0,
			titlebarHeight: 28,
			darkMode: true,
			focused: true,
		});

		// Surrogate pair emoji "\ud83d\ude80" is 2 UTF-16 code units = 4 UTF-8 bytes
		const line = "a\ud83d\ude80z";
		assert.equal(backend.getTextCaretX({ fontSize: 14 }, line, 3), 50);
		assert.equal(backend.hitTestText({ fontSize: 14 }, line, 50), 3);

		// Clipboard larger than initial 8KB buffer triggers resize retry
		const big = "x".repeat(12000);
		driver.clipboardValue = big;
		assert.equal(backend.getClipboardText(), big);

		const events = backend.pollEvents(0);
		assert.equal(events.length, 1);
		assert.equal(events[0]?.kind, "key");

		let menuClicked = false;
		backend.setAppMenu([
			{
				title: "File",
				items: [
					{
						kind: "action",
						label: "Save",
						onSelect: () => {
							menuClicked = true;
						},
					},
				],
			},
		]);
		assert.equal(backend.dispatchMenuItem(1), true);
		assert.equal(menuClicked, true);
		backend.shutdown();
	});
});

function findScriptcBinary(): string | undefined {
	const whichResult = spawnSync("which", ["scriptc"], { encoding: "utf8" });
	const whichPath = whichResult.status === 0 ? whichResult.stdout.trim() : undefined;
	const candidates = [
		process.env.SCRIPTC,
		process.env.SCRIPTC_BIN,
		resolve(import.meta.dirname, "../../../node_modules/.bin/scriptc"),
		whichPath,
		join(homedir(), ".local/share/mise/installs/node/24/bin/scriptc"),
	];
	for (const candidate of candidates) {
		if (candidate !== undefined && candidate.length > 0 && existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

describe("scriptc native compilation & FFI integration", () => {
	it("analyzes coverage and compiles examples/demo.ts cleanly on Darwin", (t) => {
		if (process.platform !== "darwin") {
			t.skip("Darwin native archive build check runs on macOS");
			return;
		}
		const scriptcBin = findScriptcBinary();
		if (scriptcBin === undefined) {
			t.skip("scriptc binary not found on host");
			return;
		}

		const pkgRoot = resolve(import.meta.dirname, "..");
		const libPath = join(pkgRoot, "native", "darwin", "build", "libsgui.a");
		if (!existsSync(libPath)) {
			const nativeBuild = spawnSync("npm", ["run", "build:native:darwin"], {
				cwd: pkgRoot,
				encoding: "utf8",
			});
			assert.equal(nativeBuild.status, 0, nativeBuild.stderr);
		}

		const demoEntry = join(pkgRoot, "examples", "demo.ts");
		const ffiManifest = join(pkgRoot, "ffi", "darwin.json");

		const cov = spawnSync(scriptcBin, ["coverage", demoEntry, "--ffi", ffiManifest], {
			cwd: pkgRoot,
			encoding: "utf8",
		});
		assert.equal(cov.status, 0, `scriptc coverage failed:\n${cov.stdout}\n${cov.stderr}`);

		const outDir = mkdtempSync(join(tmpdir(), "scriptc-gui-test-"));
		const outBin = join(outDir, "demo");
		try {
			const build = spawnSync(scriptcBin, ["build", demoEntry, "--ffi", ffiManifest, "-o", outBin], {
				cwd: pkgRoot,
				encoding: "utf8",
			});
			assert.equal(build.status, 0, `scriptc build failed:\n${build.stdout}\n${build.stderr}`);

			const smoke = spawnSync(outBin, ["--headless-smoke"], { encoding: "utf8" });
			assert.equal(smoke.status, 0, `demo --headless-smoke failed:\n${smoke.stdout}\n${smoke.stderr}`);
			const parsed = JSON.parse(smoke.stdout.trim()) as { ok?: boolean; mode?: string };
			assert.equal(parsed.ok, true);
			assert.equal(parsed.mode, "headless-smoke");
		} finally {
			rmSync(outDir, { recursive: true, force: true });
		}
	});

	it("renders offscreen draw list to 2x Retina PNG via sgui_render_png on Darwin", (t) => {
		if (process.platform !== "darwin") {
			t.skip("Darwin CoreGraphics PNG export check runs on macOS");
			return;
		}
		const scriptcBin = findScriptcBinary();
		if (scriptcBin === undefined) {
			t.skip("scriptc binary not found on host");
			return;
		}

		const pkgRoot = resolve(import.meta.dirname, "..");
		const libPath = join(pkgRoot, "native", "darwin", "build", "libsgui.a");
		if (!existsSync(libPath)) {
			const nativeBuild = spawnSync("npm", ["run", "build:native:darwin"], {
				cwd: pkgRoot,
				encoding: "utf8",
			});
			assert.equal(nativeBuild.status, 0, nativeBuild.stderr);
		}

		const ffiManifest = join(pkgRoot, "ffi", "darwin.json");
		const outDir = mkdtempSync(join(tmpdir(), "scriptc-gui-png-test-"));
		const harnessEntry = join(outDir, "png-export-check.ts");
		const outBin = join(outDir, "png-export-check");
		const outPng = join(outDir, "snapshot.png");
		const indexImport = join(pkgRoot, "src", "index.ts").replace(/\\/g, "/");
		try {
			writeFileSync(
				harnessEntry,
				[
					`import { Box, darkGuiTheme, GuiApp, HeadlessBackend, renderDrawListToPng, Text, VStack } from ${JSON.stringify(indexImport)};`,
					"",
					"const backend = new HeadlessBackend({ width: 120, height: 80 });",
					"const app = new GuiApp({ backend, theme: darkGuiTheme, window: { title: 'png-test', width: 120, height: 80 } });",
					"app.setRoot(new Box({ padding: 8, background: darkGuiTheme.background, fillWidth: true, fillHeight: true, child: new VStack({ gap: 4, children: [new Text({ text: 'PNG Snapshot', color: darkGuiTheme.text })] }) }));",
					"app.renderFrame();",
					"const bytes = backend.getLastFrameBytes();",
					"if (!bytes || bytes.length === 0) throw new Error('Expected non-empty draw list');",
					`const ok = renderDrawListToPng(120, 80, 2, bytes, ${JSON.stringify(outPng)});`,
					"console.log(JSON.stringify({ ok, byteLength: bytes.length }));",
					"if (!ok) process.exit(2);",
					"app.dispose();",
				].join("\n"),
			);

			const build = spawnSync(
				scriptcBin,
				["build", "--node-islands=off", harnessEntry, "--ffi", ffiManifest, "-o", outBin],
				{
					cwd: pkgRoot,
					encoding: "utf8",
				},
			);
			assert.equal(build.status, 0, `scriptc build failed:\n${build.stdout}\n${build.stderr}`);

			const run = spawnSync(outBin, [], {
				encoding: "utf8",
				env: { ...process.env, SCRIPTC_LIBNODE: "/nonexistent" },
			});
			assert.equal(run.status, 0, `png-export-check failed:\n${run.stdout}\n${run.stderr}`);
			assert.equal(existsSync(outPng), true, "snapshot PNG should exist");

			const png = readFileSync(outPng);
			assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "valid PNG signature");
			assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR", "IHDR chunk present");
			const pixelW = png.readUInt32BE(16);
			const pixelH = png.readUInt32BE(20);
			assert.equal(pixelW, 240, "2x Retina PNG width");
			assert.equal(pixelH, 160, "2x Retina PNG height");
		} finally {
			rmSync(outDir, { recursive: true, force: true });
		}
	});
});
