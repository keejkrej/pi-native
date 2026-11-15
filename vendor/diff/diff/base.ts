import type {
    ChangeObject,
    AllDiffOptions,
    AbortableDiffOptions,
    DiffCallbackNonabortable,
    CallbackOptionAbortable,
    CallbackOptionNonabortable,
} from '../types.ts';

class DraftChangeObject<ValueT> {
    count: number;
    added: boolean;
    removed: boolean;
    value: ValueT | undefined;
    previousComponent: DraftChangeObject<ValueT> | undefined;

    constructor(
        count: number,
        added: boolean,
        removed: boolean,
        previousComponent: DraftChangeObject<ValueT> | undefined,
    ) {
        this.count = count;
        this.added = added;
        this.removed = removed;
        this.value = undefined;
        this.previousComponent = previousComponent;
    }
}

type DiffCallbackBivariant<T> = { bivariance(result: ChangeObject<T>[] | undefined): void }['bivariance'];

type DiffImplOptions<ValueT> = AllDiffOptions & {
    timeout?: number;
    maxEditLength?: number;
    callback?: DiffCallbackBivariant<ValueT>;
};

interface BestPath<ValueT> {
    oldPos: number;
    lastComponent: DraftChangeObject<ValueT> | undefined;
}

export default class Diff<TokenT, ValueT extends Iterable<TokenT> = Iterable<TokenT>, InputValueT = ValueT> {
    diff(oldStr: InputValueT, newStr: InputValueT, options: DiffCallbackNonabortable<ValueT>): undefined;
    diff(oldStr: InputValueT, newStr: InputValueT, options: AllDiffOptions & AbortableDiffOptions & CallbackOptionAbortable<ValueT>): undefined;
    diff(oldStr: InputValueT, newStr: InputValueT, options: AllDiffOptions & CallbackOptionNonabortable<ValueT>): undefined;
    diff(oldStr: InputValueT, newStr: InputValueT, options: AllDiffOptions & AbortableDiffOptions): ChangeObject<ValueT>[] | undefined;
    diff(oldStr: InputValueT, newStr: InputValueT, options?: AllDiffOptions): ChangeObject<ValueT>[];
    diff(
        oldStr: InputValueT,
        newStr: InputValueT,
        options: DiffCallbackNonabortable<ValueT> | DiffImplOptions<ValueT> = {},
    ): ChangeObject<ValueT>[] | undefined {
        let callback: DiffCallbackBivariant<ValueT> | undefined;
        let opts: DiffImplOptions<ValueT>;
        if (typeof options === 'function') {
            callback = options;
            opts = {};
        }
        else {
            opts = options;
            callback = options.callback;
        }
        // Allow subclasses to massage the input prior to running
        const oldString = this.castInput(oldStr, opts);
        const newString = this.castInput(newStr, opts);

        const oldTokens = this.removeEmpty(this.tokenize(oldString, opts));
        const newTokens = this.removeEmpty(this.tokenize(newString, opts));

        return this.diffWithOptionsObj(oldTokens, newTokens, opts, callback);
    }

