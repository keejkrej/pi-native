/**
 * Example extension with local multi-file TypeScript modules.
 * Demonstrates resolving relative imports alongside extension entry points.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { parseDurationMs } from "./duration.ts";

export default function (pi: ExtensionAPI) {
	// Register a tool using the local pure-TS duration parser
	pi.registerTool({
		name: "parse_duration",
		label: "Parse Duration",
		description: "Parse a human-readable duration string (e.g., '2 days', '1h', '5m') to milliseconds",
		parameters: Type.Object({
			duration: Type.String({ description: "Duration string like '2 days', '1h', '5m'" }),
		}),
		execute: async (_toolCallId, params) => {
			const result = parseDurationMs(params.duration);
			if (result === undefined) {
				throw new Error(`Invalid duration: "${params.duration}"`);
			}
			return {
				content: [{ type: "text", text: `${params.duration} = ${result} milliseconds` }],
				details: { milliseconds: result },
			};
		},
	});
}
