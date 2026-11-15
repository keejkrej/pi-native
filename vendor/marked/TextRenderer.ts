import type { Tokens } from './Tokens.ts';

/**
 * TextRenderer
 * returns only the textual part of the token
 */
export class _TextRenderer {
  // no need for block level renderers
  strong({ text }: Tokens.Strong): string {
    return text;
  }

  em({ text }: Tokens.Em): string {
    return text;
  }

  codespan({ text }: Tokens.Codespan): string {
    return text;
  }

  del({ text }: Tokens.Del): string {
    return text;
  }

  html({ text }: Tokens.HTML | Tokens.Tag): string {
    return text;
  }

  text({ text }: Tokens.Text | Tokens.Escape | Tokens.Tag): string {
    return text;
  }

  link({ text }: Tokens.Link): string {
    return '' + text;
  }

  image({ text }: Tokens.Image): string {
    return '' + text;
  }

  br(): string {
    return '';
  }

  checkbox({ raw }: Tokens.Checkbox): string {
    return raw;
  }
}
