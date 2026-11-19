/**
 * Non-intrusive live component inspection and semantic layout annotation registry for Waku UI replication.
 * Reads live layoutRect, Box styles, Stack flex parameters, accessibility labels, and children directly from
 * rendered GuiComponent trees without altering runtime rendering or hardcoding output coordinates.
 */

import {
	Box,
	Button,
	Editor,
	type GuiComponent,
	HStack,
	IconButton,
	Input,
	ScrollView,
	Text,
	TruncatedText,
	type VectorIconName,
	VStack,
	WindowDragArea,
} from "@pi-ts/gui";

/** Map a provider identifier to a native Waku vector brand mark. */
export function providerIconForId(provider?: string): VectorIconName {
	const p = (provider ?? "").toLowerCase();
	if (p.includes("anthropic") || p.includes("claude")) return "provider-claude";
	if (p.includes("openai") || p.includes("codex")) return "provider-openai";
	if (p.includes("google") || p.includes("gemini")) return "provider-google";
	if (p === "pi") return "provider-pi";
	return "provider-generic";
}

export type SpecOverflow = "hidden" | "auto" | "scroll" | "visible";

export interface SpecFlowInfo {
	readonly type: "flex" | "block" | "inline";
	readonly dir?: "row" | "column";
	readonly justify?: "start" | "center" | "end" | "between";
	readonly align?: "start" | "center" | "end" | "stretch" | "baseline";
	readonly wrap?: "nowrap" | "wrap";
	readonly gap?: number;
}

export interface SpecSizeInfo {
	readonly w: number | "fill" | "hug";
	readonly h: number | "fill" | "hug";
}

export interface SpecTextInfo {
	readonly value: string;
	readonly wrap: "nowrap" | "wrap";
	readonly lines: number | null;
	readonly overflow: "ellipsis" | "clip" | "visible";
}

export interface SpecAssetInfo {
	readonly kind: string;
	readonly ref?: string | null;
	readonly alt?: string | null;
	readonly w?: number;
	readonly h?: number;
}

export interface UiSpecAnnotation {
	readonly key: string;
	readonly role: string;
	readonly flow?: SpecFlowInfo | (() => SpecFlowInfo);
	readonly flowComponent?: GuiComponent;
	readonly margin?: readonly [number, number, number, number];
	readonly padding?:
		| readonly [number, number, number, number]
		| (() => readonly [number, number, number, number]);
	readonly border?: readonly [number, number, number, number];
	readonly size?: SpecSizeInfo | (() => SpecSizeInfo);
	readonly overflow?: SpecOverflow;
	readonly z?: number;
	readonly variant?: string | null | (() => string | null);
	readonly state?: string | (() => string);
	readonly text?: SpecTextInfo | null | (() => SpecTextInfo | null);
	readonly asset?: SpecAssetInfo | null;
	readonly skipChildren?: boolean;
}

export interface SpecChildrenProvider {
	getSpecChildComponents(): readonly GuiComponent[];
}

export interface ExtractedSpecNode {
	readonly key: string;
	readonly parent: string | null;
	readonly order: number;
	readonly role: string;
	readonly bounds: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
	readonly flow: SpecFlowInfo;
	readonly box: {
		readonly padding: readonly [number, number, number, number];
		readonly margin: readonly [number, number, number, number];
		readonly border: readonly [number, number, number, number];
	};
	readonly size: SpecSizeInfo;
	readonly overflow: SpecOverflow;
	readonly z: number;
	readonly variant: string | null;
	readonly state: string;
	readonly text: SpecTextInfo | null;
	readonly asset: SpecAssetInfo | null;
}

const specMetaRegistry = new Map<number, UiSpecAnnotation>();
const extraChildProviders = new Map<number, () => readonly GuiComponent[]>();

function roundMetric(value: number): number {
	const rounded = Math.round(value * 10) / 10;
	return Object.is(rounded, -0) ? 0 : rounded;
}

/** Remove any semantic UI-replication metadata from a GuiComponent instance. */
export function clearSpecAnnotation(component: GuiComponent): void {
	specMetaRegistry.delete(component.a11yId);
}

/** Associate semantic UI-replication metadata with a live GuiComponent instance by its stable a11yId. */
export function annotateSpecNode<T extends GuiComponent>(component: T, meta: UiSpecAnnotation): T {
	specMetaRegistry.set(component.a11yId, meta);
	return component;
}

