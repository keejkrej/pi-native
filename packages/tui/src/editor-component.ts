import type { AutocompleteProvider } from "./autocomplete.ts";
import { Component, type ComponentLike } from "./tui.ts";

/**
 * Structural shape for plain-object custom editor components provided by extensions/tests.
 */
export interface EditorComponentLike extends ComponentLike {
	/** Get the current text content */
	getText(): string;

	/** Set the text content */
	setText(text: string): void;

	/** Handle raw terminal input (key presses, paste sequences, etc.) */
	handleInput(data: string): void;

	/** Called when user submits (e.g., Enter key) */
	onSubmit?: (text: string) => void;

	/** Called when text changes */
	onChange?: (text: string) => void;

	/** Add text to history for up/down navigation */
	addToHistory?(text: string): void;

	/** Insert text at current cursor position */
	insertTextAtCursor?(text: string): void;

	/** Get current cursor position */
	getCursor?(): { line: number; col: number };

	/**
	 * Get text with any markers expanded (e.g., paste markers).
	 * Falls back to getText() if not implemented.
	 */
	getExpandedText?(): string;

	/** Set the autocomplete provider */
	setAutocompleteProvider?(provider: AutocompleteProvider): void;

	/** Border color function */
	borderColor?: (str: string) => string;

	/** Get horizontal padding */
	getPaddingX?(): number;

	/** Set horizontal padding */
	setPaddingX?(padding: number): void;

	/** Get max visible items in autocomplete dropdown */
	getAutocompleteMaxVisible?(): number;

	/** Set max visible items in autocomplete dropdown */
	setAutocompleteMaxVisible?(maxVisible: number): void;
}

/**
 * Base class for custom editor components.
 *
 * This allows extensions to provide their own editor implementation
 * (e.g., vim mode, emacs mode, custom keybindings) while maintaining
 * native virtual dispatch compatibility with the core application.
 */
export abstract class EditorComponent extends Component {
	private _onSubmit?: (text: string) => void;
	private _onChange?: (text: string) => void;
	private _borderColor: (str: string) => string = (str) => str;

	override canHandleInput(): boolean {
		return true;
	}

	// =========================================================================
	// Core text access (required)
	// =========================================================================

	/** Get the current text content */
	abstract getText(): string;

	/** Set the text content */
	abstract setText(text: string): void;

	/** Handle raw terminal input (key presses, paste sequences, etc.) */
	abstract override handleInput(data: string): void;

	// =========================================================================
	// Callbacks
	// =========================================================================

	/** Called when user submits (e.g., Enter key) */
	get onSubmit(): ((text: string) => void) | undefined {
		return this._onSubmit;
	}

	set onSubmit(value: ((text: string) => void) | undefined) {
		this._onSubmit = value;
	}

	/** Called when text changes */
	get onChange(): ((text: string) => void) | undefined {
		return this._onChange;
	}

	set onChange(value: ((text: string) => void) | undefined) {
		this._onChange = value;
	}

	// =========================================================================
	// History support (optional)
	// =========================================================================

	/** Add text to history for up/down navigation */
	addToHistory(_text: string): void {}

	// =========================================================================
	// Advanced text manipulation (optional)
	// =========================================================================

	/** Insert text at current cursor position */
	insertTextAtCursor(_text: string): void {}

	/** Get current cursor position */
	getCursor(): { line: number; col: number } {
		return { line: 0, col: 0 };
	}

	/**
	 * Get text with any markers expanded (e.g., paste markers).
	 * Falls back to getText() if not implemented.
	 */
	getExpandedText(): string {
		return this.getText();
	}

	// =========================================================================
	// Autocomplete support (optional)
	// =========================================================================

	/** Set the autocomplete provider */
	setAutocompleteProvider(_provider: AutocompleteProvider): void {}

	// =========================================================================
	// Appearance (optional)
	// =========================================================================

	/** Border color function */
	get borderColor(): (str: string) => string {
		return this._borderColor;
	}

