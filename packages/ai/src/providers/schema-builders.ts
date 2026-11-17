// Builders for pi-ai's own configuration schemas (model metadata, compat settings): pi-schema's builders, shaped like the
// TypeBox schemas they replace, so models.json and the catalog validate exactly as before.

import {
	type Annotations,
	obj,
	type Properties,
	type Schema,
	type Static,
	type StaticObject,
} from "@pi-ts/schema";

export interface OpenObjectOptions extends Annotations {
	readonly additionalProperties?: true;
}

/** An object that allows other properties; `additionalProperties: true` says so explicitly. */
export function openObject<const P extends Properties>(
	properties: P,
	options: OpenObjectOptions = {},
): Schema<StaticObject<P>> {
	const schema = obj(properties, {
		open: true,
		title: options.title,
		description: options.description,
		examples: options.examples,
		deprecated: options.deprecated,
		default: options.default,
	});
	return options.additionalProperties ? { ...schema, additionalProperties: true } : schema;
}

/** One string: `{ type: "string", const: value }`. */
export function stringLiteral<const V extends string>(value: V, options: Annotations<V> = {}): Schema<V> {
	return { type: "string", const: value, ...options };
}

/** An object with any string keys and values of `value`: `{ type: "object", patternProperties: { "^.*$": value } }`. */
export function stringRecord<S extends Schema>(
	value: S,
	options: Annotations<Record<string, Static<S>>> = {},
): Schema<Record<string, Static<S>>> {
	return { type: "object", patternProperties: { "^.*$": value }, ...options };
}