    private diffWithOptionsObj(
        oldTokens: TokenT[],
        newTokens: TokenT[],
        options: DiffImplOptions<ValueT>,
        callback: DiffCallbackBivariant<ValueT> | undefined,
    ): ChangeObject<ValueT>[] | undefined {
        const done = (value: ChangeObject<ValueT>[]): ChangeObject<ValueT>[] | undefined => {
            value = this.postProcess(value, options);
            if (callback) {
                setTimeout(function () { callback(value); }, 0);
                return undefined;
            }
            else {
                return value;
            }
        };

        const newLen = newTokens.length, oldLen = oldTokens.length;
        let editLength = 1;
        let maxEditLength = newLen + oldLen;
        if (options.maxEditLength != null) {
            maxEditLength = Math.min(maxEditLength, options.maxEditLength);
        }
        const maxExecutionTime = options.timeout ?? Infinity;
        const abortAfterTimestamp = Date.now() + maxExecutionTime;

        const bestPath: (BestPath<ValueT> | undefined)[] = [{ oldPos: -1, lastComponent: undefined }];

        // Seed editLength = 0, i.e. the content starts with the same values
        let newPos = this.extractCommon(bestPath[0]!, newTokens, oldTokens, 0, options);
        if (bestPath[0]!.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
            // Identity per the equality and tokenizer
            return done(this.buildValues(bestPath[0]!.lastComponent, newTokens, oldTokens));
        }

        let minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;

        // Main worker method. checks all permutations of a given edit length for acceptance.
        const execEditLength = (): ChangeObject<ValueT>[] | true | undefined => {
            for (
                let diagonalPath = Math.max(minDiagonalToConsider, -editLength);
                diagonalPath <= Math.min(maxDiagonalToConsider, editLength);
                diagonalPath += 2
            ) {
                let basePath: BestPath<ValueT>;
                const removePath = bestPath[diagonalPath - 1],
                    addPath = bestPath[diagonalPath + 1];
                if (removePath) {
                    // No one else is going to attempt to use this value, clear it
                    bestPath[diagonalPath - 1] = undefined;
                }

                let canAdd = false;
                if (addPath) {
                    // what newPos will be after we do an insertion:
                    const addPathNewPos = addPath.oldPos - diagonalPath;
                    canAdd = 0 <= addPathNewPos && addPathNewPos < newLen;
                }

                const canRemove = Boolean(removePath && removePath.oldPos + 1 < oldLen);
                if (!canAdd && !canRemove) {
                    // If this path is a terminal then prune
                    bestPath[diagonalPath] = undefined;
                    continue;
                }

                // Select the diagonal that we want to branch from.
                if (!canRemove || (canAdd && removePath!.oldPos < addPath!.oldPos)) {
                    basePath = this.addToPath(addPath!, true, false, 0, options);
                }
                else {
                    basePath = this.addToPath(removePath!, false, true, 1, options);
                }

                newPos = this.extractCommon(basePath, newTokens, oldTokens, diagonalPath, options);

                if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
                    // If we have hit the end of both strings, then we are done
                    return done(this.buildValues(basePath.lastComponent, newTokens, oldTokens)) || true;
                }
                else {
                    bestPath[diagonalPath] = basePath;
                    if (basePath.oldPos + 1 >= oldLen) {
                        maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
                    }
                    if (newPos + 1 >= newLen) {
                        minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
                    }
                }
            }

            editLength++;
            return undefined;
        };

