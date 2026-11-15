const TYPEBOX_META_KEYS = new Set(["~kind", "~optional", "~readonly"]);
const JSON_SCHEMA_NAME_MAPS = new Set([
	"properties",
	"patternProperties",
	"$defs",
	"definitions",
	"dependentSchemas",
	"dependencies",
]);
const JSON_SCHEMA_DATA_KEYS = new Set(["const", "enum", "default", "examples"]);

function cloneSchemaValue(value: unknown, mode: "schema" | "nameMap" | "data"): unknown {
	if (Array.isArray(value)) {
		const items = value as readonly unknown[];
		const childMode = mode === "data" ? "data" : "schema";
		return items.map((item) => cloneSchemaValue(item, childMode));
	}
	if (typeof value === "object" && value !== null) {
		const result: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			if (mode === "schema" && TYPEBOX_META_KEYS.has(key)) continue;
			let nextMode: "schema" | "nameMap" | "data" = "schema";
			if (mode === "data" || (mode === "schema" && JSON_SCHEMA_DATA_KEYS.has(key))) {
				nextMode = "data";
			} else if (mode === "schema" && JSON_SCHEMA_NAME_MAPS.has(key)) {
				nextMode = "nameMap";
			}
			result[key] = cloneSchemaValue(entry, nextMode);
		}
		return result;
	}
	return value;
}

/**
 * Deep-clone a JSON Schema value while removing TypeBox runtime metadata keys (`~kind`, `~optional`, `~readonly`).
 * Node keeps those marks non-enumerable, whereas `scriptc` materializes them as enumerable properties at interface boundaries.
 */
export function stripSchemaMetaKeys(schema: unknown): unknown {
	return cloneSchemaValue(schema, "schema");
}
