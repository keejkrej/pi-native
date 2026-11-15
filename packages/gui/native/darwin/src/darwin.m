#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreText/CoreText.h>
#import <Foundation/Foundation.h>
#include <math.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "../../include/sgui.h"

/* -------------------------------------------------------------------------- */
/* Little-endian unaligned-safe binary helpers                                */
/* -------------------------------------------------------------------------- */

static inline uint16_t read_u16(const uint8_t *p) {
    uint16_t v;
    memcpy(&v, p, sizeof(v));
    return v;
}

static inline uint32_t read_u32(const uint8_t *p) {
    uint32_t v;
    memcpy(&v, p, sizeof(v));
    return v;
}

static inline double read_f64(const uint8_t *p) {
    double v;
    memcpy(&v, p, sizeof(v));
    return v;
}

static inline void write_u32(uint8_t *p, uint32_t v) {
    memcpy(p, &v, sizeof(v));
}

static inline void write_f64(uint8_t *p, double v) {
    memcpy(p, &v, sizeof(v));
}

static inline size_t align8(size_t n) {
    return (n + 7u) & ~(size_t)7u;
}

static inline CGColorRef cg_color_from_rgba(uint32_t rgba) {
    CGFloat r = (CGFloat)((rgba >> 24) & 0xFFu) / 255.0;
    CGFloat g = (CGFloat)((rgba >> 16) & 0xFFu) / 255.0;
    CGFloat b = (CGFloat)((rgba >> 8) & 0xFFu) / 255.0;
    CGFloat a = (CGFloat)(rgba & 0xFFu) / 255.0;
    return [[NSColor colorWithSRGBRed:r green:g blue:b alpha:a] CGColor];
}

/* -------------------------------------------------------------------------- */
/* UTF-8 <-> UTF-16 index conversion                                          */
/* -------------------------------------------------------------------------- */

static CFIndex utf8_byte_to_utf16(const uint8_t *s, size_t len, uint32_t byte_off) {
    size_t limit = byte_off < len ? (size_t)byte_off : len;
    size_t i = 0;
    CFIndex units = 0;
    while (i < limit) {
        uint8_t b = s[i];
        if (b < 0x80u) {
            i += 1;
            units += 1;
        } else if ((b & 0xE0u) == 0xC0u) {
            i += 2;
            units += 1;
        } else if ((b & 0xF0u) == 0xE0u) {
            i += 3;
            units += 1;
        } else if ((b & 0xF8u) == 0xF0u) {
            i += 4;
            units += 2;
        } else {
            i += 1;
            units += 1;
        }
    }
    return units;
}

static uint32_t utf16_to_utf8_byte(const uint8_t *s, size_t len, CFIndex target_units) {
    if (target_units <= 0) {
        return 0;
    }
    size_t i = 0;
    CFIndex units = 0;
    while (i < len && units < target_units) {
        uint8_t b = s[i];
        size_t adv = 1;
        CFIndex uadv = 1;
        if (b < 0x80u) {
            adv = 1;
            uadv = 1;
        } else if ((b & 0xE0u) == 0xC0u) {
            adv = 2;
            uadv = 1;
        } else if ((b & 0xF0u) == 0xE0u) {
            adv = 3;
            uadv = 1;
        } else if ((b & 0xF8u) == 0xF0u) {
            adv = 4;
            uadv = 2;
        }
        if (i + adv > len) {
            i = len;
            break;
        }
        if (units + uadv > target_units) {
            break;
        }
        i += adv;
        units += uadv;
    }
    return (uint32_t)i;
}

/* -------------------------------------------------------------------------- */
/* CoreText Font Cache & Text Layout                                          */
/* -------------------------------------------------------------------------- */

typedef struct {
    uint32_t family;
    uint32_t size_tenths;
    uint32_t weight;
    uint32_t flags;
    CTFontRef font;
    double ascent;
    double descent;
    double leading;
    double line_height;
} SguiCachedFont;

#define SGUI_FONT_CACHE_MAX 128

static SguiCachedFont g_font_cache[SGUI_FONT_CACHE_MAX];
static size_t g_font_cache_count = 0;

static NSFontWeight ns_weight_from_css(uint32_t weight) {
    if (weight <= 150) return NSFontWeightUltraLight;
    if (weight <= 250) return NSFontWeightThin;
    if (weight <= 350) return NSFontWeightLight;
    if (weight <= 450) return NSFontWeightRegular;
    if (weight <= 550) return NSFontWeightMedium;
    if (weight <= 650) return NSFontWeightSemibold;
    if (weight <= 750) return NSFontWeightBold;
    if (weight <= 850) return NSFontWeightHeavy;
    return NSFontWeightBlack;
}

static const SguiCachedFont *get_cached_font(
    uint32_t family,
    double font_size,
    uint32_t weight,
    uint32_t flags
) {
    double clamped_size = font_size > 1.0 ? font_size : 1.0;
    uint32_t size_tenths = (uint32_t)llround(clamped_size * 10.0);
    uint32_t style_flags = flags & SGUI_FONT_FLAG_ITALIC;

    for (size_t i = 0; i < g_font_cache_count; i++) {
        const SguiCachedFont *entry = &g_font_cache[i];
        if (entry->family == family &&
            entry->size_tenths == size_tenths &&
            entry->weight == weight &&
            entry->flags == style_flags) {
            return entry;
        }
    }

    NSFontWeight ns_weight = ns_weight_from_css(weight);
    CGFloat pt_size = (CGFloat)clamped_size;
    NSFont *base = (family == SGUI_FONT_MONO)
        ? [NSFont monospacedSystemFontOfSize:pt_size weight:ns_weight]
        : [NSFont systemFontOfSize:pt_size weight:ns_weight];
    if (base == nil) {
        base = [NSFont systemFontOfSize:pt_size];
    }

    CTFontRef ct_font = (__bridge CTFontRef)base;
    CFRetain(ct_font);

    if ((style_flags & SGUI_FONT_FLAG_ITALIC) != 0) {
        CTFontRef italic = CTFontCreateCopyWithSymbolicTraits(
            ct_font,
            pt_size,
            NULL,
            kCTFontTraitItalic,
            kCTFontTraitItalic
        );
        if (italic != NULL) {
            CFRelease(ct_font);
            ct_font = italic;
        }
    }

    double ascent = (double)CTFontGetAscent(ct_font);
    double descent = (double)CTFontGetDescent(ct_font);
    double leading = (double)CTFontGetLeading(ct_font);
    double line_height = ceil(ascent + descent + (leading > 0.0 ? leading : 0.0));
    if (line_height < 1.0) {
        line_height = 1.0;
    }

    size_t slot = g_font_cache_count;
    if (slot >= SGUI_FONT_CACHE_MAX) {
        slot = SGUI_FONT_CACHE_MAX - 1;
        if (g_font_cache[slot].font != NULL) {
            CFRelease(g_font_cache[slot].font);
        }
    } else {
        g_font_cache_count++;
    }

    g_font_cache[slot] = (SguiCachedFont){
        .family = family,
        .size_tenths = size_tenths,
        .weight = weight,
        .flags = style_flags,
        .font = ct_font,
        .ascent = ascent,
        .descent = descent,
        .leading = leading,
        .line_height = line_height,
    };
    return &g_font_cache[slot];
}

static NSString *nsstring_from_utf8(const uint8_t *bytes, size_t len) {
    if (bytes == NULL || len == 0) {
        return @"";
    }
    NSString *s = [[NSString alloc] initWithBytes:bytes length:len encoding:NSUTF8StringEncoding];
    if (s != nil) {
        return s;
    }
    /* Replace invalid UTF-8 sequences cleanly rather than returning nil. */
    NSData *data = [NSData dataWithBytes:bytes length:len];
    NSDictionary *opts = @{NSStringEncodingDetectionAllowLossyKey : @YES};
    NSString *decoded = nil;
    [NSString stringEncodingForData:data
                    encodingOptions:opts
                    convertedString:&decoded
                usedLossyConversion:NULL];
    return decoded != nil ? decoded : @"";
}

typedef struct {
    CTLineRef *lines;
    double *widths;
    size_t count;
    size_t capacity;
    double max_line_width;
} SguiBrokenLines;

static void broken_lines_push(SguiBrokenLines *out, CTLineRef line, double width) {
    if (out->count == out->capacity) {
        size_t next_cap = out->capacity == 0 ? 8 : out->capacity * 2;
        CTLineRef *next_lines = (CTLineRef *)realloc(out->lines, next_cap * sizeof(CTLineRef));
        double *next_widths = (double *)realloc(out->widths, next_cap * sizeof(double));
        if (next_lines == NULL || next_widths == NULL) {
            free(next_lines);
            free(next_widths);
            return;
        }
        out->lines = next_lines;
        out->widths = next_widths;
        out->capacity = next_cap;
    }
    CFRetain(line);
    out->lines[out->count] = line;
    out->widths[out->count] = width;
    out->count++;
    if (width > out->max_line_width) {
        out->max_line_width = width;
    }
}

static void broken_lines_free(SguiBrokenLines *out) {
    for (size_t i = 0; i < out->count; i++) {
        if (out->lines[i] != NULL) {
            CFRelease(out->lines[i]);
        }
    }
    free(out->lines);
    free(out->widths);
    out->lines = NULL;
    out->widths = NULL;
    out->count = 0;
    out->capacity = 0;
    out->max_line_width = 0.0;
}

static void layout_paragraph(
    const SguiCachedFont *cf,
    NSString *para,
    CGColorRef color,
    double max_width,
    SguiBrokenLines *out
) {
    if (para.length == 0) {
        CFAttributedStringRef empty_attr = CFAttributedStringCreate(
            kCFAllocatorDefault,
            (__bridge CFStringRef)@"",
            (__bridge CFDictionaryRef)@{
                (__bridge id)kCTFontAttributeName : (__bridge id)cf->font,
                (__bridge id)kCTForegroundColorAttributeName : (__bridge id)color,
            }
        );
        CTLineRef empty_line = CTLineCreateWithAttributedString(empty_attr);
        CFRelease(empty_attr);
        broken_lines_push(out, empty_line, 0.0);
        CFRelease(empty_line);
        return;
    }

    NSDictionary *attrs = @{
        (__bridge id)kCTFontAttributeName : (__bridge id)cf->font,
        (__bridge id)kCTForegroundColorAttributeName : (__bridge id)color,
    };
    NSAttributedString *attr = [[NSAttributedString alloc] initWithString:para attributes:attrs];

    if (max_width <= 0.0) {
        CTLineRef line = CTLineCreateWithAttributedString((__bridge CFAttributedStringRef)attr);
        double w = (double)CTLineGetTypographicBounds(line, NULL, NULL, NULL);
        broken_lines_push(out, line, w);
        CFRelease(line);
        return;
    }

    CTTypesetterRef typesetter = CTTypesetterCreateWithAttributedString((__bridge CFAttributedStringRef)attr);
    CFIndex total_len = (CFIndex)para.length;
    CFIndex start = 0;
    while (start < total_len) {
        CFIndex count = CTTypesetterSuggestLineBreak(typesetter, start, max_width);
        if (count <= 0) {
            count = 1;
        }
        CTLineRef line = CTTypesetterCreateLine(typesetter, CFRangeMake(start, count));
        double w = (double)CTLineGetTypographicBounds(line, NULL, NULL, NULL);
        broken_lines_push(out, line, w);
        CFRelease(line);
        start += count;
    }
    CFRelease(typesetter);
}

static void layout_text(
    const SguiCachedFont *cf,
    const uint8_t *text,
    size_t text_len,
    CGColorRef color,
    double max_width,
    SguiBrokenLines *out
) {
    memset(out, 0, sizeof(*out));
    if (text == NULL || text_len == 0) {
        layout_paragraph(cf, @"", color, max_width, out);
        return;
    }
    NSString *full = nsstring_from_utf8(text, text_len);
    NSArray<NSString *> *paragraphs = [full componentsSeparatedByString:@"\n"];
    for (NSString *para in paragraphs) {
        layout_paragraph(cf, para, color, max_width, out);
    }
}

