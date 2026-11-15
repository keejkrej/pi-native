import { Component } from "../tui.ts";

/**
 * Spacer component that renders empty lines
 */
export class Spacer extends Component {
	private lines: number;

	constructor(lines: number = 1) {
		super();
		this.lines = lines;
	}

	setLines(lines: number): void {
		this.lines = lines;
	}

	override invalidate(): void {
		// No cached state to invalidate currently
	}

	override render(_width: number): string[] {
		const result: string[] = [];
		for (let i = 0; i < this.lines; i++) {
			result.push("");
		}
		return result;
	}
}
