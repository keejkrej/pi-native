/**
 * Pure TypeScript duration string parser supporting millisecond through year units.
 */

const UNIT_MS = {
	"": 1,
	ms: 1,
	msec: 1,
	msecs: 1,
	millisecond: 1,
	milliseconds: 1,
	s: 1000,
	sec: 1000,
	secs: 1000,
	second: 1000,
	seconds: 1000,
	m: 60_000,
	min: 60_000,
	mins: 60_000,
	minute: 60_000,
	minutes: 60_000,
	h: 3_600_000,
	hr: 3_600_000,
	hrs: 3_600_000,
	hour: 3_600_000,
	hours: 3_600_000,
	d: 86_400_000,
	day: 86_400_000,
	days: 86_400_000,
	w: 604_800_000,
	wk: 604_800_000,
	wks: 604_800_000,
	week: 604_800_000,
	weeks: 604_800_000,
	y: 31_557_600_000,
	yr: 31_557_600_000,
	yrs: 31_557_600_000,
	year: 31_557_600_000,
	years: 31_557_600_000,
} as const satisfies Record<string, number>;

type DurationUnit = keyof typeof UNIT_MS;

const DURATION_PATTERN =
	/^(-?(?:\d+)?\.?\d+)\s*(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wks?|w|years?|yrs?|y)?$/i;

export function parseDurationMs(value: string): number | undefined {
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > 100) {
		return undefined;
	}

	const match = DURATION_PATTERN.exec(trimmed);
	if (!match) {
		return undefined;
	}

	const amount = Number.parseFloat(match[1]!);
	if (!Number.isFinite(amount)) {
		return undefined;
	}

	const unit = (match[2] ?? "").toLowerCase() as DurationUnit;
	const factor = UNIT_MS[unit];
	return amount * factor;
}
