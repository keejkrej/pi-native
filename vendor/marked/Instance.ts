import { _getDefaults } from './defaults.ts';
import { _Lexer } from './Lexer.ts';
import { _Parser } from './Parser.ts';
import { _Hooks } from './Hooks.ts';
import { _Renderer } from './Renderer.ts';
import { _Tokenizer } from './Tokenizer.ts';
import { _TextRenderer } from './TextRenderer.ts';
import { escapeHtmlEntities } from './helpers.ts';
import type {
  HooksObject,
  MarkedExtension,
  MarkedExtensionsConfig,
  MarkedOptions,
  TokenizerObject,
} from './MarkedOptions.ts';
import type { Token, Tokens, TokensList } from './Tokens.ts';

export type MaybePromise = void | Promise<void>;

export class Marked {
  defaults: MarkedOptions = _getDefaults();
  options = this.setOptions;

  Parser = _Parser;
  Renderer = _Renderer;
  TextRenderer = _TextRenderer;
  Lexer = _Lexer;
  Tokenizer = _Tokenizer;
  Hooks = _Hooks;

  constructor(...args: MarkedExtension[]) {
    this.use(...args);
  }

  /**
   * Compiles markdown to HTML.
   *
   * To configure hooks, a renderer, or a tokenizer, create a separate `Marked`
   * instance and use `Marked#use` instead of passing them on each call.
   */
  parse(src: string, options: MarkedOptions & { async: true }): Promise<string>;
  parse(src: string, options: MarkedOptions & { async: false }): string;
  parse(src: string, options?: MarkedOptions | null): string | Promise<string>;
  parse(src: string, options?: MarkedOptions | null): string | Promise<string> {
    return this.runParse(true, src, options);
  }

  /**
   * Compiles inline markdown to HTML.
   *
   * To configure hooks, a renderer, or a tokenizer, create a separate `Marked`
   * instance and use `Marked#use` instead of passing them on each call.
   */
  parseInline(src: string, options: MarkedOptions & { async: true }): Promise<string>;
  parseInline(src: string, options: MarkedOptions & { async: false }): string;
  parseInline(src: string, options?: MarkedOptions | null): string | Promise<string>;
  parseInline(src: string, options?: MarkedOptions | null): string | Promise<string> {
    return this.runParse(false, src, options);
  }

  /**
   * Run callback for every token
   */
  walkTokens(tokens: Token[] | TokensList, callback: (token: Token) => MaybePromise | MaybePromise[]) {
    let values: MaybePromise[] = [];
    for (const token of tokens) {
      values = values.concat(callback.call(this, token));
      switch (token.type) {
        case 'table': {
          const tableToken = token as Tokens.Table;
          for (const cell of tableToken.header) {
            values = values.concat(this.walkTokens(cell.tokens, callback));
          }
          for (const row of tableToken.rows) {
            for (const cell of row) {
              values = values.concat(this.walkTokens(cell.tokens, callback));
            }
          }
          break;
        }
        case 'list': {
          const listToken = token as Tokens.List;
          values = values.concat(this.walkTokens(listToken.items, callback));
          break;
        }
        default: {
          const genericToken = token as Tokens.Generic;
          const childNames = this.defaults.extensions?.childTokens?.[genericToken.type];
          if (childNames) {
            for (const childTokens of childNames) {
              const childVal = genericToken[childTokens];
              if (Array.isArray(childVal)) {
                const flat: Token[] = [];
                for (const entry of childVal) {
                  if (Array.isArray(entry)) {
                    for (const sub of entry) {
                      flat.push(sub as Token);
                    }
                  } else {
                    flat.push(entry as Token);
                  }
                }
                values = values.concat(this.walkTokens(flat, callback));
              }
            }
          } else if (genericToken.tokens) {
            values = values.concat(this.walkTokens(genericToken.tokens, callback));
          }
        }
      }
    }
    return values;
  }