/* -------------------------------------------------------------------------- */
/* Event Queue (Ring Buffer in Linear Bytes)                                  */
/* -------------------------------------------------------------------------- */

#define SGUI_EVENT_QUEUE_CAP (512u * 1024u)

static uint8_t *g_event_buf = NULL;
static size_t g_event_head = 0;
static size_t g_event_tail = 0;

static void ensure_event_buf(void) {
    if (g_event_buf == NULL) {
        g_event_buf = (uint8_t *)malloc(SGUI_EVENT_QUEUE_CAP);
        g_event_head = 0;
        g_event_tail = 0;
    }
}

static void push_event_record(const uint8_t *rec, size_t len) {
    ensure_event_buf();
    if (g_event_buf == NULL || len > SGUI_EVENT_QUEUE_CAP) {
        return;
    }
    if (g_event_tail + len > SGUI_EVENT_QUEUE_CAP) {
        if (g_event_head > 0) {
            size_t avail = g_event_tail - g_event_head;
            if (avail > 0) {
                memmove(g_event_buf, g_event_buf + g_event_head, avail);
            }
            g_event_head = 0;
            g_event_tail = avail;
        }
        if (g_event_tail + len > SGUI_EVENT_QUEUE_CAP) {
            /* Drop oldest events to keep latest input responsive under extreme backlog. */
            while (g_event_head < g_event_tail &&
                   (g_event_tail - g_event_head) + len > SGUI_EVENT_QUEUE_CAP) {
                uint32_t skip_len = read_u32(g_event_buf + g_event_head + 4u);
                if (skip_len < 16u || g_event_head + skip_len > g_event_tail) {
                    g_event_head = g_event_tail;
                    break;
                }
                g_event_head += skip_len;
            }
            size_t avail = g_event_tail - g_event_head;
            if (avail > 0 && g_event_head > 0) {
                memmove(g_event_buf, g_event_buf + g_event_head, avail);
            }
            g_event_head = 0;
            g_event_tail = avail;
        }
    }
    if (g_event_tail + len <= SGUI_EVENT_QUEUE_CAP) {
        memcpy(g_event_buf + g_event_tail, rec, len);
        g_event_tail += len;
    }
}

static uint32_t modifiers_from_flags(NSEventModifierFlags flags) {
    uint32_t mods = 0u;
    if ((flags & NSEventModifierFlagShift) != 0) mods |= SGUI_MOD_SHIFT;
    if ((flags & NSEventModifierFlagControl) != 0) mods |= SGUI_MOD_CTRL;
    if ((flags & NSEventModifierFlagOption) != 0) mods |= SGUI_MOD_ALT;
    if ((flags & NSEventModifierFlagCommand) != 0) mods |= SGUI_MOD_SUPER;
    return mods;
}

static void push_evt_simple(uint32_t kind, uint32_t window_id, uint32_t mods) {
    uint8_t rec[16];
    write_u32(rec + 0, kind);
    write_u32(rec + 4, 16u);
    write_u32(rec + 8, window_id);
    write_u32(rec + 12, mods);
    push_event_record(rec, sizeof(rec));
}

static void push_evt_resize(uint32_t window_id, double w, double h, double scale) {
    uint8_t rec[40];
    write_u32(rec + 0, SGUI_EVT_RESIZE);
    write_u32(rec + 4, 40u);
    write_u32(rec + 8, window_id);
    write_u32(rec + 12, 0u);
    write_f64(rec + 16, w);
    write_f64(rec + 24, h);
    write_f64(rec + 32, scale);
    push_event_record(rec, sizeof(rec));
}

static void push_evt_focus(uint32_t window_id, uint32_t focused, uint32_t dark_mode) {
    uint8_t rec[24];
    write_u32(rec + 0, SGUI_EVT_FOCUS);
    write_u32(rec + 4, 24u);
    write_u32(rec + 8, window_id);
    write_u32(rec + 12, 0u);
    write_u32(rec + 16, focused);
    write_u32(rec + 20, dark_mode);
    push_event_record(rec, sizeof(rec));
}

static void push_evt_pointer(
    uint32_t window_id,
    uint32_t mods,
    uint32_t phase,
    uint32_t button,
    uint32_t click_count,
    double x,
    double y
) {
    uint8_t rec[48];
    write_u32(rec + 0, SGUI_EVT_POINTER);
    write_u32(rec + 4, 48u);
    write_u32(rec + 8, window_id);
    write_u32(rec + 12, mods);
    write_u32(rec + 16, phase);
    write_u32(rec + 20, button);
    write_u32(rec + 24, click_count);
    write_u32(rec + 28, 0u);
    write_f64(rec + 32, x);
    write_f64(rec + 40, y);
    push_event_record(rec, sizeof(rec));
}

static void push_evt_scroll(uint32_t window_id, uint32_t mods, double x, double y, double dx, double dy) {
    uint8_t rec[48];
    write_u32(rec + 0, SGUI_EVT_SCROLL);
    write_u32(rec + 4, 48u);
    write_u32(rec + 8, window_id);
    write_u32(rec + 12, mods);
    write_f64(rec + 16, x);
    write_f64(rec + 24, y);
    write_f64(rec + 32, dx);
    write_f64(rec + 40, dy);
    push_event_record(rec, sizeof(rec));
}

static void push_evt_key(
    uint32_t window_id,
    uint32_t mods,
    uint32_t phase,
    uint32_t key_code,
    const char *name
) {
    size_t name_len = name != NULL ? strlen(name) : 0u;
    size_t total = align8(32u + name_len);
    uint8_t stack_buf[128];
    uint8_t *rec = total <= sizeof(stack_buf) ? stack_buf : (uint8_t *)malloc(total);
    if (rec == NULL) return;
    memset(rec, 0, total);
    write_u32(rec + 0, SGUI_EVT_KEY);
    write_u32(rec + 4, (uint32_t)total);
    write_u32(rec + 8, window_id);
    write_u32(rec + 12, mods);
    write_u32(rec + 16, phase);
    write_u32(rec + 20, key_code);
    write_u32(rec + 24, (uint32_t)name_len);
    write_u32(rec + 28, 0u);
    if (name_len > 0) {
        memcpy(rec + 32, name, name_len);
    }
    push_event_record(rec, total);
    if (rec != stack_buf) free(rec);
}

static void push_evt_text(uint32_t window_id, uint32_t mods, NSString *text) {
    NSData *utf8 = [text dataUsingEncoding:NSUTF8StringEncoding];
    size_t utf8_len = utf8 != nil ? utf8.length : 0u;
    size_t total = align8(24u + utf8_len);
    uint8_t stack_buf[256];
    uint8_t *rec = total <= sizeof(stack_buf) ? stack_buf : (uint8_t *)malloc(total);
    if (rec == NULL) return;
    memset(rec, 0, total);
    write_u32(rec + 0, SGUI_EVT_TEXT);
    write_u32(rec + 4, (uint32_t)total);
    write_u32(rec + 8, window_id);
    write_u32(rec + 12, mods);
    write_u32(rec + 16, (uint32_t)utf8_len);
    write_u32(rec + 20, 0u);
    if (utf8_len > 0) {
        memcpy(rec + 24, utf8.bytes, utf8_len);
    }
    push_event_record(rec, total);
    if (rec != stack_buf) free(rec);
}

static void push_evt_ime_preedit(
    uint32_t window_id,
    uint32_t cursor_start,
    uint32_t cursor_end,
    NSString *text
) {
    NSData *utf8 = [text dataUsingEncoding:NSUTF8StringEncoding];
    size_t utf8_len = utf8 != nil ? utf8.length : 0u;
    size_t total = align8(32u + utf8_len);
    uint8_t stack_buf[256];
    uint8_t *rec = total <= sizeof(stack_buf) ? stack_buf : (uint8_t *)malloc(total);
    if (rec == NULL) return;
    memset(rec, 0, total);
    write_u32(rec + 0, SGUI_EVT_IME_PREEDIT);
    write_u32(rec + 4, (uint32_t)total);
    write_u32(rec + 8, window_id);
    write_u32(rec + 12, 0u);
    write_u32(rec + 16, cursor_start);
    write_u32(rec + 20, cursor_end);
    write_u32(rec + 24, (uint32_t)utf8_len);
    write_u32(rec + 28, 0u);
    if (utf8_len > 0) {
        memcpy(rec + 32, utf8.bytes, utf8_len);
    }
    push_event_record(rec, total);
    if (rec != stack_buf) free(rec);
}

static void push_evt_menu(uint32_t item_id) {
    uint8_t rec[24];
    write_u32(rec + 0, SGUI_EVT_MENU);
    write_u32(rec + 4, 24u);
    write_u32(rec + 8, 0u);
    write_u32(rec + 12, 0u);
    write_u32(rec + 16, item_id);
    write_u32(rec + 20, 0u);
    push_event_record(rec, sizeof(rec));
}

static void push_evt_a11y_action(
    uint32_t window_id,
    uint32_t node_id,
    uint32_t action,
    NSString *text
) {
    NSData *utf8 = (text != nil && text.length > 0) ? [text dataUsingEncoding:NSUTF8StringEncoding] : nil;
    size_t utf8_len = utf8 != nil ? utf8.length : 0u;
    size_t total = align8(32u + utf8_len);
    uint8_t stack_buf[256];
    uint8_t *rec = total <= sizeof(stack_buf) ? stack_buf : (uint8_t *)malloc(total);
    if (rec == NULL) return;
    memset(rec, 0, total);
    write_u32(rec + 0, SGUI_EVT_A11Y_ACTION);
    write_u32(rec + 4, (uint32_t)total);
    write_u32(rec + 8, window_id);
    write_u32(rec + 12, 0u);
    write_u32(rec + 16, node_id);
    write_u32(rec + 20, action);
    write_u32(rec + 24, (uint32_t)utf8_len);
    write_u32(rec + 28, 0u);
    if (utf8_len > 0) {
        memcpy(rec + 32, utf8.bytes, utf8_len);
    }
    push_event_record(rec, total);
    if (rec != stack_buf) free(rec);
}

/* -------------------------------------------------------------------------- */
/* Key Mapping                                                                */
/* -------------------------------------------------------------------------- */

static const char *map_nsevent_key_name(NSEvent *event, char *scratch, size_t scratch_cap) {
    uint16_t code = event.keyCode;
    switch (code) {
        case 36: return "enter";
        case 76: return "enter";
        case 48: return "tab";
        case 49: return "space";
        case 51: return "backspace";
        case 53: return "escape";
        case 117: return "delete";
        case 115: return "home";
        case 119: return "end";
        case 116: return "pageUp";
        case 121: return "pageDown";
        case 123: return "left";
        case 124: return "right";
        case 125: return "down";
        case 126: return "up";
        case 122: return "f1";
        case 120: return "f2";
        case 99: return "f3";
        case 118: return "f4";
        case 96: return "f5";
        case 97: return "f6";
        case 98: return "f7";
        case 100: return "f8";
        case 101: return "f9";
        case 109: return "f10";
        case 103: return "f11";
        case 111: return "f12";
        default: break;
    }

    NSString *chars = event.charactersIgnoringModifiers;
    if (chars == nil || chars.length == 0) {
        chars = event.characters;
    }
    if (chars != nil && chars.length > 0) {
        unichar ch = [chars characterAtIndex:0];
        if (ch == '\r' || ch == '\n') return "enter";
        if (ch == '\t' || ch == 25) return "tab";
        if (ch == ' ') return "space";
        if (ch == 127) return "backspace";
        if (ch == 27) return "escape";
        NSString *lower = [chars lowercaseString];
        const char *utf8 = [lower UTF8String];
        if (utf8 != NULL && utf8[0] != '\0') {
            snprintf(scratch, scratch_cap, "%s", utf8);
            return scratch;
        }
    }
    snprintf(scratch, scratch_cap, "key%u", (unsigned)code);
    return scratch;
}

