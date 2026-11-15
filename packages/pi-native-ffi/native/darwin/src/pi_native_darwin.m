#import <AppKit/AppKit.h>
#import <CoreFoundation/CoreFoundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <JavaScriptCore/JavaScriptCore.h>
#include <dlfcn.h>
#include <limits.h>
#include <math.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

// ---------------------------------------------------------------------------
// Thread-local growable scratch buffer
// ---------------------------------------------------------------------------

typedef struct {
	uint8_t *data;
	size_t len;
	size_t cap;
} PiScratchBuffer;

static pthread_once_t g_scratch_once = PTHREAD_ONCE_INIT;
static pthread_key_t g_scratch_key;

static void pi_scratch_free(void *ptr) {
	PiScratchBuffer *buf = (PiScratchBuffer *)ptr;
	if (buf) {
		free(buf->data);
		free(buf);
	}
}

static void pi_scratch_init_key(void) {
	pthread_key_create(&g_scratch_key, pi_scratch_free);
}

static PiScratchBuffer *pi_get_scratch(void) {
	pthread_once(&g_scratch_once, pi_scratch_init_key);
	PiScratchBuffer *buf = (PiScratchBuffer *)pthread_getspecific(g_scratch_key);
	if (!buf) {
		buf = (PiScratchBuffer *)calloc(1, sizeof(PiScratchBuffer));
		if (buf) {
			pthread_setspecific(g_scratch_key, buf);
		}
	}
	return buf;
}

static bool pi_scratch_set(const uint8_t *bytes, size_t len) {
	if (len > (size_t)INT32_MAX) return false;
	PiScratchBuffer *buf = pi_get_scratch();
	if (!buf) return false;
	if (len > buf->cap) {
		size_t new_cap = buf->cap ? buf->cap : 4096;
		while (new_cap < len) {
			if (new_cap > ((size_t)INT32_MAX / 2)) {
				new_cap = len;
				break;
			}
			new_cap *= 2;
		}
		uint8_t *grown = (uint8_t *)realloc(buf->data, new_cap);
		if (!grown) return false;
		buf->data = grown;
		buf->cap = new_cap;
	}
	if (len > 0 && bytes != NULL) {
		memcpy(buf->data, bytes, len);
	}
	buf->len = len;
	return true;
}

int32_t pi_native_read_scratch(uint8_t *out, size_t out_len) {
	PiScratchBuffer *buf = pi_get_scratch();
	if (!buf || buf->len == 0 || !out || out_len == 0) return 0;
	size_t to_copy = buf->len < out_len ? buf->len : out_len;
	memcpy(out, buf->data, to_copy);
	return (int32_t)to_copy;
}

int32_t pi_native_available(void) {
	return 1;
}

// ---------------------------------------------------------------------------
// Clipboard & modifiers (AppKit + CoreGraphics)
// ---------------------------------------------------------------------------

int32_t pi_native_clipboard_get_text(void) {
	@autoreleasepool {
		@try {
			NSPasteboard *pb = [NSPasteboard generalPasteboard];
			if (!pb) return -2;
			NSString *str = [pb stringForType:NSPasteboardTypeString];
			if (!str) return -1;
			NSData *utf8 = [str dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:YES];
			if (!utf8) return -2;
			if (!pi_scratch_set((const uint8_t *)[utf8 bytes], [utf8 length])) return -2;
			return (int32_t)[utf8 length];
		} @catch (NSException *ex) {
			(void)ex;
			return -2;
		}
	}
}

int32_t pi_native_clipboard_set_text(const uint8_t *text, size_t text_len) {
	@autoreleasepool {
		@try {
			if (!text && text_len > 0) return 0;
			NSString *str = text_len == 0
				? @""
				: [[NSString alloc] initWithBytes:text length:text_len encoding:NSUTF8StringEncoding];
			if (!str) return 0;
			NSPasteboard *pb = [NSPasteboard generalPasteboard];
			if (!pb) return 0;
			[pb clearContents];
			BOOL ok = [pb setString:str forType:NSPasteboardTypeString];
			return ok ? 1 : 0;
		} @catch (NSException *ex) {
			(void)ex;
			return 0;
		}
	}
}