        if (callback) {
            (function exec() {
                setTimeout(function () {
                    if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) {
                        callback(undefined);
                        return;
                    }

                    if (!execEditLength()) {
                        exec();
                    }
                }, 0);
            }());
            return undefined;
        }
        else {
            while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
                const ret = execEditLength();
                if (ret) {
                    return ret === true ? undefined : ret;
                }
            }
            return undefined;
        }
    }

    private addToPath(
        path: BestPath<ValueT>,
        added: boolean,
        removed: boolean,
        oldPosInc: number,
        options: AllDiffOptions,
    ): BestPath<ValueT> {
        const last = path.lastComponent;
        if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) {
            return {
                oldPos: path.oldPos + oldPosInc,
                lastComponent: new DraftChangeObject<ValueT>(last.count + 1, added, removed, last.previousComponent),
            };
        }
        else {
            return {
                oldPos: path.oldPos + oldPosInc,
                lastComponent: new DraftChangeObject<ValueT>(1, added, removed, last),
            };
        }
    }

    private extractCommon(
        basePath: BestPath<ValueT>,
        newTokens: TokenT[],
        oldTokens: TokenT[],
        diagonalPath: number,
        options: AllDiffOptions,
    ): number {
        const newLen = newTokens.length, oldLen = oldTokens.length;
        let oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
        while (
            newPos + 1 < newLen &&
            oldPos + 1 < oldLen &&
            this.equals(oldTokens[oldPos + 1]!, newTokens[newPos + 1]!, options)
        ) {
            newPos++;
            oldPos++;
            commonCount++;
            if (options.oneChangePerToken) {
                basePath.lastComponent = new DraftChangeObject<ValueT>(1, false, false, basePath.lastComponent);
            }
        }

        if (commonCount && !options.oneChangePerToken) {
            basePath.lastComponent = new DraftChangeObject<ValueT>(commonCount, false, false, basePath.lastComponent);
        }

        basePath.oldPos = oldPos;
        return newPos;
    }

    equals(left: TokenT, right: TokenT, options: AllDiffOptions): boolean {
        if (options.comparator) {
            return options.comparator(left, right);
        }
        else {
            const leftVal: unknown = left;
            const rightVal: unknown = right;
            return left === right || (
                !!options.ignoreCase &&
                typeof leftVal === 'string' &&
                typeof rightVal === 'string' &&
                leftVal.toLowerCase() === rightVal.toLowerCase()
            );
        }
    }

    removeEmpty(array: TokenT[]): TokenT[] {
        const ret: TokenT[] = [];
        for (let i = 0; i < array.length; i++) {
            if (array[i]) {
                ret.push(array[i]!);
            }
        }
        return ret;
    }

    castInput(value: InputValueT, _options: AllDiffOptions): ValueT {
        return value as unknown as ValueT;
    }

    tokenize(value: ValueT, _options: AllDiffOptions): TokenT[] {
        return Array.from(value);
    }

    join(chars: TokenT[]): ValueT {
        const joined: unknown = chars.join('');
        return joined as ValueT;
    }

    postProcess(changeObjects: ChangeObject<ValueT>[], _options: AllDiffOptions): ChangeObject<ValueT>[] {
        return changeObjects;
    }

    get useLongestToken(): boolean {
        return false;
    }

    private buildValues(
        lastComponent: DraftChangeObject<ValueT> | undefined,
        newTokens: TokenT[],
        oldTokens: TokenT[],
    ): ChangeObject<ValueT>[] {
        // First we convert our linked list of components in reverse order to an
        // array in the right order:
        const components: DraftChangeObject<ValueT>[] = [];
        let nextComponent: DraftChangeObject<ValueT> | undefined;
        while (lastComponent) {
            components.push(lastComponent);
            nextComponent = lastComponent.previousComponent;
            lastComponent.previousComponent = undefined;
            lastComponent = nextComponent;
        }
        components.reverse();

        const results: ChangeObject<ValueT>[] = [];
        const componentLen = components.length;
        let componentPos = 0, newPos = 0, oldPos = 0;

        for (; componentPos < componentLen; componentPos++) {
            const component = components[componentPos]!;
            let valueOut: ValueT;
            if (!component.removed) {
                if (!component.added && this.useLongestToken) {
                    let value = newTokens.slice(newPos, newPos + component.count);
                    value = value.map(function (val, i) {
                        const oldValue = oldTokens[oldPos + i]!;
                        const oldStr: unknown = oldValue;
                        const newStr: unknown = val;
                        if (typeof oldStr === 'string' && typeof newStr === 'string') {
                            return oldStr.length > newStr.length ? oldValue : val;
                        }
                        return val;
                    });
                    valueOut = this.join(value);
                }
                else {
                    valueOut = this.join(newTokens.slice(newPos, newPos + component.count));
                }
                newPos += component.count;

                // Common case
                if (!component.added) {
                    oldPos += component.count;
                }
            }
            else {
                valueOut = this.join(oldTokens.slice(oldPos, oldPos + component.count));
                oldPos += component.count;
            }
            results.push({
                value: valueOut,
                added: component.added,
                removed: component.removed,
                count: component.count,
            });
        }

        return results;
    }
}
