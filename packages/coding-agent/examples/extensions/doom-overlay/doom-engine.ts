/**
 * DOOM Engine - WebAssembly wrapper for doomgeneric
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface DoomModule {
	_doomgeneric_Create: (argc: number, argv: number) => void;
	_doomgeneric_Tick: () => void;
	_DG_GetFrameBuffer: () => number;
	_DG_GetScreenWidth: () => number;
	_DG_GetScreenHeight: () => number;
	_DG_PushKeyEvent: (pressed: number, key: number) => void;
	_malloc: (size: number) => number;
	_free: (ptr: number) => void;
	HEAPU8: Uint8Array;
	HEAPU32: Uint32Array;
	FS_createDataFile: (parent: string, name: string, data: number[], canRead: boolean, canWrite: boolean) => void;
	FS_createPath: (parent: string, path: string, canRead: boolean, canWrite: boolean) => string;
	setValue: (ptr: number, value: number, type: string) => void;
	getValue: (ptr: number, type: string) => number;
}

export class DoomEngine {
	private module: DoomModule | null = null;
	private frameBufferPtr: number = 0;
	private initialized = false;
	private wadPath: string;
	private _width = 640;
	private _height = 400;

	constructor(wadPath: string) {
		this.wadPath = wadPath;
	}

	get width(): number {
		return this._width;
	}

	get height(): number {
		return this._height;
	}

	async init(): Promise<void> {
		// Locate WASM build
		const __dirname = path.dirname(fileURLToPath(import.meta.url));
		const buildDir = path.join(__dirname, "doom", "build");
		const doomJsPath = path.join(buildDir, "doom.js");

		type CreateDoomModule = (config: unknown) => Promise<DoomModule>;
		const preloadedFactory = (globalThis as { createDoomModule?: CreateDoomModule }).createDoomModule;
		let createDoomModule = preloadedFactory;

		if (!createDoomModule) {
			if (!fs.existsSync(doomJsPath)) {
				throw new Error(`DOOM WASM build not found at ${doomJsPath}. Run ./doom/build.sh first`);
			}
			if (typeof WebAssembly !== "object" || typeof WebAssembly.instantiate !== "function") {
				throw new Error("DOOM requires WebAssembly support, which is unavailable in this sandbox runtime.");
			}

			// Evaluate Emscripten CJS loader with sandboxed built-in shims instead of node:module createRequire
			const doomJsCode = fs.readFileSync(doomJsPath, "utf-8");
			const moduleExports: { exports: unknown } = { exports: {} };
			const sandboxRequire = (id: string): unknown => {
				if (id === "fs" || id === "node:fs") return fs;
				if (id === "path" || id === "node:path") return path;
				if (id === "crypto" || id === "node:crypto") return crypto;
				throw new Error(`DOOM sandbox engine does not support CJS module "${id}"`);
			};
			try {
				const moduleFunc = new Function("module", "exports", "__dirname", "__filename", "require", doomJsCode);
				moduleFunc(moduleExports, moduleExports.exports, buildDir, doomJsPath, sandboxRequire);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				throw new Error(`Failed to load DOOM CJS engine (${doomJsPath}): ${msg}`);
			}
			if (typeof moduleExports.exports !== "function") {
				throw new Error(`Invalid DOOM engine module exports in ${doomJsPath}`);
			}
			createDoomModule = moduleExports.exports as CreateDoomModule;
		}

		// Read WAD file
		const wadData = fs.readFileSync(this.wadPath);
		const wadArray = Array.from(new Uint8Array(wadData));

		const moduleConfig = {
			locateFile: (filePath: string) => {
				if (filePath.endsWith(".wasm")) {
					return path.join(buildDir, filePath);
				}
				return filePath;
			},
			print: () => {},
			printErr: () => {},
			preRun: [
				(module: DoomModule) => {
					// Create /doom directory and add WAD
					module.FS_createPath("/", "doom", true, true);
					module.FS_createDataFile("/doom", "doom1.wad", wadArray, true, false);
				},
			],
		};

		this.module = await createDoomModule(moduleConfig);
		if (!this.module) {
			throw new Error("Failed to initialize DOOM module");
		}

		// Initialize DOOM
		this.initDoom();

		// Get framebuffer info
		this.frameBufferPtr = this.module._DG_GetFrameBuffer();
		this._width = this.module._DG_GetScreenWidth();
		this._height = this.module._DG_GetScreenHeight();
		this.initialized = true;
	}

	private initDoom(): void {
		if (!this.module) return;

		const args = ["doom", "-iwad", "/doom/doom1.wad"];
		const argPtrs: number[] = [];

		for (const arg of args) {
			const ptr = this.module._malloc(arg.length + 1);
			for (let i = 0; i < arg.length; i++) {
				this.module.setValue(ptr + i, arg.charCodeAt(i), "i8");
			}
			this.module.setValue(ptr + arg.length, 0, "i8");
			argPtrs.push(ptr);
		}

		const argvPtr = this.module._malloc(argPtrs.length * 4);
		for (let i = 0; i < argPtrs.length; i++) {
			this.module.setValue(argvPtr + i * 4, argPtrs[i]!, "i32");
		}

		this.module._doomgeneric_Create(args.length, argvPtr);

		for (const ptr of argPtrs) {
			this.module._free(ptr);
		}
		this.module._free(argvPtr);
	}

	/**
	 * Run one game tick
	 */
	tick(): void {
		if (!this.module || !this.initialized) return;
		this.module._doomgeneric_Tick();
	}

	/**
	 * Get current frame as RGBA pixel data
	 * DOOM outputs ARGB, we convert to RGBA
	 */
	getFrameRGBA(): Uint8Array {
		if (!this.module || !this.initialized) {
			return new Uint8Array(this._width * this._height * 4);
		}

		const pixels = this._width * this._height;
		const buffer = new Uint8Array(pixels * 4);

		for (let i = 0; i < pixels; i++) {
			const argb = this.module.getValue(this.frameBufferPtr + i * 4, "i32");
			const offset = i * 4;
			buffer[offset + 0] = (argb >> 16) & 0xff; // R
			buffer[offset + 1] = (argb >> 8) & 0xff; // G
			buffer[offset + 2] = argb & 0xff; // B
			buffer[offset + 3] = 255; // A
		}

		return buffer;
	}

	/**
	 * Push a key event
	 */
	pushKey(pressed: boolean, key: number): void {
		if (!this.module || !this.initialized) return;
		this.module._DG_PushKeyEvent(pressed ? 1 : 0, key);
	}

	isInitialized(): boolean {
		return this.initialized;
	}
}
