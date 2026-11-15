import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, relative, resolve, toNamespacedPath } from "node:path";

const QUARANTINE_DIR_NAME = ".pi-native-quarantine";

function normalizePath(path: string): string {
	return toNamespacedPath(resolve(path));
}

function getQuarantineRoot(packageDir: string): string | undefined {
	let current = resolve(packageDir);
	while (true) {
		if (basename(current).toLowerCase() === "node_modules") {
			return join(current, QUARANTINE_DIR_NAME);
		}
		const parent = dirname(current);
		if (parent === current) {
			return undefined;
		}
		current = parent;
	}
}

function getLoadedSharedObjectsInPackageDir(_packageDir: string): string[] {
	// Native scriptc builds do not dynamically load Node native addons and do not expose process.report.
	return [];
}

export function cleanupWindowsSelfUpdateQuarantine(packageDir: string): void {
	const quarantineRoot = getQuarantineRoot(packageDir);
	if (!quarantineRoot) {
		return;
	}
	try {
		rmSync(quarantineRoot, { recursive: true, force: true });
	} catch {
		// A previous pi process may still be exiting and holding a native addon.
	}
}

export function quarantineWindowsNativeDependencies(packageDir: string): void {
	const resolvedPackageDir = normalizePath(packageDir);
	const quarantineRoot = getQuarantineRoot(resolvedPackageDir);
	if (!quarantineRoot) {
		return;
	}

	const loadedFiles = getLoadedSharedObjectsInPackageDir(resolvedPackageDir);
	if (loadedFiles.length === 0) {
		return;
	}

	const quarantineRunDir = join(quarantineRoot, `${Date.now()}-${process.pid}-${randomUUID()}`);
	for (const loadedFile of loadedFiles) {
		if (!existsSync(loadedFile)) {
			continue;
		}
		const quarantinePath = join(quarantineRunDir, relative(resolvedPackageDir, loadedFile));
		mkdirSync(dirname(quarantinePath), { recursive: true });
		renameSync(loadedFile, quarantinePath);
		copyFileSync(quarantinePath, loadedFile);
	}
}
