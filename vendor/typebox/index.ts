/**
 * Pure TypeScript vendored subset of TypeBox (v1.x schema builders & types).
 * Zero third-party dependencies; `Static<T>` re-exported from `@earendil-works/pi-schema`.
 */

import type { Schema, Static } from "@earendil-works/pi-schema";

export type { Static };

export interface TSchema {
	readonly [keyword: string]: unknown;
}

export interface TSchemaOptions extends TSchema {
	readonly $id?: string;
	readonly $schema?: string;
	readonly $comment?: string;
	readonly title?: string;
	readonly description?: string;
	readonly default?: unknown;
	readonly examples?: readonly unknown[];
	readonly deprecated?: boolean;
	readonly readOnly?: boolean;
	readonly writeOnly?: boolean;
	readonly additionalProperties?: boolean | TSchema;
	readonly minProperties?: number;
	readonly maxProperties?: number;
	readonly format?: string;
	readonly pattern?: string;
	readonly minLength?: number;
	readonly maxLength?: number;
	readonly minimum?: number | bigint;
	readonly maximum?: number | bigint;
	readonly exclusiveMinimum?: number | bigint;
	readonly exclusiveMaximum?: number | bigint;
	readonly multipleOf?: number | bigint;
	readonly minItems?: number;
	readonly maxItems?: number;
	readonly uniqueItems?: boolean;
}

export type TProperties = Record<string, TSchema>;

export interface TString extends TSchema {
	readonly "~kind": "String";
	readonly type: "string";
}

export interface TNumber extends TSchema {
	readonly "~kind": "Number";
	readonly type: "number";
}

export interface TInteger extends TSchema {
	readonly "~kind": "Integer";
	readonly type: "integer";
}

export interface TBoolean extends TSchema {
	readonly "~kind": "Boolean";
	readonly type: "boolean";
}

export interface TNull extends TSchema {
	readonly "~kind": "Null";
	readonly type: "null";
}

export interface TUndefined extends TSchema {
	readonly "~kind": "Undefined";
	readonly type: "undefined";
}

export interface TBigInt extends TSchema {
	readonly "~kind": "BigInt";
	readonly type: "bigint";
}

export interface TNever extends TSchema {
	readonly "~kind": "Never";
	readonly not: Record<string, never>;
}

export interface TVoid extends TSchema {
	readonly "~kind": "Void";
	readonly type: "void";
}

export interface TAny extends TSchema {
	readonly "~kind": "Any";
}

export interface TUnknown extends TSchema {
	readonly "~kind": "Unknown";
}

export type TLiteralValue = string | number | boolean | bigint;

export interface TLiteral<T extends TLiteralValue = TLiteralValue> extends TSchema {
	readonly "~kind": "Literal";
	readonly type: T extends string
		? "string"
		: T extends number
			? "number"
			: T extends bigint
				? "bigint"
				: "boolean";
	readonly const: T;
}

export interface TSymbol extends TSchema {
	readonly "~kind": "Symbol";
	readonly type: "symbol";
}

export interface TTemplateLiteral<T extends string = string> extends TSchema {
	readonly "~kind": "TemplateLiteral";
	readonly type: "string";
	readonly pattern: T;
}

export interface TArray<T extends TSchema = TSchema> extends TSchema {
	readonly "~kind": "Array";
	readonly type: "array";
	readonly items: T;
}

export type TOptional<T extends TSchema = TSchema> = T & {
	readonly "~optional": true;
};

export type TReadonly<T extends TSchema = TSchema> = T & {
	readonly "~readonly": true;
};

export type TReadonlyOptional<T extends TSchema = TSchema> = T & {
	readonly "~readonly": true;
	readonly "~optional": true;
};

export interface TObject<T extends TProperties = TProperties> extends TSchema {
	readonly "~kind": "Object";
	readonly type: "object";
	readonly properties: T;
	readonly required?: readonly string[];
}

export interface TUnion<T extends readonly TSchema[] = readonly TSchema[]> extends TSchema {
	readonly "~kind": "Union";
	readonly anyOf: T;
}

export type TRecordPattern<K extends TSchema> = K extends { readonly "~kind": "Integer" }
	? "^-?(?:0|[1-9][0-9]*)$"
	: K extends { readonly "~kind": "Number" }
		? "^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$"
		: "^.*$";

