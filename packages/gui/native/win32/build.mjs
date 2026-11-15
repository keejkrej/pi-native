import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceFile = join(scriptDir, "src", "win32.c");
const includeDir = resolve(scriptDir, "..", "include");
const outputDir = join(scriptDir, "build");
const outputLib = join(outputDir, "sgui.lib");

const tempDir = mkdtempSync(join(tmpdir(), "pi-gui-win32-"));
try {
	mkdirSync(outputDir, { recursive: true });
	const objFile = join(tempDir, "win32.obj");
	execFileSync(
		"cl",
		["/nologo", "/c", "/TP", "/W3", "/O2", `/I${includeDir}`, `/Fo${objFile}`, sourceFile],
		{ stdio: "inherit" },
	);
	execFileSync("lib", ["/nologo", `/OUT:${outputLib}`, objFile], { stdio: "inherit" });
	console.log(`Built ${outputLib}`);
} finally {
	rmSync(tempDir, { recursive: true, force: true });
}
