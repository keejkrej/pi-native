import Diff from './base.ts';
import type {
    AllDiffOptions,
    ChangeObject,
    CallbackOptionAbortable,
    CallbackOptionNonabortable,
    DiffCallbackNonabortable,
    DiffSentencesOptionsAbortable,
    DiffSentencesOptionsNonabortable,
} from '../types.ts';

function isSentenceEndPunct(char: string | undefined): boolean {
    return char == '.' || char == '!' || char == '?';
}

class SentenceDiff extends Diff<string, string> {
    tokenize(value: string, _options: AllDiffOptions): string[] {
        const result: string[] = [];
        let tokenStartI = 0;
        for (let i = 0; i < value.length; i++) {
            if (i == value.length - 1) {
                result.push(value.slice(tokenStartI));
                break;
            }

            if (isSentenceEndPunct(value[i]) && value[i + 1]!.match(/\s/)) {
                // We've hit a sentence break - i.e. a punctuation mark followed by whitespace.
                result.push(value.slice(tokenStartI, i + 1));

                i = tokenStartI = i + 1;
                while (value[i + 1]?.match(/\s/)) {
                    i++;
                }
                result.push(value.slice(tokenStartI, i + 1));

                tokenStartI = i + 1;
            }
        }

        return result;
    }
}

export const sentenceDiff: SentenceDiff = new SentenceDiff();

/**
 * diffs two blocks of text, treating each sentence, and the whitespace between each pair of sentences, as a token.
 * @returns a list of change objects.
 */
export function diffSentences(oldStr: string, newStr: string, options: DiffCallbackNonabortable<string>): undefined;
export function diffSentences(oldStr: string, newStr: string, options: DiffSentencesOptionsAbortable & CallbackOptionAbortable<string>): undefined;
export function diffSentences(oldStr: string, newStr: string, options: DiffSentencesOptionsNonabortable & CallbackOptionNonabortable<string>): undefined;
export function diffSentences(oldStr: string, newStr: string, options: DiffSentencesOptionsAbortable): ChangeObject<string>[] | undefined;
export function diffSentences(oldStr: string, newStr: string, options?: DiffSentencesOptionsNonabortable): ChangeObject<string>[];
export function diffSentences(oldStr: string, newStr: string, options?: any): ChangeObject<string>[] | undefined {
    return sentenceDiff.diff(oldStr, newStr, options);
}
