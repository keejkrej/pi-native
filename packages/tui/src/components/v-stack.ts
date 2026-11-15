import type { StackLayoutNode } from "../layout-node.ts";
import { allocateStackSizes, Stack, type StackChild, type StackOptions, visibleStackEntries } from "./stack.ts";

export class VStack extends Stack {
	protected readonly layoutType = "vstack" as const;

	constructor(children: StackChild[] = [], options: StackOptions = {}) {
		super(children, options);
	}

	override getLayoutNode(): StackLayoutNode {
		return super.getLayoutNode();
	}

	override invalidate(): void {
		super.invalidate();
	}

	override render(width: number): string[] {
		const viewport = { width: Math.max(1, width), height: Number.MAX_SAFE_INTEGER };
		const entries = visibleStackEntries(this.entries, viewport);
		const rendered = entries.map((entry) => entry.component.render(viewport.width));
		const sizes = allocateStackSizes(
			entries,
			rendered.map((lines) => lines.length),
			undefined,
			this.gap,
		);
		const lines: string[] = [];
		for (let index = 0; index < entries.length; index++) {
			if (index > 0) {
				for (let gap = 0; gap < this.gap; gap++) lines.push("");
			}
			const targetSize = index < sizes.length ? sizes[index]! : 0;
			const childLines = (index < rendered.length ? rendered[index]! : []).slice(0, targetSize);
			lines.push(...childLines);
			for (let padding = childLines.length; padding < targetSize; padding++) lines.push("");
		}
		return lines;
	}
}

export type { StackChild, StackEntry, StackEntryOptions, StackOptions } from "./stack.ts";
