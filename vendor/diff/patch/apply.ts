import { hasOnlyWinLineEndings, hasOnlyUnixLineEndings } from '../util/string.ts';
import { isWin, isUnix, unixToWin, winToUnix } from './line-endings.ts';
import { parsePatch } from './parse.ts';
import distanceIterator from '../util/distance-iterator.ts';
import type { StructuredPatch } from '../types.ts';

export interface ApplyPatchOptions {
    /**
     * Maximum Levenshtein distance (in lines deleted, added, or substituted) between the context shown in a patch hunk and the lines found in the file.
     * @default 0
     */
    fuzzFactor?: number;
    /**
     * If `true`, and if the file to be patched consistently uses different line endings to the patch, auto-convert patch line endings to match source.
     * @default true
     */
    autoConvertLineEndings?: boolean;
    /**
     * Callback used to compare two given lines to determine if they should be considered equal when patching.
     */
    compareLine?: (lineNumber: number, line: string, operation: string, patchContent: string) => boolean;
}

interface HunkApplyResult {
    patchedLines: string[];
    oldLineLastI: number;
}

/**
 * attempts to apply a unified diff patch.
 */
export function applyPatch(
    source: string,
    patch: string | StructuredPatch | [StructuredPatch],
    options: ApplyPatchOptions = {},
): string | false {
    let patches: StructuredPatch[];
    if (typeof patch === 'string') {
        patches = parsePatch(patch);
    }
    else if (Array.isArray(patch)) {
        patches = patch;
    }
    else {
        patches = [patch];
    }

    if (patches.length > 1) {
        throw new Error('applyPatch only works with a single input.');
    }

    return applyStructuredPatch(source, patches[0]!, options);
}

