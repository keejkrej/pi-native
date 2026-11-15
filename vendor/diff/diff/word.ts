import Diff from './base.ts';
import {
    longestCommonPrefix,
    longestCommonSuffix,
    replacePrefix,
    replaceSuffix,
    removePrefix,
    removeSuffix,
    maximumOverlap,
    leadingWs,
    trailingWs,
    leadingAndTrailingWs,
    segment,
} from '../util/string.ts';
import type {
    AllDiffOptions,
    ChangeObject,
    CallbackOptionAbortable,
    CallbackOptionNonabortable,
    DiffCallbackNonabortable,
    DiffWordsOptionsAbortable,
    DiffWordsOptionsNonabortable,
} from '../types.ts';

const extendedWordChars = 'a-zA-Z0-9_\\u{AD}\\u{C0}-\\u{D6}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}';
const tokenizeIncludingWhitespace = new RegExp(`[${extendedWordChars}]+|\\s+|[^${extendedWordChars}]`, 'ug');

class WordDiff extends Diff<string, string> {
    equals(left: string, right: string, options: AllDiffOptions): boolean {
        if (options.ignoreCase) {
            left = left.toLowerCase();
            right = right.toLowerCase();
        }
        return left.trim() === right.trim();
    }

    tokenize(value: string, options: AllDiffOptions): string[] {
        let parts: string[];
        if (options.intlSegmenter) {
            // scriptc has no lowering for Intl.ResolvedSegmenterOptions.granularity, so skip the check here.
            const segmenter = options.intlSegmenter as Intl.Segmenter;
            parts = segment(value, segmenter);
        }
        else {
            parts = value.match(tokenizeIncludingWhitespace) || [];
        }
        const tokens: string[] = [];
        let prevPart: string | null = null;
        parts.forEach(part => {
            if ((/\s/).test(part)) {
                if (prevPart == null) {
                    tokens.push(part);
                }
                else {
                    tokens.push(tokens.pop()! + part);
                }
            }
            else if (prevPart != null && (/\s/).test(prevPart)) {
                if (tokens[tokens.length - 1] == prevPart) {
                    tokens.push(tokens.pop()! + part);
                }
                else {
                    tokens.push(prevPart + part);
                }
            }
            else {
                tokens.push(part);
            }

            prevPart = part;
        });
        return tokens;
    }

    join(tokens: string[]): string {
        return tokens.map((token, i) => {
            if (i == 0) {
                return token;
            }
            else {
                return token.replace((/^\s+/), '');
            }
        }).join('');
    }

    postProcess(changes: ChangeObject<string>[], options: AllDiffOptions): ChangeObject<string>[] {
        if (!changes || options.oneChangePerToken) {
            return changes;
        }

        let lastKeep: ChangeObject<string> | null = null;
        let insertion: ChangeObject<string> | null = null;
        let deletion: ChangeObject<string> | null = null;
        changes.forEach(change => {
            if (change.added) {
                insertion = change;
            }
            else if (change.removed) {
                deletion = change;
            }
            else {
                if (insertion || deletion) {
                    dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, change, options.intlSegmenter);
                }
                lastKeep = change;
                insertion = null;
                deletion = null;
            }
        });
        if (insertion || deletion) {
            dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, null, options.intlSegmenter);
        }
        return changes;
    }
}

export const wordDiff: WordDiff = new WordDiff();

/**
 * diffs two blocks of text, treating each word and each punctuation mark as a token.
 * @returns a list of change objects.
 */
export function diffWords(oldStr: string, newStr: string, options: DiffCallbackNonabortable<string>): undefined;
export function diffWords(oldStr: string, newStr: string, options: DiffWordsOptionsAbortable & CallbackOptionAbortable<string>): undefined;
export function diffWords(oldStr: string, newStr: string, options: DiffWordsOptionsNonabortable & CallbackOptionNonabortable<string>): undefined;
export function diffWords(oldStr: string, newStr: string, options: DiffWordsOptionsAbortable): ChangeObject<string>[] | undefined;
export function diffWords(oldStr: string, newStr: string, options?: DiffWordsOptionsNonabortable): ChangeObject<string>[];
export function diffWords(oldStr: string, newStr: string, options?: any): ChangeObject<string>[] | undefined {
    if (options?.ignoreWhitespace != null && !options.ignoreWhitespace) {
        return diffWordsWithSpace(oldStr, newStr, options);
    }

    return wordDiff.diff(oldStr, newStr, options);
}