type UnionRecordLiteralKeys<T extends readonly TSchema[]> = T extends readonly [
	infer First extends TSchema,
	...infer Rest extends readonly TSchema[],
]
	? [RecordLiteralKey<First>] extends [never]
		? never
		: Rest extends readonly []
			? RecordLiteralKey<First>
			: [UnionRecordLiteralKeys<Rest>] extends [never]
				? never
				: RecordLiteralKey<First> | UnionRecordLiteralKeys<Rest>
	: never;

type RecordLiteralKey<K extends TSchema> = K extends TLiteral<infer S extends string>
	? string extends S
		? never
		: S
	: K extends TEnum<infer E>
		? [E[number]] extends [string]
			? string extends E[number]
				? never
				: E[number]
			: never
		: K extends TUnion<infer B>
			? UnionRecordLiteralKeys<B>
			: never;

export type TRecord<K extends TSchema = TSchema, V extends TSchema = TSchema> = [
	RecordLiteralKey<K>,
] extends [never]
	? TSchema & {
			readonly "~kind": "Record";
			readonly type: "object";
			readonly patternProperties: Record<TRecordPattern<K>, V>;
		}
	: TSchema & {
			readonly "~kind": "Object";
			readonly type: "object";
			readonly properties: Record<RecordLiteralKey<K>, V>;
			readonly required: readonly string[];
		};

export type TEnumValue = string | number;

export interface TEnum<T extends readonly TEnumValue[] = readonly TEnumValue[]> extends TSchema {
	readonly "~kind": "Enum";
	readonly enum: T;
}

export interface TTuple<T extends readonly TSchema[] = readonly TSchema[]> extends TSchema {
	readonly "~kind": "Tuple";
	readonly type: "array";
	readonly additionalItems: false;
	readonly items: T;
	readonly minItems: number;
}

export interface TIntersect<T extends readonly TSchema[] = readonly TSchema[]> extends TSchema {
	readonly "~kind": "Intersect";
	readonly allOf: T;
}

export interface TRef<T extends string = string> extends TSchema {
	readonly "~kind": "Ref";
	readonly $ref: T;
}

export type TUnsafe<T = unknown> = Schema<T>;

interface TypeMeta {
	readonly kind?: string;
	readonly optional?: boolean;
	readonly readonly?: boolean;
}

function setMeta(schema: object, meta: TypeMeta): void {
	if (meta.kind !== undefined) {
		Object.defineProperty(schema, "~kind", { value: meta.kind, enumerable: false, configurable: true });
	}
	if (meta.optional === true) {
		Object.defineProperty(schema, "~optional", { value: true, enumerable: false, configurable: true });
	}
	if (meta.readonly === true) {
		Object.defineProperty(schema, "~readonly", { value: true, enumerable: false, configurable: true });
	}
}

function getMeta(schema: object): TypeMeta {
	// Read non-enumerable (Node) or boundary-materialized (scriptc) marker properties directly
	// without WeakMap, so native reference schemas work as keys across all scriptc tiers.
	const raw = schema as Record<string, unknown>;
	return {
		kind: typeof raw["~kind"] === "string" ? raw["~kind"] : undefined,
		optional: raw["~optional"] === true ? true : undefined,
		readonly: raw["~readonly"] === true ? true : undefined,
	};
}

function mergeSchemaOptions(base: Record<string, unknown>, options: TSchemaOptions): Record<string, unknown> {
	const optRecord = options as Record<string, unknown>;
	for (const key of Object.keys(optRecord)) {
		const val = optRecord[key];
		if (val !== undefined) {
			base[key] = val;
		}
	}
	return base;
}

function prepareSchema(kind: string, base: Record<string, unknown>, options: TSchemaOptions = {}): Record<string, unknown> {
	const obj = mergeSchemaOptions(base, options);
	setMeta(obj, { kind, optional: undefined, readonly: undefined });
	return obj;
}

function makeSchema<T>(kind: string, base: Record<string, unknown>, options: TSchemaOptions = {}): T {
	return prepareSchema(kind, base, options) as T;
}

function cloneSchemaObject(schema: TSchema): Record<string, unknown> {
	const src = schema as Record<string, unknown>;
	const copy: Record<string, unknown> = {};
	for (const key of Object.keys(src)) {
		if (key === "~kind" || key === "~optional" || key === "~readonly") continue;
		copy[key] = src[key];
	}
	return copy;
}

function isOptionalProperty(schema: TSchema): boolean {
	return getMeta(schema).optional === true;
}

