import { diffLines } from '../diff/line.ts';
import type {
    ChangeObject,
    StructuredPatch,
    StructuredPatchHunk,
    DiffLinesOptionsAbortable,
    DiffLinesOptionsNonabortable,
    AbortableDiffOptions,
} from '../types.ts';

type StructuredPatchCallbackAbortable = (patch: StructuredPatch | undefined) => void;
type StructuredPatchCallbackNonabortable = (patch: StructuredPatch) => void;

export interface HeaderOptions {
    includeIndex: boolean;
    includeUnderline: boolean;
    includeFileHeaders: boolean;
}

export const INCLUDE_HEADERS: HeaderOptions = {
    includeIndex: true,
    includeUnderline: true,
    includeFileHeaders: true,
};
export const FILE_HEADERS_ONLY: HeaderOptions = {
    includeIndex: false,
    includeUnderline: false,
    includeFileHeaders: true,
};
export const OMIT_HEADERS: HeaderOptions = {
    includeIndex: false,
    includeUnderline: false,
    includeFileHeaders: false,
};

interface _StructuredPatchOptionsAbortable extends Pick<DiffLinesOptionsAbortable, 'ignoreWhitespace' | 'stripTrailingCr'> {
    /**
     * describes how many lines of context should be included.
     * You can set this to `Number.MAX_SAFE_INTEGER` or `Infinity` to include the entire file content in one hunk.
     * @default 4
     */
    context?: number;
    callback?: StructuredPatchCallbackAbortable;
}
export type StructuredPatchOptionsAbortable = _StructuredPatchOptionsAbortable & AbortableDiffOptions;

export interface StructuredPatchOptionsNonabortable extends Pick<DiffLinesOptionsNonabortable, 'ignoreWhitespace' | 'stripTrailingCr'> {
    context?: number;
    callback?: StructuredPatchCallbackNonabortable;
}

interface StructuredPatchCallbackOptionAbortable {
    callback: StructuredPatchCallbackAbortable;
}
interface StructuredPatchCallbackOptionNonabortable {
    callback: StructuredPatchCallbackNonabortable;
}

type DiffWithLines = ChangeObject<string> & { lines?: string[] };

/**
 * returns an object with an array of hunk objects.
 */
