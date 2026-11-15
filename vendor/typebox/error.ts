/**
 * Localized validation error shape compatible with TypeBox `typebox/error` callers.
 */
export interface TLocalizedValidationError {
	readonly keyword: string;
	readonly schemaPath: string;
	readonly instancePath: string;
	readonly params: Record<string, unknown>;
	readonly message: string;
	readonly path: string;
	readonly value?: unknown;
	readonly schema?: unknown;
}
