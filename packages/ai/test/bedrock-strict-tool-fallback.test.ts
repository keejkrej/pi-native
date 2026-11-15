import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stream as streamBedrock } from "../src/api/bedrock-converse-stream.ts";
import { cleanupSessionResources } from "../src/session-resources.ts";
import type { Model, Tool } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const bedrockMock = {
	inputs: [] as unknown[],
	respond: undefined as ((attempt: number) => Promise<Response>) | undefined,
};

const CRC32_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let j = 0; j < 8; j++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[i] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function encodeEventFrame(eventType: string, payload: unknown): Uint8Array {
	const encoder = new TextEncoder();
	const headerEntries: Array<[string, string]> = [
		[":message-type", "event"],
		[":event-type", eventType],
		[":content-type", "application/json"],
	];
	const headerChunks: Uint8Array[] = [];
	for (const [k, v] of headerEntries) {
		const kb = encoder.encode(k);
		const vb = encoder.encode(v);
		const chunk = new Uint8Array(1 + kb.length + 1 + 2 + vb.length);
		const dv = new DataView(chunk.buffer);
		dv.setUint8(0, kb.length);
		chunk.set(kb, 1);
		dv.setUint8(1 + kb.length, 7);
		dv.setUint16(1 + kb.length + 1, vb.length, false);
		chunk.set(vb, 1 + kb.length + 3);
		headerChunks.push(chunk);
	}
	const headersLen = headerChunks.reduce((n, c) => n + c.length, 0);
	const payloadBytes = encoder.encode(JSON.stringify(payload));
	const totalLen = 12 + headersLen + payloadBytes.length + 4;
	const frame = new Uint8Array(totalLen);
	const dv = new DataView(frame.buffer);
	dv.setUint32(0, totalLen, false);
	dv.setUint32(4, headersLen, false);
	dv.setUint32(8, crc32(frame.subarray(0, 8)), false);
	let pos = 12;
	for (const c of headerChunks) {
		frame.set(c, pos);
		pos += c.length;
	}
	frame.set(payloadBytes, pos);
	dv.setUint32(totalLen - 4, crc32(frame.subarray(0, totalLen - 4)), false);
	return frame;
}

const bedrockMockFetch: typeof globalThis.fetch = async (_input, init) => {
	if (typeof init?.body === "string") {
		bedrockMock.inputs.push(JSON.parse(init.body));
	}
	return bedrockMock.respond!(bedrockMock.inputs.length);
};

const model: Model<"bedrock-converse-stream"> = {
	id: "us.anthropic.claude-opus-5-5",
	name: "Claude Opus 5.5 (US)",
	api: "bedrock-converse-stream",
	provider: "amazon-bedrock",
	baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200000,
	maxTokens: 100,
	compat: { supportsStrictMode: true },
};

// Observed from live Bedrock with 20 optional parameters across strict tools.
const unionLimitMessage =
	"The model returned the following errors: Schemas contains too many parameters with union types (20 parameters with type arrays or anyOf). This causes exponential compilation cost. Reduce the number of nullable or union-typed parameters (limit: 16 parameters with unions).";

type ToolSpecInput = { toolSpec: { name: string; strict?: boolean; inputSchema: { json: unknown } } };
type CommandInput = { toolConfig: { tools: ToolSpecInput[] }; requestMetadata?: Record<string, string> };

function tool(name: string, strict?: "prefer" | "require"): Tool {
	return {
		name,
		description: "Look up a value",
		parameters: Type.Object({ value: Type.String(), optional: Type.Optional(Type.Number()) }),
		...(strict ? { constrainedSampling: { type: "json_schema", strict } } : {}),
	};
}

function sdkError(name: string, message: string): Response {
	return new Response(JSON.stringify({ message }), {
		status: 400,
		headers: {
			"content-type": "application/json",
			"x-amzn-errortype": name,
		},
	});
}

function successResponse(): Promise<Response> {
	const frames = [
		encodeEventFrame("messageStart", { role: "assistant" }),
		encodeEventFrame("messageStop", { stopReason: "end_turn" }),
	];
	const combined = new Uint8Array(frames.reduce((n, f) => n + f.length, 0));
	let offset = 0;
	for (const frame of frames) {
		combined.set(frame, offset);
		offset += frame.length;
	}
	return Promise.resolve(
		new Response(combined, {
			status: 200,
			headers: { "content-type": "application/vnd.amazon.eventstream" },
		}),
	);
}

function run(tools: Tool[], onPayload?: (payload: unknown) => unknown, sessionId?: string) {
	return streamBedrock(
		model,
		normalizeContext({ tools, messages: [{ role: "user", content: "Hello", timestamp: 1 }] }),
		{
			cacheRetention: "none",
			onPayload,
			sessionId,
			fetch: bedrockMockFetch,
			env: { AWS_BEDROCK_SKIP_AUTH: "1" },
		},
	).result();
}

