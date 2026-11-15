import { _defaults } from './defaults.ts';
import { _Lexer } from './Lexer.ts';
import { _Parser } from './Parser.ts';
import type { HooksObject, MarkedCoreOptions, MarkedOptions } from './MarkedOptions.ts';
import type { Token } from './Tokens.ts';

export class _Hooks {
  options: MarkedCoreOptions;
  block?: boolean;
  override: HooksObject = {};

  constructor(options?: MarkedOptions) {
    const opts = options || _defaults;
    this.options = {
      async: opts.async,
      breaks: opts.breaks,
      gfm: opts.gfm,
      pedantic: opts.pedantic,
      silent: opts.silent,
    };
  }

  static passThroughHooks = new Set([
    'preprocess',
    'postprocess',
    'processAllTokens',
    'emStrongMask',
  ]);

  static passThroughHooksRespectAsync = new Set([
    'preprocess',
    'postprocess',
    'processAllTokens',
  ]);

  /**
   * Process markdown before marked
   */
  preprocess(markdown: string): string | Promise<string> {
    if (this.override.preprocess) {
      return this.override.preprocess.call(this, markdown);
    }
    return markdown;
  }

  /**
   * Process HTML after marked is finished
   */
  postprocess(html: string): string | Promise<string> {
    if (this.override.postprocess) {
      return this.override.postprocess.call(this, html);
    }
    return html;
  }

  /**
   * Process all tokens before walk tokens
   */
  processAllTokens(tokens: Token[]): Token[] | Promise<Token[]> {
    if (this.override.processAllTokens) {
      return this.override.processAllTokens.call(this, tokens);
    }
    return tokens;
  }

  /**
   * Mask contents that should not be interpreted as em/strong delimiters
   */
  emStrongMask(src: string): string {
    if (this.override.emStrongMask) {
      return this.override.emStrongMask.call(this, src);
    }
    return src;
  }

  /**
   * Provide function to tokenize markdown
   */
  provideLexer(block = this.block) {
    return block ? _Lexer.lex : _Lexer.lexInline;
  }

  /**
   * Provide function to parse tokens
   */
  provideParser(block = this.block) {
    return block ? _Parser.parse : _Parser.parseInline;
  }
}
