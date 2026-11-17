import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TUI_PACKAGE_NAME = "@pi-ts/tui";

export interface NativeModuleCandidateOptions {
	moduleUrl?: string;
	execPath?: string;
	resolvePackage?: (specifier: string) => string;
}

export function getNativeModuleCandidates(nativePath: string, options: NativeModuleCandidateOptions = {}): string[] {
	const moduleDir = dirname(fileURLToPath(options.moduleUrl ?? import.meta.url));
	const candidates: string[] = [];

	if (options.resolvePackage) {
		try {
			const packageEntry = options.resolvePackage(TUI_PACKAGE_NAME);
			candidates.push(join(dirname(packageEntry), "..", nativePath));
		} catch {
			// Standalone binaries do not have an installed TUI package.
		}
	}

	candidates.push(
		join(moduleDir, "..", nativePath),
		join(moduleDir, nativePath),
		join(dirname(options.execPath ?? process.execPath), nativePath),
	);
	return Array.from(new Set(candidates));
}
