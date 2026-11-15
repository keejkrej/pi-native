/**
 * Armin says hi! A fun easter egg with animated XBM art.
 */

import { Component, type TUI } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

// XBM image: 31x36 pixels, LSB first, 1=background, 0=foreground
export const ARMIN_WIDTH = 31;
export const ARMIN_HEIGHT = 36;
const WIDTH = ARMIN_WIDTH;
const HEIGHT = ARMIN_HEIGHT;
const BITS = [
	0xff, 0xff, 0xff, 0x7f, 0xff, 0xf0, 0xff, 0x7f, 0xff, 0xed, 0xff, 0x7f, 0xff, 0xdb, 0xff, 0x7f, 0xff, 0xb7, 0xff,
	0x7f, 0xff, 0x77, 0xfe, 0x7f, 0x3f, 0xf8, 0xfe, 0x7f, 0xdf, 0xff, 0xfe, 0x7f, 0xdf, 0x3f, 0xfc, 0x7f, 0x9f, 0xc3,
	0xfb, 0x7f, 0x6f, 0xfc, 0xf4, 0x7f, 0xf7, 0x0f, 0xf7, 0x7f, 0xf7, 0xff, 0xf7, 0x7f, 0xf7, 0xff, 0xe3, 0x7f, 0xf7,
	0x07, 0xe8, 0x7f, 0xef, 0xf8, 0x67, 0x70, 0x0f, 0xff, 0xbb, 0x6f, 0xf1, 0x00, 0xd0, 0x5b, 0xfd, 0x3f, 0xec, 0x53,
	0xc1, 0xff, 0xef, 0x57, 0x9f, 0xfd, 0xee, 0x5f, 0x9f, 0xfc, 0xae, 0x5f, 0x1f, 0x78, 0xac, 0x5f, 0x3f, 0x00, 0x50,
	0x6c, 0x7f, 0x00, 0xdc, 0x77, 0xff, 0xc0, 0x3f, 0x78, 0xff, 0x01, 0xf8, 0x7f, 0xff, 0x03, 0x9c, 0x78, 0xff, 0x07,
	0x8c, 0x7c, 0xff, 0x0f, 0xce, 0x78, 0xff, 0xff, 0xcf, 0x7f, 0xff, 0xff, 0xcf, 0x78, 0xff, 0xff, 0xdf, 0x78, 0xff,
	0xff, 0xdf, 0x7d, 0xff, 0xff, 0x3f, 0x7e, 0xff, 0xff, 0xff, 0x7f,
];

const BYTES_PER_ROW = Math.ceil(WIDTH / 8);
const DISPLAY_HEIGHT = Math.ceil(HEIGHT / 2); // Half-block rendering

type Effect = "typewriter" | "scanline" | "rain" | "fade" | "crt" | "glitch" | "dissolve";

const EFFECTS: Effect[] = ["typewriter", "scanline", "rain", "fade", "crt", "glitch", "dissolve"];

// Get pixel at (x, y): true = foreground, false = background
export function isArminPixel(x: number, y: number): boolean {
	if (y >= HEIGHT) return false;
	const byteIndex = y * BYTES_PER_ROW + Math.floor(x / 8);
	const bitIndex = x % 8;
	return ((BITS[byteIndex] >> bitIndex) & 1) === 0;
}

// Get the character for a cell (2 vertical pixels packed)
function getChar(x: number, row: number): string {
	const upper = isArminPixel(x, row * 2);
	const lower = isArminPixel(x, row * 2 + 1);
	if (upper && lower) return "█";
	if (upper) return "▀";
	if (lower) return "▄";
	return " ";
}

// Build the final image grid
function buildFinalGrid(): string[][] {
	const grid: string[][] = [];
	for (let row = 0; row < DISPLAY_HEIGHT; row++) {
		const line: string[] = [];
		for (let x = 0; x < WIDTH; x++) {
			line.push(getChar(x, row));
		}
		grid.push(line);
	}
	return grid;
}

interface ArminEffectState {
	pos: number;
	row: number;
	drops: { y: number; settled: number }[];
	positions: [number, number][];
	idx: number;
	expansion: number;
	phase: number;
	glitchFrames: number;
}

