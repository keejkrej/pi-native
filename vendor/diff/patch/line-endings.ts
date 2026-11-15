import type { StructuredPatch } from '../types.ts';

export function unixToWin(patch: StructuredPatch): StructuredPatch;
export function unixToWin(patches: StructuredPatch[]): StructuredPatch[];
export function unixToWin(patch: StructuredPatch | StructuredPatch[]): StructuredPatch | StructuredPatch[] {
    if (Array.isArray(patch)) {
        return patch.map(p => unixToWin(p));
    }

    return {
        ...patch,
        hunks: patch.hunks.map(hunk => ({
            ...hunk,
            lines: hunk.lines.map((line, i) =>
                (line.startsWith('\\') || line.endsWith('\r') || hunk.lines[i + 1]?.startsWith('\\'))
                    ? line
                    : line + '\r',
            ),
        })),
    };
}

export function winToUnix(patch: StructuredPatch): StructuredPatch;
export function winToUnix(patches: StructuredPatch[]): StructuredPatch[];
export function winToUnix(patch: StructuredPatch | StructuredPatch[]): StructuredPatch | StructuredPatch[] {
    if (Array.isArray(patch)) {
        return patch.map(p => winToUnix(p));
    }

    return {
        ...patch,
        hunks: patch.hunks.map(hunk => ({
            ...hunk,
            lines: hunk.lines.map(line =>
                line.endsWith('\r') ? line.substring(0, line.length - 1) : line,
            ),
        })),
    };
}

/**
 * Returns true if the patch consistently uses Unix line endings (or only involves one line and has
 * no line endings).
 */
export function isUnix(patch: StructuredPatch | StructuredPatch[]): boolean {
    if (!Array.isArray(patch)) {
        patch = [patch];
    }

    return !patch.some(index => index.hunks.some(hunk => hunk.lines.some(line => !line.startsWith('\\') && line.endsWith('\r'))));
}

/**
 * Returns true if the patch uses Windows line endings and only Windows line endings.
 */
export function isWin(patch: StructuredPatch | StructuredPatch[]): boolean {
    if (!Array.isArray(patch)) {
        patch = [patch];
    }

    return patch.some(index => index.hunks.some(hunk => hunk.lines.some(line => line.endsWith('\r'))))
        && patch.every(index => index.hunks.every(hunk => hunk.lines.every((line, i) =>
            line.startsWith('\\') || line.endsWith('\r') || !!hunk.lines[i + 1]?.startsWith('\\'),
        )));
}
