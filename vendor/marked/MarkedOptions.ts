import type { Links, Token, Tokens } from "./Tokens.ts";
import type { _Parser } from "./Parser.ts";
import type { _Lexer } from "./Lexer.ts";
import type { _Renderer } from "./Renderer.ts";
import type { _Tokenizer } from "./Tokenizer.ts";
import type { _Hooks } from "./Hooks.ts";

export interface TokenizerThis {
	lexer: _Lexer;
}

export type TokenizerExtensionFunction = (
	this: TokenizerThis,
	src: string,
	tokens: Token[],
) => Tokens.Generic | undefined;

export type TokenizerStartFunction = (this: TokenizerThis, src: string) => number | void;

export interface TokenizerExtension {
	name: string;
	level: "block" | "inline";
	start?: TokenizerStartFunction;
	tokenizer: TokenizerExtensionFunction;
	childTokens?: string[];
}

export interface RendererThis {
	parser: _Parser;
}

export type RendererExtensionFunction = (
	this: RendererThis,
	token: Tokens.Generic,
) => string | false | undefined;

export interface RendererExtension {
	name: string;
	renderer: RendererExtensionFunction;
}

export type TokenizerAndRendererExtension =
	| TokenizerExtension
	| RendererExtension
	| (TokenizerExtension & RendererExtension);

export interface HooksObject {
	preprocess?: (this: _Hooks, markdown: string) => string | Promise<string>;
	postprocess?: (this: _Hooks, html: string) => string | Promise<string>;
	processAllTokens?: (this: _Hooks, tokens: Token[]) => Token[] | Promise<Token[]>;
	emStrongMask?: (this: _Hooks, src: string) => string;
}

export interface RendererObject {
	space?: (this: _Renderer, token: Tokens.Space) => string | false;
	code?: (this: _Renderer, token: Tokens.Code) => string | false;
	blockquote?: (this: _Renderer, token: Tokens.Blockquote) => string | false;
	html?: (this: _Renderer, token: Tokens.HTML | Tokens.Tag) => string | false;
	def?: (this: _Renderer, token: Tokens.Def) => string | false;
	heading?: (this: _Renderer, token: Tokens.Heading) => string | false;
	hr?: (this: _Renderer, token: Tokens.Hr) => string | false;
	list?: (this: _Renderer, token: Tokens.List) => string | false;
	listitem?: (this: _Renderer, item: Tokens.ListItem) => string | false;
	checkbox?: (this: _Renderer, token: Tokens.Checkbox) => string | false;
	paragraph?: (this: _Renderer, token: Tokens.Paragraph) => string | false;
	table?: (this: _Renderer, token: Tokens.Table) => string | false;
	tablerow?: (this: _Renderer, token: Tokens.TableRow) => string | false;
	tablecell?: (this: _Renderer, token: Tokens.TableCell) => string | false;
	strong?: (this: _Renderer, token: Tokens.Strong) => string | false;
	em?: (this: _Renderer, token: Tokens.Em) => string | false;
	codespan?: (this: _Renderer, token: Tokens.Codespan) => string | false;
	br?: (this: _Renderer, token: Tokens.Br) => string | false;
	del?: (this: _Renderer, token: Tokens.Del) => string | false;
	link?: (this: _Renderer, token: Tokens.Link) => string | false;
	image?: (this: _Renderer, token: Tokens.Image) => string | false;
	text?: (this: _Renderer, token: Tokens.Text | Tokens.Escape) => string | false;
}

export interface TokenizerObject {
	space?: (this: _Tokenizer, src: string) => Tokens.Space | false | undefined;
	code?: (this: _Tokenizer, src: string) => Tokens.Code | false | undefined;
	fences?: (this: _Tokenizer, src: string) => Tokens.Code | false | undefined;
	heading?: (this: _Tokenizer, src: string) => Tokens.Heading | false | undefined;
	hr?: (this: _Tokenizer, src: string) => Tokens.Hr | false | undefined;
	blockquote?: (this: _Tokenizer, src: string) => Tokens.Blockquote | false | undefined;
	list?: (this: _Tokenizer, src: string) => Tokens.List | false | undefined;
	html?: (this: _Tokenizer, src: string) => Tokens.HTML | false | undefined;
	def?: (this: _Tokenizer, src: string) => Tokens.Def | false | undefined;
	table?: (this: _Tokenizer, src: string) => Tokens.Table | false | undefined;
	lheading?: (this: _Tokenizer, src: string) => Tokens.Heading | false | undefined;
	paragraph?: (this: _Tokenizer, src: string) => Tokens.Paragraph | false | undefined;
	text?: (this: _Tokenizer, src: string) => Tokens.Text | false | undefined;
	escape?: (this: _Tokenizer, src: string) => Tokens.Escape | false | undefined;
	tag?: (this: _Tokenizer, src: string) => Tokens.Tag | false | undefined;
	link?: (this: _Tokenizer, src: string) => Tokens.Link | Tokens.Image | false | undefined;
	reflink?: (this: _Tokenizer, src: string, links: Links) => Tokens.Link | Tokens.Image | Tokens.Text | false | undefined;
	emStrong?: (this: _Tokenizer, src: string, maskedSrc: string, prevChar: string) => Tokens.Em | Tokens.Strong | false | undefined;
	codespan?: (this: _Tokenizer, src: string) => Tokens.Codespan | false | undefined;
	br?: (this: _Tokenizer, src: string) => Tokens.Br | false | undefined;
	del?: (this: _Tokenizer, src: string, maskedSrc: string, prevChar: string) => Tokens.Del | false | undefined;
	autolink?: (this: _Tokenizer, src: string) => Tokens.Link | false | undefined;
	url?: (this: _Tokenizer, src: string) => Tokens.Link | false | undefined;
	inlineText?: (this: _Tokenizer, src: string) => Tokens.Text | false | undefined;
}

export interface MarkedCoreOptions {
	async?: boolean;
	breaks?: boolean;
	gfm?: boolean;
	pedantic?: boolean;
	silent?: boolean;
}

export interface MarkedExtensionsConfig {
	renderers: {
		[name: string]: RendererExtensionFunction;
	};
	childTokens: {
		[name: string]: string[];
	};
	inline?: TokenizerExtensionFunction[];
	block?: TokenizerExtensionFunction[];
	startInline?: TokenizerStartFunction[];
	startBlock?: TokenizerStartFunction[];
}

export interface MarkedExtension extends MarkedCoreOptions {
	extensions?: TokenizerAndRendererExtension[] | null;
	hooks?: HooksObject | null;
	renderer?: RendererObject | null;
	tokenizer?: TokenizerObject | null;
	walkTokens?: ((token: Token) => void | Promise<void>) | null;
}

export interface MarkedOptions extends MarkedCoreOptions {
	hooks?: _Hooks | null;
	renderer?: _Renderer | null;
	tokenizer?: _Tokenizer | null;
	extensions?: MarkedExtensionsConfig | null;
	walkTokens?: null | ((token: Token) => void | Promise<void> | (void | Promise<void>)[]);
}