function StringSchema(options: TSchemaOptions = {}): TString {
	return makeSchema<TString>("String", { type: "string" }, options);
}

function NumberSchema(options: TSchemaOptions = {}): TNumber {
	return makeSchema<TNumber>("Number", { type: "number" }, options);
}

function IntegerSchema(options: TSchemaOptions = {}): TInteger {
	return makeSchema<TInteger>("Integer", { type: "integer" }, options);
}

function BooleanSchema(options: TSchemaOptions = {}): TBoolean {
	return makeSchema<TBoolean>("Boolean", { type: "boolean" }, options);
}

function NullSchema(options: TSchemaOptions = {}): TNull {
	return makeSchema<TNull>("Null", { type: "null" }, options);
}

function UndefinedSchema(options: TSchemaOptions = {}): TUndefined {
	return makeSchema<TUndefined>("Undefined", { type: "undefined" }, options);
}

function BigIntSchema(options: TSchemaOptions = {}): TBigInt {
	return makeSchema<TBigInt>("BigInt", { type: "bigint" }, options);
}

function NeverSchema(options: TSchemaOptions = {}): TNever {
	return makeSchema<TNever>("Never", { not: {} }, options);
}

function VoidSchema(options: TSchemaOptions = {}): TVoid {
	return makeSchema<TVoid>("Void", { type: "void" }, options);
}

function AnySchema(options: TSchemaOptions = {}): TAny {
	return makeSchema<TAny>("Any", {}, options);
}

function UnknownSchema(options: TSchemaOptions = {}): TUnknown {
	return makeSchema<TUnknown>("Unknown", {}, options);
}

function LiteralSchema<const T extends TLiteralValue>(value: T, options: TSchemaOptions = {}): TLiteral<T> {
	const valueType = typeof value;
	if (valueType !== "string" && valueType !== "number" && valueType !== "boolean" && valueType !== "bigint") {
		throw new Error(`Invalid Literal value: ${String(value)}`);
	}
	return makeSchema<TLiteral<T>>("Literal", { type: valueType, const: value }, options);
}

function SymbolSchema(options: TSchemaOptions = {}): TSymbol {
	return makeSchema<TSymbol>("Symbol", { type: "symbol" }, options);
}

function TemplateLiteralSchema<T extends string>(pattern: T, options: TSchemaOptions = {}): TTemplateLiteral<T> {
	return makeSchema<TTemplateLiteral<T>>("TemplateLiteral", { type: "string", pattern }, options);
}

function ArraySchema<T extends TSchema>(items: T, options: TSchemaOptions = {}): TArray<T> {
	return makeSchema<TArray<T>>("Array", { type: "array", items }, options);
}

function OptionalSchema<T extends TSchema>(schema: T): TOptional<T> {
	const copy = cloneSchemaObject(schema);
	const prev = getMeta(schema);
	setMeta(copy, { kind: prev.kind, optional: true, readonly: prev.readonly });
	return copy as unknown as TOptional<T>;
}

function ReadonlySchema<T extends TSchema>(schema: T): TReadonly<T> {
	const copy = cloneSchemaObject(schema);
	const prev = getMeta(schema);
	setMeta(copy, { kind: prev.kind, optional: prev.optional, readonly: true });
	return copy as unknown as TReadonly<T>;
}

function ReadonlyOptionalSchema<T extends TSchema>(schema: T): TReadonlyOptional<T> {
	const copy = cloneSchemaObject(schema);
	const prev = getMeta(schema);
	setMeta(copy, { kind: prev.kind, optional: true, readonly: true });
	return copy as unknown as TReadonlyOptional<T>;
}

function buildObjectBase(properties: TProperties): Record<string, unknown> {
	const required: string[] = [];
	const copiedProperties: Record<string, TSchema> = {};
	for (const key of Object.keys(properties)) {
		const prop = properties[key]!;
		copiedProperties[key] = prop;
		if (!isOptionalProperty(prop)) {
			required.push(key);
		}
	}
	return required.length > 0
		? { type: "object", required, properties: copiedProperties }
		: { type: "object", properties: copiedProperties };
}

function ObjectSchema<T extends TProperties>(properties: T, options: TSchemaOptions = {}): TObject<T> {
	return makeSchema<TObject<T>>("Object", buildObjectBase(properties), options);
}

