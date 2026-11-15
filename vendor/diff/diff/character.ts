import Diff from './base.ts';
import type {
    ChangeObject,
    CallbackOptionAbortable,
    CallbackOptionNonabortable,
    DiffCallbackNonabortable,
    DiffCharsOptionsAbortable,
    DiffCharsOptionsNonabortable,
} from '../types.ts';

class CharacterDiff extends Diff<string, string> {}

export const characterDiff: CharacterDiff = new CharacterDiff();

/**
 * diffs two blocks of text, treating each character as a token.
 * @returns a list of change objects.
 */
export function diffChars(oldStr: string, newStr: string, options: DiffCallbackNonabortable<string>): undefined;
export function diffChars(oldStr: string, newStr: string, options: DiffCharsOptionsAbortable & CallbackOptionAbortable<string>): undefined;
export function diffChars(oldStr: string, newStr: string, options: DiffCharsOptionsNonabortable & CallbackOptionNonabortable<string>): undefined;
export function diffChars(oldStr: string, newStr: string, options: DiffCharsOptionsAbortable): ChangeObject<string>[] | undefined;
export function diffChars(oldStr: string, newStr: string, options?: DiffCharsOptionsNonabortable): ChangeObject<string>[];
export function diffChars(oldStr: string, newStr: string, options?: any): ChangeObject<string>[] | undefined {
    return characterDiff.diff(oldStr, newStr, options);
}