export function structuredPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader: string | undefined,
    newHeader: string | undefined,
    options: StructuredPatchCallbackNonabortable,
): undefined;
export function structuredPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader: string | undefined,
    newHeader: string | undefined,
    options: StructuredPatchOptionsAbortable & StructuredPatchCallbackOptionAbortable,
): undefined;
export function structuredPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader: string | undefined,
    newHeader: string | undefined,
    options: StructuredPatchOptionsNonabortable & StructuredPatchCallbackOptionNonabortable,
): undefined;
export function structuredPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader: string | undefined,
    newHeader: string | undefined,
    options: StructuredPatchOptionsAbortable,
): StructuredPatch | undefined;
export function structuredPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: StructuredPatchOptionsNonabortable,
): StructuredPatch;
export function structuredPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: any,
): StructuredPatch | undefined {
    let optionsObj: any;
    if (!options) {
        optionsObj = {};
    }
    else if (typeof options === 'function') {
        optionsObj = { callback: options };
    }
    else {
        optionsObj = options;
    }

    if (typeof optionsObj.context === 'undefined') {
        optionsObj.context = 4;
    }

    const context: number = optionsObj.context;

    if (optionsObj.newlineIsToken) {
        throw new Error('newlineIsToken may not be used with patch-generation functions, only with diffing functions');
    }

    if (!optionsObj.callback) {
        return diffLinesResultToPatch(diffLines(oldStr, newStr, optionsObj));
    }
    else {
        const { callback } = optionsObj;
        diffLines(oldStr, newStr, {
            ...optionsObj,
            callback: (diff: ChangeObject<string>[] | undefined) => {
                const patch = diffLinesResultToPatch(diff);
                callback(patch);
            },
        });
        return undefined;
    }

    function diffLinesResultToPatch(diff: DiffWithLines[] | undefined): StructuredPatch | undefined {
        if (!diff) {
            return undefined;
        }

        diff.push({ value: '', lines: [], added: false, removed: false, count: 0 });

        function contextLines(lines: string[]): string[] {
            return lines.map(entry => ' ' + entry);
        }

        const hunks: StructuredPatchHunk[] = [];
        let oldRangeStart = 0,
            newRangeStart = 0,
            curRange: string[] = [],
            oldLine = 1,
            newLine = 1;
        for (let i = 0; i < diff.length; i++) {
            const current = diff[i]!;
            const lines = current.lines || splitLines(current.value);
            current.lines = lines;

            if (current.added || current.removed) {
                if (!oldRangeStart) {
                    const prev = diff[i - 1];
                    oldRangeStart = oldLine;
                    newRangeStart = newLine;

                    if (prev && prev.lines) {
                        curRange = context > 0 ? contextLines(prev.lines.slice(-context)) : [];
                        oldRangeStart -= curRange.length;
                        newRangeStart -= curRange.length;
                    }
                }

                for (const line of lines) {
                    curRange.push((current.added ? '+' : '-') + line);
                }

                if (current.added) {
                    newLine += lines.length;
                }
                else {
                    oldLine += lines.length;
                }
            }
            else {
                if (oldRangeStart) {
                    if (lines.length <= context * 2 && i < diff.length - 2) {
                        for (const line of contextLines(lines)) {
                            curRange.push(line);
                        }
                    }
                    else {
                        const contextSize = Math.min(lines.length, context);
                        for (const line of contextLines(lines.slice(0, contextSize))) {
                            curRange.push(line);
                        }

                        const hunk: StructuredPatchHunk = {
                            oldStart: oldRangeStart,
                            oldLines: oldLine - oldRangeStart + contextSize,
                            newStart: newRangeStart,
                            newLines: newLine - newRangeStart + contextSize,
                            lines: curRange,
                        };
                        hunks.push(hunk);

                        oldRangeStart = 0;
                        newRangeStart = 0;
                        curRange = [];
                    }
                }
                oldLine += lines.length;
                newLine += lines.length;
            }
        }

        // Eliminate trailing `\n` from each line of each hunk, and add "\ No newline at end of file" where needed.
        for (const hunk of hunks) {
            for (let i = 0; i < hunk.lines.length; i++) {
                if (hunk.lines[i]!.endsWith('\n')) {
                    hunk.lines[i] = hunk.lines[i]!.slice(0, -1);
                }
                else {
                    hunk.lines.splice(i + 1, 0, '\\ No newline at end of file');
                    i++;
                }
            }
        }

        return {
            oldFileName,
            newFileName,
            oldHeader,
            newHeader,
            hunks,
        };
    }
}

/**
 * creates a unified diff patch.
 */
export function formatPatch(patch: StructuredPatch | StructuredPatch[], headerOptions?: HeaderOptions): string {
    if (!headerOptions) {
        headerOptions = INCLUDE_HEADERS;
    }

    if (Array.isArray(patch)) {
        if (patch.length > 1 && !headerOptions.includeFileHeaders) {
            throw new Error(
                'Cannot omit file headers on a multi-file patch. '
                + '(The result would be unparseable; how would a tool trying to apply '
                + 'the patch know which changes are to which file?)',
            );
        }
        return patch.map(p => formatPatch(p, headerOptions)).join('\n');
    }

    const ret: string[] = [];
    if (headerOptions.includeIndex && patch.oldFileName == patch.newFileName) {
        ret.push('Index: ' + patch.oldFileName);
    }
    if (headerOptions.includeUnderline) {
        ret.push('===================================================================');
    }
    if (headerOptions.includeFileHeaders) {
        ret.push('--- ' + patch.oldFileName + (typeof patch.oldHeader === 'undefined' ? '' : '\t' + patch.oldHeader));
        ret.push('+++ ' + patch.newFileName + (typeof patch.newHeader === 'undefined' ? '' : '\t' + patch.newHeader));
    }

    for (let i = 0; i < patch.hunks.length; i++) {
        const hunk = patch.hunks[i]!;
        if (hunk.oldLines === 0) {
            hunk.oldStart -= 1;
        }
        if (hunk.newLines === 0) {
            hunk.newStart -= 1;
        }
        ret.push('@@ -' + hunk.oldStart + ',' + hunk.oldLines + ' +' + hunk.newStart + ',' + hunk.newLines + ' @@');
        for (const line of hunk.lines) {
            ret.push(line);
        }
    }

    return ret.join('\n') + '\n';
}

