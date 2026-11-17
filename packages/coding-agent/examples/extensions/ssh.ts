/**
 * SSH Remote Execution Example
 *
 * Demonstrates delegating tool operations to a remote machine via SSH.
 * When --ssh is provided, read/write/edit/bash run on the remote.
 *
 * Usage:
 *   pi -e ./ssh.ts --ssh user@host
 *   pi -e ./ssh.ts --ssh user@host:/remote/path
 *
 * Requirements:
 *   - SSH key-based auth (no password prompts)
 *   - bash on remote
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type BashOperations,
	createBashTool,
	createEditTool,
	createReadTool,
	createWriteTool,
	type EditOperations,
	type ReadOperations,
	type WriteOperations,
} from "@earendil-works/pi-coding-agent";

async function sshExec(pi: ExtensionAPI, remote: string, command: string): Promise<string> {
	const res = await pi.exec("ssh", [remote, command]);
	if (res.code !== 0) {
		throw new Error(`SSH failed (${res.code}): ${res.stderr}`);
	}
	return res.stdout;
}

function createRemoteReadOps(pi: ExtensionAPI, remote: string, remoteCwd: string, localCwd: string): ReadOperations {
	const toRemote = (p: string) => p.replace(localCwd, remoteCwd);
	return {
		readFile: async (p) => {
			const b64 = await sshExec(pi, remote, `base64 < ${JSON.stringify(toRemote(p))}`);
			return Buffer.from(b64.replace(/\s+/g, ""), "base64");
		},
		access: async (p) => {
			await sshExec(pi, remote, `test -r ${JSON.stringify(toRemote(p))}`);
		},
		detectImageMimeType: async (p) => {
			try {
				const out = await sshExec(pi, remote, `file --mime-type -b ${JSON.stringify(toRemote(p))}`);
				const m = out.trim();
				return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(m) ? m : null;
			} catch {
				return null;
			}
		},
	};
}

function createRemoteWriteOps(pi: ExtensionAPI, remote: string, remoteCwd: string, localCwd: string): WriteOperations {
	const toRemote = (p: string) => p.replace(localCwd, remoteCwd);
	return {
		writeFile: async (p, content) => {
			const b64 = Buffer.from(content).toString("base64");
			await sshExec(pi, remote, `echo ${JSON.stringify(b64)} | base64 -d > ${JSON.stringify(toRemote(p))}`);
		},
		mkdir: async (dir) => {
			await sshExec(pi, remote, `mkdir -p ${JSON.stringify(toRemote(dir))}`);
		},
	};
}

function createRemoteEditOps(pi: ExtensionAPI, remote: string, remoteCwd: string, localCwd: string): EditOperations {
	const r = createRemoteReadOps(pi, remote, remoteCwd, localCwd);
	const w = createRemoteWriteOps(pi, remote, remoteCwd, localCwd);
	return { readFile: r.readFile, access: r.access, writeFile: w.writeFile };
}

function createRemoteBashOps(pi: ExtensionAPI, remote: string, remoteCwd: string, localCwd: string): BashOperations {
	const toRemote = (p: string) => p.replace(localCwd, remoteCwd);
	return {
		exec: async (command, cwd, { onData, signal, timeout }) => {
			const cmd = `cd ${JSON.stringify(toRemote(cwd))} && ${command}`;
			const res = await pi.exec("ssh", [remote, cmd], {
				signal,
				timeout: timeout ? timeout * 1000 : undefined,
			});
			if (res.stdout) onData(Buffer.from(res.stdout, "utf-8"));
			if (res.stderr) onData(Buffer.from(res.stderr, "utf-8"));
			if (signal?.aborted) throw new Error("aborted");
			if (res.killed && timeout) throw new Error(`timeout:${timeout}`);
			return { exitCode: res.code };
		},
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerFlag("ssh", { description: "SSH remote: user@host or user@host:/path", type: "string" });

	const localCwd = process.cwd();
	const localRead = createReadTool(localCwd);
	const localWrite = createWriteTool(localCwd);
	const localEdit = createEditTool(localCwd);
	const localBash = createBashTool(localCwd);

	// Resolved lazily on session_start (CLI flags not available during factory)
	let resolvedSsh: { remote: string; remoteCwd: string } | null = null;

	const getSsh = () => resolvedSsh;

	pi.registerTool({
		...localRead,
		async execute(id, params, signal, onUpdate, _ctx) {
			const ssh = getSsh();
			if (ssh) {
				const tool = createReadTool(localCwd, {
					operations: createRemoteReadOps(pi, ssh.remote, ssh.remoteCwd, localCwd),
				});
				return tool.execute(id, params, signal, onUpdate);
			}
			return localRead.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localWrite,
		async execute(id, params, signal, onUpdate, _ctx) {
			const ssh = getSsh();
			if (ssh) {
				const tool = createWriteTool(localCwd, {
					operations: createRemoteWriteOps(pi, ssh.remote, ssh.remoteCwd, localCwd),
				});
				return tool.execute(id, params, signal, onUpdate);
			}
			return localWrite.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localEdit,
		async execute(id, params, signal, onUpdate, _ctx) {
			const ssh = getSsh();
			if (ssh) {
				const tool = createEditTool(localCwd, {
					operations: createRemoteEditOps(pi, ssh.remote, ssh.remoteCwd, localCwd),
				});
				return tool.execute(id, params, signal, onUpdate);
			}
			return localEdit.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localBash,
		async execute(id, params, signal, onUpdate, _ctx) {
			const ssh = getSsh();
			if (ssh) {
				const tool = createBashTool(localCwd, {
					operations: createRemoteBashOps(pi, ssh.remote, ssh.remoteCwd, localCwd),
				});
				return tool.execute(id, params, signal, onUpdate);
			}
			return localBash.execute(id, params, signal, onUpdate);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		// Resolve SSH config now that CLI flags are available
		const arg = pi.getFlag("ssh") as string | undefined;
		if (arg) {
			if (arg.includes(":")) {
				const [remote, path] = arg.split(":");
				resolvedSsh = { remote, remoteCwd: path };
			} else {
				// No path given, evaluate pwd on remote
				const remote = arg;
				const pwd = (await sshExec(pi, remote, "pwd")).trim();
				resolvedSsh = { remote, remoteCwd: pwd };
			}
			ctx.ui.setStatus("ssh", ctx.ui.theme.fg("accent", `SSH: ${resolvedSsh.remote}:${resolvedSsh.remoteCwd}`));
			ctx.ui.notify(`SSH mode: ${resolvedSsh.remote}:${resolvedSsh.remoteCwd}`, "info");
		}
	});

	// Handle user ! commands via SSH
	pi.on("user_bash", (_event) => {
		const ssh = getSsh();
		if (!ssh) return; // No SSH, use local execution
		return { operations: createRemoteBashOps(pi, ssh.remote, ssh.remoteCwd, localCwd) };
	});

	// Replace local cwd with remote cwd in system prompt
	pi.on("before_agent_start", async (event) => {
		const ssh = getSsh();
		if (ssh) {
			const modified = event.systemPrompt.replace(
				`Current working directory: ${localCwd}`,
				`Current working directory: ${ssh.remoteCwd} (via SSH: ${ssh.remote})`,
			);
			return { systemPrompt: modified };
		}
	});
}