  /**
   * Registers extensions with this Marked instance.
   *
   * The `renderer`, `tokenizer`, and `hooks` objects may each contain only the
   * methods that should be overridden. Their methods are merged with built-in
   * behavior and extensions registered by earlier calls.
   *
   * Use this method when supplying only some hook methods.
   */
  use(...args: MarkedExtension[]) {
    const extensions: MarkedExtensionsConfig = this.defaults.extensions || { renderers: {}, childTokens: {} };

    args.forEach((pack) => {
      // copy options to new object
      const opts: MarkedOptions = {
        async: this.defaults.async || pack.async || false,
        breaks: pack.breaks ?? this.defaults.breaks,
        gfm: pack.gfm ?? this.defaults.gfm,
        pedantic: pack.pedantic ?? this.defaults.pedantic,
        silent: pack.silent ?? this.defaults.silent,
      };

      // ==-- Parse "addon" extensions --== //
      if (pack.extensions) {
        pack.extensions.forEach((ext) => {
          if (!ext.name) {
            throw new Error('extension name required');
          }
          if ('renderer' in ext) { // Renderer extensions
            const prevRenderer = extensions.renderers[ext.name];
            if (prevRenderer) {
              // Replace extension with func to run new extension but fall back if false
              extensions.renderers[ext.name] = function(token: Tokens.Generic) {
                let ret = ext.renderer.call(this, token);
                if (ret === false) {
                  ret = prevRenderer.call(this, token);
                }
                return ret;
              };
            } else {
              extensions.renderers[ext.name] = ext.renderer;
            }
          }
          if ('tokenizer' in ext) { // Tokenizer Extensions
            if (!ext.level || (ext.level !== 'block' && ext.level !== 'inline')) {
              throw new Error("extension level must be 'block' or 'inline'");
            }
            const extLevel = extensions[ext.level];
            if (extLevel) {
              extLevel.unshift(ext.tokenizer);
            } else {
              extensions[ext.level] = [ext.tokenizer];
            }
            if (ext.start) { // Function to check for start of token
              if (ext.level === 'block') {
                if (extensions.startBlock) {
                  extensions.startBlock.push(ext.start);
                } else {
                  extensions.startBlock = [ext.start];
                }
              } else if (ext.level === 'inline') {
                if (extensions.startInline) {
                  extensions.startInline.push(ext.start);
                } else {
                  extensions.startInline = [ext.start];
                }
              }
            }
          }
          if ('childTokens' in ext && ext.childTokens) { // Child tokens to be visited by walkTokens
            extensions.childTokens[ext.name] = ext.childTokens;
          }
        });
        opts.extensions = extensions;
      }

      // ==-- Parse "overwrite" extensions --== //
      if (pack.renderer) {
        const rendererKeys = Object.keys(pack.renderer);
        if (rendererKeys.length > 0) {
          throw new Error(`Unsupported renderer override '${rendererKeys[0]}' in vendored marked`);
        }
      }
      if (pack.tokenizer) {
        const tokenizer = this.defaults.tokenizer || new _Tokenizer(this.defaults);
        const packTok = pack.tokenizer;
        const supported = new Set(['emStrong', 'del', 'url']);
        for (const prop of Object.keys(packTok)) {
          if (!supported.has(prop)) {
            throw new Error(`Unsupported tokenizer override '${prop}' in vendored marked`);
          }
        }
        if (packTok.emStrong) {
          const fn = packTok.emStrong;
          const prev = tokenizer.override.emStrong;
          tokenizer.override.emStrong = prev
            ? function(this: _Tokenizer, src: string, maskedSrc: string, prevChar: string) {
                const ret = fn.call(this, src, maskedSrc, prevChar);
                return ret === false ? prev.call(this, src, maskedSrc, prevChar) : ret;
              }
            : fn;
        }
        if (packTok.del) {
          const fn = packTok.del;
          const prev = tokenizer.override.del;
          tokenizer.override.del = prev
            ? function(this: _Tokenizer, src: string, maskedSrc: string, prevChar: string) {
                const ret = fn.call(this, src, maskedSrc, prevChar);
                return ret === false ? prev.call(this, src, maskedSrc, prevChar) : ret;
              }
            : fn;
        }
        if (packTok.url) {
          const fn = packTok.url;
          const prev = tokenizer.override.url;
          tokenizer.override.url = prev
            ? function(this: _Tokenizer, src: string) {
                const ret = fn.call(this, src);
                return ret === false ? prev.call(this, src) : ret;
              }
            : fn;
        }
        opts.tokenizer = tokenizer;
      }

      // ==-- Parse Hooks extensions --== //
      if (pack.hooks) {
        const hooks = this.defaults.hooks || new _Hooks();
        const packHooks: HooksObject = pack.hooks;
        const supportedHooks = new Set(['preprocess', 'postprocess', 'processAllTokens', 'emStrongMask']);
        for (const prop of Object.keys(packHooks)) {
          if (!supportedHooks.has(prop)) {
            throw new Error(`Unsupported hook override '${prop}' in vendored marked`);
          }
        }
        if (packHooks.preprocess) {
          const fn = packHooks.preprocess;
          const prev = hooks.override.preprocess;
          hooks.override.preprocess = (arg: string) => {
            if (this.defaults.async) {
              return (async() => {
                const ret = await fn.call(hooks, arg);
                return prev ? await prev.call(hooks, ret) : ret;
              })();
            }
            const ret = fn.call(hooks, arg);
            if (prev) {
              return prev.call(hooks, ret as string);
            }
            return ret;
          };
        }
        if (packHooks.postprocess) {
          const fn = packHooks.postprocess;
          const prev = hooks.override.postprocess;
          hooks.override.postprocess = (arg: string) => {
            if (this.defaults.async) {
              return (async() => {
                const ret = await fn.call(hooks, arg);
                return prev ? await prev.call(hooks, ret) : ret;
              })();
            }
            const ret = fn.call(hooks, arg);
            if (prev) {
              return prev.call(hooks, ret as string);
            }
            return ret;
          };
        }
        if (packHooks.processAllTokens) {
          const fn = packHooks.processAllTokens;
          const prev = hooks.override.processAllTokens;
          hooks.override.processAllTokens = (arg: Token[]) => {
            if (this.defaults.async) {
              return (async() => {
                const ret = await fn.call(hooks, arg);
                return prev ? await prev.call(hooks, ret) : ret;
              })();
            }
            const ret = fn.call(hooks, arg);
            if (prev) {
              return prev.call(hooks, ret as Token[]);
            }
            return ret;
          };
        }
        if (packHooks.emStrongMask) {
          const fn = packHooks.emStrongMask;
          const prev = hooks.override.emStrongMask;
          hooks.override.emStrongMask = (arg: string) => {
            const ret = fn.call(hooks, arg);
            return prev ? prev.call(hooks, ret) : ret;
          };
        }
        opts.hooks = hooks;
      }

      // ==-- Parse WalkTokens extensions --== //
      if (pack.walkTokens) {
        const walkTokens = this.defaults.walkTokens;
        const packWalktokens = pack.walkTokens;
        opts.walkTokens = function(this: Marked, token: Token) {
          let values: MaybePromise[] = [];
          values.push(packWalktokens.call(this, token));
          if (walkTokens) {
            values = values.concat(walkTokens.call(this, token));
          }
          return values;
        };
      }

      this.defaults = { ...this.defaults, ...opts };
    });

    return this;
  }