/* -------------------------------------------------------------------------- */
/* Window & NSView State                                                      */
/* -------------------------------------------------------------------------- */

@class SguiView;
@class SguiWindowDelegate;

typedef struct {
    uint32_t window_id;
    uint32_t flags;
    NSWindow * __strong window;
    NSView * __strong container;
    NSVisualEffectView * __strong vibrancy_view;
    SguiView * __strong view;
    SguiWindowDelegate * __strong delegate;
    uint8_t *commands;
    size_t commands_len;
    size_t commands_cap;
    NSCursor * __strong cursor;
    NSEvent * __strong last_mouse_down_event;
    NSRect ime_rect;
    double sidebar_width;
    bool vibrancy_enabled;
} SguiWindowEntry;

#define SGUI_MAX_WINDOWS 64

static SguiWindowEntry g_windows[SGUI_MAX_WINDOWS];
static uint32_t g_next_window_id = 1u;
static bool g_initialized = false;

static SguiWindowEntry *find_window_entry(uint32_t window_id) {
    if (window_id == 0u) return NULL;
    for (size_t i = 0; i < SGUI_MAX_WINDOWS; i++) {
        if (g_windows[i].window_id == window_id) {
            return &g_windows[i];
        }
    }
    return NULL;
}

static bool is_window_dark_mode(NSWindow *window) {
    NSAppearance *app = window != nil
        ? [window effectiveAppearance]
        : (NSApp != nil ? [NSApp effectiveAppearance] : nil);
    if (app == nil) return false;
    NSAppearanceName match = [app bestMatchFromAppearancesWithNames:@[
        NSAppearanceNameDarkAqua,
        NSAppearanceNameAqua,
    ]];
    return [match isEqualToString:NSAppearanceNameDarkAqua];
}

static void draw_rounded_rect_path(CGContextRef ctx, CGRect rect, CGFloat radius) {
    if (radius <= 0.0) {
        CGContextAddRect(ctx, rect);
        return;
    }
    CGFloat r = fmin(radius, fmin(rect.size.width * 0.5, rect.size.height * 0.5));
    CGFloat minx = CGRectGetMinX(rect);
    CGFloat midx = CGRectGetMidX(rect);
    CGFloat maxx = CGRectGetMaxX(rect);
    CGFloat miny = CGRectGetMinY(rect);
    CGFloat midy = CGRectGetMidY(rect);
    CGFloat maxy = CGRectGetMaxY(rect);

    CGContextMoveToPoint(ctx, minx, midy);
    CGContextAddArcToPoint(ctx, minx, miny, midx, miny, r);
    CGContextAddArcToPoint(ctx, maxx, miny, maxx, midy, r);
    CGContextAddArcToPoint(ctx, maxx, maxy, midx, maxy, r);
    CGContextAddArcToPoint(ctx, minx, maxy, minx, midy, r);
    CGContextClosePath(ctx);
}

static void draw_rounded_corners_path(
    CGContextRef ctx,
    CGRect rect,
    CGFloat tl,
    CGFloat tr,
    CGFloat br,
    CGFloat bl
) {
    CGFloat w = rect.size.width;
    CGFloat h = rect.size.height;
    if (w <= 0.0 || h <= 0.0) return;

    CGFloat rtl = fmax(0.0, tl);
    CGFloat rtr = fmax(0.0, tr);
    CGFloat rbr = fmax(0.0, br);
    CGFloat rbl = fmax(0.0, bl);
    if (rtl <= 0.0 && rtr <= 0.0 && rbr <= 0.0 && rbl <= 0.0) {
        CGContextAddRect(ctx, rect);
        return;
    }

    CGFloat sx1 = (rtl + rtr) > 0.0 ? w / (rtl + rtr) : 1.0;
    CGFloat sx2 = (rbl + rbr) > 0.0 ? w / (rbl + rbr) : 1.0;
    CGFloat sy1 = (rtl + rbl) > 0.0 ? h / (rtl + rbl) : 1.0;
    CGFloat sy2 = (rtr + rbr) > 0.0 ? h / (rtr + rbr) : 1.0;
    CGFloat k = fmin(1.0, fmin(fmin(sx1, sx2), fmin(sy1, sy2)));
    rtl *= k;
    rtr *= k;
    rbr *= k;
    rbl *= k;

    CGFloat minx = CGRectGetMinX(rect);
    CGFloat maxx = CGRectGetMaxX(rect);
    CGFloat miny = CGRectGetMinY(rect);
    CGFloat maxy = CGRectGetMaxY(rect);

    CGContextMoveToPoint(ctx, minx + rtl, miny);
    CGContextAddLineToPoint(ctx, maxx - rtr, miny);
    if (rtr > 0.0) {
        CGContextAddArcToPoint(ctx, maxx, miny, maxx, miny + rtr, rtr);
    }
    CGContextAddLineToPoint(ctx, maxx, maxy - rbr);
    if (rbr > 0.0) {
        CGContextAddArcToPoint(ctx, maxx, maxy, maxx - rbr, maxy, rbr);
    }
    CGContextAddLineToPoint(ctx, minx + rbl, maxy);
    if (rbl > 0.0) {
        CGContextAddArcToPoint(ctx, minx, maxy, minx, maxy - rbl, rbl);
    }
    CGContextAddLineToPoint(ctx, minx, miny + rtl);
    if (rtl > 0.0) {
        CGContextAddArcToPoint(ctx, minx, miny, minx + rtl, miny, rtl);
    }
    CGContextClosePath(ctx);
}

static void render_command_buffer(
    CGContextRef ctx,
    CGRect bounds,
    const uint8_t *buf,
    size_t len,
    double vibrancy_sidebar_w
) {
    if (buf == NULL || len < 8u) {
        return;
    }
    int clip_depth = 0;
    size_t off = 0u;
    while (off + 8u <= len) {
        uint32_t op = read_u32(buf + off + 0u);
        uint32_t cmd_len = read_u32(buf + off + 4u);
        if (cmd_len < 8u || off + cmd_len > len) {
            break;
        }
        const uint8_t *cmd = buf + off;
        switch (op) {
            case SGUI_CMD_CLEAR: {
                if (cmd_len >= 16u) {
                    uint32_t rgba = read_u32(cmd + 8u);
                    if (vibrancy_sidebar_w > 0.0) {
                        CGFloat sw = fmin(bounds.size.width, vibrancy_sidebar_w);
                        if (sw > 0.0) {
                            CGContextClearRect(
                                ctx,
                                CGRectMake(bounds.origin.x, bounds.origin.y, sw, bounds.size.height)
                            );
                        }
                        CGFloat main_w = bounds.size.width - sw;
                        if (main_w > 0.0) {
                            CGContextSetFillColorWithColor(ctx, cg_color_from_rgba(rgba));
                            CGContextFillRect(
                                ctx,
                                CGRectMake(bounds.origin.x + sw, bounds.origin.y, main_w, bounds.size.height)
                            );
                        }
                    } else {
                        CGContextSetFillColorWithColor(ctx, cg_color_from_rgba(rgba));
                        CGContextFillRect(ctx, bounds);
                    }
                }
                break;
            }
            case SGUI_CMD_FILL_RECT: {
                if (cmd_len >= 56u) {
                    double x = read_f64(cmd + 8u);
                    double y = read_f64(cmd + 16u);
                    double w = read_f64(cmd + 24u);
                    double h = read_f64(cmd + 32u);
                    double radius = read_f64(cmd + 40u);
                    uint32_t rgba = read_u32(cmd + 48u);
                    if (w > 0.0 && h > 0.0) {
                        CGContextSetFillColorWithColor(ctx, cg_color_from_rgba(rgba));
                        CGContextBeginPath(ctx);
                        draw_rounded_rect_path(ctx, CGRectMake(x, y, w, h), radius);
                        CGContextFillPath(ctx);
                    }
                }
                break;
            }
            case SGUI_CMD_STROKE_RECT: {
                if (cmd_len >= 64u) {
                    double x = read_f64(cmd + 8u);
                    double y = read_f64(cmd + 16u);
                    double w = read_f64(cmd + 24u);
                    double h = read_f64(cmd + 32u);
                    double radius = read_f64(cmd + 40u);
                    double stroke_w = read_f64(cmd + 48u);
                    uint32_t rgba = read_u32(cmd + 56u);
                    if (w > 0.0 && h > 0.0 && stroke_w > 0.0) {
                        CGFloat inset = stroke_w * 0.5;
                        CGContextSetStrokeColorWithColor(ctx, cg_color_from_rgba(rgba));
                        CGContextSetLineWidth(ctx, stroke_w);
                        CGContextBeginPath(ctx);
                        draw_rounded_rect_path(
                            ctx,
                            CGRectMake(x + inset, y + inset, fmax(0.0, w - stroke_w), fmax(0.0, h - stroke_w)),
                            fmax(0.0, radius - inset)
                        );
                        CGContextStrokePath(ctx);
                    }
                }
                break;
            }
            case SGUI_CMD_FILL_RECT_CORNERS: {
                if (cmd_len >= 80u) {
                    double x = read_f64(cmd + 8u);
                    double y = read_f64(cmd + 16u);
                    double w = read_f64(cmd + 24u);
                    double h = read_f64(cmd + 32u);
                    double tl = read_f64(cmd + 40u);
                    double tr = read_f64(cmd + 48u);
                    double br = read_f64(cmd + 56u);
                    double bl = read_f64(cmd + 64u);
                    uint32_t rgba = read_u32(cmd + 72u);
                    if (w > 0.0 && h > 0.0) {
                        CGContextSetFillColorWithColor(ctx, cg_color_from_rgba(rgba));
                        CGContextBeginPath(ctx);
                        draw_rounded_corners_path(ctx, CGRectMake(x, y, w, h), tl, tr, br, bl);
                        CGContextFillPath(ctx);
                    }
                }
                break;
            }
            case SGUI_CMD_STROKE_RECT_CORNERS: {
                if (cmd_len >= 88u) {
                    double x = read_f64(cmd + 8u);
                    double y = read_f64(cmd + 16u);
                    double w = read_f64(cmd + 24u);
                    double h = read_f64(cmd + 32u);
                    double tl = read_f64(cmd + 40u);
                    double tr = read_f64(cmd + 48u);
                    double br = read_f64(cmd + 56u);
                    double bl = read_f64(cmd + 64u);
                    double stroke_w = read_f64(cmd + 72u);
                    uint32_t rgba = read_u32(cmd + 80u);
                    if (w > 0.0 && h > 0.0 && stroke_w > 0.0) {
                        CGFloat inset = stroke_w * 0.5;
                        CGContextSetStrokeColorWithColor(ctx, cg_color_from_rgba(rgba));
                        CGContextSetLineWidth(ctx, stroke_w);
                        CGContextBeginPath(ctx);
                        draw_rounded_corners_path(
                            ctx,
                            CGRectMake(x + inset, y + inset, fmax(0.0, w - stroke_w), fmax(0.0, h - stroke_w)),
                            tl > 0.0 ? fmax(0.0, tl - inset) : 0.0,
                            tr > 0.0 ? fmax(0.0, tr - inset) : 0.0,
                            br > 0.0 ? fmax(0.0, br - inset) : 0.0,
                            bl > 0.0 ? fmax(0.0, bl - inset) : 0.0
                        );
                        CGContextStrokePath(ctx);
                    }
                }
                break;
            }
            case SGUI_CMD_PUSH_CLIP: {
                if (cmd_len >= 40u) {
                    double x = read_f64(cmd + 8u);
                    double y = read_f64(cmd + 16u);
                    double w = read_f64(cmd + 24u);
                    double h = read_f64(cmd + 32u);
                    CGContextSaveGState(ctx);
                    clip_depth++;
                    CGContextClipToRect(ctx, CGRectMake(x, y, fmax(0.0, w), fmax(0.0, h)));
                }
                break;
            }
            case SGUI_CMD_POP_CLIP: {
                if (clip_depth > 0) {
                    CGContextRestoreGState(ctx);
                    clip_depth--;
                }
                break;
            }
            case SGUI_CMD_DRAW_TEXT: {
                if (cmd_len >= 56u) {
                    double x = read_f64(cmd + 8u);
                    double y = read_f64(cmd + 16u);
                    double max_width = read_f64(cmd + 24u);
                    double font_size = read_f64(cmd + 32u);
                    uint32_t rgba = read_u32(cmd + 40u);
                    uint16_t family = read_u16(cmd + 44u);
                    uint16_t weight = read_u16(cmd + 46u);
                    uint32_t flags = read_u32(cmd + 48u);
                    uint32_t utf8_len = read_u32(cmd + 52u);
                    if (utf8_len > 0u && 56u + (size_t)utf8_len <= cmd_len) {
                        const SguiCachedFont *cf = get_cached_font(family, font_size, weight, flags);
                        CGColorRef color = cg_color_from_rgba(rgba);
                        SguiBrokenLines broken;
                        layout_text(cf, cmd + 56u, utf8_len, color, max_width, &broken);
                        CGContextSaveGState(ctx);
                        /* NSView is flipped (origin top-left), so invert Y in text matrix. */
                        CGContextSetTextMatrix(ctx, CGAffineTransformMakeScale(1.0, -1.0));
                        for (size_t li = 0; li < broken.count; li++) {
                            double line_y = y + (double)li * cf->line_height;
                            double baseline_y = line_y + cf->ascent;
                            CGContextSetTextPosition(ctx, x, baseline_y);
                            CTLineDraw(broken.lines[li], ctx);
                            double line_w = broken.widths[li];
                            if ((flags & SGUI_FONT_FLAG_UNDERLINE) != 0 && line_w > 0.0) {
                                CGContextSetFillColorWithColor(ctx, color);
                                CGContextFillRect(ctx, CGRectMake(x, baseline_y + 2.0, line_w, 1.0));
                            }
                            if ((flags & SGUI_FONT_FLAG_STRIKETHROUGH) != 0 && line_w > 0.0) {
                                CGContextSetFillColorWithColor(ctx, color);
                                CGContextFillRect(ctx, CGRectMake(x, baseline_y - cf->ascent * 0.35, line_w, 1.0));
                            }
                        }
                        CGContextRestoreGState(ctx);
                        broken_lines_free(&broken);
                    }
                }
                break;
            }
            case SGUI_CMD_DRAW_LINE: {
                if (cmd_len >= 56u) {
                    double x1 = read_f64(cmd + 8u);
                    double y1 = read_f64(cmd + 16u);
                    double x2 = read_f64(cmd + 24u);
                    double y2 = read_f64(cmd + 32u);
                    double stroke_w = read_f64(cmd + 40u);
                    uint32_t rgba = read_u32(cmd + 48u);
                    if (stroke_w > 0.0) {
                        CGContextSetStrokeColorWithColor(ctx, cg_color_from_rgba(rgba));
                        CGContextSetLineWidth(ctx, stroke_w);
                        CGContextSetLineCap(ctx, kCGLineCapRound);
                        CGContextSetLineJoin(ctx, kCGLineJoinRound);
                        CGContextBeginPath(ctx);
                        CGContextMoveToPoint(ctx, x1, y1);
                        CGContextAddLineToPoint(ctx, x2, y2);
                        CGContextStrokePath(ctx);
                    }
                }
                break;
            }
            case SGUI_CMD_DRAW_IMAGE_RGBA: {
                if (cmd_len >= 56u) {
                    double x = read_f64(cmd + 8u);
                    double y = read_f64(cmd + 16u);
                    double w = read_f64(cmd + 24u);
                    double h = read_f64(cmd + 32u);
                    double radius = read_f64(cmd + 40u);
                    uint32_t px_w = read_u32(cmd + 48u);
                    uint32_t px_h = read_u32(cmd + 52u);
                    size_t byte_size = (size_t)px_w * (size_t)px_h * 4u;
                    if (px_w > 0u && px_h > 0u && w > 0.0 && h > 0.0 &&
                        56u + byte_size <= cmd_len) {
                        CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
                        CGDataProviderRef provider = CGDataProviderCreateWithData(
                            NULL,
                            cmd + 56u,
                            byte_size,
                            NULL
                        );
                        CGImageRef img = CGImageCreate(
                            px_w,
                            px_h,
                            8,
                            32,
                            (size_t)px_w * 4u,
                            cs,
                            (CGBitmapInfo)kCGImageAlphaLast | kCGBitmapByteOrderDefault,
                            provider,
                            NULL,
                            true,
                            kCGRenderingIntentDefault
                        );
                        if (img != NULL) {
                            CGContextSaveGState(ctx);
                            CGRect dst = CGRectMake(x, y, w, h);
                            if (radius > 0.0) {
                                CGContextBeginPath(ctx);
                                draw_rounded_rect_path(ctx, dst, radius);
                                CGContextClip(ctx);
                            }
                            /* CGContextDrawImage expects bottom-up coords in flipped contexts. */
                            CGContextTranslateCTM(ctx, x, y + h);
                            CGContextScaleCTM(ctx, 1.0, -1.0);
                            CGContextDrawImage(ctx, CGRectMake(0.0, 0.0, w, h), img);
                            CGContextRestoreGState(ctx);
                            CGImageRelease(img);
                        }
                        CGDataProviderRelease(provider);
                        CGColorSpaceRelease(cs);
                    }
                }
                break;
            }
            default:
                break;
        }
        off += cmd_len;
    }
    while (clip_depth > 0) {
        CGContextRestoreGState(ctx);
        clip_depth--;
    }
}

