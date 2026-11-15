/**
 * Pure TypeScript vendored implementation of `proper-lockfile`.
 * Zero third-party dependencies; uses atomic `mkdir`/`mkdirSync` on `<path>.lock`.
 */

import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export interface RetryOptions {
	readonly retries?: number;
	readonly factor?: number;
	readonly minTimeout?: number;
	readonly maxTimeout?: number;
	readonly randomize?: boolean;
}

export interface LockOptions {
	readonly stale?: number;
	readonly update?: number;
	readonly retries?: number | RetryOptions;
	readonly realpath?: boolean;
	readonly lockfilePath?: string;
	readonly onCompromised?: (err: Error) => void;
}

export interface UnlockOptions {
	readonly realpath?: boolean;
	readonly lockfilePath?: string;
}

export interface CheckOptions {
	readonly stale?: number;
	readonly realpath?: boolean;
	readonly lockfilePath?: string;
}

export type ReleaseFn = () => Promise<void>;
export type ReleaseSyncFn = () => void;

export class LockError extends Error {
	readonly code: string;
	readonly file: string | undefined;

	constructor(message: string, code: string, file?: string) {
		super(message);
		this.name = "LockError";
		this.code = code;
		if (file !== undefined) {
			this.file = file;
		}
	}
}

interface NormalizedLockOptions {
	readonly stale: number;
	readonly update: number;
	readonly realpath: boolean;
	readonly lockfilePath: string | undefined;
	readonly onCompromised: (err: Error) => void;
	readonly retries: Required<RetryOptions>;
}

interface LockEntry {
	readonly lockfilePath: string;
	mtime: Date;
	readonly mtimePrecision: "s" | "ms";
	readonly options: NormalizedLockOptions;
	lastUpdate: number;
	updateDelay: number | null;
	updateTimeout: ReturnType<typeof setTimeout> | null;
	released: boolean;
}

const activeLocks = new Map<string, LockEntry>();
let cachedMtimePrecision: "s" | "ms" | undefined;
let exitHookRegistered = false;

function ensureExitHook(): void {
	if (exitHookRegistered) return;
	exitHookRegistered = true;
	process.on("exit", () => {
		for (const entry of activeLocks.values()) {
			try {
				fs.rmdirSync(entry.lockfilePath);
			} catch {
				// Ignore best-effort cleanup errors during process exit.
			}
		}
		activeLocks.clear();
	});
}

function defaultOnCompromised(err: Error): void {
	throw err;
}

function normalizeRetryOptions(retries: number | RetryOptions | undefined): Required<RetryOptions> {
	if (typeof retries === "number") {
		return {
			retries: Math.max(0, retries),
			factor: 2,
			minTimeout: 1000,
			maxTimeout: Number.POSITIVE_INFINITY,
			randomize: false,
		};
	}
	return {
		retries: Math.max(0, retries?.retries ?? 0),
		factor: retries?.factor ?? 2,
		minTimeout: retries?.minTimeout ?? 1000,
		maxTimeout: retries?.maxTimeout ?? Number.POSITIVE_INFINITY,
		randomize: retries?.randomize ?? false,
	};
}

function normalizeLockOptions(options?: LockOptions): NormalizedLockOptions {
	const stale = Math.max(options?.stale ?? 10_000, 2000);
	const rawUpdate = options?.update == null ? stale / 2 : options.update || 0;
	const update = Math.max(Math.min(rawUpdate, stale / 2), 1000);
	return {
		stale,
		update,
		realpath: options?.realpath ?? true,
		lockfilePath: options?.lockfilePath,
		onCompromised: options?.onCompromised ?? defaultOnCompromised,
		retries: normalizeRetryOptions(options?.retries),
	};
}

function getLockFile(file: string, lockfilePathOption?: string): string {
	return lockfilePathOption || `${file}.lock`;
}

function isLockStale(stat: fs.Stats, staleMs: number): boolean {
	return stat.mtime.getTime() < Date.now() - staleMs;
}

function getMtime(precision: "s" | "ms"): Date {
	let now = Date.now();
	if (precision === "s") {
		now = Math.ceil(now / 1000) * 1000;
	}
	return new Date(now);
}

function getErrorCode(err: unknown): string | undefined {
	if (typeof err === "object" && err !== null && "code" in err) {
		const code = (err as { code?: unknown }).code;
		return typeof code === "string" ? code : undefined;
	}
	return undefined;
}

