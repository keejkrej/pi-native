/**
 * Keyboard event types, modifier bitmasks, and platform-aware key-chord matching.
 */

import { SGUI_MOD_ALT, SGUI_MOD_CTRL, SGUI_MOD_SHIFT, SGUI_MOD_SUPER } from "./protocol.ts";

export interface GuiModifiers {
	readonly shift: boolean;
	readonly ctrl: boolean;
	readonly alt: boolean;
	readonly super: boolean;
}

export interface GuiKeyEvent {
	readonly phase: "down" | "up" | "repeat";
	readonly keyCode: number;
	readonly key: string;
	readonly modifiers: GuiModifiers;
}

export type KeyId = string;

export function decodeModifiers(bitmask: number): GuiModifiers {
	return {
		shift: (bitmask & SGUI_MOD_SHIFT) !== 0,
		ctrl: (bitmask & SGUI_MOD_CTRL) !== 0,
		alt: (bitmask & SGUI_MOD_ALT) !== 0,
		super: (bitmask & SGUI_MOD_SUPER) !== 0,
	};
}

export function encodeModifiers(modifiers: GuiModifiers): number {
	let mask = 0;
	if (modifiers.shift) mask |= SGUI_MOD_SHIFT;
	if (modifiers.ctrl) mask |= SGUI_MOD_CTRL;
	if (modifiers.alt) mask |= SGUI_MOD_ALT;
	if (modifiers.super) mask |= SGUI_MOD_SUPER;
	return mask;
}

function normalizeKeyName(name: string): string {
	const lower = name.trim().toLowerCase();
	switch (lower) {
		case "return":
			return "enter";
		case "esc":
			return "escape";
		case "del":
			return "delete";
		case "arrowup":
			return "up";
		case "arrowdown":
			return "down";
		case "arrowleft":
			return "left";
		case "arrowright":
			return "right";
		case " ":
			return "space";
		default:
			return lower;
	}
}

export interface ParsedKeyChord {
	readonly key: string;
	readonly shift: boolean;
	readonly ctrl: boolean;
	readonly alt: boolean;
	readonly super: boolean;
}

export function parseKeyChord(keyId: KeyId, platform: string = process.platform): ParsedKeyChord {
	const parts = keyId
		.split("+")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	let shift = false;
	let ctrl = false;
	let alt = false;
	let isSuper = false;
	let key = "";

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part === undefined) continue;
		const lower = part.toLowerCase();
		if (i < parts.length - 1) {
			if (lower === "shift") {
				shift = true;
				continue;
			}
			if (lower === "ctrl" || lower === "control") {
				ctrl = true;
				continue;
			}
			if (lower === "alt" || lower === "option" || lower === "opt") {
				alt = true;
				continue;
			}
			if (lower === "super" || lower === "cmd" || lower === "meta") {
				isSuper = true;
				continue;
			}
			if (lower === "mod") {
				if (platform === "darwin") {
					isSuper = true;
				} else {
					ctrl = true;
				}
				continue;
			}
		}
		key = normalizeKeyName(part);
	}

	return { key, shift, ctrl, alt, super: isSuper };
}

export function matchesKeyEvent(event: GuiKeyEvent, keyId: KeyId, platform: string = process.platform): boolean {
	if (event.phase === "up") {
		return false;
	}
	const chord = parseKeyChord(keyId, platform);
	if (chord.key.length === 0) {
		return false;
	}
	if (normalizeKeyName(event.key) !== chord.key) {
		return false;
	}
	return (
		event.modifiers.shift === chord.shift &&
		event.modifiers.ctrl === chord.ctrl &&
		event.modifiers.alt === chord.alt &&
		event.modifiers.super === chord.super
	);
}