int32_t pi_native_clipboard_get_image_png(void) {
	@autoreleasepool {
		@try {
			NSPasteboard *pb = [NSPasteboard generalPasteboard];
			if (!pb) return -2;

			NSData *pngData = [pb dataForType:NSPasteboardTypePNG];
			if (pngData && [pngData length] > 0) {
				if (!pi_scratch_set((const uint8_t *)[pngData bytes], [pngData length])) return -2;
				return (int32_t)[pngData length];
			}

			NSData *tiffData = [pb dataForType:NSPasteboardTypeTIFF];
			if (tiffData && [tiffData length] > 0) {
				NSBitmapImageRep *rep = [NSBitmapImageRep imageRepWithData:tiffData];
				if (!rep) return -2;
				NSData *converted = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
				if (!converted || [converted length] == 0) return -2;
				if (!pi_scratch_set((const uint8_t *)[converted bytes], [converted length])) return -2;
				return (int32_t)[converted length];
			}

			return -1;
		} @catch (NSException *ex) {
			(void)ex;
			return -2;
		}
	}
}

int32_t pi_native_clipboard_get_file_paths(void) {
	@autoreleasepool {
		@try {
			NSPasteboard *pb = [NSPasteboard generalPasteboard];
			if (!pb) return -2;
			NSDictionary *opts = @{ NSPasteboardURLReadingFileURLsOnlyKey: @YES };
			NSArray<NSURL *> *urls = [pb readObjectsForClasses:@[[NSURL class]] options:opts];
			if (!urls || [urls count] == 0) return -1;

			NSMutableData *out = [NSMutableData data];
			for (NSURL *url in urls) {
				const char *fsPath = [url fileSystemRepresentation];
				if (fsPath && fsPath[0] != '\0') {
					if ([out length] > 0) {
						const char nul = '\0';
						[out appendBytes:&nul length:1];
					}
					[out appendBytes:fsPath length:strlen(fsPath)];
				}
			}
			if ([out length] == 0) return -1;
			if (!pi_scratch_set((const uint8_t *)[out bytes], [out length])) return -2;
			return (int32_t)[out length];
		} @catch (NSException *ex) {
			(void)ex;
			return -2;
		}
	}
}