function strictFlags(): (boolean | undefined)[][] {
	return (bedrockMock.inputs as CommandInput[]).map((input) =>
		input.toolConfig.tools.map((tool) => tool.toolSpec.strict),
	);
}

// Regression tests for https://github.com/earendil-works/pi/issues/11416.
describe("Bedrock preferred strict tool fallback", () => {
	beforeEach(() => {
		bedrockMock.inputs = [];
	});

	afterEach(() => cleanupSessionResources());

	it("retries a strict tool limit rejection with preferred tools non-strict and keeps required tools strict", async () => {
		bedrockMock.respond = (attempt) =>
			attempt === 1 ? Promise.resolve(sdkError("ValidationException", unionLimitMessage)) : successResponse();
		const onPayload = vi.fn((payload: unknown) => ({ ...(payload as object), requestMetadata: { team: "a" } }));

		const result = await run([tool("preferred", "prefer"), tool("required", "require"), tool("ordinary")], onPayload);

		expect(result.stopReason).toBe("stop");
		expect(onPayload).toHaveBeenCalledTimes(2);
		const [first, second] = bedrockMock.inputs as CommandInput[];
		expect(first.toolConfig.tools[0].toolSpec).toMatchObject({
			strict: true,
			inputSchema: {
				json: {
					required: ["value", "optional"],
					properties: { optional: { anyOf: [{ type: "number" }, { type: "null" }] } },
				},
			},
		});
		expect(second.toolConfig.tools[0].toolSpec.strict).toBeUndefined();
		expect(second.toolConfig.tools[0].toolSpec.inputSchema.json).toEqual({
			type: "object",
			properties: { value: { type: "string" }, optional: { type: "number" } },
			required: ["value"],
		});
		expect(second.toolConfig.tools[1]).toEqual(first.toolConfig.tools[1]);
		expect(second.toolConfig.tools[1].toolSpec.strict).toBe(true);
		expect(second.toolConfig.tools[2]).toEqual(first.toolConfig.tools[2]);
		expect(second.requestMetadata).toEqual({ team: "a" });
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				type: "bedrock_strict_tools_fallback",
				error: { message: unionLimitMessage },
				details: { reason: "strict_tool_limits_exceeded" },
			}),
		]);
	});

	it("does not retry without preferred strict tools", async () => {
		bedrockMock.respond = () => Promise.resolve(sdkError("ValidationException", unionLimitMessage));

		const result = await run([tool("required", "require"), tool("ordinary")]);

		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe(`Validation error: ${unionLimitMessage}`);
		expect(bedrockMock.inputs).toHaveLength(1);
	});

	it("does not retry other validation errors", async () => {
		bedrockMock.respond = () => Promise.resolve(sdkError("ValidationException", "messages: field required"));

		const result = await run([tool("preferred", "prefer")]);

		expect(result.stopReason).toBe("error");
		expect(bedrockMock.inputs).toHaveLength(1);
	});

	it("retries only once", async () => {
		bedrockMock.respond = () => Promise.resolve(sdkError("ValidationException", unionLimitMessage));

		const result = await run([tool("preferred", "prefer")]);

		expect(result.stopReason).toBe("error");
		expect(bedrockMock.inputs).toHaveLength(2);
	});

	it("does not remember a rejection without a session", async () => {
		bedrockMock.respond = (attempt) =>
			attempt === 1 ? Promise.resolve(sdkError("ValidationException", unionLimitMessage)) : successResponse();

		await run([tool("preferred", "prefer")]);
		await run([tool("preferred", "prefer")]);

		expect(strictFlags()).toEqual([[true], [undefined], [true]]);
	});

	// Regression tests for https://github.com/earendil-works/pi/issues/11626.
	it("sends preferred tools non-strict right away on later requests of a rejected session", async () => {
		bedrockMock.respond = (attempt) =>
			attempt === 1 ? Promise.resolve(sdkError("ValidationException", unionLimitMessage)) : successResponse();
		const tools = [tool("preferred", "prefer"), tool("required", "require")];

		await run(tools, undefined, "rejected");
		const second = await run(tools, undefined, "rejected");
		await run(tools, undefined, "other");

		expect(second.stopReason).toBe("stop");
		expect(second.diagnostics).toBeUndefined();
		expect(strictFlags()).toEqual([
			[true, true],
			[undefined, true],
			[undefined, true],
			[true, true],
		]);
	});

	it("tries strict sampling again after the session's resources are cleaned up", async () => {
		bedrockMock.respond = (attempt) =>
			attempt === 1 ? Promise.resolve(sdkError("ValidationException", unionLimitMessage)) : successResponse();

		await run([tool("preferred", "prefer")], undefined, "cleaned");
		cleanupSessionResources("cleaned");
		await run([tool("preferred", "prefer")], undefined, "cleaned");

		expect(strictFlags()).toEqual([[true], [undefined], [true]]);
	});
});