@class SguiView;

@interface SguiA11yElement : NSAccessibilityElement
@property(nonatomic, assign) uint32_t windowId;
@property(nonatomic, assign) uint32_t nodeId;
@property(nonatomic, assign) uint32_t roleCode;
@property(nonatomic, assign) uint32_t stateFlags;
@property(nonatomic, assign) NSRect localRect;
@property(nonatomic, copy) NSString *labelText;
@property(nonatomic, copy) NSString *valueText;
@property(nonatomic, weak) SguiView *ownerView;
@end

@interface SguiView : NSView <NSTextInputClient>
@property(nonatomic, assign) uint32_t sguiWindowId;
@property(nonatomic, assign) BOOL sguiVibrancyActive;
- (void)activateWindowForInput;
- (void)applyA11yElements:(NSArray<SguiA11yElement *> *)elements
               byNodeId:(NSDictionary<NSNumber *, SguiA11yElement *> *)byId;
- (nullable SguiA11yElement *)a11yElementForNodeId:(uint32_t)nodeId;
@end

static NSAccessibilityRole ns_role_for_sgui_role(uint32_t role) {
    switch (role) {
        case SGUI_A11Y_ROLE_BUTTON: return NSAccessibilityButtonRole;
        case SGUI_A11Y_ROLE_TEXT_FIELD: return NSAccessibilityTextFieldRole;
        case SGUI_A11Y_ROLE_TEXT_AREA: return NSAccessibilityTextAreaRole;
        case SGUI_A11Y_ROLE_CHECKBOX: return NSAccessibilityCheckBoxRole;
        case SGUI_A11Y_ROLE_SLIDER: return NSAccessibilitySliderRole;
        case SGUI_A11Y_ROLE_RADIO_GROUP: return NSAccessibilityRadioGroupRole;
        case SGUI_A11Y_ROLE_LIST: return NSAccessibilityListRole;
        case SGUI_A11Y_ROLE_STATIC_TEXT: return NSAccessibilityStaticTextRole;
        default: return NSAccessibilityGroupRole;
    }
}

@implementation SguiA11yElement

- (BOOL)isAccessibilityElement {
    return YES;
}

- (nullable id)accessibilityParent {
    return _ownerView;
}

- (nullable id)accessibilityWindow {
    return _ownerView != nil ? _ownerView.window : nil;
}

- (nullable NSAccessibilityRole)accessibilityRole {
    return ns_role_for_sgui_role(_roleCode);
}

- (nullable NSString *)accessibilityLabel {
    return _labelText;
}

- (nullable NSString *)accessibilityTitle {
    if (_roleCode == SGUI_A11Y_ROLE_BUTTON || _roleCode == SGUI_A11Y_ROLE_CHECKBOX) {
        return _labelText;
    }
    return nil;
}

- (nullable id)accessibilityValue {
    if (_roleCode == SGUI_A11Y_ROLE_CHECKBOX) {
        return @((_stateFlags & SGUI_A11Y_STATE_CHECKED) != 0u ? 1 : 0);
    }
    if (_roleCode == SGUI_A11Y_ROLE_SLIDER) {
        return @(_valueText != nil ? [_valueText doubleValue] : 0.0);
    }
    return _valueText;
}

- (nullable NSString *)accessibilityValueDescription {
    if (_roleCode == SGUI_A11Y_ROLE_SLIDER && _valueText != nil && _valueText.length > 0) {
        return _valueText;
    }
    return nil;
}

- (NSRect)accessibilityFrame {
    SguiView *view = _ownerView;
    if (view == nil || view.window == nil) {
        return NSZeroRect;
    }
    NSRect winRect = [view convertRect:_localRect toView:nil];
    return [view.window convertRectToScreen:winRect];
}

- (BOOL)isAccessibilityEnabled {
    return (_stateFlags & SGUI_A11Y_STATE_ENABLED) != 0u;
}

- (BOOL)isAccessibilityFocused {
    return (_stateFlags & SGUI_A11Y_STATE_FOCUSED) != 0u;
}

- (BOOL)isAccessibilitySelected {
    return (_stateFlags & SGUI_A11Y_STATE_SELECTED) != 0u;
}

- (BOOL)isAccessibilitySelectorAllowed:(SEL)selector {
    if (selector == @selector(setAccessibilityValue:)) {
        return self.isAccessibilityEnabled && (
            _roleCode == SGUI_A11Y_ROLE_TEXT_FIELD ||
            _roleCode == SGUI_A11Y_ROLE_TEXT_AREA ||
            _roleCode == SGUI_A11Y_ROLE_CHECKBOX ||
            _roleCode == SGUI_A11Y_ROLE_SLIDER
        );
    }
    if (selector == @selector(setAccessibilityFocused:)) {
        return self.isAccessibilityEnabled && _roleCode != SGUI_A11Y_ROLE_STATIC_TEXT;
    }
    if (selector == @selector(accessibilityPerformIncrement) ||
        selector == @selector(accessibilityPerformDecrement)) {
        return self.isAccessibilityEnabled && (
            _roleCode == SGUI_A11Y_ROLE_SLIDER ||
            _roleCode == SGUI_A11Y_ROLE_LIST ||
            _roleCode == SGUI_A11Y_ROLE_RADIO_GROUP
        );
    }
    if (selector == @selector(accessibilityPerformPress)) {
        return self.isAccessibilityEnabled && _roleCode != SGUI_A11Y_ROLE_STATIC_TEXT;
    }
    return [super isAccessibilitySelectorAllowed:selector];
}

- (void)setAccessibilityFocused:(BOOL)focused {
    if (!self.isAccessibilityEnabled) return;
    if (focused) {
        SguiView *view = _ownerView;
        if (view != nil) {
            [view activateWindowForInput];
        }
        push_evt_a11y_action(_windowId, _nodeId, SGUI_A11Y_ACT_FOCUS, @"");
    }
}

