/**
 * Perceptual color space math (sRGB <-> linear sRGB <-> Oklab <-> OKLCH / OKHSL).
 * Self-contained with zero runtime dependencies for both Node and scriptc native compilation.
 */

export interface RgbTriplet {
	r: number;
	g: number;
	b: number;
}

export interface OklabTriplet {
	L: number;
	a: number;
	b: number;
}

const TAU = Math.PI * 2;
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

export function clamp01(value: number): number {
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

export function clampByte(value: number): number {
	const rounded = Math.round(value);
	if (rounded < 0) return 0;
	if (rounded > 255) return 255;
	return rounded;
}

export function normalizeHue(hDeg: number): number {
	const h = hDeg % 360;
	return h < 0 ? h + 360 : h;
}

function srgbTransferInv(channel: number): number {
	return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function srgbTransfer(channel: number): number {
	const c = clamp01(channel);
	return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function linearSrgbToOklab(r: number, g: number, b: number): OklabTriplet {
	const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
	const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
	const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

	const lCbrt = Math.cbrt(l);
	const mCbrt = Math.cbrt(m);
	const sCbrt = Math.cbrt(s);

	return {
		L: 0.2104542553 * lCbrt + 0.793617785 * mCbrt - 0.0040720468 * sCbrt,
		a: 1.9779984951 * lCbrt - 2.428592205 * mCbrt + 0.4505937099 * sCbrt,
		b: 0.0259040371 * lCbrt + 0.7827717662 * mCbrt - 0.808675766 * sCbrt,
	};
}

function oklabToLinearSrgb(L: number, a: number, b: number): RgbTriplet {
	const lCbrt = L + 0.3963377774 * a + 0.2158037573 * b;
	const mCbrt = L - 0.1055613458 * a - 0.0638541728 * b;
	const sCbrt = L - 0.0894841775 * a - 1.291485548 * b;

	const l = lCbrt * lCbrt * lCbrt;
	const m = mCbrt * mCbrt * mCbrt;
	const s = sCbrt * sCbrt * sCbrt;

	return {
		r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	};
}

function isInLinearSrgbGamut(rgb: RgbTriplet): boolean {
	return (
		rgb.r >= -1e-6 && rgb.r <= 1 + 1e-6 && rgb.g >= -1e-6 && rgb.g <= 1 + 1e-6 && rgb.b >= -1e-6 && rgb.b <= 1 + 1e-6
	);
}

export function rgbToOklab(r: number, g: number, b: number): OklabTriplet {
	return linearSrgbToOklab(srgbTransferInv(r / 255), srgbTransferInv(g / 255), srgbTransferInv(b / 255));
}

export function oklabToRgb(L: number, a: number, b: number): RgbTriplet {
	const lin = oklabToLinearSrgb(L, a, b);
	return {
		r: clampByte(srgbTransfer(lin.r) * 255),
		g: clampByte(srgbTransfer(lin.g) * 255),
		b: clampByte(srgbTransfer(lin.b) * 255),
	};
}

export function oklchToRgb(l: number, c: number, hDeg: number): RgbTriplet {
	const light = clamp01(l);
	const chroma = Math.max(0, c);
	const hRad = normalizeHue(hDeg) * DEG_TO_RAD;
	const cosH = Math.cos(hRad);
	const sinH = Math.sin(hRad);

	const initial = oklabToLinearSrgb(light, chroma * cosH, chroma * sinH);
	if (isInLinearSrgbGamut(initial)) {
		return {
			r: clampByte(srgbTransfer(initial.r) * 255),
			g: clampByte(srgbTransfer(initial.g) * 255),
			b: clampByte(srgbTransfer(initial.b) * 255),
		};
	}

	// Binary search maximum in-gamut chroma at fixed (L, h)
	let lo = 0;
	let hi = chroma;
	for (let i = 0; i < 16; i++) {
		const mid = (lo + hi) * 0.5;
		const candidate = oklabToLinearSrgb(light, mid * cosH, mid * sinH);
		if (isInLinearSrgbGamut(candidate)) {
			lo = mid;
		} else {
			hi = mid;
		}
	}
	const clamped = oklabToLinearSrgb(light, lo * cosH, lo * sinH);
	return {
		r: clampByte(srgbTransfer(clamped.r) * 255),
		g: clampByte(srgbTransfer(clamped.g) * 255),
		b: clampByte(srgbTransfer(clamped.b) * 255),
	};
}

function toeInv(x: number): number {
	const k1 = 0.206;
	const k2 = 0.03;
	const k3 = (1 + k1) / (1 + k2);
	return (x * x + k1 * x) / (k3 * (x + k2));
}

function computeMaxSaturation(a: number, b: number): number {
	let k0 = 0;
	let k1 = 0;
	let k2 = 0;
	let k3 = 0;
	let k4 = 0;
	let wl = 0;
	let wm = 0;
	let ws = 0;

	if (-1.88170328 * a - 0.80936493 * b > 1) {
		k0 = 1.19086277;
		k1 = 1.76576728;
		k2 = 0.59662641;
		k3 = 0.75515197;
		k4 = 0.56771245;
		wl = 4.0767416621;
		wm = -3.3077115913;
		ws = 0.2309699292;
	} else if (1.81444104 * a - 1.19445276 * b > 1) {
		k0 = 0.73956515;
		k1 = -0.45954404;
		k2 = 0.08285427;
		k3 = 0.1254107;
		k4 = 0.14503204;
		wl = -1.2684380046;
		wm = 2.6097574011;
		ws = -0.3413193965;
	} else {
		k0 = 1.35733652;
		k1 = -0.00915799;
		k2 = -1.1513021;
		k3 = -0.50559606;
		k4 = 0.00692167;
		wl = -0.0041960863;
		wm = -0.7034186147;
		ws = 1.707614701;
	}

	let S = k0 + k1 * a + k2 * b + k3 * a * a + k4 * a * b;
	const kl = 0.3963377774 * a + 0.2158037573 * b;
	const km = -0.1055613458 * a - 0.0638541728 * b;
	const ks = -0.0894841775 * a - 1.291485548 * b;

	for (let step = 0; step < 1; step++) {
		const l_ = 1 + S * kl;
		const m_ = 1 + S * km;
		const s_ = 1 + S * ks;
		const l = l_ * l_ * l_;
		const m = m_ * m_ * m_;
		const s = s_ * s_ * s_;
		const lds = 3 * kl * l_ * l_;
		const mds = 3 * km * m_ * m_;
		const sds = 3 * ks * s_ * s_;
		const lds2 = 6 * kl * kl * l_;
		const mds2 = 6 * km * km * m_;
		const sds2 = 6 * ks * ks * s_;
		const f = wl * l + wm * m + ws * s;
		const f1 = wl * lds + wm * mds + ws * sds;
		const f2 = wl * lds2 + wm * mds2 + ws * sds2;
		S -= (f * f1) / (f1 * f1 - 0.5 * f * f2);
	}
	return S;
}

function findCusp(a: number, b: number): { L: number; C: number } {
	const S = computeMaxSaturation(a, b);
	const lin = oklabToLinearSrgb(1, S * a, S * b);
	const L = Math.cbrt(1 / Math.max(lin.r, lin.g, lin.b));
	return { L, C: L * S };
}

function findGamutIntersection(
	a: number,
	b: number,
	L1: number,
	C1: number,
	L0: number,
	cusp: { L: number; C: number },
): number {
	let t = 0;
	if ((L1 - L0) * cusp.C - (cusp.L - L0) * C1 <= 0) {
		t = (cusp.C * L0) / (C1 * cusp.L + cusp.C * (L0 - L1));
	} else {
		t = (cusp.C * (L0 - 1)) / (C1 * (cusp.L - 1) + cusp.C * (L0 - L1));
		const dL = L1 - L0;
		const dC = C1;
		const kl = 0.3963377774 * a + 0.2158037573 * b;
		const km = -0.1055613458 * a - 0.0638541728 * b;
		const ks = -0.0894841775 * a - 1.291485548 * b;
		const ldt = dL + dC * kl;
		const mdt = dL + dC * km;
		const sdt = dL + dC * ks;

		const L = L0 * (1 - t) + t * L1;
		const C = t * C1;
		const l_ = L + C * kl;
		const m_ = L + C * km;
		const s_ = L + C * ks;
		const l = l_ * l_ * l_;
		const m = m_ * m_ * m_;
		const s = s_ * s_ * s_;

		const ldt2 = 2 * ldt * l_;
		const mdt2 = 2 * mdt * m_;
		const sdt2 = 2 * sdt * s_;
		const ldt3 = ldt * ldt2;
		const mdt3 = mdt * mdt2;
		const sdt3 = sdt * sdt2;

		const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s - 1;
		const r1 = 3 * (4.0767416621 * ldt * l_ * l_ - 3.3077115913 * mdt * m_ * m_ + 0.2309699292 * sdt * s_ * s_);
		const r2 = 3 * (4.0767416621 * ldt2 * l_ - 3.3077115913 * mdt2 * m_ + 0.2309699292 * sdt2 * s_);
		const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s - 1;
		const g1 = 3 * (-1.2684380046 * ldt * l_ * l_ + 2.6097574011 * mdt * m_ * m_ - 0.3413193965 * sdt * s_ * s_);
		const g2 = 3 * (-1.2684380046 * ldt2 * l_ + 2.6097574011 * mdt2 * m_ - 0.3413193965 * sdt2 * s_);
		const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s - 1;
		const bl1 = 3 * (-0.0041960863 * ldt * l_ * l_ - 0.7034186147 * mdt * m_ * m_ + 1.707614701 * sdt * s_ * s_);
		const bl2 = 3 * (-0.0041960863 * ldt2 * l_ - 0.7034186147 * mdt2 * m_ + 1.707614701 * sdt2 * s_);

		const uR = r1 / (r1 * r1 - 0.5 * r * r2);
		const uG = g1 / (g1 * g1 - 0.5 * g * g2);
		const uB = bl1 / (bl1 * bl1 - 0.5 * bl * bl2);
		const tR = uR >= 0 ? -r * uR : Number.POSITIVE_INFINITY;
		const tG = uG >= 0 ? -g * uG : Number.POSITIVE_INFINITY;
		const tB = uB >= 0 ? -bl * uB : Number.POSITIVE_INFINITY;
		void (ldt3 + mdt3 + sdt3);
		t += Math.min(tR, tG, tB);
	}
	return t;
}

function getStMid(a: number, b: number): { S: number; T: number } {
	const S =
		0.11516993 +
		1 /
			(7.4477897 +
				4.1590124 * b +
				a *
					(-2.19557347 +
						1.75198401 * b +
						a * (-2.13704948 - 10.02301043 * b + a * (-4.24894561 + 5.38770819 * b + 4.69891013 * a))));
	const T =
		0.11239642 +
		1 /
			(1.6132032 -
				0.68124379 * b +
				a *
					(0.40370612 +
						0.90148123 * b +
						a * (-0.27087943 + 0.6122399 * b + a * (0.00299215 - 0.45399568 * b - 0.14661872 * a))));
	return { S, T };
}

function getCs(L: number, a: number, b: number): { C0: number; Cmid: number; Cmax: number } {
	const cusp = findCusp(a, b);
	const Cmax = findGamutIntersection(a, b, L, 1, L, cusp);
	const stMaxS = cusp.C / cusp.L;
	const stMaxT = cusp.C / (1 - cusp.L);
	const k = Cmax / Math.min(L * stMaxS, (1 - L) * stMaxT);
	const stMid = getStMid(a, b);
	const C0 = L * stMid.S * (1 - L) * stMid.T;
	const ca = L * stMid.S;
	const cb = (1 - L) * stMid.T;
	const Cmid = 0.9 * k * Math.sqrt(Math.sqrt(1 / (1 / (ca * ca * ca * ca) + 1 / (cb * cb * cb * cb))));
	return { C0: C0 > 0 ? C0 : 0.0001, Cmid, Cmax };
}

export function okhslToRgb(hDeg: number, sPct: number, lPct: number): RgbTriplet {
	const h = normalizeHue(hDeg) / 360;
	const s = clamp01(sPct / 100);
	const l = clamp01(lPct / 100);

	if (l >= 1) return { r: 255, g: 255, b: 255 };
	if (l <= 0) return { r: 0, g: 0, b: 0 };

	const a_ = Math.cos(TAU * h);
	const b_ = Math.sin(TAU * h);
	let L = toeInv(l);

	const cs = getCs(L, a_, b_);
	const mid = 0.8;
	const midInv = 1.25;
	let C = 0;

	if (s < mid) {
		const t = midInv * s;
		const k1 = mid * cs.C0;
		const k2 = 1 - k1 / cs.Cmid;
		C = (t * k1) / (1 - k2 * t);
	} else {
		const t = (s - mid) / (1 - mid);
		const k0 = cs.Cmid;
		const k1 = ((1 - mid) * cs.Cmid * cs.Cmid * midInv * midInv) / cs.C0;
		const k2 = 1 - k1 / (cs.Cmax - cs.Cmid);
		C = k0 + (t * k1) / (1 - k2 * t);
	}

	L = clamp01(L);
	return oklabToRgb(L, C * a_, C * b_);
}

export function rgbToOklch(r: number, g: number, b: number): { l: number; c: number; h: number } {
	const lab = rgbToOklab(r, g, b);
	const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
	const h = c < 1e-6 ? 0 : normalizeHue(Math.atan2(lab.b, lab.a) * RAD_TO_DEG);
	return { l: lab.L, c, h };
}
