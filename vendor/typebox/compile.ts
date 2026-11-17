/**
 * Pure TypeScript `Compile` validator backed by `@pi-ts/schema`.
 */

import {
	compile,
	type JsonSchema,
	type ValidationError,
	type Validator as PiValidator,
} from "@pi-ts/schema";
import type { TLocalizedValidationError } from "./error.ts";
import type { TSchema } from "./index.ts";

function unescapePointerSegment(segment: string): string {
	return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolvePointer(root: unknown, pointer: string): unknown {
	if (pointer === "" || pointer === "/") return root;
	const segments = pointer.slice(1).split("/");
	let current: unknown = root;
	for (const rawSegment of segments) {
		if (current === null || typeof current !== "object") return undefined;
		const key = unescapePointerSegment(rawSegment);
		if (Array.isArray(current)) {
			const idx = Number(key);
			if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) return undefined;
			current = current[idx];
		} else {
			current = (current as Record<string, unknown>)[key];
		}
	}
	return current;
}

function toLocalizedError(
	rootValue: unknown,
	schema: TSchema,
	error: { readonly path: string; readonly keyword: string; readonly message: string },
): TLocalizedValidationError {
	if (error.keyword === "required") {
		const lastSlash = error.path.lastIndexOf("/");
		const instancePath = lastSlash <= 0 ? "" : error.path.slice(0, lastSlash);
		const missingProp = unescapePointerSegment(lastSlash === -1 ? error.path : error.path.slice(lastSlash + 1));
		return {
			keyword: "required",
			schemaPath: "#",
			instancePath,
			params: { requiredProperties: [missingProp] },
			message: `must have required property '${missingProp}'`,
			path: error.path,
			value: resolvePointer(rootValue, instancePath),
			schema,
		};
	}

	return {
		keyword: error.keyword,
		schemaPath: "#",
		instancePath: error.path,
		params: {},
		message: error.message,
		path: error.path,
		value: resolvePointer(rootValue, error.path),
		schema,
	};
}

export class Validator {
	private readonly rawSchema: unknown;
	private readonly validator: PiValidator<unknown>;

	constructor(schema: TSchema) {
		this.rawSchema = schema;
		this.validator = compile(schema as unknown as JsonSchema);
	}

	Check(value: unknown): boolean {
		return this.validator.check(value);
	}

	Errors(value: unknown): TLocalizedValidationError[] {
		const rawErrors = this.validator.errors(value);
		return rawErrors.map((err: ValidationError) => toLocalizedError(value, this.rawSchema as TSchema, err));
	}

	Parse(value: unknown): unknown {
		if (!this.validator.check(value)) {
			const first = this.Errors(value)[0];
			const summary = first ? `${first.instancePath || "/"}: ${first.message}` : "Validation failed";
			throw new Error(summary);
		}
		return value;
	}
}

export function Compile(schema: TSchema): Validator;
export function Compile(context: Record<string, TSchema>, schema: TSchema): Validator;
export function Compile(
	contextOrSchema: Record<string, TSchema> | TSchema,
	maybeSchema?: TSchema,
): Validator {
	if (maybeSchema !== undefined) {
		return new Validator({ $defs: contextOrSchema, ...maybeSchema } as unknown as TSchema);
	}
	return new Validator(contextOrSchema as TSchema);
}