- (void)setAccessibilityValue:(nullable id)value {
    if (!self.isAccessibilityEnabled) return;
    NSString *str = @"";
    if ([value isKindOfClass:[NSString class]]) {
        str = (NSString *)value;
    } else if ([value isKindOfClass:[NSNumber class]]) {
        str = [(NSNumber *)value stringValue];
    } else if (value != nil) {
        str = [value description];
    }
    if (_roleCode == SGUI_A11Y_ROLE_TEXT_FIELD || _roleCode == SGUI_A11Y_ROLE_TEXT_AREA) {
        SguiView *view = _ownerView;
        if (view != nil) {
            [view activateWindowForInput];
        }
    }
    push_evt_a11y_action(_windowId, _nodeId, SGUI_A11Y_ACT_SET_VALUE, str);
}

- (BOOL)accessibilityPerformPress {
    if (!self.isAccessibilityEnabled) return NO;
    if (_roleCode == SGUI_A11Y_ROLE_TEXT_FIELD || _roleCode == SGUI_A11Y_ROLE_TEXT_AREA) {
        SguiView *view = _ownerView;
        if (view != nil) {
            [view activateWindowForInput];
        }
    }
    push_evt_a11y_action(_windowId, _nodeId, SGUI_A11Y_ACT_PRESS, @"");
    return YES;
}

- (BOOL)accessibilityPerformIncrement {
    if (!self.isAccessibilityEnabled) return NO;
    push_evt_a11y_action(_windowId, _nodeId, SGUI_A11Y_ACT_INCREMENT, @"");
    return YES;
}

- (BOOL)accessibilityPerformDecrement {
    if (!self.isAccessibilityEnabled) return NO;
    push_evt_a11y_action(_windowId, _nodeId, SGUI_A11Y_ACT_DECREMENT, @"");
    return YES;
}

@end

static NSString *strip_control_chars(NSString *str) {
    if (str == nil || str.length == 0) return @"";
    NSUInteger len = str.length;
    BOOL hasControl = NO;
    for (NSUInteger i = 0; i < len; i++) {
        unichar ch = [str characterAtIndex:i];
        if (ch < 0x20 || ch == 0x7f) {
            hasControl = YES;
            break;
        }
    }
    if (!hasControl) return str;
    NSMutableString *clean = [NSMutableString stringWithCapacity:len];
    for (NSUInteger i = 0; i < len; i++) {
        unichar ch = [str characterAtIndex:i];
        if (ch >= 0x20 && ch != 0x7f) {
            [clean appendString:[str substringWithRange:NSMakeRange(i, 1)]];
        }
    }
    return clean;
}

@implementation SguiView {
    NSMutableString *_markedText;
    NSRange _markedSelectedRange;
    NSTrackingArea *_trackingArea;
    BOOL _handledTextDuringKeyDown;
    BOOL _didCommandDuringKeyDown;
    NSMutableArray<SguiA11yElement *> *_a11yChildren;
    NSMutableDictionary<NSNumber *, SguiA11yElement *> *_a11yByNodeId;
}

- (instancetype)initWithFrame:(NSRect)frame windowId:(uint32_t)windowId {
    self = [super initWithFrame:frame];
    if (self != nil) {
        _sguiWindowId = windowId;
        _markedText = [[NSMutableString alloc] init];
        _markedSelectedRange = NSMakeRange(NSNotFound, 0);
        _a11yChildren = [[NSMutableArray alloc] init];
        _a11yByNodeId = [[NSMutableDictionary alloc] init];
    }
    return self;
}

- (BOOL)isFlipped {
    return YES;
}

- (BOOL)isOpaque {
    return !_sguiVibrancyActive;
}

- (BOOL)acceptsFirstResponder {
    return YES;
}

- (BOOL)acceptsFirstMouse:(nullable NSEvent *)event {
    (void)event;
    return YES;
}

- (BOOL)isAccessibilityElement {
    return NO;
}

- (nullable NSAccessibilityRole)accessibilityRole {
    return NSAccessibilityGroupRole;
}

- (nullable NSArray *)accessibilityChildren {
    return _a11yChildren;
}

- (nullable id)accessibilityFocusedUIElement {
    for (SguiA11yElement *elem in _a11yChildren) {
        if (elem.isAccessibilityFocused) {
            return elem;
        }
    }
    return self;
}

- (nullable id)accessibilityHitTest:(NSPoint)point {
    for (SguiA11yElement *elem in [_a11yChildren reverseObjectEnumerator]) {
        if (NSPointInRect(point, elem.accessibilityFrame)) {
            return elem;
        }
    }
    return self;
}

- (void)applyA11yElements:(NSArray<SguiA11yElement *> *)elements
               byNodeId:(NSDictionary<NSNumber *, SguiA11yElement *> *)byId {
    [_a11yChildren setArray:elements];
    [_a11yByNodeId setDictionary:byId];
    NSAccessibilityPostNotification(self, NSAccessibilityLayoutChangedNotification);
    for (SguiA11yElement *elem in elements) {
        if (elem.isAccessibilityFocused) {
            NSAccessibilityPostNotification(elem, NSAccessibilityFocusedUIElementChangedNotification);
            break;
        }
    }
}

- (nullable SguiA11yElement *)a11yElementForNodeId:(uint32_t)nodeId {
    return _a11yByNodeId[@(nodeId)];
}

- (void)updateTrackingAreas {
    [super updateTrackingAreas];
    if (_trackingArea != nil) {
        [self removeTrackingArea:_trackingArea];
        _trackingArea = nil;
    }
    NSTrackingAreaOptions opts = NSTrackingMouseMoved |
                                 NSTrackingMouseEnteredAndExited |
                                 NSTrackingActiveInKeyWindow |
                                 NSTrackingInVisibleRect;
    _trackingArea = [[NSTrackingArea alloc] initWithRect:self.bounds options:opts owner:self userInfo:nil];
    [self addTrackingArea:_trackingArea];
}

- (void)resetCursorRects {
    SguiWindowEntry *entry = find_window_entry(_sguiWindowId);
    NSCursor *cursor = (entry != NULL && entry->cursor != nil) ? entry->cursor : [NSCursor arrowCursor];
    [self addCursorRect:self.bounds cursor:cursor];
}

- (void)viewDidChangeEffectiveAppearance {
    [super viewDidChangeEffectiveAppearance];
    BOOL focused = self.window != nil && self.window.isKeyWindow;
    push_evt_focus(_sguiWindowId, focused ? 1u : 0u, is_window_dark_mode(self.window) ? 1u : 0u);
}

- (void)drawRect:(NSRect)dirtyRect {
    (void)dirtyRect;
    SguiWindowEntry *entry = find_window_entry(_sguiWindowId);
    CGContextRef ctx = [[NSGraphicsContext currentContext] CGContext];
    if (ctx == NULL) return;
    double vibrancy_sidebar_w = (entry != NULL && entry->vibrancy_enabled) ? entry->sidebar_width : 0.0;
    if (vibrancy_sidebar_w > 0.0) {
        CGContextClearRect(ctx, self.bounds);
    }
    if (entry == NULL || entry->commands == NULL || entry->commands_len == 0u) {
        CGFloat sw = fmin(self.bounds.size.width, fmax(0.0, vibrancy_sidebar_w));
        CGContextSetFillColorWithColor(ctx, [[NSColor windowBackgroundColor] CGColor]);
        CGContextFillRect(
            ctx,
            CGRectMake(self.bounds.origin.x + sw, self.bounds.origin.y, fmax(0.0, self.bounds.size.width - sw), self.bounds.size.height)
        );
        return;
    }
    render_command_buffer(ctx, self.bounds, entry->commands, entry->commands_len, vibrancy_sidebar_w);
}

- (NSPoint)localPointFromEvent:(NSEvent *)event {
    return [self convertPoint:event.locationInWindow fromView:nil];
}

- (void)emitPointerEvent:(NSEvent *)event phase:(uint32_t)phase button:(uint32_t)button {
    NSPoint p = [self localPointFromEvent:event];
    uint32_t clicks = (phase == SGUI_PTR_DOWN || phase == SGUI_PTR_UP) ? (uint32_t)event.clickCount : 0u;
    push_evt_pointer(_sguiWindowId, modifiers_from_flags(event.modifierFlags), phase, button, clicks, p.x, p.y);
}

- (void)activateWindowForInput {
#if defined(__MAC_OS_X_VERSION_MIN_REQUIRED) && __MAC_OS_X_VERSION_MIN_REQUIRED >= 140000
    [NSApp activate];
#else
    if (@available(macOS 14.0, *)) {
        [NSApp activate];
    } else {
        [NSApp activateIgnoringOtherApps:YES];
    }
#endif
    if (self.window != nil) {
        if (!self.window.isKeyWindow) {
            [self.window makeKeyAndOrderFront:nil];
        }
        [self.window makeFirstResponder:self];
    }
}

- (void)mouseDown:(NSEvent *)event {
    [self activateWindowForInput];
    SguiWindowEntry *entry = find_window_entry(_sguiWindowId);
    if (entry != NULL) {
        entry->last_mouse_down_event = event;
    }
    [self emitPointerEvent:event phase:SGUI_PTR_DOWN button:SGUI_BTN_LEFT];
}

- (void)mouseUp:(NSEvent *)event {
    [self emitPointerEvent:event phase:SGUI_PTR_UP button:SGUI_BTN_LEFT];
    SguiWindowEntry *entry = find_window_entry(_sguiWindowId);
    if (entry != NULL) {
        entry->last_mouse_down_event = nil;
    }
}

- (void)mouseDragged:(NSEvent *)event {
    [self emitPointerEvent:event phase:SGUI_PTR_DRAG button:SGUI_BTN_LEFT];
}

- (void)rightMouseDown:(NSEvent *)event {
    [self activateWindowForInput];
    [self emitPointerEvent:event phase:SGUI_PTR_DOWN button:SGUI_BTN_RIGHT];
}

- (void)rightMouseUp:(NSEvent *)event {
    [self emitPointerEvent:event phase:SGUI_PTR_UP button:SGUI_BTN_RIGHT];
}

- (void)rightMouseDragged:(NSEvent *)event {
    [self emitPointerEvent:event phase:SGUI_PTR_DRAG button:SGUI_BTN_RIGHT];
}

- (void)otherMouseDown:(NSEvent *)event {
    [self activateWindowForInput];
    [self emitPointerEvent:event phase:SGUI_PTR_DOWN button:SGUI_BTN_MIDDLE];
}

- (void)otherMouseUp:(NSEvent *)event {
    [self emitPointerEvent:event phase:SGUI_PTR_UP button:SGUI_BTN_MIDDLE];
}

- (void)otherMouseDragged:(NSEvent *)event {
    [self emitPointerEvent:event phase:SGUI_PTR_DRAG button:SGUI_BTN_MIDDLE];
}

- (void)mouseMoved:(NSEvent *)event {
    [self emitPointerEvent:event phase:SGUI_PTR_MOVE button:SGUI_BTN_NONE];
}

- (void)mouseExited:(NSEvent *)event {
    [self emitPointerEvent:event phase:SGUI_PTR_LEAVE button:SGUI_BTN_NONE];
}

- (void)scrollWheel:(NSEvent *)event {
    NSPoint p = [self localPointFromEvent:event];
    double dx = event.hasPreciseScrollingDeltas ? event.scrollingDeltaX : event.scrollingDeltaX * 24.0;
    double dy = event.hasPreciseScrollingDeltas ? event.scrollingDeltaY : event.scrollingDeltaY * 24.0;
    /* Negate Cocoa Y delta so positive deltaY scrolls content downward. */
    push_evt_scroll(_sguiWindowId, modifiers_from_flags(event.modifierFlags), p.x, p.y, -dx, -dy);
}

- (BOOL)performKeyEquivalent:(NSEvent *)event {
    if (event.type == NSEventTypeKeyDown &&
        self.window != nil &&
        self.window.firstResponder == self &&
        (event.modifierFlags & NSEventModifierFlagCommand) != 0) {
        uint32_t mods = modifiers_from_flags(event.modifierFlags);
        char scratch[32];
        const char *name = map_nsevent_key_name(event, scratch, sizeof(scratch));
        uint32_t phase = event.isARepeat ? SGUI_KEY_REPEAT : SGUI_KEY_DOWN;
        push_evt_key(_sguiWindowId, mods, phase, (uint32_t)event.keyCode, name);
        return YES;
    }
    return [super performKeyEquivalent:event];
}

