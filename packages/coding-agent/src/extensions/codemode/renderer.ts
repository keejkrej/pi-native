/**
 * TUI rendering for the codemode tool call and result.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import type { ToolDefinition, ToolRenderContext, ToolRenderResultOptions } from "../../core/extensions/types.ts";
import { replaceTabs, startToolTimer, str, toolTimerText } from "../../core/tools/render-utils.ts";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import { VisualLinePreview } from "../../modes/interactive/components/visual-truncate.ts";
import { CodeHighlighter, type Theme } from "../../modes/interactive/theme/theme.ts";
import type { CodemodeToolDetails } from "./execute.ts";

const CALL_PREVIEW_LINES = 10;
const OUTPUT_PREVIEW_LINES = 5;
const SCRIPT_HEADER_RE = /^Script (?:completed|failed)\nWall time [^\n]*\nOutput:\n?/;

function formatCost(cost: number): string {
	if (!Number.isFinite(cost) || cost <= 0) return "$0.00";
	if (cost >= 0.01) return `$${cost.toFixed(2)}`;
	const decimals = Math.min(10, 1 - Math.floor(Math.log10(cost)));
	const fixed = cost.toFixed(decimals);
	return `$${fixed.replace(/(\.\d\d\d*?)0+$/, "$1")}`;
}

function stripScriptHeader(content: readonly (TextContent | ImageContent)[]): string {
	const textBlocks: string[] = [];
	let strippedHeader = false;
	for (let i = 0; i < content.length; i++) {
		const block = content[i];
		if (!block || block.type !== "text") continue;
		let text = block.text;
		if (!strippedHeader && i === 0 && SCRIPT_HEADER_RE.test(text)) {
			text = text.replace(SCRIPT_HEADER_RE, "");
			strippedHeader = true;
			if (!text) continue;
		}
		if (text) textBlocks.push(text);
	}
	return textBlocks.join("\n");
}

/**
 * Static component subclass holding a cached CodeHighlighter for codemode call rendering.
 */
class CodemodeCallComponent extends Text {
	constructor() {
		super("", 0, 0);
	}

	updateCall(
		code: string,
		expanded: boolean,
		theme: Theme,
		sharedHighlighter: CodeHighlighter,
	): void {
		const title = theme.fg("toolTitle", theme.bold("codemode"));
		if (!code) {
			this.setText(title);
			return;
		}

		const normalized = replaceTabs(code);
		const highlighted = sharedHighlighter.highlight(normalized, "javascript");
		if (expanded || highlighted.length <= CALL_PREVIEW_LINES) {
			this.setText(`${title}\n${highlighted.join("\n")}`);
			return;
		}

		const remaining = highlighted.length - CALL_PREVIEW_LINES;
		const hint = `${theme.fg("muted", `... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
		this.setText(`${title}\n${highlighted.slice(0, CALL_PREVIEW_LINES).join("\n")}\n${hint}`);
	}
}

/**
 * Static Container subclass for codemode tool execution results.
 */
class CodemodeResultComponent extends Container {
	rebuild(
		result: AgentToolResult<CodemodeToolDetails | undefined>,
		options: ToolRenderResultOptions,
		theme: Theme,
		context: ToolRenderContext,
	): void {
		this.clear();

		const details = result.details;
		const calls = details?.calls ?? [];
		const callLines: string[] = [];
		let modelCostTotal = 0;
		let hasModelCost = false;

		for (const call of calls) {
			const icon = call.status === "ok" ? theme.fg("success", "✓") : theme.fg("error", "✗");
			const argsPart = call.args ? ` ${theme.fg("muted", call.args)}` : "";
			const durationPart = theme.fg("dim", ` ${call.durationMs}ms`);
			const costPart = typeof call.cost === "number" ? theme.fg("dim", ` ${formatCost(call.cost)}`) : "";
			if (typeof call.cost === "number") {
				modelCostTotal += call.cost;
				hasModelCost = true;
			}
			callLines.push(`${icon} ${call.name}${argsPart}${durationPart}${costPart}`);
		}

		if (hasModelCost) {
			callLines.push(theme.fg("muted", `Model calls: ${formatCost(modelCostTotal)}`));
		}

		if (callLines.length > 0) {
			this.addChild(new Text(callLines.join("\n"), 0, 0));
		}

		const rawOutput = stripScriptHeader(result.content);
		if (rawOutput.length > 0) {
			if (callLines.length > 0) {
				this.addChild(new Spacer(1));
			}
			const isError = context.isError || Boolean((result as { isError?: boolean }).isError);
			const normalizedOutput = replaceTabs(rawOutput);
			const styledOutput = isError ? theme.fg("error", normalizedOutput) : normalizedOutput;

			if (options.expanded) {
				this.addChild(new Text(styledOutput, 0, 0));
			} else {
				this.addChild(
					new VisualLinePreview({
						text: styledOutput,
						maxVisualLines: OUTPUT_PREVIEW_LINES,
						keep: "start",
						formatHint: (hidden) =>
							`${theme.fg("muted", `... (${hidden} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`,
					}),
				);
			}
		}

		if (details?.fullOutputPath) {
			this.addChild(new Text(theme.fg("muted", `Full output: ${details.fullOutputPath}`), 0, 0));
		}

		const timerText = toolTimerText(context, options.isPartial);
		if (timerText) {
			this.addChild(new Text(timerText, 0, 0));
		}

		this.invalidate();
	}
}

export const codemodeRenderers: Pick<ToolDefinition<any, CodemodeToolDetails | undefined>, "renderCall" | "renderResult"> =
	{
		renderCall(args, theme, context) {
			startToolTimer(context);
			const code = str((args as { code?: unknown } | undefined)?.code) ?? "";
			let highlighter = context.state.codeHighlighter as CodeHighlighter | undefined;
			if (!highlighter) {
				highlighter = new CodeHighlighter();
				context.state.codeHighlighter = highlighter;
			}
			const component =
				context.lastComponent instanceof CodemodeCallComponent
					? context.lastComponent
					: new CodemodeCallComponent();
			component.updateCall(code, context.expanded, theme, highlighter);
			return component;
		},

		renderResult(result, options, theme, context) {
			const component =
				context.lastComponent instanceof CodemodeResultComponent
					? context.lastComponent
					: new CodemodeResultComponent();
			component.rebuild(result, options, theme, context);
			return component;
		},
	};
