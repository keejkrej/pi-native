import { _Tokenizer } from './Tokenizer.ts';
import { _defaults } from './defaults.ts';
import { other, block, inline } from './rules.ts';
import { type Links, setTokensLinks, type Token, type Tokens } from './Tokens.ts';
import type { MarkedCoreOptions, MarkedExtensionsConfig, MarkedOptions } from './MarkedOptions.ts';
import type { _Hooks } from './Hooks.ts';

/**
 * Block Lexer
 */
export class _Lexer {
  tokens: Token[];
  links: Links;
  options: MarkedCoreOptions;
  extensions: MarkedExtensionsConfig | null;
  hooks: _Hooks | null;
  state: {
    inLink: boolean;
    inRawBlock: boolean;
    /** a link was produced in the inline run currently being scanned */
    linkEmitted: boolean;
    top: boolean;
  };

  public inlineQueue: { src: string, tokens: Token[] }[];

  private tokenizer: _Tokenizer;

  constructor(options?: MarkedOptions) {
    // TokenList cannot be created in one go
    this.tokens = [];
    this.links = {};
    setTokensLinks(this.tokens, this.links);
    const opts = options || _defaults;
    this.options = {
      async: opts.async,
      breaks: opts.breaks,
      gfm: opts.gfm,
      pedantic: opts.pedantic,
      silent: opts.silent,
    };
    this.extensions = opts.extensions ?? null;
    this.hooks = opts.hooks ?? null;
    this.tokenizer = opts.tokenizer || new _Tokenizer(opts);
    this.tokenizer.options = this.options;
    this.tokenizer.lexer = this;
    this.inlineQueue = [];
    this.state = {
      inLink: false,
      inRawBlock: false,
      linkEmitted: false,
      top: true,
    };

    const rules = {
      other,
      block: block.normal,
      inline: inline.normal,
    };

    if (this.options.pedantic) {
      rules.block = block.pedantic;
      rules.inline = inline.pedantic;
    } else if (this.options.gfm) {
      rules.block = block.gfm;
      if (this.options.breaks) {
        rules.inline = inline.breaks;
      } else {
        rules.inline = inline.gfm;
      }
    }
    this.tokenizer.rules = rules;
  }

  /**
   * Expose Rules
   */
  static get rules() {
    return {
      block,
      inline,
    };
  }

  /**
   * Static Lex Method
   */
  static lex(src: string, options?: MarkedOptions) {
    const lexer = new _Lexer(options);
    return lexer.lex(src);
  }

  /**
   * Static Lex Inline Method
   */
  static lexInline(src: string, options?: MarkedOptions) {
    const lexer = new _Lexer(options);
    return lexer.inlineTokens(src);
  }

  /**
   * Preprocessing
   */
  lex(src: string) {
    src = src.replace(other.carriageReturn, '\n');

    this.blockTokens(src, this.tokens);

    for (let i = 0; i < this.inlineQueue.length; i++) {
      const next = this.inlineQueue[i];
      this.inlineTokens(next.src, next.tokens);
    }
    this.inlineQueue = [];

    return this.tokens;
  }

