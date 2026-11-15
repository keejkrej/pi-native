/**
 * Pure TypeScript structural wire types for the OpenAI Responses API.
 *
 * Kept independent of `openai` `.d.ts` declarations so native `scriptc` code
 * never lowers local request arrays, messages, or SSE/WebSocket events as
 * foreign Node-island handles.
 */

export type ResponseStatus = "completed" | "failed" | "in_progress" | "cancelled" | "queued" | "incomplete";

export type ServiceTier = "auto" | "default" | "flex" | "scale" | "priority" | "fast" | "ultrafast" | null;

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null;

export type ImageDetail = "low" | "high" | "auto" | "original";

export type ResponseToolChoice =
	| "none"
	| "auto"
	| "required"
	| { type: "function"; name: string }
	| { type: string; [key: string]: unknown };

export interface ResponseInputText {
	type: "input_text";
	text: string;
}

export interface ResponseInputImage {
	type: "input_image";
	image_url?: string | null;
	file_id?: string | null;
	detail: ImageDetail;
}

export interface ResponseInputFile {
	type: "input_file";
	file_data?: string;
	file_id?: string | null;
	filename?: string;
	file_url?: string;
}

export type ResponseInputContent = ResponseInputText | ResponseInputImage | ResponseInputFile;

export interface ResponseOutputText {
	type: "output_text";
	text: string;
	annotations?: unknown[];
}

export interface ResponseOutputRefusal {
	type: "refusal";
	refusal: string;
}

export interface ResponseOutputMessage {
	type: "message";
	id: string;
	role: "assistant";
	status: "in_progress" | "completed" | "incomplete";
	content: Array<ResponseOutputText | ResponseOutputRefusal>;
	phase?: "commentary" | "final_answer" | null;
}

export interface ResponseReasoningItem {
	type: "reasoning";
	id: string;
	summary: Array<{ type: "summary_text"; text: string }>;
	content?: Array<{ type: "reasoning_text"; text: string }>;
	encrypted_content?: string | null;
	status?: "in_progress" | "completed" | "incomplete";
}

export interface ResponseFunctionToolCall {
	type: "function_call";
	id?: string;
	call_id: string;
	name: string;
	arguments: string;
	namespace?: string;
	status?: "in_progress" | "completed" | "incomplete";
}

export interface ResponseCustomToolCall {
	type: "custom_tool_call";
	id?: string;
	call_id: string;
	name: string;
	input: string;
	namespace?: string;
}

export interface ResponseFunctionCallOutputItem {
	type: "function_call_output";
	call_id: string;
	output: string | ResponseInputContent[];
	id?: string | null;
	status?: "in_progress" | "completed" | "incomplete" | null;
}

export interface ResponseCustomToolCallOutput {
	type: "custom_tool_call_output";
	call_id: string;
	output: string | ResponseInputContent[];
	id?: string;
}

export interface ResponseToolSearchCallItem {
	type: "tool_search_call";
	call_id?: string | null;
	execution?: "server" | "client";
	status?: "in_progress" | "completed" | "incomplete";
	arguments?: unknown;
}

export interface ResponseToolSearchOutputItemParam {
	type: "tool_search_output";
	call_id?: string | null;
	execution?: "server" | "client";
	status?: "in_progress" | "completed" | "incomplete";
	tools: Tool[];
}

export interface ResponseAdditionalToolsItem {
	type: "additional_tools";
	role: "developer";
	tools: Tool[];
}

export namespace ResponseConfigurationUpdateItemParam {
	export interface Reasoning {
		effort?: ReasoningEffort;
	}
}

export interface ResponseConfigurationUpdateItemParam {
	type: "configuration_update";
	reasoning?: ResponseConfigurationUpdateItemParam.Reasoning | null;
}

export interface EasyInputMessage {
	type?: "message";
	role: "user" | "assistant" | "system" | "developer";
	content: string | ResponseInputContent[];
	phase?: "commentary" | "final_answer" | null;
}

export type ResponseInputItem =
	| EasyInputMessage
	| ResponseOutputMessage
	| ResponseReasoningItem
	| ResponseFunctionToolCall
	| ResponseFunctionCallOutputItem
	| ResponseCustomToolCall
	| ResponseCustomToolCallOutput
	| ResponseToolSearchCallItem
	| ResponseToolSearchOutputItemParam
	| ResponseAdditionalToolsItem
	| ResponseConfigurationUpdateItemParam;

export type ResponseInput = ResponseInputItem[];

export interface FunctionTool {
	type: "function";
	name: string;
	description?: string | null;
	parameters: Record<string, unknown> | null;
	strict?: boolean | null;
	defer_loading?: boolean;
}

export interface CustomTool {
	type: "custom";
	name: string;
	description?: string;
	format?:
		| { type: "text" }
		| {
				type: "grammar";
				syntax: "lark" | "regex";
				definition: string;
		  };
	defer_loading?: boolean;
}

export type Tool = FunctionTool | CustomTool;

