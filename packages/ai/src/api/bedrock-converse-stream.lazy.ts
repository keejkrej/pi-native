import type { ProviderStreams } from "../types.ts";
import { lazyApi } from "./lazy.ts";

let bedrockModuleLoader: (() => Promise<ProviderStreams>) | undefined;

/**
 * Overrides the dynamically imported bedrock implementation.
 */
export function setBedrockProviderModule(module: ProviderStreams): void {
	bedrockModuleLoader = async () => module;
}

/**
 * Overrides how the bedrock implementation is imported, loaded on the first
 * bedrock request.
 */
export function setBedrockProviderLoader(load: () => Promise<ProviderStreams>): void {
	bedrockModuleLoader = load;
}

export const bedrockConverseStreamApi = (): ProviderStreams =>
	lazyApi(async (): Promise<ProviderStreams> => {
		if (bedrockModuleLoader) return await bedrockModuleLoader();
		const mod = await import("./bedrock-converse-stream.ts");
		return { stream: mod.stream, streamSimple: mod.streamSimple };
	});
