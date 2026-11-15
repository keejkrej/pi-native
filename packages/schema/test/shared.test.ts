// Values shared across compiled schemas use a bounded FIFO cache (MAX_SHARED_REGEXES = 1024).

import { describe, expect, it } from "vitest";
import { compile } from "../src/index.ts";
import { sharedRegexCount } from "../src/shared.ts";

const MAX_SHARED_REGEXES = 1024;

describe("shared checks", () => {
	it("share the module-level check of a bare type", () => {
		const a = compile({ type: "string", description: "a" });
		const b = compile({ type: "string", title: "b" });
		expect(a.check).toBe(b.check);
	});

	it("share a pattern's regular expression and bound the cache with FIFO eviction", () => {
		const before = sharedRegexCount();
		for (let i = 0; i < 5; i++) {
			compile({ type: "string", pattern: `^shared-fifo-unique-${i}$` });
		}
		const again = compile({ type: "string", pattern: "^shared-fifo-unique-0$" });
		expect(sharedRegexCount()).toBe(Math.min(MAX_SHARED_REGEXES, before + 5));
		expect(again.check("shared-fifo-unique-0")).toBe(true);
		expect(again.check("shared-fifo-unique-1")).toBe(false);

		const total = MAX_SHARED_REGEXES + 16;
		for (let i = 0; i < total; i++) {
			compile({ type: "string", pattern: `^shared-fifo-fill-${i}$` });
			expect(sharedRegexCount()).toBeLessThanOrEqual(MAX_SHARED_REGEXES);
		}
		expect(sharedRegexCount()).toBe(MAX_SHARED_REGEXES);

		const recompiledEvicted = compile({ type: "string", pattern: "^shared-fifo-unique-0$" });
		expect(recompiledEvicted.check("shared-fifo-unique-0")).toBe(true);
		expect(sharedRegexCount()).toBe(MAX_SHARED_REGEXES);
	});
});
