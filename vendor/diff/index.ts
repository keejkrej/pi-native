/* See LICENSE file for terms of use */
/*
 * Text diff implementation.
 *
 * This library supports the following APIs:
 * Diff.diffChars: Character by character diff
 * Diff.diffWords: Word (as defined by \b regex) diff which ignores whitespace
 * Diff.diffLines: Line based diff
 * Diff.diffCss: Diff targeted at CSS content
 */

import Diff from './diff/base.ts';
import { diffChars, characterDiff } from './diff/character.ts';
import { diffWords, diffWordsWithSpace, wordDiff, wordsWithSpaceDiff } from './diff/word.ts';
import { diffLines, diffTrimmedLines, lineDiff } from './diff/line.ts';
import { diffSentences, sentenceDiff } from './diff/sentence.ts';
import { diffCss, cssDiff } from './diff/css.ts';
import { diffJson, canonicalize, jsonDiff } from './diff/json.ts';
import { diffArrays, arrayDiff } from './diff/array.ts';

import { applyPatch, applyPatches } from './patch/apply.ts';
import type { ApplyPatchOptions, ApplyPatchesOptions } from './patch/apply.ts';
import { parsePatch } from './patch/parse.ts';
import { reversePatch } from './patch/reverse.ts';
import {
    structuredPatch,
    createTwoFilesPatch,
    createPatch,
    formatPatch,
    INCLUDE_HEADERS,
    FILE_HEADERS_ONLY,
    OMIT_HEADERS,
} from './patch/create.ts';
import type {
    StructuredPatchOptionsAbortable,
    StructuredPatchOptionsNonabortable,
    CreatePatchOptionsAbortable,
    CreatePatchOptionsNonabortable,
    HeaderOptions,
} from './patch/create.ts';

import { convertChangesToDMP } from './convert/dmp.ts';
import { convertChangesToXML } from './convert/xml.ts';
import type {
    ChangeObject,
    Change,
    ArrayChange,
    DiffArraysOptionsAbortable,
    DiffArraysOptionsNonabortable,
    DiffCharsOptionsAbortable,
    DiffCharsOptionsNonabortable,
    DiffLinesOptionsAbortable,
    DiffLinesOptionsNonabortable,
    DiffWordsOptionsAbortable,
    DiffWordsOptionsNonabortable,
    DiffSentencesOptionsAbortable,
    DiffSentencesOptionsNonabortable,
    DiffJsonOptionsAbortable,
    DiffJsonOptionsNonabortable,
    DiffCssOptionsAbortable,
    DiffCssOptionsNonabortable,
    StructuredPatch,
    StructuredPatchHunk,
    ParsedDiff,
} from './types.ts';

export {
    Diff,
    diffChars,
    characterDiff,
    diffWords,
    wordDiff,
    diffWordsWithSpace,
    wordsWithSpaceDiff,
    diffLines,
    lineDiff,
    diffTrimmedLines,
    diffSentences,
    sentenceDiff,
    diffCss,
    cssDiff,
    diffJson,
    jsonDiff,
    diffArrays,
    arrayDiff,
    structuredPatch,
    createTwoFilesPatch,
    createPatch,
    formatPatch,
    INCLUDE_HEADERS,
    FILE_HEADERS_ONLY,
    OMIT_HEADERS,
    applyPatch,
    applyPatches,
    parsePatch,
    reversePatch,
    convertChangesToDMP,
    convertChangesToXML,
    canonicalize,
};

export type {
    ChangeObject,
    Change,
    ArrayChange,
    DiffArraysOptionsAbortable,
    DiffArraysOptionsNonabortable,
    DiffCharsOptionsAbortable,
    DiffCharsOptionsNonabortable,
    DiffLinesOptionsAbortable,
    DiffLinesOptionsNonabortable,
    DiffWordsOptionsAbortable,
    DiffWordsOptionsNonabortable,
    DiffSentencesOptionsAbortable,
    DiffSentencesOptionsNonabortable,
    DiffJsonOptionsAbortable,
    DiffJsonOptionsNonabortable,
    DiffCssOptionsAbortable,
    DiffCssOptionsNonabortable,
    StructuredPatch,
    StructuredPatchHunk,
    ParsedDiff,
    ApplyPatchOptions,
    ApplyPatchesOptions,
    StructuredPatchOptionsAbortable,
    StructuredPatchOptionsNonabortable,
    CreatePatchOptionsAbortable,
    CreatePatchOptionsNonabortable,
    HeaderOptions,
};
