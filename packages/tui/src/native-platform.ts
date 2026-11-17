import {
	isNativeDarwinAvailable,
	nativeClipboardGetFilePaths,
	nativeClipboardGetImagePng,
	nativeClipboardGetText,
	nativeClipboardSetText,
	nativeIsModifierPressed,
} from "@pi-ts/ffi";

export type ModifierKey = "shift" | "command" | "control" | "option";

export interface NativeClipboard {
	/** Undefined means unavailable, null means no text; transfer failures reject. */
	getText(): Promise<string | null | undefined>;
	/** Undefined means unavailable, null means no image; transfer failures reject. */
	getImage(): Promise<Uint8Array | null | undefined>;
	/** POSIX paths of file URLs on the clipboard. Undefined means unsupported, null means no files. */
	getFilePaths?(): Promise<string[] | null | undefined>;
	/** Linux uses command-line tools to retain clipboard ownership instead. */
	setText?(text: string): Promise<void>;
}

export type NativePlatformHelper = NativeClipboard & {
	enableVirtualTerminalInput?: () => boolean;
	isModifierPressed?: (name: ModifierKey) => boolean;
};

const darwinPlatformHelper: NativePlatformHelper = {
	async getText(): Promise<string | null | undefined> {
		return nativeClipboardGetText();
	},
	async getImage(): Promise<Uint8Array | null | undefined> {
		return nativeClipboardGetImagePng();
	},
	async getFilePaths(): Promise<string[] | null | undefined> {
		return nativeClipboardGetFilePaths();
	},
	async setText(text: string): Promise<void> {
		if (!nativeClipboardSetText(text)) {
			throw new Error("Failed to set clipboard text");
		}
	},
	isModifierPressed(name: ModifierKey): boolean {
		return nativeIsModifierPressed(name);
	},
};

export function getNativePlatformHelper(): NativePlatformHelper | undefined {
	if (!isNativeDarwinAvailable()) {
		return undefined;
	}
	return darwinPlatformHelper;
}

/** Load a clipboard helper without opening the display until a read is requested. */
export function getNativeClipboard(): NativePlatformHelper | undefined {
	if (!isNativeDarwinAvailable()) {
		return undefined;
	}
	return darwinPlatformHelper;
}