function dedupeWhitespaceInChangeObjects(
    startKeep: ChangeObject<string> | null,
    deletion: ChangeObject<string> | null,
    insertion: ChangeObject<string> | null,
    endKeep: ChangeObject<string> | null,
    segmenter?: Intl.Segmenter,
): void {
    if (deletion && insertion) {
        const [oldWsPrefix, oldWsSuffix] = leadingAndTrailingWs(deletion.value, segmenter);
        const [newWsPrefix, newWsSuffix] = leadingAndTrailingWs(insertion.value, segmenter);

        if (startKeep) {
            const commonWsPrefix = longestCommonPrefix(oldWsPrefix, newWsPrefix);
            startKeep.value = replaceSuffix(startKeep.value, newWsPrefix, commonWsPrefix);
            deletion.value = removePrefix(deletion.value, commonWsPrefix);
            insertion.value = removePrefix(insertion.value, commonWsPrefix);
        }
        if (endKeep) {
            const commonWsSuffix = longestCommonSuffix(oldWsSuffix, newWsSuffix);
            endKeep.value = replacePrefix(endKeep.value, newWsSuffix, commonWsSuffix);
            deletion.value = removeSuffix(deletion.value, commonWsSuffix);
            insertion.value = removeSuffix(insertion.value, commonWsSuffix);
        }
    }
    else if (insertion) {
        if (startKeep) {
            const ws = leadingWs(insertion.value, segmenter);
            insertion.value = insertion.value.substring(ws.length);
        }
        if (endKeep) {
            const ws = leadingWs(endKeep.value, segmenter);
            endKeep.value = endKeep.value.substring(ws.length);
        }
    }
    else if (startKeep && endKeep) {
        const newWsFull = leadingWs(endKeep.value, segmenter);
        const [delWsStart, delWsEnd] = leadingAndTrailingWs(deletion!.value, segmenter);

        const newWsStart = longestCommonPrefix(newWsFull, delWsStart);
        deletion!.value = removePrefix(deletion!.value, newWsStart);

        const newWsEnd = longestCommonSuffix(removePrefix(newWsFull, newWsStart), delWsEnd);
        deletion!.value = removeSuffix(deletion!.value, newWsEnd);
        endKeep.value = replacePrefix(endKeep.value, newWsFull, newWsEnd);

        startKeep.value = replaceSuffix(
            startKeep.value,
            newWsFull,
            newWsFull.slice(0, newWsFull.length - newWsEnd.length),
        );
    }
    else if (endKeep) {
        const endKeepWsPrefix = leadingWs(endKeep.value, segmenter);
        const deletionWsSuffix = trailingWs(deletion!.value, segmenter);
        const overlap = maximumOverlap(deletionWsSuffix, endKeepWsPrefix);
        deletion!.value = removeSuffix(deletion!.value, overlap);
    }
    else if (startKeep) {
        const startKeepWsSuffix = trailingWs(startKeep.value, segmenter);
        const deletionWsPrefix = leadingWs(deletion!.value, segmenter);
        const overlap = maximumOverlap(startKeepWsSuffix, deletionWsPrefix);
        deletion!.value = removePrefix(deletion!.value, overlap);
    }
}

class WordsWithSpaceDiff extends Diff<string, string> {
    tokenize(value: string, _options: AllDiffOptions): string[] {
        const regex = new RegExp(`(\\r?\\n)|[${extendedWordChars}]+|[^\\S\\n\\r]+|[^${extendedWordChars}]`, 'ug');
        return value.match(regex) || [];
    }
}

export const wordsWithSpaceDiff: WordsWithSpaceDiff = new WordsWithSpaceDiff();

/**
 * diffs two blocks of text, treating each word, punctuation mark, newline, or run of (non-newline) whitespace as a token.
 * @returns a list of change objects
 */
export function diffWordsWithSpace(oldStr: string, newStr: string, options: DiffCallbackNonabortable<string>): undefined;
export function diffWordsWithSpace(oldStr: string, newStr: string, options: DiffWordsOptionsAbortable & CallbackOptionAbortable<string>): undefined;
export function diffWordsWithSpace(oldStr: string, newStr: string, options: DiffWordsOptionsNonabortable & CallbackOptionNonabortable<string>): undefined;
export function diffWordsWithSpace(oldStr: string, newStr: string, options: DiffWordsOptionsAbortable): ChangeObject<string>[] | undefined;
export function diffWordsWithSpace(oldStr: string, newStr: string, options?: DiffWordsOptionsNonabortable): ChangeObject<string>[];
export function diffWordsWithSpace(oldStr: string, newStr: string, options?: any): ChangeObject<string>[] | undefined {
    return wordsWithSpaceDiff.diff(oldStr, newStr, options);
}