/** Register custom child traversal on composite components whose children are private fields. */
export function registerSpecChildren<T extends GuiComponent>(
	component: T,
	provider: () => readonly GuiComponent[],
): T {
	extraChildProviders.set(component.a11yId, provider);
	return component;
}

/** Read attached semantic metadata for a GuiComponent, if present. */
export function getSpecAnnotation(component: GuiComponent): UiSpecAnnotation | undefined {
	return specMetaRegistry.get(component.a11yId);
}

/** Enumerate direct child GuiComponents from built-in containers or registered composite providers. */
export function getDirectChildComponents(component: GuiComponent): readonly GuiComponent[] {
	const customProvider = extraChildProviders.get(component.a11yId);
	if (customProvider !== undefined) {
		return customProvider();
	}
	if (component instanceof Box) {
		const child = component.getChild();
		return child !== undefined ? [child] : [];
	}
	if (component instanceof WindowDragArea) {
		const child = component.getChild();
		return child !== undefined ? [child] : [];
	}
	if (component instanceof ScrollView) {
		const child = component.getChild();
		return child !== undefined ? [child] : [];
	}
	if (component instanceof VStack || component instanceof HStack) {
		return component.getChildren();
	}
	return [];
}

function readFlowFromComponent(component: GuiComponent, annotation: UiSpecAnnotation): SpecFlowInfo {
	if (annotation.flow !== undefined) {
		return typeof annotation.flow === "function" ? annotation.flow() : annotation.flow;
	}
	const target = annotation.flowComponent ?? component;
	const innerChild =
		target instanceof Box || target instanceof WindowDragArea ? target.getChild() : target;
	const stack =
		target instanceof VStack || target instanceof HStack
			? target
			: innerChild instanceof VStack || innerChild instanceof HStack
				? innerChild
				: undefined;
	if (stack !== undefined) {
		const st = stack.getStackStyle();
		return {
			type: "flex",
			dir: st.direction === "vertical" ? "column" : "row",
			justify: st.justify === "space-between" ? "between" : st.justify,
			align: st.align,
			wrap: "nowrap",
			gap: roundMetric(st.gap),
		};
	}
	if (component instanceof IconButton) {
		return { type: "flex", dir: "row", justify: "center", align: "center", wrap: "nowrap", gap: 0 };
	}
	if (component instanceof Button) {
		return { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 6 };
	}
	if (component instanceof Text || component instanceof TruncatedText) {
		return { type: "inline" };
	}
	return { type: "block" };
}

function readBoxFromComponent(
	component: GuiComponent,
	annotation: UiSpecAnnotation,
): {
	readonly padding: readonly [number, number, number, number];
	readonly margin: readonly [number, number, number, number];
	readonly border: readonly [number, number, number, number];
} {
	const margin = annotation.margin ?? [0, 0, 0, 0];
	let padding = typeof annotation.padding === "function" ? annotation.padding() : annotation.padding;
	let border = annotation.border;

	if (component instanceof Box) {
		const style = component.getStyleInfo();
		if (padding === undefined) {
			padding = [
				roundMetric(style.padding.top),
				roundMetric(style.padding.right),
				roundMetric(style.padding.bottom),
				roundMetric(style.padding.left),
			];
		}
		if (border === undefined) {
			border = [
				roundMetric(style.borderEdges.top),
				roundMetric(style.borderEdges.right),
				roundMetric(style.borderEdges.bottom),
				roundMetric(style.borderEdges.left),
			];
		}
	} else if (component instanceof VStack || component instanceof HStack) {
		const st = component.getStackStyle();
		if (padding === undefined) {
			padding = [
				roundMetric(st.padding.top),
				roundMetric(st.padding.right),
				roundMetric(st.padding.bottom),
				roundMetric(st.padding.left),
			];
		}
	}

	return {
		padding: padding ?? [0, 0, 0, 0],
		margin,
		border: border ?? [0, 0, 0, 0],
	};
}