  /**
   * Lexing
   */
  blockTokens(src: string, tokens: Token[] = [], lastParagraphClipped = false): Token[] {
    this.tokenizer.lexer = this;
    if (this.options.pedantic) {
      src = src.replace(other.tabCharGlobal, '    ').replace(other.spaceLine, '');
    }

    let srcLength = Infinity;
    while (src) {
      if (src.length < srcLength) {
        srcLength = src.length;
      } else {
        this.infiniteLoopError(src.charCodeAt(0));
        break;
      }

      let extToken: Tokens.Generic | undefined;

      if (this.extensions?.block?.some((extTokenizer) => {
        if (extToken = extTokenizer.call({ lexer: this }, src, tokens)) {
          src = src.substring(extToken.raw.length);
          tokens.push(extToken);
          return true;
        }
        return false;
      })) {
        continue;
      }

      // newline
      const spaceTok = this.tokenizer.space(src);
      if (spaceTok) {
        src = src.substring(spaceTok.raw.length);
        const lastToken = tokens.at(-1);
        if (spaceTok.raw.length === 1 && lastToken !== undefined) {
          // if there's a single \n as a spacer, it's terminating the last line,
          // so move it there so that we don't get unnecessary paragraph tags
          lastToken.raw = lastToken.raw + '\n';
        } else {
          tokens.push(spaceTok);
        }
        continue;
      }

      // code
      const codeTok = this.tokenizer.code(src);
      if (codeTok) {
        src = src.substring(codeTok.raw.length);
        const lastToken = tokens.at(-1);
        // An indented code block cannot interrupt a paragraph.
        if (lastToken?.type === 'paragraph') {
          const prev = lastToken as Tokens.Paragraph;
          prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + codeTok.raw;
          prev.text += '\n' + codeTok.text;
          this.inlineQueue.at(-1)!.src = prev.text;
        } else if (lastToken?.type === 'text') {
          const prev = lastToken as Tokens.Text;
          prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + codeTok.raw;
          prev.text += '\n' + codeTok.text;
          this.inlineQueue.at(-1)!.src = prev.text;
        } else {
          tokens.push(codeTok);
        }
        continue;
      }

      // fences
      const fencesTok = this.tokenizer.fences(src);
      if (fencesTok) {
        src = src.substring(fencesTok.raw.length);
        tokens.push(fencesTok);
        continue;
      }

      // heading
      const headingTok = this.tokenizer.heading(src);
      if (headingTok) {
        src = src.substring(headingTok.raw.length);
        tokens.push(headingTok);
        continue;
      }

      // hr
      const hrTok = this.tokenizer.hr(src);
      if (hrTok) {
        src = src.substring(hrTok.raw.length);
        tokens.push(hrTok);
        continue;
      }

      // blockquote
      const blockquoteTok = this.tokenizer.blockquote(src);
      if (blockquoteTok) {
        src = src.substring(blockquoteTok.raw.length);
        tokens.push(blockquoteTok);
        continue;
      }

      // list
      const listTok = this.tokenizer.list(src);
      if (listTok) {
        src = src.substring(listTok.raw.length);
        tokens.push(listTok);
        continue;
      }

      // html
      const htmlTok = this.tokenizer.html(src);
      if (htmlTok) {
        src = src.substring(htmlTok.raw.length);
        tokens.push(htmlTok);
        continue;
      }

      // def
      const defTok = this.tokenizer.def(src);
      if (defTok) {
        src = src.substring(defTok.raw.length);
        const lastToken = tokens.at(-1);
        if (lastToken?.type === 'paragraph') {
          const prev = lastToken as Tokens.Paragraph;
          prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + defTok.raw;
          prev.text += '\n' + defTok.raw;
          this.inlineQueue.at(-1)!.src = prev.text;
        } else if (lastToken?.type === 'text') {
          const prev = lastToken as Tokens.Text;
          prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + defTok.raw;
          prev.text += '\n' + defTok.raw;
          this.inlineQueue.at(-1)!.src = prev.text;
        } else if (!Object.hasOwn(this.links, defTok.tag)) {
          this.links[defTok.tag] = {
            href: defTok.href,
            title: defTok.title,
          };
          tokens.push(defTok);
        }
        continue;
      }

      // table (gfm)
      const tableTok = this.tokenizer.table(src);
      if (tableTok) {
        src = src.substring(tableTok.raw.length);
        tokens.push(tableTok);
        continue;
      }

      // lheading
      const lheadingTok = this.tokenizer.lheading(src);
      if (lheadingTok) {
        src = src.substring(lheadingTok.raw.length);
        tokens.push(lheadingTok);
        continue;
      }

      // top-level paragraph
      // prevent paragraph consuming extensions by clipping 'src' to extension start
      let cutSrc = src;
      if (this.extensions?.startBlock) {
        let startIndex = Infinity;
        const tempSrc = src.slice(1);
        let tempStart;
        this.extensions.startBlock.forEach((getStartIndex) => {
          tempStart = getStartIndex.call({ lexer: this }, tempSrc);
          if (typeof tempStart === 'number' && tempStart >= 0) {
            startIndex = Math.min(startIndex, tempStart);
          }
        });
        if (startIndex < Infinity && startIndex >= 0) {
          cutSrc = src.substring(0, startIndex + 1);
        }
      }
      const paraTok = this.state.top ? this.tokenizer.paragraph(cutSrc) : undefined;
      if (paraTok) {
        const lastToken = tokens.at(-1);
        if (lastParagraphClipped && lastToken?.type === 'paragraph') {
          const prev = lastToken as Tokens.Paragraph;
          prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + paraTok.raw;
          prev.text += '\n' + paraTok.text;
          this.inlineQueue.pop();
          this.inlineQueue.at(-1)!.src = prev.text;
        } else {
          tokens.push(paraTok);
        }
        lastParagraphClipped = cutSrc.length !== src.length;
        src = src.substring(paraTok.raw.length);
        continue;
      }

      // text
      const textTok = this.tokenizer.text(src);
      if (textTok) {
        src = src.substring(textTok.raw.length);
        const lastToken = tokens.at(-1);
        if (lastToken?.type === 'text') {
          const prev = lastToken as Tokens.Text;
          prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + textTok.raw;
          prev.text += '\n' + textTok.text;
          this.inlineQueue.pop();
          this.inlineQueue.at(-1)!.src = prev.text;
        } else {
          tokens.push(textTok);
        }
        continue;
      }

      if (src) {
        this.infiniteLoopError(src.charCodeAt(0));
        break;
      }
    }

    this.state.top = true;
    return tokens;
  }

