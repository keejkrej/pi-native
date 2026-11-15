import { _Lexer } from './Lexer.ts';
import { _Parser } from './Parser.ts';
import { _Tokenizer } from './Tokenizer.ts';
import { _Renderer } from './Renderer.ts';
import { _TextRenderer } from './TextRenderer.ts';
import { _Hooks } from './Hooks.ts';
import { Marked } from './Instance.ts';
import {
  _getDefaults,
  changeDefaults,
  _defaults,
} from './defaults.ts';
import type { MarkedExtension, MarkedOptions } from './MarkedOptions.ts';
import type { Token, TokensList } from './Tokens.ts';
import type { MaybePromise } from './Instance.ts';

const markedInstance = new Marked();

/**
 * Compiles markdown to HTML asynchronously.
 *
 * To configure hooks, a renderer, or a tokenizer, create a `Marked` instance
 * and use `Marked#use` instead of passing them as options on each call.
 *
 * @param src String of markdown source to be compiled
 * @param options Hash of options, having async: true
 * @return Promise of string of compiled HTML
 */
export function marked(src: string, options: MarkedOptions & { async: true }): Promise<string>;

/**
 * Compiles markdown to HTML.
 *
 * To configure hooks, a renderer, or a tokenizer, create a `Marked` instance
 * and use `Marked#use` instead of passing them as options on each call.
 *
 * @param src String of markdown source to be compiled
 * @param options Optional hash of options
 * @return String of compiled HTML. Will be a Promise of string if async is set to true by any extensions.
 */
export function marked(src: string, options: MarkedOptions & { async: false }): string;
export function marked(src: string, options?: MarkedOptions | null): string | Promise<string>;
export function marked(src: string, opt?: MarkedOptions | null): string | Promise<string> {
  return markedInstance.parse(src, opt);
}

export let defaults: MarkedOptions = _defaults;

/**
 * Sets the default options.
 *
 * @param options Hash of options
 */
export function setOptions(opt: MarkedOptions) {
  markedInstance.setOptions(opt);
  defaults = markedInstance.defaults;
  changeDefaults(defaults);
  return marked;
}

export const options = setOptions;

/**
 * Registers extensions with the default Marked instance.
 *
 * The `renderer`, `tokenizer`, and `hooks` objects may each contain only the
 * methods that should be overridden. Their methods are merged with built-in
 * behavior and extensions registered by earlier calls.
 *
 * Use this function when supplying only some hook methods.
 *
 * @param args Extensions to register
 * @return The `marked` function
 */
export function use(...args: MarkedExtension[]) {
  markedInstance.use(...args);
  defaults = markedInstance.defaults;
  changeDefaults(defaults);
  return marked;
}

/**
 * Run callback for every token
 */
export function walkTokens(tokens: Token[] | TokensList, callback: (token: Token) => MaybePromise | MaybePromise[]) {
  return markedInstance.walkTokens(tokens, callback);
}

/**
 * Compiles inline markdown to HTML.
 *
 * To configure hooks, a renderer, or a tokenizer, create a `Marked` instance
 * and use `Marked#use` instead of passing them as options on each call.
 *
 * @param src String of markdown source to be compiled
 * @param options Hash of options
 * @return String of compiled HTML
 */
export function parseInline(src: string, options: MarkedOptions & { async: true }): Promise<string>;
export function parseInline(src: string, options: MarkedOptions & { async: false }): string;
export function parseInline(src: string, options?: MarkedOptions | null): string | Promise<string>;
export function parseInline(src: string, opt?: MarkedOptions | null): string | Promise<string> {
  return markedInstance.parseInline(src, opt);
}

export const parse = marked;
export const parser = _Parser.parse;
export const lexer = _Lexer.lex;
export { _getDefaults as getDefaults } from './defaults.ts';
export { _Lexer as Lexer } from './Lexer.ts';
export { _Parser as Parser } from './Parser.ts';
export { _Tokenizer as Tokenizer } from './Tokenizer.ts';
export { _Renderer as Renderer } from './Renderer.ts';
export { _TextRenderer as TextRenderer } from './TextRenderer.ts';
export { _Hooks as Hooks } from './Hooks.ts';
export { Marked } from './Instance.ts';
export { getTokensLinks, setTokensLinks } from './Tokens.ts';
export type * from './MarkedOptions.ts';
export type * from './Tokens.ts';