function readSizeFromComponent(component: GuiComponent, annotation: UiSpecAnnotation): SpecSizeInfo {
	if (annotation.size !== undefined) {
		return typeof annotation.size === "function" ? annotation.size() : annotation.size;
	}
	if (component instanceof Box) {
		const style = component.getStyleInfo();
		const w: number | "fill" | "hug" =
			style.fixedWidth !== undefined
				? roundMetric(style.fixedWidth)
				: style.maxWidth !== undefined
					? roundMetric(style.maxWidth)
					: style.fillWidth
						? "fill"
						: "hug";
		const h: number | "fill" | "hug" =
			style.fixedHeight !== undefined
				? roundMetric(style.fixedHeight)
				: style.fillHeight
					? "fill"
					: "hug";
		return { w, h };
	}
	if (component instanceof IconButton) {
		return {
			w: roundMetric(component.layoutRect.width),
			h: roundMetric(component.layoutRect.height),
		};
	}
	if (component instanceof Text || component instanceof TruncatedText) {
		return { w: "hug", h: "hug" };
	}
	return { w: "fill", h: "hug" };
}

function readTextFromComponent(component: GuiComponent, annotation: UiSpecAnnotation): SpecTextInfo | null {
	if (annotation.text !== undefined) {
		return typeof annotation.text === "function" ? annotation.text() : annotation.text;
	}
	if (component instanceof Text) {
		return { value: component.getText(), wrap: "nowrap", lines: 1, overflow: "ellipsis" };
	}
	if (component instanceof TruncatedText) {
		return { value: component.getText(), wrap: "nowrap", lines: 1, overflow: "ellipsis" };
	}
	if (component instanceof Button) {
		return { value: component.getLabel(), wrap: "nowrap", lines: 1, overflow: "ellipsis" };
	}
	if (component instanceof Input) {
		const text = component.getValue().length > 0 ? component.getValue() : component.getPlaceholder();
		return text.length > 0 ? { value: text, wrap: "nowrap", lines: 1, overflow: "ellipsis" } : null;
	}
	if (component instanceof Editor) {
		const text = component.getText();
		return { value: text.length > 0 ? text : "Prompt editor", wrap: "nowrap", lines: 1, overflow: "ellipsis" };
	}
	return null;
}

/**
 * Walk a live laid-out GuiComponent tree and extract canonical ui-layout-spec/1 nodes
 * whose bounds are read strictly from live component.layoutRect.
 */
export function collectLiveSpecNodes(rootComponent: GuiComponent): ExtractedSpecNode[] {
	const out: ExtractedSpecNode[] = [];
	const childCountByParent = new Map<string, number>();

	const visit = (component: GuiComponent, parentKey: string | null): void => {
		if (!component.visible) {
			return;
		}
		const annotation = getSpecAnnotation(component);
		let nextParent = parentKey;
		if (annotation !== undefined) {
			const r = component.layoutRect;
			if (r.width <= 0 && r.height <= 0) {
				return;
			}
			const countKey = parentKey ?? "__root__";
			const order = childCountByParent.get(countKey) ?? 0;
			childCountByParent.set(countKey, order + 1);

			const state =
				annotation.state === undefined
					? "default"
					: typeof annotation.state === "function"
						? annotation.state()
						: annotation.state;

			const variant =
				annotation.variant === undefined
					? null
					: typeof annotation.variant === "function"
						? annotation.variant()
						: annotation.variant;

			out.push({
				key: annotation.key,
				parent: parentKey,
				order,
				role: annotation.role,
				bounds: {
					x: roundMetric(r.x),
					y: roundMetric(r.y),
					w: roundMetric(r.width),
					h: roundMetric(r.height),
				},
				flow: readFlowFromComponent(component, annotation),
				box: readBoxFromComponent(component, annotation),
				size: readSizeFromComponent(component, annotation),
				overflow: annotation.overflow ?? (component instanceof ScrollView ? "auto" : "hidden"),
				z: annotation.z ?? 0,
				variant,
				state,
				text: readTextFromComponent(component, annotation),
				asset: annotation.asset ?? null,
			});
			nextParent = annotation.key;
			if (annotation.skipChildren) {
				return;
			}
		}

		const children = getDirectChildComponents(component);
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			if (child !== undefined) {
				visit(child, nextParent);
			}
		}
	};

	visit(rootComponent, null);
	return out;
}

/** Find a rendered component inside a GuiComponent subtree by its annotated key. */
export function findComponentBySpecKey(rootComponent: GuiComponent, key: string): GuiComponent | undefined {
	if (!rootComponent.visible) return undefined;
	const ann = getSpecAnnotation(rootComponent);
	if (ann?.key === key) {
		return rootComponent;
	}
	const children = getDirectChildComponents(rootComponent);
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (child !== undefined) {
			const match = findComponentBySpecKey(child, key);
			if (match !== undefined) return match;
		}
	}
	return undefined;
}
