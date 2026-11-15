/**
 * Configurable application and editor keybindings (no hardcoded component shortcuts).
 */

import { type GuiKeyEvent, type KeyId, matchesKeyEvent } from "./keys.ts";

export type EditorKeybindingAction =
	| "cursorUp"
	| "cursorDown"
	| "cursorLeft"
	| "cursorRight"
	| "cursorWordLeft"
	| "cursorWordRight"
	| "cursorLineStart"
	| "cursorLineEnd"
	| "cursorDocStart"
	| "cursorDocEnd"
	| "extendUp"
	| "extendDown"
	| "extendLeft"
	| "extendRight"
	| "extendWordLeft"
	| "extendWordRight"
	| "extendLineStart"
	| "extendLineEnd"
	| "extendDocStart"
	| "extendDocEnd"
	| "selectAll"
	| "pageUp"
	| "pageDown"
	| "deleteCharBackward"
	| "deleteCharForward"
	| "deleteWordBackward"
	| "deleteWordForward"
	| "deleteToLineStart"
	| "deleteToLineEnd"
	| "newLine"
	| "submit"
	| "tab"
	| "undo"
	| "redo"
	| "copy"
	| "cut"
	| "paste"
	| "yank"
	| "yankPop";

export type AppKeybindingAction =
	| "focusNext"
	| "focusPrev"
	| "activate"
	| "cancel"
	| "selectUp"
	| "selectDown"
	| "selectPageUp"
	| "selectPageDown"
	| "selectConfirm"
	| "selectCancel"
	| "scrollUp"
	| "scrollDown"
	| "scrollPageUp"
	| "scrollPageDown"
	| "scrollTop"
	| "scrollBottom"
	| "stepDecrement"
	| "stepIncrement"
	| "moveUp"
	| "moveDown"
	| "moveLeft"
	| "moveRight"
	| "commandPalette"
	| "toggle"
	| "quit";

export type GuiKeybindingAction = EditorKeybindingAction | AppKeybindingAction;

export type GuiKeybindingsConfig = Partial<Record<GuiKeybindingAction, KeyId | readonly KeyId[]>>;

export const DEFAULT_EDITOR_KEYBINDINGS: Record<EditorKeybindingAction, readonly KeyId[]> = {
	cursorUp: ["up"],
	cursorDown: ["down"],
	cursorLeft: ["left", "ctrl+b"],
	cursorRight: ["right", "ctrl+f"],
	cursorWordLeft: ["alt+left", "ctrl+left"],
	cursorWordRight: ["alt+right", "ctrl+right"],
	cursorLineStart: ["home", "ctrl+a", "mod+left"],
	cursorLineEnd: ["end", "ctrl+e", "mod+right"],
	cursorDocStart: ["mod+up", "ctrl+home"],
	cursorDocEnd: ["mod+down", "ctrl+end"],
	extendUp: ["shift+up"],
	extendDown: ["shift+down"],
	extendLeft: ["shift+left"],
	extendRight: ["shift+right"],
	extendWordLeft: ["shift+alt+left", "shift+ctrl+left"],
	extendWordRight: ["shift+alt+right", "shift+ctrl+right"],
	extendLineStart: ["shift+home", "shift+mod+left"],
	extendLineEnd: ["shift+end", "shift+mod+right"],
	extendDocStart: ["shift+mod+up", "shift+ctrl+home"],
	extendDocEnd: ["shift+mod+down", "shift+ctrl+end"],
	selectAll: ["mod+a"],
	pageUp: ["pageup"],
	pageDown: ["pagedown"],
	deleteCharBackward: ["backspace", "shift+backspace"],
	deleteCharForward: ["delete", "ctrl+d"],
	deleteWordBackward: ["alt+backspace", "ctrl+backspace", "ctrl+w"],
	deleteWordForward: ["alt+delete", "ctrl+delete"],
	deleteToLineStart: ["ctrl+u", "mod+backspace"],
	deleteToLineEnd: ["ctrl+k"],
	newLine: ["shift+enter", "alt+enter"],
	submit: ["enter"],
	tab: ["tab"],
	undo: ["mod+z"],
	redo: ["mod+shift+z"],
	copy: ["mod+c"],
	cut: ["mod+x"],
	paste: ["mod+v"],
	yank: ["ctrl+y"],
	yankPop: ["alt+y"],
};

export const DEFAULT_APP_KEYBINDINGS: Record<AppKeybindingAction, readonly KeyId[]> = {
	focusNext: ["tab"],
	focusPrev: ["shift+tab"],
	activate: ["enter", "space"],
	cancel: ["escape"],
	selectUp: ["up"],
	selectDown: ["down"],
	selectPageUp: ["pageup"],
	selectPageDown: ["pagedown"],
	selectConfirm: ["enter"],
	selectCancel: ["escape"],
	scrollUp: ["up"],
	scrollDown: ["down"],
	scrollPageUp: ["pageup"],
	scrollPageDown: ["pagedown"],
	scrollTop: ["home", "mod+up"],
	scrollBottom: ["end", "mod+down"],
	stepDecrement: ["left", "down"],
	stepIncrement: ["right", "up"],
	moveUp: ["up", "w"],
	moveDown: ["down", "s"],
	moveLeft: ["left", "a"],
	moveRight: ["right", "d"],
	commandPalette: ["mod+k"],
	toggle: ["enter", "space"],
	quit: ["mod+q"],
};

function toKeyList(value: KeyId | readonly KeyId[]): readonly KeyId[] {
	return typeof value === "string" ? [value] : value;
}

export class KeybindingsManager {
	private readonly bindings: Map<string, readonly KeyId[]>;
	private readonly platform: string;

	constructor(userConfig: GuiKeybindingsConfig = {}, platform: string = process.platform) {
		this.bindings = new Map<string, readonly KeyId[]>();
		this.platform = platform;
		this.loadDefaults();
		this.applyOverrides(userConfig);
	}

	private loadDefaults(): void {
		const editorEntries = Object.entries(DEFAULT_EDITOR_KEYBINDINGS);
		for (let i = 0; i < editorEntries.length; i++) {
			const entry = editorEntries[i];
			if (entry === undefined) continue;
			this.bindings.set(entry[0], entry[1]);
		}
		const appEntries = Object.entries(DEFAULT_APP_KEYBINDINGS);
		for (let i = 0; i < appEntries.length; i++) {
			const entry = appEntries[i];
			if (entry === undefined) continue;
			if (!this.bindings.has(entry[0])) {
				this.bindings.set(entry[0], entry[1]);
			}
		}
	}

	private applyOverrides(userConfig: GuiKeybindingsConfig): void {
		const entries = Object.entries(userConfig);
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (entry === undefined) continue;
			const action = entry[0];
			const keys = entry[1];
			if (keys !== undefined) {
				this.bindings.set(action, toKeyList(keys));
			}
		}
	}

	getKeys(action: GuiKeybindingAction): readonly KeyId[] {
		return this.bindings.get(action) ?? [];
	}

	setKeys(action: GuiKeybindingAction, keys: KeyId | readonly KeyId[]): void {
		this.bindings.set(action, toKeyList(keys));
	}

	matches(event: GuiKeyEvent, action: GuiKeybindingAction): boolean {
		const keys = this.bindings.get(action);
		if (keys === undefined) {
			return false;
		}
		for (let i = 0; i < keys.length; i++) {
			const keyId = keys[i];
			if (keyId !== undefined && matchesKeyEvent(event, keyId, this.platform)) {
				return true;
			}
		}
		return false;
	}
}