- (void)keyDown:(NSEvent *)event {
    uint32_t mods = modifiers_from_flags(event.modifierFlags);
    char scratch[32];
    const char *name = map_nsevent_key_name(event, scratch, sizeof(scratch));
    uint32_t phase = event.isARepeat ? SGUI_KEY_REPEAT : SGUI_KEY_DOWN;
    push_evt_key(_sguiWindowId, mods, phase, (uint32_t)event.keyCode, name);

    if ((mods & (SGUI_MOD_CTRL | SGUI_MOD_SUPER)) == 0u) {
        _handledTextDuringKeyDown = NO;
        _didCommandDuringKeyDown = NO;
        [self interpretKeyEvents:@[event]];
        if (!_handledTextDuringKeyDown &&
            !_didCommandDuringKeyDown &&
            !self.hasMarkedText &&
            (mods & SGUI_MOD_ALT) == 0u) {
            NSString *chars = strip_control_chars(event.characters);
            if (chars.length > 0) {
                unichar first = [chars characterAtIndex:0];
                if (first < 0xF700 || first > 0xF8FF) {
                    push_evt_text(_sguiWindowId, 0u, chars);
                }
            }
        }
    }
}

- (void)keyUp:(NSEvent *)event {
    uint32_t mods = modifiers_from_flags(event.modifierFlags);
    char scratch[32];
    const char *name = map_nsevent_key_name(event, scratch, sizeof(scratch));
    push_evt_key(_sguiWindowId, mods, SGUI_KEY_UP, (uint32_t)event.keyCode, name);
}

/* NSTextInputClient + NSResponder text entry */

- (void)doCommandBySelector:(SEL)selector {
    (void)selector;
    _didCommandDuringKeyDown = YES;
    /* Suppress NSBeep; TypeScript handles non-text editing commands from EVT_KEY. */
}

- (void)insertText:(id)insertString {
    [self insertText:insertString replacementRange:NSMakeRange(NSNotFound, 0)];
}

- (void)insertText:(id)string replacementRange:(NSRange)replacementRange {
    (void)replacementRange;
    NSString *raw = [string isKindOfClass:[NSAttributedString class]]
        ? [(NSAttributedString *)string string]
        : (NSString *)string;
    NSString *clean = strip_control_chars(raw);
    [_markedText setString:@""];
    _markedSelectedRange = NSMakeRange(NSNotFound, 0);
    _handledTextDuringKeyDown = YES;
    push_evt_ime_preedit(_sguiWindowId, 0u, 0u, @"");
    if (clean.length > 0) {
        push_evt_text(_sguiWindowId, 0u, clean);
    }
}

- (void)setMarkedText:(id)string selectedRange:(NSRange)selectedRange replacementRange:(NSRange)replacementRange {
    (void)replacementRange;
    NSString *str = [string isKindOfClass:[NSAttributedString class]]
        ? [(NSAttributedString *)string string]
        : (NSString *)string;
    if (str == nil) str = @"";
    [_markedText setString:str];
    _markedSelectedRange = selectedRange;
    _handledTextDuringKeyDown = YES;
    uint32_t start = (selectedRange.location == NSNotFound) ? 0u : (uint32_t)selectedRange.location;
    uint32_t end = start + (uint32_t)selectedRange.length;
    push_evt_ime_preedit(_sguiWindowId, start, end, str);
}

- (void)unmarkText {
    if (_markedText.length > 0) {
        [_markedText setString:@""];
        _markedSelectedRange = NSMakeRange(NSNotFound, 0);
        push_evt_ime_preedit(_sguiWindowId, 0u, 0u, @"");
    }
}

- (NSRange)selectedRange {
    return NSMakeRange(NSNotFound, 0);
}

- (NSRange)markedRange {
    if (_markedText.length == 0) {
        return NSMakeRange(NSNotFound, 0);
    }
    return NSMakeRange(0, _markedText.length);
}

- (BOOL)hasMarkedText {
    return _markedText.length > 0;
}

- (nullable NSAttributedString *)attributedSubstringForProposedRange:(NSRange)range
                                                         actualRange:(nullable NSRangePointer)actualRange {
    (void)range;
    (void)actualRange;
    return nil;
}

- (NSArray<NSAttributedStringKey> *)validAttributesForMarkedText {
    return @[];
}

- (NSRect)firstRectForCharacterRange:(NSRange)range actualRange:(nullable NSRangePointer)actualRange {
    (void)range;
    (void)actualRange;
    SguiWindowEntry *entry = find_window_entry(_sguiWindowId);
    NSRect local = (entry != NULL && entry->ime_rect.size.height > 0.0)
        ? entry->ime_rect
        : NSMakeRect(20.0, 20.0, 2.0, 18.0);
    NSRect win_rect = [self convertRect:local toView:nil];
    return [self.window convertRectToScreen:win_rect];
}

- (NSUInteger)characterIndexForPoint:(NSPoint)point {
    (void)point;
    return NSNotFound;
}

@end

@interface SguiWindowDelegate : NSObject <NSWindowDelegate>
@property(nonatomic, assign) uint32_t sguiWindowId;
@end

@implementation SguiWindowDelegate

- (BOOL)windowShouldClose:(NSWindow *)sender {
    (void)sender;
    push_evt_simple(SGUI_EVT_CLOSE, _sguiWindowId, 0u);
    return NO;
}

- (void)windowDidResize:(NSNotification *)notification {
    (void)notification;
    SguiWindowEntry *entry = find_window_entry(_sguiWindowId);
    if (entry == NULL || entry->view == nil || entry->window == nil) return;
    if (entry->vibrancy_enabled && entry->vibrancy_view != nil && entry->container != nil) {
        CGFloat sw = fmin(entry->sidebar_width, entry->container.bounds.size.width);
        entry->vibrancy_view.frame = NSMakeRect(0.0, 0.0, sw, entry->container.bounds.size.height);
    }
    NSRect bounds = entry->view.bounds;
    double scale = (double)entry->window.backingScaleFactor;
    push_evt_resize(_sguiWindowId, bounds.size.width, bounds.size.height, scale);
}

- (void)windowDidChangeBackingProperties:(NSNotification *)notification {
    [self windowDidResize:notification];
}

- (void)windowDidBecomeKey:(NSNotification *)notification {
    (void)notification;
    SguiWindowEntry *entry = find_window_entry(_sguiWindowId);
    NSWindow *w = entry != NULL ? entry->window : nil;
    push_evt_focus(_sguiWindowId, 1u, is_window_dark_mode(w) ? 1u : 0u);
}

- (void)windowDidResignKey:(NSNotification *)notification {
    (void)notification;
    SguiWindowEntry *entry = find_window_entry(_sguiWindowId);
    NSWindow *w = entry != NULL ? entry->window : nil;
    push_evt_focus(_sguiWindowId, 0u, is_window_dark_mode(w) ? 1u : 0u);
}

@end

@interface SguiMenuTarget : NSObject
- (void)onMenuItem:(id)sender;
@end

@implementation SguiMenuTarget
- (void)onMenuItem:(id)sender {
    if ([sender isKindOfClass:[NSMenuItem class]]) {
        NSMenuItem *item = (NSMenuItem *)sender;
        if (item.tag > 0) {
            push_evt_menu((uint32_t)item.tag);
        }
    }
}
@end

static SguiMenuTarget *g_menu_target = nil;

/* -------------------------------------------------------------------------- */
/* Public C ABI Implementation                                                */
/* -------------------------------------------------------------------------- */

int32_t sgui_init(void) {
    @autoreleasepool {
        if (g_initialized) {
            return 0;
        }
        ensure_event_buf();
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
        [NSApp finishLaunching];
        g_menu_target = [[SguiMenuTarget alloc] init];
        g_initialized = true;
        return 0;
    }
}

void sgui_shutdown(void) {
    @autoreleasepool {
        for (size_t i = 0; i < SGUI_MAX_WINDOWS; i++) {
            if (g_windows[i].window_id != 0u) {
                sgui_window_destroy(g_windows[i].window_id);
            }
        }
        for (size_t i = 0; i < g_font_cache_count; i++) {
            if (g_font_cache[i].font != NULL) {
                CFRelease(g_font_cache[i].font);
                g_font_cache[i].font = NULL;
            }
        }
        g_font_cache_count = 0;
        free(g_event_buf);
        g_event_buf = NULL;
        g_event_head = 0;
        g_event_tail = 0;
        g_menu_target = nil;
        g_initialized = false;
    }
}

uint32_t sgui_window_create(
    const uint8_t *title,
    size_t title_len,
    double width,
    double height,
    uint32_t flags
) {
    @autoreleasepool {
        if (!g_initialized && sgui_init() != 0) {
            return 0u;
        }
        size_t slot = SGUI_MAX_WINDOWS;
        for (size_t i = 0; i < SGUI_MAX_WINDOWS; i++) {
            if (g_windows[i].window_id == 0u) {
                slot = i;
                break;
            }
        }
        if (slot == SGUI_MAX_WINDOWS) {
            return 0u;
        }

        uint32_t window_id = g_next_window_id++;
        if (window_id == 0u) window_id = g_next_window_id++;

        NSWindowStyleMask style = NSWindowStyleMaskTitled |
                                  NSWindowStyleMaskClosable |
                                  NSWindowStyleMaskMiniaturizable;
        if ((flags & SGUI_WIN_RESIZABLE) != 0u) {
            style |= NSWindowStyleMaskResizable;
        }
        BOOL hidden_bar = (flags & (SGUI_WIN_TITLEBAR_HIDDEN | SGUI_WIN_UNIFIED_TITLEBAR)) != 0u;
        if (hidden_bar) {
            style |= NSWindowStyleMaskFullSizeContentView;
        }

        double safe_w = width > 64.0 ? width : 64.0;
        double safe_h = height > 64.0 ? height : 64.0;
        NSRect frame = NSMakeRect(0.0, 0.0, safe_w, safe_h);
        NSWindow *window = [[NSWindow alloc] initWithContentRect:frame
                                                       styleMask:style
                                                         backing:NSBackingStoreBuffered
                                                           defer:NO];
        if (window == nil) {
            return 0u;
        }

        window.title = nsstring_from_utf8(title, title_len);
        window.releasedWhenClosed = NO;
        if (hidden_bar) {
            window.titlebarAppearsTransparent = YES;
            window.titleVisibility = NSWindowTitleHidden;
        }

        NSRect content_bounds = NSMakeRect(0.0, 0.0, safe_w, safe_h);
        NSView *container = [[NSView alloc] initWithFrame:content_bounds];
        container.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        container.wantsLayer = YES;
        window.contentView = container;

        NSVisualEffectView *vibrancy_view = [[NSVisualEffectView alloc] initWithFrame:NSMakeRect(0.0, 0.0, 0.0, safe_h)];
        vibrancy_view.material = NSVisualEffectMaterialSidebar;
        vibrancy_view.blendingMode = NSVisualEffectBlendingModeBehindWindow;
        vibrancy_view.state = NSVisualEffectStateFollowsWindowActiveState;
        vibrancy_view.autoresizingMask = NSViewHeightSizable | NSViewMaxXMargin;
        vibrancy_view.hidden = YES;
        [container addSubview:vibrancy_view];

        SguiView *view = [[SguiView alloc] initWithFrame:container.bounds windowId:window_id];
        view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        view.wantsLayer = YES;
        [container addSubview:view positioned:NSWindowAbove relativeTo:vibrancy_view];

        SguiWindowDelegate *delegate = [[SguiWindowDelegate alloc] init];
        delegate.sguiWindowId = window_id;
        window.delegate = delegate;

        g_windows[slot] = (SguiWindowEntry){
            .window_id = window_id,
            .flags = flags,
            .window = window,
            .container = container,
            .vibrancy_view = vibrancy_view,
            .view = view,
            .delegate = delegate,
            .commands = NULL,
            .commands_len = 0u,
            .commands_cap = 0u,
            .cursor = [NSCursor arrowCursor],
            .last_mouse_down_event = nil,
            .ime_rect = NSMakeRect(0.0, 0.0, 2.0, 18.0),
            .sidebar_width = 0.0,
            .vibrancy_enabled = false,
        };

        [window center];
        [window makeKeyAndOrderFront:nil];
        [window makeFirstResponder:view];
        [view activateWindowForInput];

        NSRect bounds = view.bounds;
        push_evt_resize(window_id, bounds.size.width, bounds.size.height, (double)window.backingScaleFactor);
        push_evt_focus(window_id, window.isKeyWindow ? 1u : 0u, is_window_dark_mode(window) ? 1u : 0u);
        return window_id;
    }
}

