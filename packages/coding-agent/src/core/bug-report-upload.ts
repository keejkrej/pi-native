import * as crypto from "node:crypto";
import type { BugReportBundle } from "./bug-report.ts";
import { bugReportFiles } from "./bug-report.ts";
import { getRadiusGatewayUrl } from "./radius.ts";

interface UploadBugReportOptions {
	token?: string;
	signal?: AbortSignal;
	gatewayUrl?: string;
}

/** Upload a report as multipart form data, anonymously or attributed to a Radius account. */
export async function uploadBugReport(
	bundle: BugReportBundle,
	options: UploadBugReportOptions = {},
): Promise<{ id: string }> {
	const boundary = `----pi-bug-report-${crypto.randomUUID()}`;
	const parts: string[] = [];
	for (const file of bugReportFiles(bundle)) {
		const safeName = file.name.replace(/["\r\n]/g, "_");
		parts.push(
			`--${boundary}\r\n` +
				`Content-Disposition: form-data; name="${safeName}"; filename="${safeName}"\r\n` +
				`Content-Type: ${file.contentType}\r\n\r\n` +
				`${file.data}\r\n`,
		);
	}
	parts.push(`--${boundary}--\r\n`);
	const headers: Record<string, string> = {
		"Content-Type": `multipart/form-data; boundary=${boundary}`,
	};
	if (options.token) {
		headers.Authorization = `Bearer ${options.token}`;
	}
	const response = await fetch(new URL("/v1/bug-reports", options.gatewayUrl ?? getRadiusGatewayUrl()), {
		method: "POST",
		headers,
		body: parts.join(""),
		signal: options.signal,
	});
	const json = (await response.json().catch(() => null)) as {
		ok?: boolean;
		bug_report?: { id?: string };
		error?: string;
		description?: string;
	} | null;
	if (response.ok && json?.ok === true && typeof json.bug_report?.id === "string") {
		return { id: json.bug_report.id };
	}
	const detail = json && !json.ok ? json.description || json.error : undefined;
	throw new Error(`Bug report upload failed: ${detail || response.statusText || response.status}`);
}