async function resolveCanonicalPath(file: string, realpathEnabled: boolean): Promise<string> {
	if (!realpathEnabled) {
		return path.resolve(file);
	}
	return fsPromises.realpath(file);
}

function resolveCanonicalPathSync(file: string, realpathEnabled: boolean): string {
	if (!realpathEnabled) {
		return path.resolve(file);
	}
	return fs.realpathSync(file);
}

async function probeMtimePrecision(lockfilePath: string): Promise<{ mtime: Date; precision: "s" | "ms" }> {
	if (cachedMtimePrecision !== undefined) {
		const stat = await fsPromises.stat(lockfilePath);
		return { mtime: stat.mtime, precision: cachedMtimePrecision };
	}
	const probeDate = new Date(Math.ceil(Date.now() / 1000) * 1000 + 5);
	await fsPromises.utimes(lockfilePath, probeDate, probeDate);
	const stat = await fsPromises.stat(lockfilePath);
	const precision: "s" | "ms" = stat.mtime.getTime() % 1000 === 0 ? "s" : "ms";
	cachedMtimePrecision = precision;
	return { mtime: stat.mtime, precision };
}

function probeMtimePrecisionSync(lockfilePath: string): { mtime: Date; precision: "s" | "ms" } {
	if (cachedMtimePrecision !== undefined) {
		const stat = fs.statSync(lockfilePath);
		return { mtime: stat.mtime, precision: cachedMtimePrecision };
	}
	const probeDate = new Date(Math.ceil(Date.now() / 1000) * 1000 + 5);
	fs.utimesSync(lockfilePath, probeDate, probeDate);
	const stat = fs.statSync(lockfilePath);
	const precision: "s" | "ms" = stat.mtime.getTime() % 1000 === 0 ? "s" : "ms";
	cachedMtimePrecision = precision;
	return { mtime: stat.mtime, precision };
}

async function removeLockFile(lockfilePath: string): Promise<void> {
	try {
		await fsPromises.rmdir(lockfilePath);
	} catch (err) {
		if (getErrorCode(err) !== "ENOENT") {
			throw err;
		}
	}
}

function removeLockFileSync(lockfilePath: string): void {
	try {
		fs.rmdirSync(lockfilePath);
	} catch (err) {
		if (getErrorCode(err) !== "ENOENT") {
			throw err;
		}
	}
}

async function acquireLockOnce(
	file: string,
	lockfilePath: string,
	staleMs: number,
): Promise<{ mtime: Date; precision: "s" | "ms" }> {
	try {
		await fsPromises.mkdir(lockfilePath);
	} catch (err) {
		if (getErrorCode(err) !== "EEXIST") {
			throw err;
		}
		if (staleMs <= 0) {
			throw new LockError("Lock file is already being held", "ELOCKED", file);
		}
		let stat: fs.Stats;
		try {
			stat = await fsPromises.stat(lockfilePath);
		} catch (statErr) {
			if (getErrorCode(statErr) === "ENOENT") {
				return acquireLockOnce(file, lockfilePath, 0);
			}
			throw statErr;
		}
		if (!isLockStale(stat, staleMs)) {
			throw new LockError("Lock file is already being held", "ELOCKED", file);
		}
		await removeLockFile(lockfilePath);
		return acquireLockOnce(file, lockfilePath, 0);
	}

	try {
		return await probeMtimePrecision(lockfilePath);
	} catch (err) {
		try {
			await fsPromises.rmdir(lockfilePath);
		} catch {
			// Best-effort cleanup after probe failure.
		}
		throw err;
	}
}

function acquireLockOnceSync(
	file: string,
	lockfilePath: string,
	staleMs: number,
): { mtime: Date; precision: "s" | "ms" } {
	try {
		fs.mkdirSync(lockfilePath);
	} catch (err) {
		if (getErrorCode(err) !== "EEXIST") {
			throw err;
		}
		if (staleMs <= 0) {
			throw new LockError("Lock file is already being held", "ELOCKED", file);
		}
		let stat: fs.Stats;
		try {
			stat = fs.statSync(lockfilePath);
		} catch (statErr) {
			if (getErrorCode(statErr) === "ENOENT") {
				return acquireLockOnceSync(file, lockfilePath, 0);
			}
			throw statErr;
		}
		if (!isLockStale(stat, staleMs)) {
			throw new LockError("Lock file is already being held", "ELOCKED", file);
		}
		removeLockFileSync(lockfilePath);
		return acquireLockOnceSync(file, lockfilePath, 0);
	}

	try {
		return probeMtimePrecisionSync(lockfilePath);
	} catch (err) {
		try {
			fs.rmdirSync(lockfilePath);
		} catch {
			// Best-effort cleanup after probe failure.
		}
		throw err;
	}
}

