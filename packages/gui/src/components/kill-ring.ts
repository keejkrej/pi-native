/**
 * Emacs-style kill ring buffer for line/word deletion, yank, and yank-pop cycling.
 */

export interface KillPushOptions {
	readonly prepend: boolean;
	readonly accumulate?: boolean;
}

export class KillRing {
	private readonly ring: string[];
	private readonly maxEntries: number;

	constructor(maxEntries = 60) {
		this.ring = [];
		this.maxEntries = Math.max(1, maxEntries);
	}

	push(text: string, options: KillPushOptions): void {
		if (text.length === 0) return;

		if (options.accumulate && this.ring.length > 0) {
			const last = this.ring.pop();
			if (last !== undefined) {
				this.ring.push(options.prepend ? text + last : last + text);
				return;
			}
		}

		this.ring.push(text);
		if (this.ring.length > this.maxEntries) {
			this.ring.shift();
		}
	}

	peek(): string | undefined {
		return this.ring.length > 0 ? this.ring[this.ring.length - 1] : undefined;
	}

	rotate(): void {
		if (this.ring.length <= 1) return;
		const top = this.ring.pop();
		if (top !== undefined) {
			this.ring.unshift(top);
		}
	}

	get length(): number {
		return this.ring.length;
	}
}
