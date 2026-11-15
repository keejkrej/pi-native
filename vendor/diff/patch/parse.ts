import type { StructuredPatch, StructuredPatchHunk } from '../types.ts';

/**
 * Parses a patch into structured data, in the same structure returned by `structuredPatch`.
 *
 * @return a JSON object representation of a patch, suitable for use with the `applyPatch` method.
 */
export function parsePatch(uniDiff: string): StructuredPatch[] {
    const diffstr = uniDiff.split(/\n/);
    const list: StructuredPatch[] = [];
    let i = 0;

    function parseIndex(): void {
        const index = { hunks: [] as StructuredPatchHunk[] } as unknown as StructuredPatch;
        list.push(index);

        // Parse diff metadata
        while (i < diffstr.length) {
            const line = diffstr[i]!;

            // File header found, end parsing diff metadata
            if ((/^(---|\+\+\+|@@)\s/).test(line)) {
                break;
            }

            const headerMatch = (/^(?:Index:|diff(?: -r \w+)+)\s+/).exec(line);
            if (headerMatch) {
                index.index = line.substring(headerMatch[0].length).trim();
            }

            i++;
        }

        parseFileHeader(index);
        parseFileHeader(index);

        // Parse hunks
        index.hunks = [];

        while (i < diffstr.length) {
            const line = diffstr[i]!;
            if ((/^(Index:\s|diff\s|---\s|\+\+\+\s|===================================================================)/).test(line)) {
                break;
            }
            else if ((/^@@/).test(line)) {
                index.hunks.push(parseHunk());
            }
            else if (line) {
                throw new Error('Unknown line ' + (i + 1) + ' ' + JSON.stringify(line));
            }
            else {
                i++;
            }
        }
    }

    function parseFileHeader(index: StructuredPatch): void {
        const currentLine = diffstr[i];
        const fileHeaderMatch = currentLine !== undefined ? (/^(---|\+\+\+)\s+/).exec(currentLine) : null;
        if (fileHeaderMatch && currentLine !== undefined) {
            const prefix = fileHeaderMatch[1];
            const data = currentLine.substring(3).trim().split('\t', 2);
            const header = (data[1] || '').trim();
            let fileName = (data[0] ?? '').replace(/\\\\/g, '\\');
            if (fileName.startsWith('"') && fileName.endsWith('"')) {
                fileName = fileName.substr(1, fileName.length - 2);
            }
            if (prefix === '---') {
                index.oldFileName = fileName;
                index.oldHeader = header;
            }
            else {
                index.newFileName = fileName;
                index.newHeader = header;
            }

            i++;
        }
    }

    function parseHunk(): StructuredPatchHunk {
        const chunkHeaderIndex = i;
        const chunkHeaderLine = diffstr[i++]!;
        const chunkHeader = chunkHeaderLine.split(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);

        const hunk: StructuredPatchHunk = {
            oldStart: +(chunkHeader[1] ?? 0),
            oldLines: typeof chunkHeader[2] === 'undefined' ? 1 : +chunkHeader[2],
            newStart: +(chunkHeader[3] ?? 0),
            newLines: typeof chunkHeader[4] === 'undefined' ? 1 : +chunkHeader[4],
            lines: [],
        };

        if (hunk.oldLines === 0) {
            hunk.oldStart += 1;
        }
        if (hunk.newLines === 0) {
            hunk.newStart += 1;
        }

        let addCount = 0;
        let removeCount = 0;
        for (
            ;
            i < diffstr.length &&
            (removeCount < hunk.oldLines || addCount < hunk.newLines || !!diffstr[i]?.startsWith('\\'));
            i++
        ) {
            const line = diffstr[i]!;
            const operation = (line.length == 0 && i != (diffstr.length - 1)) ? ' ' : line[0];

            if (operation === '+' || operation === '-' || operation === ' ' || operation === '\\') {
                hunk.lines.push(line);

                if (operation === '+') {
                    addCount++;
                }
                else if (operation === '-') {
                    removeCount++;
                }
                else if (operation === ' ') {
                    addCount++;
                    removeCount++;
                }
            }
            else {
                throw new Error(`Hunk at line ${chunkHeaderIndex + 1} contained invalid line ${line}`);
            }
        }

        if (!addCount && hunk.newLines === 1) {
            hunk.newLines = 0;
        }
        if (!removeCount && hunk.oldLines === 1) {
            hunk.oldLines = 0;
        }

        if (addCount !== hunk.newLines) {
            throw new Error('Added line count did not match for hunk at line ' + (chunkHeaderIndex + 1));
        }
        if (removeCount !== hunk.oldLines) {
            throw new Error('Removed line count did not match for hunk at line ' + (chunkHeaderIndex + 1));
        }

        return hunk;
    }

    while (i < diffstr.length) {
        parseIndex();
    }

    return list;
}