void sgui_window_destroy(uint32_t window_id) {
    @autoreleasepool {
        SguiWindowEntry *entry = find_window_entry(window_id);
        if (entry == NULL) return;
        entry->window.delegate = nil;
        [entry->window orderOut:nil];
        [entry->window close];
        entry->vibrancy_view = nil;
        entry->container = nil;
        entry->view = nil;
        entry->delegate = nil;
        entry->window = nil;
        entry->cursor = nil;
        entry->last_mouse_down_event = nil;
        free(entry->commands);
        entry->commands = NULL;
        entry->commands_len = 0u;
        entry->commands_cap = 0u;
        entry->sidebar_width = 0.0;
        entry->vibrancy_enabled = false;
        entry->window_id = 0u;
    }
}

void sgui_window_set_title(uint32_t window_id, const uint8_t *title, size_t title_len) {
    @autoreleasepool {
        SguiWindowEntry *entry = find_window_entry(window_id);
        if (entry == NULL || entry->window == nil) return;
        entry->window.title = nsstring_from_utf8(title, title_len);
    }
}

void sgui_window_set_chrome(uint32_t win_id, uint32_t dark_mode, double sidebar_width, uint32_t vibrancy_enabled) {
    @autoreleasepool {
        SguiWindowEntry *entry = find_window_entry(win_id);
        if (entry == NULL || entry->window == nil || entry->view == nil) return;

        if (dark_mode == 2u) {
            entry->window.appearance = nil;
        } else {
            NSAppearanceName name = dark_mode != 0u ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua;
            entry->window.appearance = [NSAppearance appearanceNamed:name];
        }

        BOOL enable_vibrancy = (vibrancy_enabled != 0u && sidebar_width > 0.0) ? YES : NO;
        double clamped_sidebar = enable_vibrancy ? sidebar_width : 0.0;
        entry->sidebar_width = clamped_sidebar;
        entry->vibrancy_enabled = enable_vibrancy ? true : false;
        entry->view.sguiVibrancyActive = enable_vibrancy;

        if (enable_vibrancy) {
            entry->window.opaque = NO;
            entry->window.backgroundColor = [NSColor clearColor];
            if (entry->view.layer != nil) {
                entry->view.layer.opaque = NO;
            }
            if (entry->vibrancy_view != nil && entry->container != nil) {
                CGFloat sw = fmin(clamped_sidebar, entry->container.bounds.size.width);
                CGFloat h = entry->container.bounds.size.height;
                entry->vibrancy_view.material = NSVisualEffectMaterialSidebar;
                entry->vibrancy_view.blendingMode = NSVisualEffectBlendingModeBehindWindow;
                entry->vibrancy_view.state = NSVisualEffectStateFollowsWindowActiveState;
                entry->vibrancy_view.frame = NSMakeRect(0.0, 0.0, sw, h);
                entry->vibrancy_view.hidden = NO;
            }
        } else {
            entry->window.opaque = YES;
            entry->window.backgroundColor = [NSColor windowBackgroundColor];
            if (entry->view.layer != nil) {
                entry->view.layer.opaque = YES;
            }
            if (entry->vibrancy_view != nil) {
                entry->vibrancy_view.hidden = YES;
            }
        }
        entry->view.needsDisplay = YES;
    }
}

void sgui_window_action(uint32_t win_id, uint32_t action) {
    @autoreleasepool {
        SguiWindowEntry *entry = find_window_entry(win_id);
        if (entry == NULL || entry->window == nil) return;
        if (action == SGUI_WIN_ACTION_DRAG) {
            NSEvent *ev = entry->last_mouse_down_event;
            if (ev != nil) {
                entry->last_mouse_down_event = nil;
                [entry->window performWindowDragWithEvent:ev];
            }
        } else if (action == SGUI_WIN_ACTION_ZOOM) {
            [entry->window performZoom:nil];
        } else if (action == SGUI_WIN_ACTION_MINIATURIZE) {
            [entry->window performMiniaturize:nil];
        }
    }
}

int32_t sgui_window_get_metrics(uint32_t window_id, uint8_t *out_metrics, size_t out_len) {
    @autoreleasepool {
        if (out_metrics == NULL || out_len < SGUI_WINDOW_METRICS_SIZE) return -1;
        SguiWindowEntry *entry = find_window_entry(window_id);
        if (entry == NULL || entry->window == nil || entry->view == nil) return -1;

        NSRect bounds = entry->view.bounds;
        double scale = (double)entry->window.backingScaleFactor;
        double inset_left = 0.0;
        double titlebar_h = 0.0;
        if ((entry->flags & (SGUI_WIN_TITLEBAR_HIDDEN | SGUI_WIN_UNIFIED_TITLEBAR)) != 0u) {
            NSRect content_layout = entry->window.contentLayoutRect;
            double layout_title_h = fmax(0.0, entry->window.frame.size.height - NSMaxY(content_layout));
            NSButton *zoom_btn = [entry->window standardWindowButton:NSWindowZoomButton];
            if (zoom_btn != nil && zoom_btn.superview != nil) {
                NSRect zoom_in_view = [entry->view convertRect:zoom_btn.frame fromView:zoom_btn.superview];
                inset_left = fmax(0.0, NSMaxX(zoom_in_view) + 12.0);
                titlebar_h = fmax(fmax(28.0, NSMaxY(zoom_in_view) + 8.0), layout_title_h);
            } else {
                inset_left = 78.0;
                titlebar_h = fmax(38.0, layout_title_h);
            }
        }
        write_f64(out_metrics + 0u, bounds.size.width);
        write_f64(out_metrics + 8u, bounds.size.height);
        write_f64(out_metrics + 16u, scale);
        write_f64(out_metrics + 24u, inset_left);
        write_f64(out_metrics + 32u, titlebar_h);
        write_u32(out_metrics + 40u, is_window_dark_mode(entry->window) ? 1u : 0u);
        write_u32(out_metrics + 44u, entry->window.isKeyWindow ? 1u : 0u);
        return 0;
    }
}

int32_t sgui_measure_text(
    uint32_t font_family,
    double font_size,
    uint32_t font_weight,
    uint32_t font_flags,
    double max_width,
    const uint8_t *text,
    size_t text_len,
    uint8_t *out_metrics,
    size_t out_len
) {
    @autoreleasepool {
        if (out_metrics == NULL || out_len < SGUI_TEXT_METRICS_SIZE) return -1;
        const SguiCachedFont *cf = get_cached_font(font_family, font_size, font_weight, font_flags);
        CGColorRef black = [[NSColor blackColor] CGColor];
        SguiBrokenLines broken;
        layout_text(cf, text, text_len, black, max_width, &broken);
        size_t line_count = broken.count > 0 ? broken.count : 1u;
        double total_height = (double)line_count * cf->line_height;
        double width = broken.max_line_width;
        broken_lines_free(&broken);

        write_f64(out_metrics + 0u, width);
        write_f64(out_metrics + 8u, total_height);
        write_f64(out_metrics + 16u, cf->line_height);
        write_f64(out_metrics + 24u, cf->ascent);
        write_u32(out_metrics + 32u, (uint32_t)line_count);
        return 0;
    }
}

double sgui_text_caret_x(
    uint32_t font_family,
    double font_size,
    uint32_t font_weight,
    uint32_t font_flags,
    const uint8_t *line,
    size_t line_len,
    uint32_t byte_offset
) {
    @autoreleasepool {
        if (line == NULL || line_len == 0u || byte_offset == 0u) {
            return 0.0;
        }
        const SguiCachedFont *cf = get_cached_font(font_family, font_size, font_weight, font_flags);
        NSString *str = nsstring_from_utf8(line, line_len);
        NSDictionary *attrs = @{(__bridge id)kCTFontAttributeName : (__bridge id)cf->font};
        NSAttributedString *attr = [[NSAttributedString alloc] initWithString:str attributes:attrs];
        CTLineRef ct_line = CTLineCreateWithAttributedString((__bridge CFAttributedStringRef)attr);
        CFIndex char_idx = utf8_byte_to_utf16(line, line_len, byte_offset);
        if (char_idx > (CFIndex)str.length) char_idx = (CFIndex)str.length;
        CGFloat x = CTLineGetOffsetForStringIndex(ct_line, char_idx, NULL);
        CFRelease(ct_line);
        return (double)x;
    }
}

uint32_t sgui_text_hit_index(
    uint32_t font_family,
    double font_size,
    uint32_t font_weight,
    uint32_t font_flags,
    const uint8_t *line,
    size_t line_len,
    double x
) {
    @autoreleasepool {
        if (line == NULL || line_len == 0u || x <= 0.0) {
            return 0u;
        }
        const SguiCachedFont *cf = get_cached_font(font_family, font_size, font_weight, font_flags);
        NSString *str = nsstring_from_utf8(line, line_len);
        NSDictionary *attrs = @{(__bridge id)kCTFontAttributeName : (__bridge id)cf->font};
        NSAttributedString *attr = [[NSAttributedString alloc] initWithString:str attributes:attrs];
        CTLineRef ct_line = CTLineCreateWithAttributedString((__bridge CFAttributedStringRef)attr);
        CFIndex utf16_idx = CTLineGetStringIndexForPosition(ct_line, CGPointMake((CGFloat)x, 0.0));
        CFRelease(ct_line);
        if (utf16_idx == kCFNotFound || utf16_idx <= 0) {
            return 0u;
        }
        return utf16_to_utf8_byte(line, line_len, utf16_idx);
    }
}

int32_t sgui_present(uint32_t window_id, const uint8_t *commands, size_t commands_len) {
    @autoreleasepool {
        SguiWindowEntry *entry = find_window_entry(window_id);
        if (entry == NULL || entry->view == nil) return -1;
        if (commands_len > 0u) {
            if (commands == NULL) return -1;
            if (commands_len > entry->commands_cap) {
                uint8_t *grown = (uint8_t *)realloc(entry->commands, commands_len);
                if (grown == NULL) return -1;
                entry->commands = grown;
                entry->commands_cap = commands_len;
            }
            memcpy(entry->commands, commands, commands_len);
        }
        entry->commands_len = commands_len;
        entry->view.needsDisplay = YES;
        [entry->view displayIfNeeded];
        return 0;
    }
}