export class ArminComponent extends Component {
	private ui: TUI;
	private interval: ReturnType<typeof setInterval> | null = null;
	private effect: Effect;
	private finalGrid: string[][];
	private currentGrid: string[][];
	private effectState: ArminEffectState = {
		pos: 0,
		row: 0,
		drops: [],
		positions: [],
		idx: 0,
		expansion: 0,
		phase: 0,
		glitchFrames: 8,
	};
	private cachedLines: string[] = [];
	private cachedWidth = 0;
	private gridVersion = 0;
	private cachedVersion = -1;

	constructor(ui: TUI) {
		super();
		this.ui = ui;
		this.effect = EFFECTS[Math.floor(Math.random() * EFFECTS.length)];
		this.finalGrid = buildFinalGrid();
		this.currentGrid = this.createEmptyGrid();

		this.initEffect();
		this.startAnimation();
	}

	override invalidate(): void {
		this.cachedWidth = 0;
	}

	override render(width: number): string[] {
		if (width === this.cachedWidth && this.cachedVersion === this.gridVersion) {
			return this.cachedLines;
		}

		const padding = 1;
		const availableWidth = width - padding;

		this.cachedLines = this.currentGrid.map((row) => {
			// Clip row to available width before applying color
			const clipped = row.slice(0, availableWidth).join("");
			const padRight = Math.max(0, width - padding - clipped.length);
			return ` ${theme.fg("accent", clipped)}${" ".repeat(padRight)}`;
		});

		// Add "ARMIN SAYS HI" at the end
		const message = "ARMIN SAYS HI";
		const msgPadRight = Math.max(0, width - padding - message.length);
		this.cachedLines.push(` ${theme.fg("accent", message)}${" ".repeat(msgPadRight)}`);

		this.cachedWidth = width;
		this.cachedVersion = this.gridVersion;

		return this.cachedLines;
	}

	private createEmptyGrid(): string[][] {
		return Array.from({ length: DISPLAY_HEIGHT }, () => Array.from({ length: WIDTH }, () => " "));
	}

	private createShuffledPositions(): [number, number][] {
		const positions: [number, number][] = [];
		for (let row = 0; row < DISPLAY_HEIGHT; row++) {
			for (let x = 0; x < WIDTH; x++) {
				positions.push([row, x]);
			}
		}
		// Fisher-Yates shuffle
		for (let i = positions.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[positions[i], positions[j]] = [positions[j]!, positions[i]!];
		}
		return positions;
	}

	private initEffect(): void {
		switch (this.effect) {
			case "typewriter":
				this.effectState.pos = 0;
				break;
			case "scanline":
				this.effectState.row = 0;
				break;
			case "rain":
				// Track falling position for each column
				this.effectState.drops = Array.from({ length: WIDTH }, () => ({
					y: -Math.floor(Math.random() * DISPLAY_HEIGHT * 2),
					settled: 0,
				}));
				break;
			case "fade": {
				this.effectState.positions = this.createShuffledPositions();
				this.effectState.idx = 0;
				break;
			}
			case "crt":
				this.effectState.expansion = 0;
				break;
			case "glitch":
				this.effectState.phase = 0;
				this.effectState.glitchFrames = 8;
				break;
			case "dissolve": {
				// Start with random noise
				const chars = [" ", "░", "▒", "▓", "█", "▀", "▄"];
				this.currentGrid = Array.from({ length: DISPLAY_HEIGHT }, () =>
					Array.from({ length: WIDTH }, () => chars[Math.floor(Math.random() * chars.length)]!),
				);
				this.effectState.positions = this.createShuffledPositions();
				this.effectState.idx = 0;
				break;
			}
		}
	}

	private startAnimation(): void {
		const fps = this.effect === "glitch" ? 60 : 30;
		this.interval = setInterval(() => {
			const done = this.tickEffect();
			this.updateDisplay();
			this.ui.requestRender();
			if (done) {
				this.stopAnimation();
			}
		}, 1000 / fps);
	}

	private stopAnimation(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
	}

	private tickEffect(): boolean {
		switch (this.effect) {
			case "typewriter":
				return this.tickTypewriter();
			case "scanline":
				return this.tickScanline();
			case "rain":
				return this.tickRain();
			case "fade":
				return this.tickFade();
			case "crt":
				return this.tickCrt();
			case "glitch":
				return this.tickGlitch();
			case "dissolve":
				return this.tickDissolve();
			default:
				return true;
		}
	}

