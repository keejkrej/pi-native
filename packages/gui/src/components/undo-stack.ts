/**
 * Snapshot-based undo and redo stack with explicit cloning (no structuredClone dependency).
 */

export class UndoStack<S> {
	private readonly undoEntries: S[];
	private readonly redoEntries: S[];
	private readonly cloneFn: (snapshot: S) => S;
	private readonly maxEntries: number;

	constructor(cloneFn: (snapshot: S) => S, maxEntries = 200) {
		this.undoEntries = [];
		this.redoEntries = [];
		this.cloneFn = cloneFn;
		this.maxEntries = Math.max(1, maxEntries);
	}

	push(snapshot: S): void {
		this.redoEntries.length = 0;
		this.undoEntries.push(this.cloneFn(snapshot));
		if (this.undoEntries.length > this.maxEntries) {
			this.undoEntries.shift();
		}
	}

	canUndo(): boolean {
		return this.undoEntries.length > 0;
	}

	canRedo(): boolean {
		return this.redoEntries.length > 0;
	}

	undo(currentSnapshot: S): S | undefined {
		const prev = this.undoEntries.pop();
		if (prev === undefined) {
			return undefined;
		}
		this.redoEntries.push(this.cloneFn(currentSnapshot));
		return this.cloneFn(prev);
	}

	redo(currentSnapshot: S): S | undefined {
		const next = this.redoEntries.pop();
		if (next === undefined) {
			return undefined;
		}
		this.undoEntries.push(this.cloneFn(currentSnapshot));
		return this.cloneFn(next);
	}

	clear(): void {
		this.undoEntries.length = 0;
		this.redoEntries.length = 0;
	}
}