	set borderColor(value: (str: string) => string) {
		this._borderColor = value;
	}

	/** Get horizontal padding */
	getPaddingX(): number {
		return 0;
	}

	/** Set horizontal padding */
	setPaddingX(_padding: number): void {}

	/** Get max visible items in autocomplete dropdown */
	getAutocompleteMaxVisible(): number {
		return 5;
	}

	/** Set max visible items in autocomplete dropdown */
	setAutocompleteMaxVisible(_maxVisible: number): void {}
}

/** Adapter wrapping a plain EditorComponentLike object literal into an EditorComponent subclass. */
export class FunctionalEditorComponent extends EditorComponent {
	readonly raw: EditorComponentLike;

	constructor(raw: EditorComponentLike) {
		super();
		this.raw = raw;
		this.wantsKeyRelease = raw.wantsKeyRelease === true;
	}

	override render(width: number): string[] {
		return this.raw.render(width);
	}

	override handleInput(data: string): void {
		this.raw.handleInput(data);
	}

	override canHandleInput(): boolean {
		return true;
	}

	override handleMouse(event: Parameters<Component["handleMouse"]>[0]): ReturnType<Component["handleMouse"]> {
		return this.raw.handleMouse?.(event);
	}

	override get capturesViewportInput(): boolean {
		return this.raw.capturesViewportInput === true;
	}

	override isFocusableComponent(): boolean {
		return "focused" in this.raw;
	}

	override get focused(): boolean {
		return this.raw.focused === true;
	}

	override set focused(value: boolean) {
		if ("focused" in this.raw) {
			this.raw.focused = value;
		}
	}

	override invalidate(): void {
		this.raw.invalidate?.();
	}

	override dispose(): void {
		this.raw.dispose?.();
	}

	override getText(): string {
		return this.raw.getText();
	}

	override setText(text: string): void {
		this.raw.setText(text);
	}

	override get onSubmit(): ((text: string) => void) | undefined {
		return this.raw.onSubmit;
	}

	override set onSubmit(value: ((text: string) => void) | undefined) {
		this.raw.onSubmit = value;
	}

	override get onChange(): ((text: string) => void) | undefined {
		return this.raw.onChange;
	}

	override set onChange(value: ((text: string) => void) | undefined) {
		this.raw.onChange = value;
	}

	override addToHistory(text: string): void {
		this.raw.addToHistory?.(text);
	}

	override insertTextAtCursor(text: string): void {
		this.raw.insertTextAtCursor?.(text);
	}

	override getCursor(): { line: number; col: number } {
		return this.raw.getCursor ? this.raw.getCursor() : super.getCursor();
	}

	override getExpandedText(): string {
		return this.raw.getExpandedText ? this.raw.getExpandedText() : this.raw.getText();
	}

	override setAutocompleteProvider(provider: AutocompleteProvider): void {
		this.raw.setAutocompleteProvider?.(provider);
	}

	override get borderColor(): (str: string) => string {
		return this.raw.borderColor ?? super.borderColor;
	}

	override set borderColor(value: (str: string) => string) {
		this.raw.borderColor = value;
	}

	override getPaddingX(): number {
		return this.raw.getPaddingX ? this.raw.getPaddingX() : 0;
	}

	override setPaddingX(padding: number): void {
		this.raw.setPaddingX?.(padding);
	}

	override getAutocompleteMaxVisible(): number {
		return this.raw.getAutocompleteMaxVisible ? this.raw.getAutocompleteMaxVisible() : 5;
	}

	override setAutocompleteMaxVisible(maxVisible: number): void {
		this.raw.setAutocompleteMaxVisible?.(maxVisible);
	}
}

/** Normalize an EditorComponent subclass or EditorComponentLike object into an EditorComponent instance. */
export function toEditorComponent(editor: EditorComponent | EditorComponentLike): EditorComponent {
	if (editor instanceof EditorComponent) {
		return editor;
	}
	return new FunctionalEditorComponent(editor);
}
