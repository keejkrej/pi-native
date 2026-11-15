import Diff from './base.ts';
import { generateOptions } from '../util/params.ts';
import type {
    AllDiffOptions,
    ChangeObject,
    CallbackOptionAbortable,
    CallbackOptionNonabortable,
    DiffCallbackNonabortable,
    DiffLinesOptionsAbortable,
    DiffLinesOptionsNonabortable,
} from '../types.ts';

class LineDiff extends Diff<string, string> {
    tokenize(value: string, options: AllDiffOptions): string[] {
        return tokenize(value, options);
    }

    equals(left: string, right: string, options: AllDiffOptions): boolean {
        if (options.ignoreWhitespace) {
            if (!options.newlineIsToken || !left.includes('\n')) {
                left = left.trim();
            }
            if (!options.newlineIsToken || !right.includes('\n')) {
                right = right.trim();
            }
        }
        else if (options.ignoreNewlineAtEof && !options.newlineIsToken) {
            if (left.endsWith('\n')) {
                left = left.slice(0, -1);
            }
            if (right.endsWith('\n')) {
                right = right.slice(0, -1);
            }
        }
        return super.equals(left, right, options);
    }
}

export const lineDiff: LineDiff = new LineDiff();

/**
 * diffs two blocks of text, treating each line as a token.
 * @returns a list of change objects.
 */
export function diffLines(oldStr: string, newStr: string, options: DiffCallbackNonabortable<string>): undefined;
export function diffLines(oldStr: string, newStr: string, options: DiffLinesOptionsAbortable & CallbackOptionAbortable<string>): undefined;
export function diffLines(oldStr: string, newStr: string, options: DiffLinesOptionsNonabortable & CallbackOptionNonabortable<string>): undefined;
export function diffLines(oldStr: string, newStr: string, options: DiffLinesOptionsAbortable): ChangeObject<string>[] | undefined;
export function diffLines(oldStr: string, newStr: string, options?: DiffLinesOptionsNonabortable): ChangeObject<string>[];
export function diffLines(oldStr: string, newStr: string, options?: any): ChangeObject<string>[] | undefined {
    return lineDiff.diff(oldStr, newStr, options);
}

export function diffTrimmedLines(oldStr: string, newStr: string, options: DiffCallbackNonabortable<string>): undefined;
export function diffTrimmedLines(oldStr: string, newStr: string, options: DiffLinesOptionsAbortable & CallbackOptionAbortable<string>): undefined;
export function diffTrimmedLines(oldStr: string, newStr: string, options: DiffLinesOptionsNonabortable & CallbackOptionNonabortable<string>): undefined;
export function diffTrimmedLines(oldStr: string, newStr: string, options: DiffLinesOptionsAbortable): ChangeObject<string>[] | undefined;
export function diffTrimmedLines(oldStr: string, newStr: string, options?: DiffLinesOptionsNonabortable): ChangeObject<string>[];
export function diffTrimmedLines(oldStr: string, newStr: string, options?: any): ChangeObject<string>[] | undefined {
    const opts = generateOptions(options, { ignoreWhitespace: true });
    return lineDiff.diff(oldStr, newStr, opts);
}

// Exported standalone so it can be used from jsonDiff too.
export function tokenize(value: string, options: AllDiffOptions): string[] {
    if (options.stripTrailingCr) {
        // remove one \r before \n to match GNU diff's --strip-trailing-cr behavior
        value = value.replace(/\r\n/g, '\n');
    }

    const retLines: string[] = [];
    const linesAndNewlines = value.split(/(\n|\r\n)/);

    // Ignore the final empty token that occurs if the string ends with a new line
    if (!linesAndNewlines[linesAndNewlines.length - 1]) {
        linesAndNewlines.pop();
    }

    // Merge the content and line separators into single tokens
    for (let i = 0; i < linesAndNewlines.length; i++) {
        const line = linesAndNewlines[i]!;

        if (i % 2 && !options.newlineIsToken) {
            retLines[retLines.length - 1] += line;
        }
        else {
            retLines.push(line);
        }
    }

    return retLines;
}