function UnionSchema<const T extends readonly TSchema[]>(schemas: T, options: TSchemaOptions = {}): TUnion<T> {
	return makeSchema<TUnion<T>>("Union", { anyOf: [...schemas] }, options);
}

function extractLiteralKeys(keySchema: TSchema): string[] | undefined {
	const kind = getMeta(keySchema).kind;
	const raw = keySchema as Record<string, unknown>;
	if (kind === "Literal" && typeof raw.const === "string") {
		return [raw.const];
	}
	if (kind === "Enum" && Array.isArray(raw.enum)) {
		const values = raw.enum as readonly unknown[];
		if (values.every((v: unknown): v is string => typeof v === "string")) return [...values];
	}
	if (kind === "Union" && Array.isArray(raw.anyOf)) {
		const out: string[] = [];
		for (const branch of raw.anyOf as TSchema[]) {
			const keys = extractLiteralKeys(branch);
			if (!keys) return undefined;
			for (const k of keys) out.push(k);
		}
		return out;
	}
	return undefined;
}

function RecordSchema<K extends TSchema, V extends TSchema>(
	key: K,
	value: V,
	options: TSchemaOptions = {},
): TRecord<K, V> {
	const literalKeys = extractLiteralKeys(key);
	if (literalKeys !== undefined && literalKeys.length > 0) {
		const properties: Record<string, TSchema> = {};
		for (const k of literalKeys) {
			properties[k] = value;
		}
		const obj = prepareSchema("Object", { type: "object", required: literalKeys, properties }, options);
		return obj as unknown as TRecord<K, V>;
	}

	const keyKind = getMeta(key).kind;
	const rawKey = key as Record<string, unknown>;
	let pattern = "^.*$";
	if (keyKind === "Integer") {
		pattern = "^-?(?:0|[1-9][0-9]*)$";
	} else if (keyKind === "Number") {
		pattern = "^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$";
	} else if (typeof rawKey.pattern === "string") {
		pattern = rawKey.pattern;
	}

	const obj = prepareSchema(
		"Record",
		{
			type: "object",
			patternProperties: { [pattern]: value },
		},
		options,
	);
	return obj as unknown as TRecord<K, V>;
}

type EnumObjectRecord = Record<string, string | number>;
type EnumInputToTuple<T> = T extends readonly TEnumValue[]
	? T
	: T extends EnumObjectRecord
		? readonly T[keyof T][]
		: readonly TEnumValue[];

function extractEnumValues(values: readonly TEnumValue[] | EnumObjectRecord): TEnumValue[] {
	if (Array.isArray(values)) return [...values];
	const record = values as EnumObjectRecord;
	const numericValueStrings = new Set<string>();
	for (const key of Object.keys(record)) {
		const val = record[key];
		if (typeof val === "number") {
			numericValueStrings.add(String(val));
		}
	}
	const out: TEnumValue[] = [];
	for (const key of Object.keys(record)) {
		if (!numericValueStrings.has(key)) {
			const val = record[key];
			if (val !== undefined) out.push(val);
		}
	}
	return out;
}

function EnumSchema<const T extends readonly TEnumValue[] | EnumObjectRecord>(
	values: T,
	options: TSchemaOptions = {},
): TEnum<EnumInputToTuple<T>> {
	const obj = prepareSchema("Enum", { enum: extractEnumValues(values) }, options);
	return obj as unknown as TEnum<EnumInputToTuple<T>>;
}

function TupleSchema<const T extends readonly TSchema[]>(items: T, options: TSchemaOptions = {}): TTuple<T> {
	const obj = prepareSchema(
		"Tuple",
		{
			type: "array",
			additionalItems: false,
			items: [...items],
			minItems: items.length,
		},
		options,
	);
	return obj as unknown as TTuple<T>;
}

function IntersectSchema<const T extends readonly TSchema[]>(
	schemas: T,
	options: TSchemaOptions = {},
): TIntersect<T> {
	const obj = prepareSchema("Intersect", { allOf: [...schemas] }, options);
	return obj as unknown as TIntersect<T>;
}

type CompositeObjectProperties<T extends readonly TObject[]> = T extends readonly [
	TObject<infer First>,
	...infer Rest extends readonly TObject[],
]
	? First & CompositeObjectProperties<Rest>
	: Record<never, TSchema>;

type EvaluateComposite<T> = {
	[K in keyof T]: T[K] extends TSchema ? T[K] : TSchema;
};