int32_t pi_native_is_modifier_pressed(const uint8_t *name, size_t name_len) {
	if (!name || name_len == 0) return 0;
	CGEventFlags mask = 0;
	if (name_len == 5 && memcmp(name, "shift", 5) == 0) {
		mask = kCGEventFlagMaskShift;
	} else if (name_len == 7 && memcmp(name, "command", 7) == 0) {
		mask = kCGEventFlagMaskCommand;
	} else if (name_len == 7 && memcmp(name, "control", 7) == 0) {
		mask = kCGEventFlagMaskControl;
	} else if (name_len == 6 && memcmp(name, "option", 6) == 0) {
		mask = kCGEventFlagMaskAlternate;
	} else {
		return 0;
	}
	CGEventFlags flags = CGEventSourceFlagsState(kCGEventSourceStateCombinedSessionState);
	return (flags & mask) != 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// ImageIO + CoreGraphics inspect & transform
// ---------------------------------------------------------------------------

static void write_u32_le(uint8_t *dst, uint32_t v) {
	dst[0] = (uint8_t)(v & 0xFFu);
	dst[1] = (uint8_t)((v >> 8) & 0xFFu);
	dst[2] = (uint8_t)((v >> 16) & 0xFFu);
	dst[3] = (uint8_t)((v >> 24) & 0xFFu);
}

static bool cf_dict_get_u32(CFDictionaryRef dict, CFStringRef key, uint32_t *out) {
	if (!dict) return false;
	CFTypeRef val = CFDictionaryGetValue(dict, key);
	if (!val || CFGetTypeID(val) != CFNumberGetTypeID()) return false;
	int64_t num = 0;
	if (!CFNumberGetValue((CFNumberRef)val, kCFNumberSInt64Type, &num) || num < 0 || num > (int64_t)UINT32_MAX) {
		return false;
	}
	*out = (uint32_t)num;
	return true;
}

static uint32_t read_exif_orientation(CFDictionaryRef props) {
	uint32_t orient = 1;
	if (cf_dict_get_u32(props, kCGImagePropertyOrientation, &orient)) {
		if (orient >= 1 && orient <= 8) return orient;
	}
	if (props) {
		CFTypeRef tiff = CFDictionaryGetValue(props, kCGImagePropertyTIFFDictionary);
		if (tiff && CFGetTypeID(tiff) == CFDictionaryGetTypeID()) {
			if (cf_dict_get_u32((CFDictionaryRef)tiff, kCGImagePropertyTIFFOrientation, &orient)) {
				if (orient >= 1 && orient <= 8) return orient;
			}
		}
	}
	return 1;
}

int32_t pi_native_image_inspect(const uint8_t *bytes, size_t len, uint8_t *out, size_t out_len) {
	@autoreleasepool {
		if (!bytes || len == 0 || len > (size_t)LONG_MAX || !out || out_len < 12) return -1;

		CFDataRef cfData = CFDataCreateWithBytesNoCopy(
			kCFAllocatorDefault, bytes, (CFIndex)len, kCFAllocatorNull);
		if (!cfData) return -1;

		CGImageSourceRef src = CGImageSourceCreateWithData(cfData, NULL);
		if (!src || CGImageSourceGetCount(src) == 0) {
			if (src) CFRelease(src);
			CFRelease(cfData);
			return -1;
		}

		CFDictionaryRef props = CGImageSourceCopyPropertiesAtIndex(src, 0, NULL);
		uint32_t width = 0;
		uint32_t height = 0;
		bool gotW = cf_dict_get_u32(props, kCGImagePropertyPixelWidth, &width);
		bool gotH = cf_dict_get_u32(props, kCGImagePropertyPixelHeight, &height);
		uint32_t orient = read_exif_orientation(props);
		if (props) CFRelease(props);

		if (!gotW || !gotH || width == 0 || height == 0) {
			CGImageRef img = CGImageSourceCreateImageAtIndex(src, 0, NULL);
			if (img) {
				width = (uint32_t)CGImageGetWidth(img);
				height = (uint32_t)CGImageGetHeight(img);
				CGImageRelease(img);
			}
		}

		CFRelease(src);
		CFRelease(cfData);

		if (width == 0 || height == 0) return -1;
		write_u32_le(out, width);
		write_u32_le(out + 4, height);
		write_u32_le(out + 8, orient);
		return 0;
	}
}

int32_t pi_native_image_transform(
	const uint8_t *bytes,
	size_t len,
	uint32_t target_w,
	uint32_t target_h,
	uint32_t fmt,
	uint32_t jpeg_q,
	uint32_t apply_orient
) {
	@autoreleasepool {
		if (!bytes || len == 0 || len > (size_t)LONG_MAX || (fmt != 0 && fmt != 1)) return -1;

		CFDataRef cfData = CFDataCreateWithBytesNoCopy(
			kCFAllocatorDefault, bytes, (CFIndex)len, kCFAllocatorNull);
		if (!cfData) return -1;

		CGImageSourceRef src = CGImageSourceCreateWithData(cfData, NULL);
		if (!src || CGImageSourceGetCount(src) == 0) {
			if (src) CFRelease(src);
			CFRelease(cfData);
			return -1;
		}

		uint32_t orient = 1;
		if (apply_orient != 0) {
			CFDictionaryRef props = CGImageSourceCopyPropertiesAtIndex(src, 0, NULL);
			orient = read_exif_orientation(props);
			if (props) CFRelease(props);
		}

		CGImageRef srcImg = CGImageSourceCreateImageAtIndex(src, 0, NULL);
		CFRelease(src);
		CFRelease(cfData);
		if (!srcImg) return -1;

		size_t rawW = CGImageGetWidth(srcImg);
		size_t rawH = CGImageGetHeight(srcImg);
		if (rawW == 0 || rawH == 0) {
			CGImageRelease(srcImg);
			return -1;
		}

		bool swap_wh = (orient >= 5 && orient <= 8);
		size_t orientW = swap_wh ? rawH : rawW;
		size_t orientH = swap_wh ? rawW : rawH;

		size_t dstW = target_w > 0 ? (size_t)target_w : orientW;
		size_t dstH = target_h > 0 ? (size_t)target_h : orientH;
		if (target_w > 0 && target_h == 0) {
			dstH = (size_t)llround((double)orientH * ((double)dstW / (double)orientW));
			if (dstH == 0) dstH = 1;
		} else if (target_h > 0 && target_w == 0) {
			dstW = (size_t)llround((double)orientW * ((double)dstH / (double)orientH));
			if (dstW == 0) dstW = 1;
		}
		if (dstW == 0 || dstH == 0 || dstW > 65535 || dstH > 65535) {
			CGImageRelease(srcImg);
			return -1;
		}

		CGColorSpaceRef cs = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
		if (!cs) cs = CGColorSpaceCreateDeviceRGB();
		if (!cs) {
			CGImageRelease(srcImg);
			return -1;
		}

		CGBitmapInfo bitmapInfo = (fmt == 1)
			? ((CGBitmapInfo)kCGImageAlphaNoneSkipFirst | (CGBitmapInfo)kCGBitmapByteOrder32Host)
			: ((CGBitmapInfo)kCGImageAlphaPremultipliedLast | (CGBitmapInfo)kCGBitmapByteOrder32Big);

		CGContextRef ctx = CGBitmapContextCreate(NULL, dstW, dstH, 8, dstW * 4, cs, bitmapInfo);
		CGColorSpaceRelease(cs);
		if (!ctx) {
			CGImageRelease(srcImg);
			return -1;
		}

		if (fmt == 1) {
			CGContextSetRGBFillColor(ctx, 1.0, 1.0, 1.0, 1.0);
			CGContextFillRect(ctx, CGRectMake(0.0, 0.0, (CGFloat)dstW, (CGFloat)dstH));
		}

		CGContextSetInterpolationQuality(ctx, kCGInterpolationHigh);

		CGFloat w = (CGFloat)dstW;
		CGFloat h = (CGFloat)dstH;
		CGRect drawRect = swap_wh ? CGRectMake(0.0, 0.0, h, w) : CGRectMake(0.0, 0.0, w, h);

		switch (orient) {
			case 2:
				CGContextTranslateCTM(ctx, w, 0.0);
				CGContextScaleCTM(ctx, -1.0, 1.0);
				break;
			case 3:
				CGContextTranslateCTM(ctx, w, h);
				CGContextScaleCTM(ctx, -1.0, -1.0);
				break;
			case 4:
				CGContextTranslateCTM(ctx, 0.0, h);
				CGContextScaleCTM(ctx, 1.0, -1.0);
				break;
			case 5:
				CGContextTranslateCTM(ctx, w, h);
				CGContextScaleCTM(ctx, -1.0, 1.0);
				CGContextRotateCTM(ctx, -M_PI_2);
				break;
			case 6:
				CGContextTranslateCTM(ctx, 0.0, h);
				CGContextRotateCTM(ctx, -M_PI_2);
				break;
			case 7:
				CGContextScaleCTM(ctx, 1.0, -1.0);
				CGContextRotateCTM(ctx, -M_PI_2);
				break;
			case 8:
				CGContextTranslateCTM(ctx, w, 0.0);
				CGContextRotateCTM(ctx, M_PI_2);
				break;
			default:
				break;
		}

		CGContextDrawImage(ctx, drawRect, srcImg);
		CGImageRelease(srcImg);

		CGImageRef dstImg = CGBitmapContextCreateImage(ctx);
		CGContextRelease(ctx);
		if (!dstImg) return -1;

		CFMutableDataRef encoded = CFDataCreateMutable(kCFAllocatorDefault, 0);
		if (!encoded) {
			CGImageRelease(dstImg);
			return -1;
		}

		CFStringRef uti = (fmt == 1) ? CFSTR("public.jpeg") : CFSTR("public.png");
		CGImageDestinationRef dest = CGImageDestinationCreateWithData(encoded, uti, 1, NULL);
		if (!dest) {
			CFRelease(encoded);
			CGImageRelease(dstImg);
			return -1;
		}

		CFDictionaryRef encOpts = NULL;
		if (fmt == 1) {
			uint32_t clampedQ = jpeg_q > 100 ? 100 : jpeg_q;
			double q = (double)clampedQ / 100.0;
			CFNumberRef qNum = CFNumberCreate(kCFAllocatorDefault, kCFNumberDoubleType, &q);
			if (qNum) {
				const void *keys[1] = { kCGImageDestinationLossyCompressionQuality };
				const void *vals[1] = { qNum };
				encOpts = CFDictionaryCreate(
					kCFAllocatorDefault, keys, vals, 1,
					&kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
				CFRelease(qNum);
			}
		}

		CGImageDestinationAddImage(dest, dstImg, encOpts);
		if (encOpts) CFRelease(encOpts);
		CGImageRelease(dstImg);

		bool finalized = CGImageDestinationFinalize(dest);
		CFRelease(dest);
		if (!finalized) {
			CFRelease(encoded);
			return -1;
		}

		CFIndex encLen = CFDataGetLength(encoded);
		if (encLen <= 0 || !pi_scratch_set(CFDataGetBytePtr(encoded), (size_t)encLen)) {
			CFRelease(encoded);
			return -1;
		}
		CFRelease(encoded);
		return (int32_t)encLen;
	}
}

// ---------------------------------------------------------------------------
// CoreFoundation Word Segmentation
// ---------------------------------------------------------------------------

static uint32_t range_is_word_like(CFStringRef str, CFCharacterSetRef alphaNum, CFRange r) {
	if (r.length <= 0) return 0;
	return CFStringFindCharacterFromSet(str, alphaNum, r, 0, NULL) ? 1u : 0u;
}

int32_t pi_native_word_segment(const uint8_t *text, size_t text_len) {
	@autoreleasepool {
		if (text_len == 0) {
			pi_scratch_set(NULL, 0);
			return 0;
		}
		if (!text || text_len > (size_t)LONG_MAX) return -1;

		CFStringRef cf = CFStringCreateWithBytes(
			kCFAllocatorDefault, text, (CFIndex)text_len, kCFStringEncodingUTF8, false);
		if (!cf) return -1;

		CFIndex totalLen = CFStringGetLength(cf);
		if (totalLen == 0) {
			CFRelease(cf);
			pi_scratch_set(NULL, 0);
			return 0;
		}

		CFStringTokenizerRef tok = CFStringTokenizerCreate(
			kCFAllocatorDefault, cf, CFRangeMake(0, totalLen),
			kCFStringTokenizerUnitWordBoundary, NULL);
		if (!tok) {
			CFRelease(cf);
			return -1;
		}

		CFCharacterSetRef alphaNum = CFCharacterSetGetPredefined(kCFCharacterSetAlphaNumeric);
		size_t cap = 64;
		size_t count = 0;
		uint32_t *items = (uint32_t *)malloc(cap * 3 * sizeof(uint32_t));
		if (!items) {
			CFRelease(tok);
			CFRelease(cf);
			return -1;
		}

		CFIndex pos = 0;
		while (CFStringTokenizerAdvanceToNextToken(tok) != kCFStringTokenizerTokenNone) {
			CFRange r = CFStringTokenizerGetCurrentTokenRange(tok);
			if (r.location == kCFNotFound) break;

			if (r.location > pos) {
				if (count == cap) {
					cap *= 2;
					uint32_t *grown = (uint32_t *)realloc(items, cap * 3 * sizeof(uint32_t));
					if (!grown) {
						free(items);
						CFRelease(tok);
						CFRelease(cf);
						return -1;
					}
					items = grown;
				}
				CFRange gap = CFRangeMake(pos, r.location - pos);
				items[count * 3 + 0] = (uint32_t)gap.location;
				items[count * 3 + 1] = (uint32_t)(gap.location + gap.length);
				items[count * 3 + 2] = range_is_word_like(cf, alphaNum, gap);
				count++;
			}

			if (count == cap) {
				cap *= 2;
				uint32_t *grown = (uint32_t *)realloc(items, cap * 3 * sizeof(uint32_t));
				if (!grown) {
					free(items);
					CFRelease(tok);
					CFRelease(cf);
					return -1;
				}
				items = grown;
			}
			items[count * 3 + 0] = (uint32_t)r.location;
			items[count * 3 + 1] = (uint32_t)(r.location + r.length);
			items[count * 3 + 2] = range_is_word_like(cf, alphaNum, r);
			count++;
			pos = r.location + r.length;
		}

		if (pos < totalLen) {
			if (count == cap) {
				cap *= 2;
				uint32_t *grown = (uint32_t *)realloc(items, cap * 3 * sizeof(uint32_t));
				if (!grown) {
					free(items);
					CFRelease(tok);
					CFRelease(cf);
					return -1;
				}
				items = grown;
			}
			CFRange tail = CFRangeMake(pos, totalLen - pos);
			items[count * 3 + 0] = (uint32_t)tail.location;
			items[count * 3 + 1] = (uint32_t)(tail.location + tail.length);
			items[count * 3 + 2] = range_is_word_like(cf, alphaNum, tail);
			count++;
		}

		CFRelease(tok);
		CFRelease(cf);

		size_t byteLen = count * 3 * sizeof(uint32_t);
		bool ok = pi_scratch_set((const uint8_t *)items, byteLen);
		free(items);
		return ok ? (int32_t)byteLen : -1;
	}
}

// ---------------------------------------------------------------------------
// JavaScriptCore VM 64-slot table & eval with timeout
// ---------------------------------------------------------------------------

#define PI_JSC_MAX_VMS 64

typedef bool (*PiJscShouldTerminateFn)(JSContextRef, void *);
typedef void (*PiJscSetTimeLimitFn)(JSContextGroupRef, double, PiJscShouldTerminateFn, void *);
typedef void (*PiJscClearTimeLimitFn)(JSContextGroupRef);

typedef struct {
	pthread_mutex_t lock;
	bool in_use;
	JSContextGroupRef group;
	JSGlobalContextRef ctx;
} PiJscSlot;

static pthread_once_t g_jsc_once = PTHREAD_ONCE_INIT;
static pthread_mutex_t g_jsc_table_lock = PTHREAD_MUTEX_INITIALIZER;
static PiJscSlot g_jsc_slots[PI_JSC_MAX_VMS];
static PiJscSetTimeLimitFn g_jsc_set_time_limit = NULL;
static PiJscClearTimeLimitFn g_jsc_clear_time_limit = NULL;

static void pi_jsc_init_once(void) {
	for (int i = 0; i < PI_JSC_MAX_VMS; i++) {
		pthread_mutex_init(&g_jsc_slots[i].lock, NULL);
		g_jsc_slots[i].in_use = false;
		g_jsc_slots[i].group = NULL;
		g_jsc_slots[i].ctx = NULL;
	}
	union { void *p; PiJscSetTimeLimitFn fn; } u_set;
	union { void *p; PiJscClearTimeLimitFn fn; } u_clr;
	u_set.p = dlsym(RTLD_DEFAULT, "JSContextGroupSetExecutionTimeLimit");
	u_clr.p = dlsym(RTLD_DEFAULT, "JSContextGroupClearExecutionTimeLimit");
	g_jsc_set_time_limit = u_set.fn;
	g_jsc_clear_time_limit = u_clr.fn;
}

int32_t pi_native_jsc_create(void) {
	pthread_once(&g_jsc_once, pi_jsc_init_once);
	pthread_mutex_lock(&g_jsc_table_lock);
	int free_idx = -1;
	for (int i = 0; i < PI_JSC_MAX_VMS; i++) {
		if (!g_jsc_slots[i].in_use) {
			free_idx = i;
			break;
		}
	}
	if (free_idx < 0) {
		pthread_mutex_unlock(&g_jsc_table_lock);
		return -1;
	}

	JSContextGroupRef group = JSContextGroupCreate();
	if (!group) {
		pthread_mutex_unlock(&g_jsc_table_lock);
		return -1;
	}
	JSGlobalContextRef ctx = JSGlobalContextCreateInGroup(group, NULL);
	if (!ctx) {
		JSContextGroupRelease(group);
		pthread_mutex_unlock(&g_jsc_table_lock);
		return -1;
	}

	g_jsc_slots[free_idx].group = group;
	g_jsc_slots[free_idx].ctx = ctx;
	g_jsc_slots[free_idx].in_use = true;
	pthread_mutex_unlock(&g_jsc_table_lock);
	return free_idx + 1;
}

void pi_native_jsc_destroy(int32_t vm_id) {
	pthread_once(&g_jsc_once, pi_jsc_init_once);
	if (vm_id < 1 || vm_id > PI_JSC_MAX_VMS) return;

	pthread_mutex_lock(&g_jsc_table_lock);
	PiJscSlot *slot = &g_jsc_slots[vm_id - 1];
	if (!slot->in_use) {
		pthread_mutex_unlock(&g_jsc_table_lock);
		return;
	}
	pthread_mutex_lock(&slot->lock);
	JSGlobalContextRef ctx = slot->ctx;
	JSContextGroupRef group = slot->group;
	slot->ctx = NULL;
	slot->group = NULL;
	slot->in_use = false;
	pthread_mutex_unlock(&slot->lock);
	pthread_mutex_unlock(&g_jsc_table_lock);

	if (ctx) JSGlobalContextRelease(ctx);
	if (group) JSContextGroupRelease(group);
}

static JSStringRef pi_js_string_from_bytes(const uint8_t *bytes, size_t len) {
	if (!bytes || len == 0) {
		return JSStringCreateWithUTF8CString("");
	}
	if (len <= (size_t)LONG_MAX) {
		CFStringRef cf = CFStringCreateWithBytes(
			kCFAllocatorDefault, bytes, (CFIndex)len, kCFStringEncodingUTF8, false);
		if (cf) {
			JSStringRef js = JSStringCreateWithCFString(cf);
			CFRelease(cf);
			return js;
		}
	}
	char *buf = (char *)malloc(len + 1);
	if (!buf) return NULL;
	memcpy(buf, bytes, len);
	buf[len] = '\0';
	JSStringRef js = JSStringCreateWithUTF8CString(buf);
	free(buf);
	return js;
}

static int32_t pi_scratch_set_js_string(JSStringRef jsStr) {
	if (!jsStr) {
		pi_scratch_set(NULL, 0);
		return 0;
	}
	size_t maxUtf8 = JSStringGetMaximumUTF8CStringSize(jsStr);
	if (maxUtf8 == 0) {
		pi_scratch_set(NULL, 0);
		return 0;
	}
	uint8_t *tmp = (uint8_t *)malloc(maxUtf8);
	if (!tmp) return -1;
	size_t written = JSStringGetUTF8CString(jsStr, (char *)tmp, maxUtf8);
	size_t byteLen = written > 0 ? written - 1 : 0;
	bool ok = pi_scratch_set(tmp, byteLen);
	free(tmp);
	return ok ? (int32_t)byteLen : -1;
}

static NSString *pi_nsstring_from_js_value(JSContextRef ctx, JSValueRef val) {
	if (!val || JSValueIsUndefined(ctx, val)) return nil;
	JSValueRef ignored = NULL;
	JSStringRef jsStr = JSValueToStringCopy(ctx, val, &ignored);
	if (!jsStr) return nil;
	CFStringRef cf = JSStringCopyCFString(kCFAllocatorDefault, jsStr);
	JSStringRelease(jsStr);
	if (!cf) return nil;
	return (__bridge_transfer NSString *)cf;
}

static NSString *pi_jsc_format_exception(JSContextRef ctx, JSValueRef exc) {
	if (!exc) return @"Unknown JavaScript error";
	if (JSValueIsObject(ctx, exc)) {
		JSValueRef ignored = NULL;
		JSObjectRef obj = JSValueToObject(ctx, exc, &ignored);
		if (obj) {
			JSStringRef kName = JSStringCreateWithUTF8CString("name");
			JSStringRef kMsg = JSStringCreateWithUTF8CString("message");
			JSStringRef kStack = JSStringCreateWithUTF8CString("stack");
			JSStringRef kLine = JSStringCreateWithUTF8CString("line");
			JSStringRef kUrl = JSStringCreateWithUTF8CString("sourceURL");

			JSValueRef vName = kName ? JSObjectGetProperty(ctx, obj, kName, &ignored) : NULL;
			JSValueRef vMsg = kMsg ? JSObjectGetProperty(ctx, obj, kMsg, &ignored) : NULL;
			JSValueRef vStack = kStack ? JSObjectGetProperty(ctx, obj, kStack, &ignored) : NULL;
			JSValueRef vLine = kLine ? JSObjectGetProperty(ctx, obj, kLine, &ignored) : NULL;
			JSValueRef vUrl = kUrl ? JSObjectGetProperty(ctx, obj, kUrl, &ignored) : NULL;

			if (kName) JSStringRelease(kName);
			if (kMsg) JSStringRelease(kMsg);
			if (kStack) JSStringRelease(kStack);
			if (kLine) JSStringRelease(kLine);
			if (kUrl) JSStringRelease(kUrl);

			NSString *name = pi_nsstring_from_js_value(ctx, vName);
			NSString *msg = pi_nsstring_from_js_value(ctx, vMsg);
			NSString *stack = pi_nsstring_from_js_value(ctx, vStack);
			NSString *line = pi_nsstring_from_js_value(ctx, vLine);
			NSString *url = pi_nsstring_from_js_value(ctx, vUrl);

			NSMutableString *header = [NSMutableString string];
			if ([name length] > 0 && [msg length] > 0) {
				[header appendFormat:@"%@: %@", name, msg];
			} else if ([name length] > 0) {
				[header appendString:name];
			} else if ([msg length] > 0) {
				[header appendString:msg];
			} else {
				NSString *fallback = pi_nsstring_from_js_value(ctx, exc);
				if (fallback) [header appendString:fallback];
			}

			if ([stack length] > 0) {
				if ([header length] > 0) [header appendString:@"\n"];
				[header appendString:stack];
			} else if ([line length] > 0) {
				if ([header length] > 0) [header appendString:@"\n"];
				if ([url length] > 0) {
					[header appendFormat:@"    at %@:%@", url, line];
				} else {
					[header appendFormat:@"    at line %@", line];
				}
			}

			if ([header length] > 0) return header;
		}
	}
	NSString *str = pi_nsstring_from_js_value(ctx, exc);
	return str ? str : @"JavaScript exception";
}

typedef struct {
	volatile bool timed_out;
} PiJscTimeoutCtx;

static bool pi_jsc_should_terminate(JSContextRef ctx, void *context) {
	(void)ctx;
	PiJscTimeoutCtx *tctx = (PiJscTimeoutCtx *)context;
	if (tctx) tctx->timed_out = true;
	return true;
}

int32_t pi_native_jsc_eval(
	int32_t vm_id,
	const uint8_t *code,
	size_t code_len,
	const uint8_t *source_url,
	size_t url_len,
	double timeout_ms,
	uint8_t *out_tag,
	size_t out_tag_len
) {
	@autoreleasepool {
		pthread_once(&g_jsc_once, pi_jsc_init_once);
		if (vm_id < 1 || vm_id > PI_JSC_MAX_VMS || !out_tag || out_tag_len < 1) return -1;

		pthread_mutex_lock(&g_jsc_table_lock);
		PiJscSlot *slot = &g_jsc_slots[vm_id - 1];
		if (!slot->in_use || !slot->ctx || !slot->group) {
			pthread_mutex_unlock(&g_jsc_table_lock);
			return -1;
		}
		pthread_mutex_lock(&slot->lock);
		JSContextGroupRef group = slot->group;
		JSGlobalContextRef ctx = slot->ctx;
		pthread_mutex_unlock(&g_jsc_table_lock);

		JSStringRef codeStr = pi_js_string_from_bytes(code, code_len);
		if (!codeStr) {
			pthread_mutex_unlock(&slot->lock);
			return -1;
		}
		JSStringRef urlStr = (source_url && url_len > 0) ? pi_js_string_from_bytes(source_url, url_len) : NULL;

		PiJscTimeoutCtx tctx = { false };
		bool timeout_armed = false;
		if (timeout_ms > 0.0 && isfinite(timeout_ms) && g_jsc_set_time_limit != NULL) {
			g_jsc_set_time_limit(group, timeout_ms / 1000.0, pi_jsc_should_terminate, &tctx);
			timeout_armed = true;
		}

		JSValueRef exc = NULL;
		JSValueRef res = JSEvaluateScript(ctx, codeStr, NULL, urlStr, 1, &exc);

		if (timeout_armed) {
			if (g_jsc_clear_time_limit != NULL) {
				g_jsc_clear_time_limit(group);
			} else if (g_jsc_set_time_limit != NULL) {
				g_jsc_set_time_limit(group, INFINITY, NULL, NULL);
			}
		}

		JSStringRelease(codeStr);
		if (urlStr) JSStringRelease(urlStr);

		if (tctx.timed_out) {
			*out_tag = 2;
			NSString *msg = @"Execution timed out";
			NSData *utf8 = [msg dataUsingEncoding:NSUTF8StringEncoding];
			int32_t outLen = 0;
			if (utf8 && pi_scratch_set((const uint8_t *)[utf8 bytes], [utf8 length])) {
				outLen = (int32_t)[utf8 length];
			} else {
				pi_scratch_set(NULL, 0);
			}
			pthread_mutex_unlock(&slot->lock);
			return outLen;
		}

		if (exc != NULL) {
			*out_tag = 1;
			NSString *formatted = pi_jsc_format_exception(ctx, exc);
			NSData *utf8 = [formatted dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:YES];
			int32_t outLen = -1;
			if (utf8 && pi_scratch_set((const uint8_t *)[utf8 bytes], [utf8 length])) {
				outLen = (int32_t)[utf8 length];
			} else {
				const char *fallback = "JavaScript error";
				pi_scratch_set((const uint8_t *)fallback, strlen(fallback));
				outLen = (int32_t)strlen(fallback);
			}
			pthread_mutex_unlock(&slot->lock);
			return outLen;
		}

		*out_tag = 0;
		if (!res || JSValueIsUndefined(ctx, res)) {
			pi_scratch_set(NULL, 0);
			pthread_mutex_unlock(&slot->lock);
			return 0;
		}

		JSValueRef strExc = NULL;
		JSStringRef outJs = JSValueToStringCopy(ctx, res, &strExc);
		if (strExc != NULL) {
			*out_tag = 1;
			if (outJs) JSStringRelease(outJs);
			NSString *formatted = pi_jsc_format_exception(ctx, strExc);
			NSData *utf8 = [formatted dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:YES];
			int32_t outLen = 0;
			if (utf8 && pi_scratch_set((const uint8_t *)[utf8 bytes], [utf8 length])) {
				outLen = (int32_t)[utf8 length];
			} else {
				pi_scratch_set(NULL, 0);
			}
			pthread_mutex_unlock(&slot->lock);
			return outLen;
		}

		int32_t outLen = pi_scratch_set_js_string(outJs);
		if (outJs) JSStringRelease(outJs);
		pthread_mutex_unlock(&slot->lock);
		return outLen;
	}
}
