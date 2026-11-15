import Diff from './base.ts';
import type {
    AllDiffOptions,
    ChangeObject,
    CallbackOptionAbortable,
    CallbackOptionNonabortable,
    DiffCallbackNonabortable,
    DiffCssOptionsAbortable,
    DiffCssOptionsNonabortable,
} from '../types.ts';

class CssDiff extends Diff<string, string> {
    tokenize(value: string, _options: AllDiffOptions): string[] {
        return value.split(/([{}:;,]|\s+)/);
    }
}

export const cssDiff: CssDiff = new CssDiff();

/**
 * diffs two blocks of text, comparing CSS tokens.
 * @returns a list of change objects.
 */
export function diffCss(oldStr: string, newStr: string, options: DiffCallbackNonabortable<string>): undefined;
export function diffCss(oldStr: string, newStr: string, options: DiffCssOptionsAbortable & CallbackOptionAbortable<string>): undefined;
export function diffCss(oldStr: string, newStr: string, options: DiffCssOptionsNonabortable & CallbackOptionNonabortable<string>): undefined;
export function diffCss(oldStr: string, newStr: string, options: DiffCssOptionsAbortable): ChangeObject<string>[] | undefined;
export function diffCss(oldStr: string, newStr: string, options?: DiffCssOptionsNonabortable): ChangeObject<string>[];
export function diffCss(oldStr: string, newStr: string, options?: any): ChangeObject<string>[] | undefined {
    return cssDiff.diff(oldStr, newStr, options);
}