function CompositeSchema<const T extends readonly TObject[]>(
	schemas: T,
	options: TSchemaOptions = {},
): TObject<EvaluateComposite<CompositeObjectProperties<T>>> {
	const merged: TProperties = {};
	for (const schema of schemas) {
		const props = schema.properties;
		for (const key of Object.keys(props)) {
			merged[key] = props[key]!;
		}
	}
	const obj = prepareSchema("Object", buildObjectBase(merged), options);
	return obj as unknown as TObject<EvaluateComposite<CompositeObjectProperties<T>>>;
}

type PartialProperties<T extends TProperties> = {
	[K in keyof T]: TOptional<T[K]>;
};

function PartialSchema<T extends TProperties>(
	schema: TObject<T>,
	options: TSchemaOptions = {},
): TObject<PartialProperties<T>> {
	const properties: Record<string, TSchema> = {};
	for (const key of Object.keys(schema.properties)) {
		const prop = schema.properties[key]!;
		const copy = cloneSchemaObject(prop);
		const prev = getMeta(prop);
		setMeta(copy, { kind: prev.kind, optional: true, readonly: prev.readonly });
		properties[key] = copy as unknown as TSchema;
	}
	const obj = prepareSchema("Object", buildObjectBase(properties), options);
	return obj as unknown as TObject<PartialProperties<T>>;
}

function PickSchema<T extends TProperties, const K extends readonly (keyof T & string)[]>(
	schema: TObject<T>,
	keys: K,
	options: TSchemaOptions = {},
): TObject<{ [P in K[number]]: T[P] }> {
	const allow = new Set<string>(keys);
	const properties: Record<string, TSchema> = {};
	for (const key of Object.keys(schema.properties)) {
		if (allow.has(key)) {
			properties[key] = schema.properties[key]!;
		}
	}
	const obj = prepareSchema("Object", buildObjectBase(properties), options);
	return obj as unknown as TObject<{ [P in K[number]]: T[P] }>;
}

function OmitSchema<T extends TProperties, const K extends readonly (keyof T & string)[]>(
	schema: TObject<T>,
	keys: K,
	options: TSchemaOptions = {},
): TObject<Omit<T, K[number]>> {
	const block = new Set<string>(keys);
	const properties: Record<string, TSchema> = {};
	for (const key of Object.keys(schema.properties)) {
		if (!block.has(key)) {
			properties[key] = schema.properties[key]!;
		}
	}
	const obj = prepareSchema("Object", buildObjectBase(properties), options);
	return obj as unknown as TObject<Omit<T, K[number]>>;
}

function RefSchema<T extends string>(ref: T, options: TSchemaOptions = {}): TRef<T> {
	const obj = prepareSchema("Ref", { $ref: ref }, options);
	return obj as unknown as TRef<T>;
}

function CyclicSchema<T extends TProperties, K extends keyof T & string>(
	defs: T,
	root: K,
	options: TSchemaOptions = {},
): T[K] {
	const obj = prepareSchema("Cyclic", { $defs: defs, $ref: `#/$defs/${root}` }, options);
	return obj as unknown as T[K];
}

function UnsafeSchema<T = unknown>(schema: object = {}): TUnsafe<T> {
	return cloneSchemaObject(schema as TSchema) as TUnsafe<T>;
}

export const Type = {
	String: StringSchema,
	Number: NumberSchema,
	Integer: IntegerSchema,
	Boolean: BooleanSchema,
	Null: NullSchema,
	Undefined: UndefinedSchema,
	BigInt: BigIntSchema,
	Symbol: SymbolSchema,
	Never: NeverSchema,
	Void: VoidSchema,
	Any: AnySchema,
	Unknown: UnknownSchema,
	Literal: LiteralSchema,
	TemplateLiteral: TemplateLiteralSchema,
	Array: ArraySchema,
	Optional: OptionalSchema,
	Readonly: ReadonlySchema,
	ReadonlyOptional: ReadonlyOptionalSchema,
	Object: ObjectSchema,
	Union: UnionSchema,
	Record: RecordSchema,
	Enum: EnumSchema,
	Tuple: TupleSchema,
	Intersect: IntersectSchema,
	Composite: CompositeSchema,
	Partial: PartialSchema,
	Pick: PickSchema,
	Omit: OmitSchema,
	Ref: RefSchema,
	Cyclic: CyclicSchema,
	Unsafe: UnsafeSchema,
} as const;

export default Type;
