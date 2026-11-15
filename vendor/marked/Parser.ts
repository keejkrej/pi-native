import { _Renderer } from './Renderer.ts';
import { _TextRenderer } from './TextRenderer.ts';
import { _defaults } from './defaults.ts';
import type { MarkedToken, Token, Tokens } from './Tokens.ts';
import type { MarkedCoreOptions, MarkedExtensionsConfig, MarkedOptions } from './MarkedOptions.ts';

/**
 * Parsing & Compiling
 */
export class _Parser {
  options: MarkedCoreOptions;
  extensions: MarkedExtensionsConfig | null;
  renderer: _Renderer;
  textRenderer: _TextRenderer;
  constructor(options?: MarkedOptions) {
    const opts = options || _defaults;
    this.options = {
      async: opts.async,
      breaks: opts.breaks,
      gfm: opts.gfm,
      pedantic: opts.pedantic,
      silent: opts.silent,
    };
    this.extensions = opts.extensions ?? null;
    this.renderer = opts.renderer || new _Renderer(opts);
    this.renderer.options = this.options;
    this.renderer.parser = this;
    this.textRenderer = new _TextRenderer();
  }

  /**
   * Static Parse Method
   */
  static parse(tokens: Token[], options?: MarkedOptions) {
    const parser = new _Parser(options);
    return parser.parse(tokens);
  }

  /**
   * Static Parse Inline Method
   */
  static parseInline(tokens: Token[], options?: MarkedOptions) {
    const parser = new _Parser(options);
    return parser.parseInline(tokens);
  }

  /**
   * Parse Loop
   */
  parse(tokens: Token[]): string {
    this.renderer.parser = this;
    let out = '';

    for (let i = 0; i < tokens.length; i++) {
      const anyToken = tokens[i];

      // Run any renderer extensions
      const extRenderer = this.extensions?.renderers?.[anyToken.type];
      if (extRenderer) {
        const genericToken = anyToken as Tokens.Generic;
        const ret = extRenderer.call({ parser: this }, genericToken);
        if (ret !== false || !['space', 'hr', 'heading', 'code', 'table', 'blockquote', 'list', 'checkbox', 'html', 'def', 'paragraph', 'text'].includes(genericToken.type)) {
          out += ret || '';
          continue;
        }
      }

      const token = anyToken as MarkedToken;

      switch (token.type) {
        case 'space': {
          out += this.renderer.space(token as Tokens.Space);
          break;
        }
        case 'hr': {
          out += this.renderer.hr(token as Tokens.Hr);
          break;
        }
        case 'heading': {
          out += this.renderer.heading(token as Tokens.Heading);
          break;
        }
        case 'code': {
          out += this.renderer.code(token as Tokens.Code);
          break;
        }
        case 'table': {
          out += this.renderer.table(token as Tokens.Table);
          break;
        }
        case 'blockquote': {
          out += this.renderer.blockquote(token as Tokens.Blockquote);
          break;
        }
        case 'list': {
          out += this.renderer.list(token as Tokens.List);
          break;
        }
        case 'checkbox': {
          out += this.renderer.checkbox(token as Tokens.Checkbox);
          break;
        }
        case 'html': {
          out += this.renderer.html(token as Tokens.HTML | Tokens.Tag);
          break;
        }
        case 'def': {
          out += this.renderer.def(token as Tokens.Def);
          break;
        }
        case 'paragraph': {
          out += this.renderer.paragraph(token as Tokens.Paragraph);
          break;
        }
        case 'text': {
          out += this.renderer.text(token as Tokens.Text);
          break;
        }

        default: {
          const errMsg = 'Token with "' + token.type + '" type was not found.';
          if (this.options.silent) {
            console.error(errMsg);
            return '';
          } else {
            throw new Error(errMsg);
          }
        }
      }
    }

    return out;
  }

  /**
   * Parse Inline Tokens
   */
  parseInline(tokens: Token[], renderer: _Renderer | _TextRenderer = this.renderer): string {
    this.renderer.parser = this;
    let out = '';

    for (let i = 0; i < tokens.length; i++) {
      const anyToken = tokens[i];

      // Run any renderer extensions
      const extRenderer = this.extensions?.renderers?.[anyToken.type];
      if (extRenderer) {
        const ret = extRenderer.call({ parser: this }, anyToken as Tokens.Generic);
        if (ret !== false || !['escape', 'html', 'link', 'image', 'checkbox', 'strong', 'em', 'codespan', 'br', 'del', 'text'].includes(anyToken.type)) {
          out += ret || '';
          continue;
        }
      }

      const token = anyToken as MarkedToken;

      switch (token.type) {
        case 'escape': {
          out += renderer.text(token as Tokens.Escape);
          break;
        }
        case 'html': {
          out += renderer.html(token as Tokens.HTML | Tokens.Tag);
          break;
        }
        case 'link': {
          out += renderer.link(token as Tokens.Link);
          break;
        }
        case 'image': {
          out += renderer.image(token as Tokens.Image);
          break;
        }
        case 'checkbox': {
          out += renderer.checkbox(token as Tokens.Checkbox);
          break;
        }
        case 'strong': {
          out += renderer.strong(token as Tokens.Strong);
          break;
        }
        case 'em': {
          out += renderer.em(token as Tokens.Em);
          break;
        }
        case 'codespan': {
          out += renderer.codespan(token as Tokens.Codespan);
          break;
        }
        case 'br': {
          out += renderer.br(token as Tokens.Br);
          break;
        }
        case 'del': {
          out += renderer.del(token as Tokens.Del);
          break;
        }
        case 'text': {
          out += renderer.text(token as Tokens.Text);
          break;
        }
        default: {
          const errMsg = 'Token with "' + token.type + '" type was not found.';
          if (this.options.silent) {
            console.error(errMsg);
            return '';
          } else {
            throw new Error(errMsg);
          }
        }
      }
    }
    return out;
  }
}