	private tickTypewriter(): boolean {
		const pixelsPerFrame = 3;

		for (let i = 0; i < pixelsPerFrame; i++) {
			const row = Math.floor(this.effectState.pos / WIDTH);
			const x = this.effectState.pos % WIDTH;
			if (row >= DISPLAY_HEIGHT) return true;
			this.currentGrid[row]![x] = this.finalGrid[row]![x]!;
			this.effectState.pos++;
		}
		return false;
	}

	private tickScanline(): boolean {
		if (this.effectState.row >= DISPLAY_HEIGHT) return true;

		// Copy row
		for (let x = 0; x < WIDTH; x++) {
			this.currentGrid[this.effectState.row]![x] = this.finalGrid[this.effectState.row]![x]!;
		}
		this.effectState.row++;
		return false;
	}

	private tickRain(): boolean {
		let allSettled = true;
		this.currentGrid = this.createEmptyGrid();

		for (let x = 0; x < WIDTH; x++) {
			const drop = this.effectState.drops[x]!;

			// Draw settled pixels
			for (let row = DISPLAY_HEIGHT - 1; row >= DISPLAY_HEIGHT - drop.settled; row--) {
				if (row >= 0) {
					this.currentGrid[row]![x] = this.finalGrid[row]![x]!;
				}
			}

			// Check if this column is done
			if (drop.settled >= DISPLAY_HEIGHT) continue;

			allSettled = false;

			// Find the target row for this column (lowest non-space pixel)
			let targetRow = -1;
			for (let row = DISPLAY_HEIGHT - 1 - drop.settled; row >= 0; row--) {
				if (this.finalGrid[row]![x] !== " ") {
					targetRow = row;
					break;
				}
			}

			// Move drop down
			drop.y++;

			// Draw falling drop
			if (drop.y >= 0 && drop.y < DISPLAY_HEIGHT) {
				if (targetRow >= 0 && drop.y >= targetRow) {
					// Settle
					drop.settled = DISPLAY_HEIGHT - targetRow;
					drop.y = -Math.floor(Math.random() * 5) - 1;
				} else {
					// Still falling
					this.currentGrid[drop.y]![x] = "▓";
				}
			}
		}

		return allSettled;
	}

	private advanceRevealedPositions(pixelsPerFrame: number): boolean {
		const positions = this.effectState.positions;
		for (let i = 0; i < pixelsPerFrame; i++) {
			if (this.effectState.idx >= positions.length) return true;
			const [row, x] = positions[this.effectState.idx]!;
			this.currentGrid[row]![x] = this.finalGrid[row]![x]!;
			this.effectState.idx++;
		}
		return false;
	}

	private tickFade(): boolean {
		return this.advanceRevealedPositions(15);
	}

	private tickCrt(): boolean {
		const midRow = Math.floor(DISPLAY_HEIGHT / 2);

		this.currentGrid = this.createEmptyGrid();

		// Draw from middle expanding outward
		const top = midRow - this.effectState.expansion;
		const bottom = midRow + this.effectState.expansion;

		for (let row = Math.max(0, top); row <= Math.min(DISPLAY_HEIGHT - 1, bottom); row++) {
			for (let x = 0; x < WIDTH; x++) {
				this.currentGrid[row]![x] = this.finalGrid[row]![x]!;
			}
		}

		this.effectState.expansion++;
		return this.effectState.expansion > DISPLAY_HEIGHT;
	}

	private tickGlitch(): boolean {
		if (this.effectState.phase < this.effectState.glitchFrames) {
			// Glitch phase: show corrupted version
			this.currentGrid = this.finalGrid.map((row) => {
				const offset = Math.floor(Math.random() * 7) - 3;
				const glitchRow = [...row];

				// Random horizontal offset
				if (Math.random() < 0.3) {
					const shifted = glitchRow.slice(offset).concat(glitchRow.slice(0, offset));
					return shifted.slice(0, WIDTH);
				}

				// Random vertical swap
				if (Math.random() < 0.2) {
					const swapRow = Math.floor(Math.random() * DISPLAY_HEIGHT);
					return [...this.finalGrid[swapRow]!];
				}

				return glitchRow;
			});
			this.effectState.phase++;
			return false;
		}

		// Final frame: show clean image
		this.currentGrid = this.finalGrid.map((row) => [...row]);
		return true;
	}

	private tickDissolve(): boolean {
		return this.advanceRevealedPositions(20);
	}

	private updateDisplay(): void {
		this.gridVersion++;
	}

	override dispose(): void {
		this.stopAnimation();
	}
}