type CreatePatchCallbackAbortable = (patch: string | undefined) => void;
type CreatePatchCallbackNonabortable = (patch: string) => void;

interface _CreatePatchOptionsAbortable extends Pick<DiffLinesOptionsAbortable, 'ignoreWhitespace' | 'stripTrailingCr'> {
    context?: number;
    callback?: CreatePatchCallbackAbortable;
    headerOptions?: HeaderOptions;
}
export type CreatePatchOptionsAbortable = _CreatePatchOptionsAbortable & AbortableDiffOptions;

export interface CreatePatchOptionsNonabortable extends Pick<DiffLinesOptionsNonabortable, 'ignoreWhitespace' | 'stripTrailingCr'> {
    context?: number;
    callback?: CreatePatchCallbackNonabortable;
    headerOptions?: HeaderOptions;
}

interface CreatePatchCallbackOptionAbortable {
    callback: CreatePatchCallbackAbortable;
}
interface CreatePatchCallbackOptionNonabortable {
    callback: CreatePatchCallbackNonabortable;
}

/**
 * creates a unified diff patch by first computing a diff with `diffLines` and then serializing it to unified diff format.
 */
export function createTwoFilesPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader: string | undefined,
    newHeader: string | undefined,
    options: CreatePatchCallbackNonabortable,
): undefined;
export function createTwoFilesPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader: string | undefined,
    newHeader: string | undefined,
    options: CreatePatchOptionsAbortable & CreatePatchCallbackOptionAbortable,
): undefined;
export function createTwoFilesPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader: string | undefined,
    newHeader: string | undefined,
    options: CreatePatchOptionsNonabortable & CreatePatchCallbackOptionNonabortable,
): undefined;
export function createTwoFilesPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader: string | undefined,
    newHeader: string | undefined,
    options: CreatePatchOptionsAbortable,
): string | undefined;
export function createTwoFilesPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: CreatePatchOptionsNonabortable,
): string;
export function createTwoFilesPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: any,
): string | undefined {
    if (typeof options === 'function') {
        options = { callback: options };
    }

    if (!options?.callback) {
        const patchObj = structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options);
        if (!patchObj) {
            return undefined;
        }
        return formatPatch(patchObj, options?.headerOptions);
    }
    else {
        const { callback } = options;
        structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, {
            ...options,
            callback: (patchObj: StructuredPatch | undefined) => {
                if (!patchObj) {
                    callback(undefined);
                }
                else {
                    callback(formatPatch(patchObj, options.headerOptions));
                }
            },
        });
        return undefined;
    }
}

/**
 * creates a unified diff patch.
 */
export function createPatch(
    fileName: string,
    oldStr: string,
    newStr: string,
    oldHeader: string | undefined,
    newHeader: string | undefined,
    options: CreatePatchCallbackNonabortable,
): undefined;
export function createPatch(
    fileName: string,
    oldStr: string,
    newStr: string,
    oldHeader: string | undefined,
    newHeader: string | undefined,
    options: CreatePatchOptionsAbortable & CreatePatchCallbackOptionAbortable,
): undefined;
export function createPatch(
    fileName: string,
    oldStr: string,
    newStr: string,
    oldHeader: string | undefined,
    newHeader: string | undefined,
    options: CreatePatchOptionsNonabortable & CreatePatchCallbackOptionNonabortable,
): undefined;
export function createPatch(
    fileName: string,
    oldStr: string,
    newStr: string,
    oldHeader: string | undefined,
    newHeader: string | undefined,
    options: CreatePatchOptionsAbortable,
): string | undefined;
export function createPatch(
    fileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: CreatePatchOptionsNonabortable,
): string;
export function createPatch(
    fileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: any,
): string | undefined {
    return createTwoFilesPatch(fileName, fileName, oldStr, newStr, oldHeader, newHeader, options);
}

function splitLines(text: string): string[] {
    const hasTrailingNl = text.endsWith('\n');
    const result = text.split('\n').map(line => line + '\n');
    if (hasTrailingNl) {
        result.pop();
    }
    else {
        const last = result.pop();
        if (last !== undefined) {
            result.push(last.slice(0, -1));
        }
    }
    return result;
}