  setOptions(opt: MarkedOptions) {
    this.defaults = { ...this.defaults, ...opt };
    return this;
  }

  lexer(src: string, options?: MarkedOptions) {
    return _Lexer.lex(src, options ?? this.defaults);
  }

  parser(tokens: Token[], options?: MarkedOptions) {
    return _Parser.parse(tokens, options ?? this.defaults);
  }

  private runParse(blockType: boolean, src: string, options?: MarkedOptions | null): string | Promise<string> {
    const origOpt: MarkedOptions = options ? { ...options } : {};
    const opt: MarkedOptions = { ...this.defaults, ...origOpt };

    const throwError = this.onError(!!opt.silent, !!opt.async);

    // throw error if an extension set async to true but parse was called with async: false
    if (this.defaults.async === true && origOpt.async === false) {
      return throwError(new Error('marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise.'));
    }

    // throw error in case of non string input
    if (typeof src === 'undefined' || src === null) {
      return throwError(new Error('marked(): input parameter is undefined or null'));
    }
    if (typeof src !== 'string') {
      return throwError(new Error('marked(): input parameter is of type '
        + Object.prototype.toString.call(src) + ', string expected'));
    }

    if (opt.hooks) {
      opt.hooks.options = {
        async: opt.async,
        breaks: opt.breaks,
        gfm: opt.gfm,
        pedantic: opt.pedantic,
        silent: opt.silent,
      };
      opt.hooks.block = blockType;
    }

    if (opt.async) {
      return (async() => {
        const processedSrc = opt.hooks ? await opt.hooks.preprocess(src) : src;
        const lexFn = opt.hooks ? opt.hooks.provideLexer(blockType) : (blockType ? _Lexer.lex : _Lexer.lexInline);
        const tokens = lexFn(processedSrc, opt);
        const processedTokens = opt.hooks ? await opt.hooks.processAllTokens(tokens) : tokens;
        if (opt.walkTokens) {
          await Promise.all(this.walkTokens(processedTokens, opt.walkTokens));
        }
        const parseFn = opt.hooks ? opt.hooks.provideParser(blockType) : (blockType ? _Parser.parse : _Parser.parseInline);
        const html = parseFn(processedTokens, opt);
        return opt.hooks ? await opt.hooks.postprocess(html) : html;
      })().catch(throwError);
    }

    try {
      if (opt.hooks) {
        src = opt.hooks.preprocess(src) as string;
      }
      const lexFn = opt.hooks ? opt.hooks.provideLexer(blockType) : (blockType ? _Lexer.lex : _Lexer.lexInline);
      let tokens = lexFn(src, opt);
      if (opt.hooks) {
        tokens = opt.hooks.processAllTokens(tokens) as Token[];
      }
      if (opt.walkTokens) {
        this.walkTokens(tokens, opt.walkTokens);
      }
      const parseFn = opt.hooks ? opt.hooks.provideParser(blockType) : (blockType ? _Parser.parse : _Parser.parseInline);
      let html = parseFn(tokens, opt);
      if (opt.hooks) {
        html = opt.hooks.postprocess(html) as string;
      }
      return html;
    } catch(e) {
      return throwError(e as Error);
    }
  }

  private onError(silent: boolean, async: boolean) {
    return (e: Error): string | Promise<string> => {
      e.message += '\nPlease report this to https://github.com/markedjs/marked.';

      if (silent) {
        const msg = '<p>An error occurred:</p><pre>'
          + escapeHtmlEntities(e.message + '', true)
          + '</pre>';
        if (async) {
          return Promise.resolve(msg);
        }
        return msg;
      }

      if (async) {
        return Promise.reject(e);
      }
      throw e;
    };
  }
}
