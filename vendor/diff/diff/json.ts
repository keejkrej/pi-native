import Diff from './base.ts';
import { tokenize } from './line.ts';
import type {
    AllDiffOptions,
    ChangeObject,
    CallbackOptionAbortable,
    CallbackOptionNonabortable,
    DiffCallbackNonabortable,
    DiffJsonOptionsAbortable,
    DiffJsonOptionsNonabortable,
} from '../types.ts';

class JsonDiff extends Diff<string, string, string | object> {
    tokenize(value: string, options: AllDiffOptions): string[] {
        return tokenize(value, options);
    }

    get useLongestToken(): boolean {
        return true;
    }

    castInput(value: string | object, options: AllDiffOptions): string {
        const {
            undefinedReplacement,
            stringifyReplacer = (_k: string, v: unknown) => (typeof v === 'undefined' ? undefinedReplacement : v),
        } = options;

        return typeof value === 'string'
            ? value
            : JSON.stringify(canonicalize(value, null, null, stringifyReplacer), null, '  ');
    }

    equals(left: string, right: string, options: AllDiffOptions): boolean {
        return super.equals(left.replace(/,([\r\n])/g, '$1'), right.replace(/,([\r\n])/g, '$1'), options);
    }
}

export const jsonDiff: JsonDiff = new JsonDiff();

/**
 * diffs two JSON-serializable objects by first serializing them to prettily-formatted JSON and then treating each line of the JSON as a token.
 * @returns a list of change objects.
 */
export function diffJson(oldStr: string | object, newStr: string | object, options: DiffCallbackNonabortable<string>): undefined;
export function diffJson(oldStr: string | object, newStr: string | object, options: DiffJsonOptionsAbortable & CallbackOptionAbortable<string>): undefined;
export function diffJson(oldStr: string | object, newStr: string | object, options: DiffJsonOptionsNonabortable & CallbackOptionNonabortable<string>): undefined;
export function diffJson(oldStr: string | object, newStr: string | object, options: DiffJsonOptionsAbortable): ChangeObject<string>[] | undefined;
export function diffJson(oldStr: string | object, newStr: string | object, options?: DiffJsonOptionsNonabortable): ChangeObject<string>[];
export function diffJson(oldStr: string | object, newStr: string | object, options?: any): ChangeObject<string>[] | undefined {
    return jsonDiff.diff(oldStr, newStr, options);
}

// This function handles the presence of circular references by bailing out when encountering an
// object that is already on the "stack" of items being processed. Accepts an optional replacer
export function canonicalize(
    obj: unknown,
    stack: Array<unknown> | null,
    replacementStack: Array<unknown> | null,
    replacer: ((k: string, v: unknown) => unknown) | null | undefined,
    key?: string,
): unknown {
    stack = stack || [];
    replacementStack = replacementStack || [];

    if (replacer) {
        obj = replacer(key === undefined ? '' : key, obj);
    }

    let i: number;
    for (i = 0; i < stack.length; i += 1) {
        if (stack[i] === obj) {
            return replacementStack[i];
        }
    }

    if (Array.isArray(obj)) {
        stack.push(obj);
        const canonicalizedArr: unknown[] = [];
        replacementStack.push(canonicalizedArr);
        for (i = 0; i < obj.length; i += 1) {
            canonicalizedArr.push(canonicalize(obj[i], stack, replacementStack, replacer, String(i)));
        }
        stack.pop();
        replacementStack.pop();
        return canonicalizedArr;
    }

    let current: unknown = obj;
    if (
        current &&
        typeof current === 'object' &&
        'toJSON' in current &&
        typeof (current as { toJSON?: unknown }).toJSON === 'function'
    ) {
        current = (current as { toJSON: () => unknown }).toJSON();
    }

    if (typeof current === 'object' && current !== null) {
        stack.push(current);
        const canonicalizedRecord: Record<string, unknown> = {};
        replacementStack.push(canonicalizedRecord);
        const record = current as Record<string, unknown>;
        const sortedKeys = Object.keys(record).sort();
        for (i = 0; i < sortedKeys.length; i += 1) {
            const k = sortedKeys[i]!;
            canonicalizedRecord[k] = canonicalize(record[k], stack, replacementStack, replacer, k);
        }
        stack.pop();
        replacementStack.pop();
        return canonicalizedRecord;
    }
    return current;
}