function applyStructuredPatch(source: string, patch: StructuredPatch, options: ApplyPatchOptions = {}): string | false {
    if (options.autoConvertLineEndings || options.autoConvertLineEndings == null) {
        if (hasOnlyWinLineEndings(source) && isUnix(patch)) {
            patch = unixToWin(patch);
        }
        else if (hasOnlyUnixLineEndings(source) && isWin(patch)) {
            patch = winToUnix(patch);
        }
    }

    const lines = source.split('\n');
    const hunks = patch.hunks;
    const compareLine = options.compareLine || ((_lineNumber: number, line: string, _operation: string, patchContent: string) => line === patchContent);
    const fuzzFactor = options.fuzzFactor || 0;
    let minLine = 0;

    if (fuzzFactor < 0 || !Number.isInteger(fuzzFactor)) {
        throw new Error('fuzzFactor must be a non-negative integer');
    }

    if (!hunks.length) {
        return source;
    }

    let prevLine = '',
        removeEOFNL = false,
        addEOFNL = false;
    const lastHunkLines = hunks[hunks.length - 1]!.lines;
    for (let i = 0; i < lastHunkLines.length; i++) {
        const line = lastHunkLines[i]!;
        if (line[0] == '\\') {
            if (prevLine[0] == '+') {
                removeEOFNL = true;
            }
            else if (prevLine[0] == '-') {
                addEOFNL = true;
            }
        }
        prevLine = line;
    }

    if (removeEOFNL) {
        if (addEOFNL) {
            if (!fuzzFactor && lines[lines.length - 1] == '') {
                return false;
            }
        }
        else if (lines[lines.length - 1] == '') {
            lines.pop();
        }
        else if (!fuzzFactor) {
            return false;
        }
    }
    else if (addEOFNL) {
        if (lines[lines.length - 1] != '') {
            lines.push('');
        }
        else if (!fuzzFactor) {
            return false;
        }
    }

    function applyHunk(
        hunkLines: string[],
        toPos: number,
        maxErrors: number,
        hunkLinesI = 0,
        lastContextLineMatched = true,
        patchedLines: string[] = [],
        patchedLinesLength = 0,
    ): HunkApplyResult | null {
        let nConsecutiveOldContextLines = 0;
        let nextContextLineMustMatch = false;
        for (; hunkLinesI < hunkLines.length; hunkLinesI++) {
            const hunkLine = hunkLines[hunkLinesI]!;
            const operation = hunkLine.length > 0 ? hunkLine[0]! : ' ';
            const content = hunkLine.length > 0 ? hunkLine.substr(1) : hunkLine;
            if (operation === '-') {
                if (compareLine(toPos + 1, lines[toPos]!, operation, content)) {
                    toPos++;
                    nConsecutiveOldContextLines = 0;
                }
                else {
                    if (!maxErrors || lines[toPos] == null) {
                        return null;
                    }
                    patchedLines[patchedLinesLength] = lines[toPos]!;
                    return applyHunk(hunkLines, toPos + 1, maxErrors - 1, hunkLinesI, false, patchedLines, patchedLinesLength + 1);
                }
            }
            if (operation === '+') {
                if (!lastContextLineMatched) {
                    return null;
                }
                patchedLines[patchedLinesLength] = content;
                patchedLinesLength++;
                nConsecutiveOldContextLines = 0;
                nextContextLineMustMatch = true;
            }
            if (operation === ' ') {
                nConsecutiveOldContextLines++;
                patchedLines[patchedLinesLength] = lines[toPos]!;
                if (compareLine(toPos + 1, lines[toPos]!, operation, content)) {
                    patchedLinesLength++;
                    lastContextLineMatched = true;
                    nextContextLineMustMatch = false;
                    toPos++;
                }
                else {
                    if (nextContextLineMustMatch || !maxErrors) {
                        return null;
                    }
                    if (lines[toPos]) {
                        const matched =
                            applyHunk(hunkLines, toPos + 1, maxErrors - 1, hunkLinesI + 1, false, patchedLines, patchedLinesLength + 1)
                            || applyHunk(hunkLines, toPos + 1, maxErrors - 1, hunkLinesI, false, patchedLines, patchedLinesLength + 1);
                        if (matched) {
                            return matched;
                        }
                    }
                    return applyHunk(hunkLines, toPos, maxErrors - 1, hunkLinesI + 1, false, patchedLines, patchedLinesLength);
                }
            }
        }

        patchedLinesLength -= nConsecutiveOldContextLines;
        toPos -= nConsecutiveOldContextLines;
        patchedLines.length = patchedLinesLength;
        return {
            patchedLines,
            oldLineLastI: toPos - 1,
        };
    }

    const resultLines: string[] = [];
    let prevHunkOffset = 0;
    for (let i = 0; i < hunks.length; i++) {
        const hunk = hunks[i]!;
        let hunkResult: HunkApplyResult | null | undefined;
        const maxLine = lines.length - hunk.oldLines + fuzzFactor;
        let toPos: number | undefined;
        for (let maxErrors = 0; maxErrors <= fuzzFactor; maxErrors++) {
            toPos = hunk.oldStart + prevHunkOffset - 1;
            const iterator = distanceIterator(toPos, minLine, maxLine);
            for (; toPos !== undefined; toPos = iterator()) {
                hunkResult = applyHunk(hunk.lines, toPos, maxErrors);
                if (hunkResult) {
                    break;
                }
            }
            if (hunkResult) {
                break;
            }
        }

        if (!hunkResult || toPos === undefined) {
            return false;
        }

        for (let j = minLine; j < toPos; j++) {
            resultLines.push(lines[j]!);
        }

        for (let j = 0; j < hunkResult.patchedLines.length; j++) {
            resultLines.push(hunkResult.patchedLines[j]!);
        }

        minLine = hunkResult.oldLineLastI + 1;
        prevHunkOffset = toPos + 1 - hunk.oldStart;
    }

    for (let i = minLine; i < lines.length; i++) {
        resultLines.push(lines[i]!);
    }

    return resultLines.join('\n');
}

export interface ApplyPatchesOptions extends ApplyPatchOptions {
    loadFile: (index: StructuredPatch, callback: (err: any, data: string) => void) => void;
    patched: (index: StructuredPatch, content: string | false, callback: (err: any) => void) => void;
    complete: (err?: any) => void;
}

/**
 * applies one or more patches.
 */
export function applyPatches(uniDiff: string | StructuredPatch[], options: ApplyPatchesOptions): void {
    const spDiff = typeof uniDiff === 'string' ? parsePatch(uniDiff) : uniDiff;
    let currentIndex = 0;

    function processIndex(): void {
        const index = spDiff[currentIndex++];
        if (!index) {
            options.complete();
            return;
        }

        options.loadFile(index, function (err: any, data: string) {
            if (err) {
                options.complete(err);
                return;
            }

            const updatedContent = applyPatch(data, index, options);
            options.patched(index, updatedContent, function (patchErr: any) {
                if (patchErr) {
                    options.complete(patchErr);
                    return;
                }

                processIndex();
            });
        });
    }
    processIndex();
}