function setLockAsCompromised(file: string, entry: LockEntry, err: Error): void {
	entry.released = true;
	if (entry.updateTimeout !== null) {
		clearTimeout(entry.updateTimeout);
		entry.updateTimeout = null;
	}
	if (activeLocks.get(file) === entry) {
		activeLocks.delete(file);
	}
	entry.options.onCompromised(err);
}

function scheduleHeartbeat(file: string, entry: LockEntry): void {
	if (entry.released || entry.updateTimeout !== null) return;
	const delay = entry.updateDelay ?? entry.options.update;
	entry.updateDelay = delay;
	const timer = setTimeout(() => {
		entry.updateTimeout = null;
		if (entry.released) return;

		// Use fsPromises.stat because scriptc's node:fs fallback provides promise stat without callback fs.stat.
		fsPromises.stat(entry.lockfilePath).then(
			(stat) => {
				if (entry.released) return;

				if (entry.mtime.getTime() !== stat.mtime.getTime()) {
					setLockAsCompromised(
						file,
						entry,
						new LockError("Unable to update lock within the stale threshold", "ECOMPROMISED", file),
					);
					return;
				}

				const nextMtime = getMtime(entry.mtimePrecision);
				fs.utimes(entry.lockfilePath, nextMtime, nextMtime, (utimesErr) => {
					if (entry.released) return;
					const expired = entry.lastUpdate + entry.options.stale < Date.now();
					if (utimesErr) {
						if (getErrorCode(utimesErr) === "ENOENT" || expired) {
							setLockAsCompromised(file, entry, new LockError(utimesErr.message, "ECOMPROMISED", file));
							return;
						}
						entry.updateDelay = 1000;
						scheduleHeartbeat(file, entry);
						return;
					}
					entry.mtime = nextMtime;
					entry.lastUpdate = Date.now();
					entry.updateDelay = null;
					scheduleHeartbeat(file, entry);
				});
			},
			(statErr: unknown) => {
				if (entry.released) return;
				const overThreshold = entry.lastUpdate + entry.options.stale < Date.now();
				if (getErrorCode(statErr) === "ENOENT" || overThreshold) {
					const message = statErr instanceof Error ? statErr.message : "Failed to stat lockfile";
					const err = new LockError(message, "ECOMPROMISED", file);
					setLockAsCompromised(file, entry, err);
					return;
				}
				entry.updateDelay = 1000;
				scheduleHeartbeat(file, entry);
			},
		);
	}, delay);

	entry.updateTimeout = timer;
}

function computeRetryDelay(attempt: number, retryOpts: Required<RetryOptions>): number {
	const randomFactor = retryOpts.randomize ? Math.random() + 1 : 1;
	const timeout = Math.round(randomFactor * retryOpts.minTimeout * retryOpts.factor ** attempt);
	return Math.min(timeout, retryOpts.maxTimeout);
}

function sleepMs(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

export async function lock(file: string, options?: LockOptions): Promise<ReleaseFn> {
	const normalized = normalizeLockOptions(options);
	const canonicalFile = await resolveCanonicalPath(file, normalized.realpath);
	const lockfilePath = getLockFile(canonicalFile, normalized.lockfilePath);

	let acquired: { mtime: Date; precision: "s" | "ms" } | undefined;
	let lastError: unknown;
	const maxRetries = normalized.retries.retries;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			acquired = await acquireLockOnce(canonicalFile, lockfilePath, normalized.stale);
			break;
		} catch (err) {
			lastError = err;
			if (attempt === maxRetries) {
				throw lastError;
			}
			await sleepMs(computeRetryDelay(attempt, normalized.retries));
		}
	}

	if (acquired === undefined) {
		throw lastError ?? new LockError("Lock file is already being held", "ELOCKED", canonicalFile);
	}

	ensureExitHook();
	const entry: LockEntry = {
		lockfilePath,
		mtime: acquired.mtime,
		mtimePrecision: acquired.precision,
		options: normalized,
		lastUpdate: Date.now(),
		updateDelay: null,
		updateTimeout: null,
		released: false,
	};
	activeLocks.set(canonicalFile, entry);
	scheduleHeartbeat(canonicalFile, entry);

	return async () => {
		if (entry.released) {
			throw new LockError("Lock is already released", "ERELEASED", canonicalFile);
		}
		await unlock(canonicalFile, { realpath: false, lockfilePath: normalized.lockfilePath });
	};
}