  inline(src: string, tokens: Token[] = []) {
    this.inlineQueue.push({ src, tokens });
    return tokens;
  }

  /**
   * Does this link text hold a link already? An image does not count: an image
   * may hold a link, a link may not.
   */
  private linkInText(text: string): boolean {
    if (!text.includes('[')) {
      return false;
    }

    const linkRule = this.tokenizer.rules.inline.link;
    for (const match of text.matchAll(this.tokenizer.rules.inline.blockSkip)) {
      // blockSkip also matches code spans and html, and the `!` of an image is
      // left out of the match, so read the character before it.
      if (linkRule.test(match[0]) && text.charAt(match.index - 1) !== '!') {
        return true;
      }
    }

    for (const match of text.matchAll(this.tokenizer.rules.inline.reflinkSearch)) {
      const match0 = match[0];
      const refStart = match0.lastIndexOf('[');
      if (match0.charAt(0) === '!' || !Object.hasOwn(this.links, match0.slice(refStart + 1, -1))) {
        continue;
      }
      // a candidate holding a link is not a link either, so it does not count
      if (refStart > 1 && this.linkInText(match0.slice(1, refStart - 1))) {
        continue;
      }
      return true;
    }

    return false;
  }

  /**
   * Lexing/Compiling
   */
  inlineTokens(src: string, tokens: Token[] = []): Token[] {
    this.tokenizer.lexer = this;
    // String with links masked to avoid interference with em and strong
    let maskedSrc = src;

    // Mask out reflinks
    if (src.includes('[')) {
      const reflinkSearch = this.tokenizer.rules.inline.reflinkSearch;
      const maskReflink = (match0: string): string => {
        const refStart = match0.lastIndexOf('[');
        if (!Object.hasOwn(this.links, match0.slice(refStart + 1, -1))) {
          return match0;
        }
        // CommonMark: "Links may not contain other links, at any level of
        // nesting." A candidate whose text already holds one never becomes a
        // link, so flattening the whole span would hide the emphasis that
        // does still apply inside it. Mask the links it holds instead.
        // Images are exempt: their text is flattened into an alt attribute.
        if (refStart > 1 && match0.charAt(0) !== '!') {
          const text = match0.slice(1, refStart - 1);
          if (this.linkInText(text)) {
            return '[' + text.replace(reflinkSearch, maskReflink)
              + '][' + 'a'.repeat(match0.length - refStart - 2) + ']';
          }
        }
        return '[' + 'a'.repeat(match0.length - 2) + ']';
      };
      maskedSrc = maskedSrc.replace(reflinkSearch, maskReflink);
    }

    // Mask out escaped characters.
    // Every mask must keep the length it replaces: emStrong and del line
    // maskedSrc up with src by slicing from the end. `anyPunctuation` matches
    // unicode punctuation, so an escaped astral character is 3 code units.
    maskedSrc = maskedSrc.replace(this.tokenizer.rules.inline.anyPunctuation, match0 => '+'.repeat(match0.length));

    // Mask out other blocks
    maskedSrc = maskedSrc.replace(this.tokenizer.rules.inline.blockSkip, (match0, _link, context) => {
      const offset = context ? context.length : 0;
      return match0.slice(0, offset) + '[' + 'a'.repeat(match0.length - offset - 2) + ']';
    });

    // Mask out blocks from extensions
    maskedSrc = this.hooks?.emStrongMask(maskedSrc) ?? maskedSrc;

    let keepPrevChar = false;
    let prevChar = '';
    let srcLength = Infinity;
    while (src) {
      if (src.length < srcLength) {
        srcLength = src.length;
      } else {
        this.infiniteLoopError(src.charCodeAt(0));
        break;
      }

      if (!keepPrevChar) {
        prevChar = '';
      }
      keepPrevChar = false;

      let extToken: Tokens.Generic | undefined;

      // extensions
      if (this.extensions?.inline?.some((extTokenizer) => {
        if (extToken = extTokenizer.call({ lexer: this }, src, tokens)) {
          src = src.substring(extToken.raw.length);
          tokens.push(extToken);
          return true;
        }
        return false;
      })) {
        continue;
      }

      // escape
      const escapeTok = this.tokenizer.escape(src);
      if (escapeTok) {
        src = src.substring(escapeTok.raw.length);
        tokens.push(escapeTok);
        continue;
      }

      // tag
      const tagTok = this.tokenizer.tag(src);
      if (tagTok) {
        src = src.substring(tagTok.raw.length);
        tokens.push(tagTok);
        continue;
      }

      // link
      const linkTok = this.tokenizer.link(src);
      if (linkTok) {
        src = src.substring(linkTok.raw.length);
        tokens.push(linkTok);
        continue;
      }

      // reflink, nolink
      const refTok = this.tokenizer.reflink(src, this.links);
      if (refTok) {
        src = src.substring(refTok.raw.length);
        const lastToken = tokens.at(-1);
        if (refTok.type === 'text' && lastToken?.type === 'text') {
          const prev = lastToken as Tokens.Text;
          prev.raw += refTok.raw;
          prev.text += (refTok as Tokens.Text).text;
        } else {
          tokens.push(refTok);
        }
        continue;
      }

      // em & strong
      const emStrongTok = this.tokenizer.emStrong(src, maskedSrc, prevChar);
      if (emStrongTok) {
        src = src.substring(emStrongTok.raw.length);
        tokens.push(emStrongTok);
        continue;
      }

      // code
      const codespanTok = this.tokenizer.codespan(src);
      if (codespanTok) {
        src = src.substring(codespanTok.raw.length);
        tokens.push(codespanTok);
        continue;
      }

      // br
      const brTok = this.tokenizer.br(src);
      if (brTok) {
        src = src.substring(brTok.raw.length);
        tokens.push(brTok);
        continue;
      }

      // del (gfm)
      const delTok = this.tokenizer.del(src, maskedSrc, prevChar);
      if (delTok) {
        src = src.substring(delTok.raw.length);
        tokens.push(delTok);
        continue;
      }

      // autolink
      const autolinkTok = this.tokenizer.autolink(src);
      if (autolinkTok) {
        src = src.substring(autolinkTok.raw.length);
        tokens.push(autolinkTok);
        continue;
      }

      // url (gfm)
      const urlTok = !this.state.inLink ? this.tokenizer.url(src) : undefined;
      if (urlTok) {
        src = src.substring(urlTok.raw.length);
        tokens.push(urlTok);
        continue;
      }

      // text
      // prevent inlineText consuming extensions by clipping 'src' to extension start
      let cutSrc = src;
      if (this.extensions?.startInline) {
        let startIndex = Infinity;
        const tempSrc = src.slice(1);
        let tempStart;
        this.extensions.startInline.forEach((getStartIndex) => {
          tempStart = getStartIndex.call({ lexer: this }, tempSrc);
          if (typeof tempStart === 'number' && tempStart >= 0) {
            startIndex = Math.min(startIndex, tempStart);
          }
        });
        if (startIndex < Infinity && startIndex >= 0) {
          cutSrc = src.substring(0, startIndex + 1);
        }
      }
      const inlineTextTok = this.tokenizer.inlineText(cutSrc);
      if (inlineTextTok) {
        src = src.substring(inlineTextTok.raw.length);
        if (inlineTextTok.raw.slice(-1) !== '_') { // Track prevChar before string of ____ started
          prevChar = inlineTextTok.raw.slice(-1);
        }
        keepPrevChar = true;
        const lastToken = tokens.at(-1);
        if (lastToken?.type === 'text') {
          const prev = lastToken as Tokens.Text;
          prev.raw += inlineTextTok.raw;
          prev.text += inlineTextTok.text;
        } else {
          tokens.push(inlineTextTok);
        }
        continue;
      }

      if (src) {
        this.infiniteLoopError(src.charCodeAt(0));
        break;
      }
    }

    return tokens;
  }

  private infiniteLoopError(byte: number) {
    const errMsg = 'Infinite loop on byte: ' + byte;
    if (this.options.silent) {
      console.error(errMsg);
    } else {
      throw new Error(errMsg);
    }
  }
}