int32_t sgui_poll_events(uint32_t wait_ms, uint8_t *out_events, size_t out_cap) {
    @autoreleasepool {
        if (!g_initialized) return 0;
        NSDate *until = (g_event_head == g_event_tail && wait_ms > 0u)
            ? [NSDate dateWithTimeIntervalSinceNow:(double)wait_ms / 1000.0]
            : [NSDate distantPast];
        for (;;) {
            NSEvent *event = [NSApp nextEventMatchingMask:NSEventMaskAny
                                                untilDate:until
                                                   inMode:NSDefaultRunLoopMode
                                                  dequeue:YES];
            if (event == nil) break;
            [NSApp sendEvent:event];
            until = [NSDate distantPast];
        }
        [NSApp updateWindows];

        if (out_events == NULL || out_cap == 0u || g_event_head == g_event_tail) {
            return 0;
        }

        size_t written = 0u;
        while (g_event_head + 16u <= g_event_tail) {
            uint32_t rec_len = read_u32(g_event_buf + g_event_head + 4u);
            if (rec_len < 16u || g_event_head + rec_len > g_event_tail) {
                g_event_head = g_event_tail;
                break;
            }
            if (written + rec_len > out_cap) {
                break;
            }
            memcpy(out_events + written, g_event_buf + g_event_head, rec_len);
            written += rec_len;
            g_event_head += rec_len;
        }
        if (g_event_head == g_event_tail) {
            g_event_head = 0u;
            g_event_tail = 0u;
        }
        return (int32_t)written;
    }
}

int32_t sgui_clipboard_get_text(uint8_t *out_utf8, size_t out_cap) {
    @autoreleasepool {
        NSPasteboard *pb = [NSPasteboard generalPasteboard];
        NSString *str = [pb stringForType:NSPasteboardTypeString];
        if (str == nil) return -1;
        NSData *utf8 = [str dataUsingEncoding:NSUTF8StringEncoding];
        if (utf8 == nil) return -1;
        size_t len = utf8.length;
        if (out_utf8 != NULL && out_cap >= len && len > 0u) {
            memcpy(out_utf8, utf8.bytes, len);
        }
        return (int32_t)len;
    }
}

int32_t sgui_clipboard_set_text(const uint8_t *text, size_t text_len) {
    @autoreleasepool {
        NSString *str = nsstring_from_utf8(text, text_len);
        NSPasteboard *pb = [NSPasteboard generalPasteboard];
        [pb clearContents];
        BOOL ok = [pb setString:str forType:NSPasteboardTypeString];
        return ok ? 0 : -1;
    }
}

void sgui_set_cursor(uint32_t window_id, uint32_t cursor_kind) {
    @autoreleasepool {
        SguiWindowEntry *entry = find_window_entry(window_id);
        if (entry == NULL || entry->window == nil || entry->view == nil) return;
        NSCursor *cursor = [NSCursor arrowCursor];
        switch (cursor_kind) {
            case SGUI_CURSOR_IBEAM: cursor = [NSCursor IBeamCursor]; break;
            case SGUI_CURSOR_POINTER: cursor = [NSCursor pointingHandCursor]; break;
            case SGUI_CURSOR_RESIZE_EW: cursor = [NSCursor resizeLeftRightCursor]; break;
            case SGUI_CURSOR_RESIZE_NS: cursor = [NSCursor resizeUpDownCursor]; break;
            default: cursor = [NSCursor arrowCursor]; break;
        }
        if (entry->cursor != cursor) {
            entry->cursor = cursor;
            [entry->window invalidateCursorRectsForView:entry->view];
            [cursor set];
        }
    }
}

void sgui_set_ime_rect(uint32_t window_id, double x, double y, double width, double height) {
    SguiWindowEntry *entry = find_window_entry(window_id);
    if (entry == NULL) return;
    entry->ime_rect = NSMakeRect(x, y, fmax(1.0, width), fmax(1.0, height));
}

typedef struct {
    const uint8_t *data;
    size_t len;
    size_t pos;
} SguiMenuReader;

static bool menu_read_u32(SguiMenuReader *r, uint32_t *out) {
    if (r->pos + 4u > r->len) return false;
    *out = read_u32(r->data + r->pos);
    r->pos += 4u;
    return true;
}

static NSString *menu_read_str(SguiMenuReader *r, bool *ok) {
    uint32_t slen = 0u;
    if (!menu_read_u32(r, &slen) || r->pos + slen > r->len) {
        *ok = false;
        return @"";
    }
    NSString *s = nsstring_from_utf8(r->data + r->pos, slen);
    r->pos += slen;
    return s;
}

static SEL selector_for_role(uint32_t role) {
    switch (role) {
        case SGUI_MENU_ROLE_ABOUT: return @selector(orderFrontStandardAboutPanel:);
        case SGUI_MENU_ROLE_HIDE: return @selector(hide:);
        case SGUI_MENU_ROLE_QUIT: return @selector(terminate:);
        case SGUI_MENU_ROLE_MINIMIZE: return @selector(performMiniaturize:);
        case SGUI_MENU_ROLE_ZOOM: return @selector(performZoom:);
        case SGUI_MENU_ROLE_CLOSE: return @selector(performClose:);
        case SGUI_MENU_ROLE_FULLSCREEN: return @selector(toggleFullScreen:);
        default: return NULL;
    }
}

static void parse_key_equivalent(NSString *shortcut, NSString **out_key, NSEventModifierFlags *out_mods) {
    *out_key = @"";
    *out_mods = 0;
    if (shortcut == nil || shortcut.length == 0) return;
    NSArray<NSString *> *parts = [shortcut componentsSeparatedByString:@"+"];
    if (parts.count == 0) return;
    for (NSUInteger i = 0; i + 1 < parts.count; i++) {
        NSString *p = [parts[i] lowercaseString];
        if ([p isEqualToString:@"mod"] || [p isEqualToString:@"super"] || [p isEqualToString:@"cmd"]) {
            *out_mods |= NSEventModifierFlagCommand;
        } else if ([p isEqualToString:@"shift"]) {
            *out_mods |= NSEventModifierFlagShift;
        } else if ([p isEqualToString:@"ctrl"] || [p isEqualToString:@"control"]) {
            *out_mods |= NSEventModifierFlagControl;
        } else if ([p isEqualToString:@"alt"] || [p isEqualToString:@"option"]) {
            *out_mods |= NSEventModifierFlagOption;
        }
    }
    NSString *last = [parts.lastObject lowercaseString];
    if ([last isEqualToString:@"enter"] || [last isEqualToString:@"return"]) {
        *out_key = @"\r";
    } else if ([last isEqualToString:@"escape"] || [last isEqualToString:@"esc"]) {
        *out_key = @"\x1b";
    } else if ([last isEqualToString:@"tab"]) {
        *out_key = @"\t";
    } else if ([last isEqualToString:@"space"]) {
        *out_key = @" ";
    } else {
        *out_key = last;
    }
}

static BOOL populate_menu_items(NSMenu *menu, SguiMenuReader *r, uint32_t count) {
    for (uint32_t i = 0; i < count; i++) {
        uint32_t kind = 0, item_id = 0, flags = 0, role = 0;
        if (!menu_read_u32(r, &kind) ||
            !menu_read_u32(r, &item_id) ||
            !menu_read_u32(r, &flags) ||
            !menu_read_u32(r, &role)) {
            return NO;
        }
        bool ok = true;
        NSString *label = menu_read_str(r, &ok);
        NSString *shortcut = menu_read_str(r, &ok);
        uint32_t sub_count = 0u;
        if (!ok) return NO;
        if (kind == SGUI_MENU_ITEM_SUBMENU && !menu_read_u32(r, &sub_count)) {
            return NO;
        }
        if (kind == SGUI_MENU_ITEM_SEPARATOR) {
            [menu addItem:[NSMenuItem separatorItem]];
            continue;
        }

        NSString *key_eq = @"";
        NSEventModifierFlags mods = 0;
        parse_key_equivalent(shortcut, &key_eq, &mods);

        SEL role_sel = selector_for_role(role);
        NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:label
                                                      action:role_sel != NULL ? role_sel : @selector(onMenuItem:)
                                               keyEquivalent:key_eq];
        if (role_sel == NULL) {
            item.target = g_menu_target;
        } else {
            item.target = (role == SGUI_MENU_ROLE_ABOUT ||
                           role == SGUI_MENU_ROLE_HIDE ||
                           role == SGUI_MENU_ROLE_QUIT)
                ? NSApp
                : nil;
        }
        item.tag = (NSInteger)item_id;
        item.keyEquivalentModifierMask = mods;
        item.enabled = (flags & SGUI_MENU_FLAG_DISABLED) == 0u;
        item.state = (flags & SGUI_MENU_FLAG_CHECKED) != 0u ? NSControlStateValueOn : NSControlStateValueOff;
        if (kind == SGUI_MENU_ITEM_SUBMENU) {
            NSMenu *sub = [[NSMenu alloc] initWithTitle:label];
            sub.autoenablesItems = NO;
            if (!populate_menu_items(sub, r, sub_count)) return NO;
            item.submenu = sub;
        }
        [menu addItem:item];
    }
    return YES;
}

int32_t sgui_set_app_menu(const uint8_t *spec, size_t spec_len) {
    @autoreleasepool {
        if (!g_initialized && sgui_init() != 0) return -1;
        if (spec == NULL || spec_len < 4u) return -1;
        SguiMenuReader reader = {.data = spec, .len = spec_len, .pos = 0u};
        uint32_t menu_count = 0u;
        if (!menu_read_u32(&reader, &menu_count)) return -1;

        NSMenu *main_menu = [[NSMenu alloc] init];
        for (uint32_t m = 0; m < menu_count; m++) {
            bool ok = true;
            NSString *title = menu_read_str(&reader, &ok);
            uint32_t item_count = 0u;
            if (!ok || !menu_read_u32(&reader, &item_count)) return -1;
            NSMenuItem *top = [[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:@""];
            NSMenu *sub = [[NSMenu alloc] initWithTitle:title];
            sub.autoenablesItems = NO;
            if (!populate_menu_items(sub, &reader, item_count)) return -1;
            top.submenu = sub;
            [main_menu addItem:top];
        }
        [NSApp setMainMenu:main_menu];
        return 0;
    }
}

int32_t sgui_set_a11y_tree(uint32_t window_id, const uint8_t *nodes, size_t nodes_len) {
    @autoreleasepool {
        SguiWindowEntry *entry = find_window_entry(window_id);
        if (entry == NULL || entry->view == nil) return -1;
        if (nodes == NULL || nodes_len < 4u) return -1;
        SguiMenuReader r = {.data = nodes, .len = nodes_len, .pos = 0u};
        uint32_t count = 0u;
        if (!menu_read_u32(&r, &count)) return -1;

        NSMutableArray<SguiA11yElement *> *elements = [NSMutableArray arrayWithCapacity:count];
        NSMutableDictionary<NSNumber *, SguiA11yElement *> *byId = [NSMutableDictionary dictionaryWithCapacity:count];
        SguiView *view = entry->view;

        for (uint32_t i = 0u; i < count; i++) {
            uint32_t node_id = 0u, role = 0u, state_flags = 0u;
            if (!menu_read_u32(&r, &node_id) ||
                !menu_read_u32(&r, &role) ||
                !menu_read_u32(&r, &state_flags) ||
                r.pos + 32u > r.len) {
                return -1;
            }
            double x = read_f64(r.data + r.pos + 0u);
            double y = read_f64(r.data + r.pos + 8u);
            double w = read_f64(r.data + r.pos + 16u);
            double h = read_f64(r.data + r.pos + 24u);
            r.pos += 32u;
            bool ok = true;
            NSString *label = menu_read_str(&r, &ok);
            NSString *value = menu_read_str(&r, &ok);
            if (!ok) return -1;

            SguiA11yElement *elem = [view a11yElementForNodeId:node_id];
            if (elem == nil) {
                elem = [[SguiA11yElement alloc] init];
            }
            elem.windowId = window_id;
            elem.nodeId = node_id;
            elem.roleCode = role;
            elem.stateFlags = state_flags;
            elem.localRect = NSMakeRect(x, y, fmax(0.0, w), fmax(0.0, h));
            elem.labelText = label;
            elem.valueText = value;
            elem.ownerView = view;

            [elements addObject:elem];
            byId[@(node_id)] = elem;
        }
        [view applyA11yElements:elements byNodeId:byId];
        return 0;
    }
}