export interface ResponseCreateParamsStreaming {
	model: string;
	input: ResponseInput;
	stream: true;
	prompt_cache_key?: string;
	prompt_cache_retention?: "24h" | "in_memory" | null;
	prompt_cache_options?: { mode?: "explicit" | "automatic"; ttl?: string };
	store?: boolean | null;
	max_output_tokens?: number | null;
	temperature?: number | null;
	service_tier?: ServiceTier;
	tools?: Tool[];
	tool_choice?: ResponseToolChoice;
	reasoning?: {
		effort?: ReasoningEffort;
		summary?: "auto" | "concise" | "detailed" | null;
	} | null;
	include?: string[] | null;
	[key: string]: unknown;
}

export type UnhandledResponseOutputItemType =
	| "file_search_call"
	| "function_call_output"
	| "web_search_call"
	| "computer_call"
	| "computer_call_output"
	| "program"
	| "program_output"
	| "tool_search_call"
	| "tool_search_output"
	| "additional_tools"
	| "compaction"
	| "image_generation_call"
	| "code_interpreter_call"
	| "local_shell_call"
	| "local_shell_call_output"
	| "shell_call"
	| "shell_call_output"
	| "apply_patch_call"
	| "apply_patch_call_output"
	| "mcp_call"
	| "mcp_list_tools"
	| "mcp_approval_request"
	| "mcp_approval_response"
	| "custom_tool_call_output";

export type ResponseOutputItem =
	| ResponseOutputMessage
	| ResponseReasoningItem
	| ResponseFunctionToolCall
	| ResponseCustomToolCall
	| { type: UnhandledResponseOutputItemType };

export interface ResponseUsagePayload {
	input_tokens: number;
	output_tokens: number;
	total_tokens?: number;
	input_tokens_details?: {
		cached_tokens?: number;
		cache_write_tokens?: number;
	};
	output_tokens_details?: {
		reasoning_tokens?: number;
	};
}

export interface ResponseObjectPayload {
	id?: string;
	status?: ResponseStatus;
	output?: ResponseOutputItem[];
	usage?: ResponseUsagePayload | null;
	service_tier?: ServiceTier;
	error?: {
		code?: string | null;
		message?: string | null;
	} | null;
	incomplete_details?: {
		reason?: unknown;
	} | null;
}

export type UnhandledResponseStreamEventType =
	| "response.audio.delta"
	| "response.audio.done"
	| "response.audio.transcript.delta"
	| "response.audio.transcript.done"
	| "response.code_interpreter_call_code.delta"
	| "response.code_interpreter_call_code.done"
	| "response.code_interpreter_call.completed"
	| "response.code_interpreter_call.in_progress"
	| "response.code_interpreter_call.interpreting"
	| "response.compaction.compacting"
	| "response.content_part.added"
	| "response.content_part.done"
	| "response.file_search_call.completed"
	| "response.file_search_call.in_progress"
	| "response.file_search_call.searching"
	| "response.image_generation_call.completed"
	| "response.image_generation_call.generating"
	| "response.image_generation_call.in_progress"
	| "response.image_generation_call.partial_image"
	| "response.in_progress"
	| "response.mcp_call_arguments.delta"
	| "response.mcp_call_arguments.done"
	| "response.mcp_call.completed"
	| "response.mcp_call.failed"
	| "response.mcp_call.in_progress"
	| "response.mcp_list_tools.completed"
	| "response.mcp_list_tools.failed"
	| "response.mcp_list_tools.in_progress"
	| "response.output_text.annotation.added"
	| "response.output_text.done"
	| "response.queued"
	| "response.reasoning_summary_part.added"
	| "response.reasoning_summary_text.done"
	| "response.reasoning_text.done"
	| "response.refusal.done"
	| "response.shell_call_command.added"
	| "response.shell_call_command.delta"
	| "response.shell_call_command.done"
	| "response.shell_call_output_content.delta"
	| "response.shell_call_output_content.done"
	| "response.web_search_call.completed"
	| "response.web_search_call.in_progress"
	| "response.web_search_call.searching";

export type ResponseStreamEvent =
	| { type: "response.created"; response: ResponseObjectPayload }
	| { type: "response.output_item.added"; output_index: number; item: ResponseOutputItem }
	| { type: "response.output_item.done"; output_index: number; item: ResponseOutputItem }
	| { type: "response.reasoning_summary_text.delta"; output_index: number; delta: string }
	| { type: "response.reasoning_summary_part.done"; output_index: number }
	| { type: "response.reasoning_text.delta"; output_index: number; delta: string }
	| { type: "response.output_text.delta"; output_index: number; delta: string }
	| { type: "response.refusal.delta"; output_index: number; delta: string }
	| { type: "response.function_call_arguments.delta"; output_index: number; delta: string }
	| { type: "response.function_call_arguments.done"; output_index: number; arguments: string }
	| { type: "response.custom_tool_call_input.delta"; output_index: number; delta: string }
	| { type: "response.custom_tool_call_input.done"; output_index: number; input: string }
	| { type: "response.completed"; response: ResponseObjectPayload }
	| { type: "response.incomplete"; response: ResponseObjectPayload }
	| { type: "response.failed"; response?: ResponseObjectPayload }
	| { type: "error"; code?: string | null; message?: string }
	| { type: UnhandledResponseStreamEventType };
