/**
 * Fuzzy matcher and slash-command / filesystem autocomplete providers for GUI text editors.
 */

import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface FuzzyMatchResult {
	readonly matches: boolean;
	readonly score: number;
}

function isWordBoundaryChar(ch: string): boolean {
	return ch === " " || ch === "-" || ch === "_" || ch === "." || ch === "/" || ch === "\\" || ch === ":";
}

export function fuzzyMatch(query: string, text: string): FuzzyMatchResult {
	const q = query.toLowerCase();
	const t = text.toLowerCase();
	if (q.length === 0) {
		return { matches: true, score: 0 };
	}
	if (q.length > t.length) {
		return { matches: false, score: 0 };
	}

	let qi = 0;
	let score = 0;
	let lastMatchIdx = -1;
	let consecutive = 0;

	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (t.charCodeAt(ti) === q.charCodeAt(qi)) {
			const isStart = ti === 0;
			const prevChar = ti > 0 ? text.charAt(ti - 1) : "";
			const isBoundary = isStart || isWordBoundaryChar(prevChar);

			if (lastMatchIdx === ti - 1) {
				consecutive += 1;
				score -= consecutive * 5;
			} else {
				consecutive = 0;
				if (lastMatchIdx >= 0) {
					score += (ti - lastMatchIdx) * 2;
				}
			}
			if (isBoundary) {
				score -= 10;
			}
			score += ti * 0.1;
			lastMatchIdx = ti;
			qi += 1;
		}
	}

	if (qi < q.length) {
		return { matches: false, score: 0 };
	}
	return { matches: true, score };
}

export function fuzzyFilter<T>(items: readonly T[], query: string, getText: (item: T) => string): T[] {
	const trimmed = query.trim();
	if (trimmed.length === 0) {
		return items.slice();
	}
	const scored: Array<{ item: T; score: number }> = [];
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (item === undefined) continue;
		const result = fuzzyMatch(trimmed, getText(item));
		if (result.matches) {
			scored.push({ item, score: result.score });
		}
	}
	scored.sort((a, b) => a.score - b.score);
	const out: T[] = [];
	for (let i = 0; i < scored.length; i++) {
		const entry = scored[i];
		if (entry !== undefined) {
			out.push(entry.item);
		}
	}
	return out;
}

export interface AutocompleteItem {
	readonly value: string;
	readonly label: string;
	readonly description?: string;
}

export interface AutocompleteResult {
	readonly items: readonly AutocompleteItem[];
	readonly prefix: string;
}

export interface AutocompleteApplyResult {
	readonly lines: string[];
	readonly cursorLine: number;
	readonly cursorCol: number;
}

export interface SlashCommand {
	readonly name: string;
	readonly description?: string;
	readonly getArgumentCompletions?: (prefix: string) => AutocompleteItem[] | null;
}

export abstract class AutocompleteProvider {
	abstract getSuggestions(lines: readonly string[], cursorLine: number, cursorCol: number): AutocompleteResult | null;

	abstract applyCompletion(
		lines: readonly string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): AutocompleteApplyResult;
}

export class CombinedAutocompleteProvider extends AutocompleteProvider {
	private readonly commands: readonly SlashCommand[];
	private readonly basePath: string;
	private readonly enablePathCompletion: boolean;

	constructor(commands: readonly SlashCommand[] = [], basePath: string = process.cwd(), enablePathCompletion = true) {
		super();
		this.commands = commands;
		this.basePath = basePath;
		this.enablePathCompletion = enablePathCompletion;
	}

	getSuggestions(lines: readonly string[], cursorLine: number, cursorCol: number): AutocompleteResult | null {
		const currentLine = lines[cursorLine] ?? "";
		const beforeCursor = currentLine.slice(0, cursorCol);

		// Slash command completion on first line
		if (beforeCursor.startsWith("/") && cursorLine === 0) {
			const spaceIndex = beforeCursor.indexOf(" ");
			if (spaceIndex === -1) {
				const prefix = beforeCursor.slice(1);
				const items: AutocompleteItem[] = [];
				for (let i = 0; i < this.commands.length; i++) {
					const cmd = this.commands[i];
					if (cmd === undefined) continue;
					items.push({
						value: cmd.name,
						label: `/${cmd.name}`,
						description: cmd.description,
					});
				}
				const filtered = fuzzyFilter(items, prefix, (item) => item.value);
				return filtered.length > 0 ? { items: filtered, prefix: beforeCursor } : null;
			}

			const cmdName = beforeCursor.slice(1, spaceIndex);
			const argPrefix = beforeCursor.slice(spaceIndex + 1);
			for (let i = 0; i < this.commands.length; i++) {
				const cmd = this.commands[i];
				if (cmd !== undefined && cmd.name === cmdName && cmd.getArgumentCompletions !== undefined) {
					const args = cmd.getArgumentCompletions(argPrefix);
					if (args !== null && args.length > 0) {
						return { items: args, prefix: argPrefix };
					}
				}
			}
			return null;
		}

		// @file reference completion
		if (this.enablePathCompletion) {
			const atMatch = /(?:^|\s)@([^\s]*)$/.exec(beforeCursor);
			if (atMatch !== null) {
				const token = atMatch[1] ?? "";
				const prefix = `@${token}`;
				const fileItems = this.completeFilePath(token);
				return fileItems.length > 0 ? { items: fileItems, prefix } : null;
			}
		}

		return null;
	}

	private completeFilePath(queryPath: string): AutocompleteItem[] {
		try {
			const hasSlash = queryPath.includes("/");
			const searchDir = hasSlash ? join(this.basePath, dirname(queryPath)) : this.basePath;
			const namePrefix = hasSlash ? basename(queryPath) : queryPath;
			const dirPrefix = hasSlash ? `${dirname(queryPath)}/` : "";

			const entries = readdirSync(searchDir, { withFileTypes: true });
			const candidates: AutocompleteItem[] = [];
			for (let i = 0; i < entries.length; i++) {
				const entry = entries[i];
				if (entry === undefined) continue;
				if (entry.name.startsWith(".") && !namePrefix.startsWith(".")) {
					continue;
				}
				const suffix = entry.isDirectory() ? "/" : "";
				const relPath = `${dirPrefix === "./" ? "" : dirPrefix}${entry.name}${suffix}`;
				candidates.push({
					value: `@${relPath}`,
					label: relPath,
					description: entry.isDirectory() ? "dir" : "file",
				});
			}
			return fuzzyFilter(candidates, namePrefix, (item) => item.label).slice(0, 12);
		} catch {
			return [];
		}
	}

	applyCompletion(
		lines: readonly string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): AutocompleteApplyResult {
		const nextLines = lines.slice();
		const line = nextLines[cursorLine] ?? "";
		const startCol = Math.max(0, cursorCol - prefix.length);
		const isSlashCmd = prefix.startsWith("/") && !prefix.includes(" ");
		const replacement = isSlashCmd ? `/${item.value} ` : item.value;
		nextLines[cursorLine] = line.slice(0, startCol) + replacement + line.slice(cursorCol);
		return {
			lines: nextLines,
			cursorLine,
			cursorCol: startCol + replacement.length,
		};
	}
}