export async function unlock(file: string, options?: UnlockOptions): Promise<void> {
	const realpathEnabled = options?.realpath ?? true;
	const canonicalFile = await resolveCanonicalPath(file, realpathEnabled);
	const entry = activeLocks.get(canonicalFile);
	if (entry === undefined) {
		throw new LockError("Lock is not acquired/owned by you", "ENOTACQUIRED", canonicalFile);
	}
	if (entry.updateTimeout !== null) {
		clearTimeout(entry.updateTimeout);
		entry.updateTimeout = null;
	}
	entry.released = true;
	activeLocks.delete(canonicalFile);
	await removeLockFile(getLockFile(canonicalFile, options?.lockfilePath ?? entry.options.lockfilePath));
}

export async function check(file: string, options?: CheckOptions): Promise<boolean> {
	const stale = Math.max(options?.stale ?? 10_000, 2000);
	const realpathEnabled = options?.realpath ?? true;
	const canonicalFile = await resolveCanonicalPath(file, realpathEnabled);
	const lockfilePath = getLockFile(canonicalFile, options?.lockfilePath);
	try {
		const stat = await fsPromises.stat(lockfilePath);
		return !isLockStale(stat, stale);
	} catch (err) {
		if (getErrorCode(err) === "ENOENT") return false;
		throw err;
	}
}

export function lockSync(file: string, options?: LockOptions): ReleaseSyncFn {
	const normalized = normalizeLockOptions(options);
	if (normalized.retries.retries > 0) {
		throw new LockError("Cannot use retries with the sync api", "ESYNC", file);
	}

	const canonicalFile = resolveCanonicalPathSync(file, normalized.realpath);
	const lockfilePath = getLockFile(canonicalFile, normalized.lockfilePath);
	const acquired = acquireLockOnceSync(canonicalFile, lockfilePath, normalized.stale);

	ensureExitHook();
	const entry: LockEntry = {
		lockfilePath,
		mtime: acquired.mtime,
		mtimePrecision: acquired.precision,
		options: normalized,
		lastUpdate: Date.now(),
		updateDelay: null,
		updateTimeout: null,
		released: false,
	};
	activeLocks.set(canonicalFile, entry);
	scheduleHeartbeat(canonicalFile, entry);

	return () => {
		if (entry.released) {
			throw new LockError("Lock is already released", "ERELEASED", canonicalFile);
		}
		unlockSync(canonicalFile, { realpath: false, lockfilePath: normalized.lockfilePath });
	};
}

export function unlockSync(file: string, options?: UnlockOptions): void {
	const realpathEnabled = options?.realpath ?? true;
	const canonicalFile = resolveCanonicalPathSync(file, realpathEnabled);
	const entry = activeLocks.get(canonicalFile);
	if (entry === undefined) {
		throw new LockError("Lock is not acquired/owned by you", "ENOTACQUIRED", canonicalFile);
	}
	if (entry.updateTimeout !== null) {
		clearTimeout(entry.updateTimeout);
		entry.updateTimeout = null;
	}
	entry.released = true;
	activeLocks.delete(canonicalFile);
	removeLockFileSync(getLockFile(canonicalFile, options?.lockfilePath ?? entry.options.lockfilePath));
}

export function checkSync(file: string, options?: CheckOptions): boolean {
	const stale = Math.max(options?.stale ?? 10_000, 2000);
	const realpathEnabled = options?.realpath ?? true;
	const canonicalFile = resolveCanonicalPathSync(file, realpathEnabled);
	const lockfilePath = getLockFile(canonicalFile, options?.lockfilePath);
	try {
		const stat = fs.statSync(lockfilePath);
		return !isLockStale(stat, stale);
	} catch (err) {
		if (getErrorCode(err) === "ENOENT") return false;
		throw err;
	}
}

export function getLocks(): Record<string, LockEntry> {
	const snapshot: Record<string, LockEntry> = {};
	for (const [k, v] of activeLocks) {
		snapshot[k] = v;
	}
	return snapshot;
}

const properLockfile = {
	lock,
	unlock,
	check,
	lockSync,
	unlockSync,
	checkSync,
	getLocks,
};

export default properLockfile;
