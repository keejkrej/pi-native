#define _POSIX_C_SOURCE 200809L

#include <cairo.h>
#include <gtk/gtk.h>
#include <math.h>
#include <pango/pangocairo.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../../include/sgui.h"

/* -------------------------------------------------------------------------- */
/* Little-endian helpers                                                      */
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

static inline void cairo_set_rgba(cairo_t *cr, uint32_t rgba) {
    double r = (double)((rgba >> 24) & 0xFFu) / 255.0;
    double g = (double)((rgba >> 16) & 0xFFu) / 255.0;
    double b = (double)((rgba >> 8) & 0xFFu) / 255.0;
    double a = (double)(rgba & 0xFFu) / 255.0;
    cairo_set_source_rgba(cr, r, g, b, a);
}

/* -------------------------------------------------------------------------- */
/* Pango Font Helpers                                                         */
/* -------------------------------------------------------------------------- */

static PangoContext *g_pango_ctx = NULL;

static PangoContext *ensure_pango_context(void) {
    if (g_pango_ctx == NULL) {
        PangoFontMap *fm = pango_cairo_font_map_get_default();
        g_pango_ctx = pango_font_map_create_context(fm);
    }
    return g_pango_ctx;
}

static PangoFontDescription *make_font_desc(
    uint32_t family,
    double font_size,
    uint32_t weight,
    uint32_t flags
) {
    PangoFontDescription *desc = pango_font_description_new();
    pango_font_description_set_family(desc, family == SGUI_FONT_MONO ? "monospace" : "sans-serif");
    double sz = font_size > 1.0 ? font_size : 1.0;
    pango_font_description_set_absolute_size(desc, sz * PANGO_SCALE);
    pango_font_description_set_weight(desc, (PangoWeight)weight);
    pango_font_description_set_style(
        desc,
        (flags & SGUI_FONT_FLAG_ITALIC) != 0u ? PANGO_STYLE_ITALIC : PANGO_STYLE_NORMAL
    );
    return desc;
}

static PangoLayout *build_layout(
    PangoContext *ctx,
    uint32_t family,
    double font_size,
    uint32_t weight,
    uint32_t flags,
    double max_width,
    const uint8_t *text,
    size_t text_len,
    double *out_line_height,
    double *out_baseline
) {
    PangoLayout *layout = pango_layout_new(ctx);
    PangoFontDescription *desc = make_font_desc(family, font_size, weight, flags);
    pango_layout_set_font_description(layout, desc);

    PangoFontMetrics *metrics = pango_context_get_metrics(ctx, desc, NULL);
    double ascent = (double)pango_font_metrics_get_ascent(metrics) / (double)PANGO_SCALE;
    double descent = (double)pango_font_metrics_get_descent(metrics) / (double)PANGO_SCALE;
    double lh = ceil(ascent + descent);
    if (lh < 1.0) lh = ceil(font_size * 1.2);
    if (out_line_height != NULL) *out_line_height = lh;
    if (out_baseline != NULL) *out_baseline = ascent;
    pango_font_metrics_unref(metrics);
    pango_font_description_free(desc);

    if (max_width > 0.0) {
        pango_layout_set_width(layout, (int)llround(max_width * (double)PANGO_SCALE));
        pango_layout_set_wrap(layout, PANGO_WRAP_WORD_CHAR);
    } else {
        pango_layout_set_width(layout, -1);
    }

    if (text != NULL && text_len > 0u) {
        pango_layout_set_text(layout, (const char *)text, (int)text_len);
    } else {
        pango_layout_set_text(layout, "", 0);
    }

    if ((flags & (SGUI_FONT_FLAG_UNDERLINE | SGUI_FONT_FLAG_STRIKETHROUGH)) != 0u) {
        PangoAttrList *attrs = pango_attr_list_new();
        if ((flags & SGUI_FONT_FLAG_UNDERLINE) != 0u) {
            pango_attr_list_insert(attrs, pango_attr_underline_new(PANGO_UNDERLINE_SINGLE));
        }
        if ((flags & SGUI_FONT_FLAG_STRIKETHROUGH) != 0u) {
            pango_attr_list_insert(attrs, pango_attr_strikethrough_new(TRUE));
        }
        pango_layout_set_attributes(layout, attrs);
        pango_attr_list_unref(attrs);
    }
    return layout;
}

/* -------------------------------------------------------------------------- */
/* Event Queue                                                                */
/* -------------------------------------------------------------------------- */

#define SGUI_EVENT_QUEUE_CAP (512u * 1024u)

static uint8_t *g_event_buf = NULL;
static size_t g_event_head = 0u;
static size_t g_event_tail = 0u;

static void ensure_event_buf(void) {
    if (g_event_buf == NULL) {
        g_event_buf = (uint8_t *)malloc(SGUI_EVENT_QUEUE_CAP);
        g_event_head = 0u;
        g_event_tail = 0u;
    }
}

static void push_event_record(const uint8_t *rec, size_t len) {
    ensure_event_buf();
    if (g_event_buf == NULL || len > SGUI_EVENT_QUEUE_CAP) return;
    if (g_event_tail + len > SGUI_EVENT_QUEUE_CAP) {
        if (g_event_head > 0u) {
            size_t avail = g_event_tail - g_event_head;
            if (avail > 0u) memmove(g_event_buf, g_event_buf + g_event_head, avail);
            g_event_head = 0u;
            g_event_tail = avail;
        }
        while (g_event_head < g_event_tail &&
               (g_event_tail - g_event_head) + len > SGUI_EVENT_QUEUE_CAP) {
            uint32_t skip_len = read_u32(g_event_buf + g_event_head + 4u);
            if (skip_len < 16u || g_event_head + skip_len > g_event_tail) {
                g_event_head = g_event_tail;
                break;
            }
            g_event_head += skip_len;
        }
        if (g_event_head > 0u) {
            size_t avail = g_event_tail - g_event_head;
            if (avail > 0u) memmove(g_event_buf, g_event_buf + g_event_head, avail);
            g_event_head = 0u;
            g_event_tail = avail;
        }
    }
    if (g_event_tail + len <= SGUI_EVENT_QUEUE_CAP) {
        memcpy(g_event_buf + g_event_tail, rec, len);
        g_event_tail += len;
    }
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
    if (name_len > 0u) memcpy(rec + 32, name, name_len);
    push_event_record(rec, total);
    if (rec != stack_buf) free(rec);
}

static void push_evt_text(uint32_t window_id, uint32_t mods, const char *utf8) {
    size_t utf8_len = utf8 != NULL ? strlen(utf8) : 0u;
    if (utf8_len == 0u) return;
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
    memcpy(rec + 24, utf8, utf8_len);
    push_event_record(rec, total);
    if (rec != stack_buf) free(rec);
}

static void push_evt_ime_preedit(
    uint32_t window_id,
    uint32_t cursor_start,
    uint32_t cursor_end,
    const char *utf8
) {
    size_t utf8_len = utf8 != NULL ? strlen(utf8) : 0u;
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
    if (utf8_len > 0u) memcpy(rec + 32, utf8, utf8_len);
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

/* -------------------------------------------------------------------------- */
/* Window Registry & Cairo Rendering                                          */
/* -------------------------------------------------------------------------- */

typedef struct {
    uint32_t window_id;
    uint32_t flags;
    GtkWidget *window;
    GtkWidget *vbox;
    GtkWidget *menu_bar;
    GtkWidget *area;
    GtkIMContext *im_ctx;
    GSimpleActionGroup *action_group;
    uint8_t *commands;
    size_t commands_len;
    size_t commands_cap;
    double pointer_x;
    double pointer_y;
    uint32_t pressed_btn;
} SguiWindowEntry;

#define SGUI_MAX_WINDOWS 64

static SguiWindowEntry g_windows[SGUI_MAX_WINDOWS];
static uint32_t g_next_window_id = 1u;
static bool g_initialized = false;
static GMenu *g_current_menu = NULL;

static SguiWindowEntry *find_window_entry(uint32_t window_id) {
    if (window_id == 0u) return NULL;
    for (size_t i = 0; i < SGUI_MAX_WINDOWS; i++) {
        if (g_windows[i].window_id == window_id) return &g_windows[i];
    }
    return NULL;
}

static bool is_dark_mode(void) {
    GtkSettings *settings = gtk_settings_get_default();
    if (settings == NULL) return false;
    gboolean prefer_dark = FALSE;
    g_object_get(settings, "gtk-application-prefer-dark-theme", &prefer_dark, NULL);
    return prefer_dark == TRUE;
}

static void cairo_rounded_rect(cairo_t *cr, double x, double y, double w, double h, double radius) {
    if (radius <= 0.0) {
        cairo_rectangle(cr, x, y, w, h);
        return;
    }
    double r = fmin(radius, fmin(w * 0.5, h * 0.5));
    double deg = M_PI / 180.0;
    cairo_new_sub_path(cr);
    cairo_arc(cr, x + w - r, y + r, r, -90.0 * deg, 0.0 * deg);
    cairo_arc(cr, x + w - r, y + h - r, r, 0.0 * deg, 90.0 * deg);
    cairo_arc(cr, x + r, y + h - r, r, 90.0 * deg, 180.0 * deg);
    cairo_arc(cr, x + r, y + r, r, 180.0 * deg, 270.0 * deg);
    cairo_close_path(cr);
}

static void cairo_rounded_corners(
    cairo_t *cr,
    double x,
    double y,
    double w,
    double h,
    double tl,
    double tr,
    double br,
    double bl
) {
    double rtl = fmax(0.0, tl);
    double rtr = fmax(0.0, tr);
    double rbr = fmax(0.0, br);
    double rbl = fmax(0.0, bl);
    if (rtl <= 0.0 && rtr <= 0.0 && rbr <= 0.0 && rbl <= 0.0) {
        cairo_rectangle(cr, x, y, w, h);
        return;
    }
    double sx1 = (rtl + rtr) > 0.0 ? w / (rtl + rtr) : 1.0;
    double sx2 = (rbl + rbr) > 0.0 ? w / (rbl + rbr) : 1.0;
    double sy1 = (rtl + rbl) > 0.0 ? h / (rtl + rbl) : 1.0;
    double sy2 = (rtr + rbr) > 0.0 ? h / (rtr + rbr) : 1.0;
    double k = fmin(1.0, fmin(fmin(sx1, sx2), fmin(sy1, sy2)));
    rtl *= k;
    rtr *= k;
    rbr *= k;
    rbl *= k;
    double deg = M_PI / 180.0;
    cairo_new_sub_path(cr);
    cairo_arc(cr, x + w - rtr, y + rtr, rtr, -90.0 * deg, 0.0 * deg);
    cairo_arc(cr, x + w - rbr, y + h - rbr, rbr, 0.0 * deg, 90.0 * deg);
    cairo_arc(cr, x + rbl, y + h - rbl, rbl, 90.0 * deg, 180.0 * deg);
    cairo_arc(cr, x + rtl, y + rtl, rtl, 180.0 * deg, 270.0 * deg);
    cairo_close_path(cr);
}

static void draw_commands_cairo(cairo_t *cr, double width, double height, const uint8_t *buf, size_t len) {
    if (buf == NULL || len < 8u) return;
    int clip_depth = 0;
    size_t off = 0u;
    while (off + 8u <= len) {
        uint32_t op = read_u32(buf + off + 0u);
        uint32_t cmd_len = read_u32(buf + off + 4u);
        if (cmd_len < 8u || off + cmd_len > len) break;
        const uint8_t *cmd = buf + off;
        switch (op) {
            case SGUI_CMD_CLEAR: {
                if (cmd_len >= 16u) {
                    cairo_set_rgba(cr, read_u32(cmd + 8u));
                    cairo_rectangle(cr, 0.0, 0.0, width, height);
                    cairo_fill(cr);
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
                        cairo_set_rgba(cr, rgba);
                        cairo_rounded_rect(cr, x, y, w, h, radius);
                        cairo_fill(cr);
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
                        double inset = stroke_w * 0.5;
                        cairo_set_rgba(cr, rgba);
                        cairo_set_line_width(cr, stroke_w);
                        cairo_rounded_rect(
                            cr,
                            x + inset,
                            y + inset,
                            fmax(0.0, w - stroke_w),
                            fmax(0.0, h - stroke_w),
                            fmax(0.0, radius - inset)
                        );
                        cairo_stroke(cr);
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
                        cairo_set_rgba(cr, rgba);
                        cairo_rounded_corners(cr, x, y, w, h, tl, tr, br, bl);
                        cairo_fill(cr);
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
                        double inset = stroke_w * 0.5;
                        cairo_set_rgba(cr, rgba);
                        cairo_set_line_width(cr, stroke_w);
                        cairo_rounded_corners(
                            cr,
                            x + inset,
                            y + inset,
                            fmax(0.0, w - stroke_w),
                            fmax(0.0, h - stroke_w),
                            tl > 0.0 ? fmax(0.0, tl - inset) : 0.0,
                            tr > 0.0 ? fmax(0.0, tr - inset) : 0.0,
                            br > 0.0 ? fmax(0.0, br - inset) : 0.0,
                            bl > 0.0 ? fmax(0.0, bl - inset) : 0.0
                        );
                        cairo_stroke(cr);
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
                    cairo_save(cr);
                    clip_depth++;
                    cairo_rectangle(cr, x, y, fmax(0.0, w), fmax(0.0, h));
                    cairo_clip(cr);
                }
                break;
            }
            case SGUI_CMD_POP_CLIP: {
                if (clip_depth > 0) {
                    cairo_restore(cr);
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
                        PangoLayout *layout = build_layout(
                            ensure_pango_context(),
                            family,
                            font_size,
                            weight,
                            flags,
                            max_width,
                            cmd + 56u,
                            utf8_len,
                            NULL,
                            NULL
                        );
                        cairo_set_rgba(cr, rgba);
                        cairo_move_to(cr, x, y);
                        pango_cairo_show_layout(cr, layout);
                        g_object_unref(layout);
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
                        cairo_set_rgba(cr, rgba);
                        cairo_set_line_width(cr, stroke_w);
                        cairo_move_to(cr, x1, y1);
                        cairo_line_to(cr, x2, y2);
                        cairo_stroke(cr);
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
                    size_t pixel_count = (size_t)px_w * (size_t)px_h;
                    if (px_w > 0u && px_h > 0u && w > 0.0 && h > 0.0 &&
                        56u + pixel_count * 4u <= cmd_len) {
                        cairo_surface_t *surf = cairo_image_surface_create(
                            CAIRO_FORMAT_ARGB32,
                            (int)px_w,
                            (int)px_h
                        );
                        unsigned char *dst = cairo_image_surface_get_data(surf);
                        int stride = cairo_image_surface_get_stride(surf);
                        const uint8_t *src = cmd + 56u;
                        for (uint32_t py = 0; py < px_h; py++) {
                            uint32_t *row = (uint32_t *)(dst + (size_t)py * (size_t)stride);
                            for (uint32_t px = 0; px < px_w; px++) {
                                size_t si = ((size_t)py * (size_t)px_w + (size_t)px) * 4u;
                                uint32_t r = src[si + 0u];
                                uint32_t g = src[si + 1u];
                                uint32_t b = src[si + 2u];
                                uint32_t a = src[si + 3u];
                                uint32_t pr = (r * a + 127u) / 255u;
                                uint32_t pg = (g * a + 127u) / 255u;
                                uint32_t pb = (b * a + 127u) / 255u;
                                row[px] = (a << 24) | (pr << 16) | (pg << 8) | pb;
                            }
                        }
                        cairo_surface_mark_dirty(surf);
                        cairo_save(cr);
                        if (radius > 0.0) {
                            cairo_rounded_rect(cr, x, y, w, h, radius);
                            cairo_clip(cr);
                        }
                        cairo_translate(cr, x, y);
                        cairo_scale(cr, w / (double)px_w, h / (double)px_h);
                        cairo_set_source_surface(cr, surf, 0.0, 0.0);
                        cairo_paint(cr);
                        cairo_restore(cr);
                        cairo_surface_destroy(surf);
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
        cairo_restore(cr);
        clip_depth--;
    }
}

/* -------------------------------------------------------------------------- */
/* GTK Signal Callbacks                                                       */
/* -------------------------------------------------------------------------- */

static uint32_t mods_from_gdk(GdkModifierType state) {
    uint32_t mods = 0u;
    if ((state & GDK_SHIFT_MASK) != 0) mods |= SGUI_MOD_SHIFT;
    if ((state & GDK_CONTROL_MASK) != 0) mods |= SGUI_MOD_CTRL;
    if ((state & GDK_ALT_MASK) != 0) mods |= SGUI_MOD_ALT;
    if ((state & GDK_SUPER_MASK) != 0) mods |= SGUI_MOD_SUPER;
    return mods;
}

static uint32_t btn_from_gtk(guint button) {
    if (button == 1) return SGUI_BTN_LEFT;
    if (button == 2) return SGUI_BTN_MIDDLE;
    if (button == 3) return SGUI_BTN_RIGHT;
    return SGUI_BTN_NONE;
}

static const char *map_gdk_keyval(guint keyval, char *scratch, size_t cap) {
    switch (keyval) {
        case GDK_KEY_Return:
        case GDK_KEY_KP_Enter:
            return "enter";
        case GDK_KEY_Tab:
        case GDK_KEY_ISO_Left_Tab:
            return "tab";
        case GDK_KEY_space:
            return "space";
        case GDK_KEY_BackSpace:
            return "backspace";
        case GDK_KEY_Escape:
            return "escape";
        case GDK_KEY_Delete:
        case GDK_KEY_KP_Delete:
            return "delete";
        case GDK_KEY_Home:
        case GDK_KEY_KP_Home:
            return "home";
        case GDK_KEY_End:
        case GDK_KEY_KP_End:
            return "end";
        case GDK_KEY_Page_Up:
        case GDK_KEY_KP_Page_Up:
            return "pageUp";
        case GDK_KEY_Page_Down:
        case GDK_KEY_KP_Page_Down:
            return "pageDown";
        case GDK_KEY_Left:
        case GDK_KEY_KP_Left:
            return "left";
        case GDK_KEY_Right:
        case GDK_KEY_KP_Right:
            return "right";
        case GDK_KEY_Up:
        case GDK_KEY_KP_Up:
            return "up";
        case GDK_KEY_Down:
        case GDK_KEY_KP_Down:
            return "down";
        default:
            break;
    }
    guint32 uc = gdk_keyval_to_unicode(gdk_keyval_to_lower(keyval));
    if (uc >= 32u) {
        char utf8[8];
        int n = g_unichar_to_utf8((gunichar)uc, utf8);
        if (n > 0 && (size_t)n < cap) {
            memcpy(scratch, utf8, (size_t)n);
            scratch[n] = '\0';
            return scratch;
        }
    }
    const char *kv_name = gdk_keyval_name(keyval);
    if (kv_name != NULL) {
        snprintf(scratch, cap, "%s", kv_name);
        return scratch;
    }
    return "unknown";
}

static void on_draw(GtkDrawingArea *area, cairo_t *cr, int width, int height, gpointer user_data) {
    (void)area;
    uint32_t window_id = (uint32_t)(uintptr_t)user_data;
    SguiWindowEntry *entry = find_window_entry(window_id);
    if (entry == NULL || entry->commands == NULL || entry->commands_len == 0u) return;
    draw_commands_cairo(cr, (double)width, (double)height, entry->commands, entry->commands_len);
}

static void on_resize(GtkDrawingArea *area, int width, int height, gpointer user_data) {
    uint32_t window_id = (uint32_t)(uintptr_t)user_data;
    double scale = (double)gtk_widget_get_scale_factor(GTK_WIDGET(area));
    push_evt_resize(window_id, (double)width, (double)height, scale);
}

static gboolean on_close_request(GtkWindow *window, gpointer user_data) {
    (void)window;
    uint32_t window_id = (uint32_t)(uintptr_t)user_data;
    push_evt_simple(SGUI_EVT_CLOSE, window_id, 0u);
    return TRUE;
}

static void on_is_active_changed(GObject *obj, GParamSpec *pspec, gpointer user_data) {
    (void)pspec;
    uint32_t window_id = (uint32_t)(uintptr_t)user_data;
    gboolean active = gtk_window_is_active(GTK_WINDOW(obj));
    push_evt_focus(window_id, active ? 1u : 0u, is_dark_mode() ? 1u : 0u);
}

static void on_click_pressed(GtkGestureClick *gesture, int n_press, double x, double y, gpointer user_data) {
    uint32_t window_id = (uint32_t)(uintptr_t)user_data;
    SguiWindowEntry *entry = find_window_entry(window_id);
    if (entry != NULL) {
        gtk_widget_grab_focus(entry->area);
        entry->pointer_x = x;
        entry->pointer_y = y;
        entry->pressed_btn = btn_from_gtk(gtk_gesture_single_get_current_button(GTK_GESTURE_SINGLE(gesture)));
    }
    GdkModifierType state = gtk_event_controller_get_current_event_state(GTK_EVENT_CONTROLLER(gesture));
    uint32_t btn = btn_from_gtk(gtk_gesture_single_get_current_button(GTK_GESTURE_SINGLE(gesture)));
    push_evt_pointer(window_id, mods_from_gdk(state), SGUI_PTR_DOWN, btn, (uint32_t)n_press, x, y);
}

static void on_click_released(GtkGestureClick *gesture, int n_press, double x, double y, gpointer user_data) {
    uint32_t window_id = (uint32_t)(uintptr_t)user_data;
    SguiWindowEntry *entry = find_window_entry(window_id);
    if (entry != NULL) entry->pressed_btn = SGUI_BTN_NONE;
    GdkModifierType state = gtk_event_controller_get_current_event_state(GTK_EVENT_CONTROLLER(gesture));
    uint32_t btn = btn_from_gtk(gtk_gesture_single_get_current_button(GTK_GESTURE_SINGLE(gesture)));
    push_evt_pointer(window_id, mods_from_gdk(state), SGUI_PTR_UP, btn, (uint32_t)n_press, x, y);
}

static void on_motion(GtkEventControllerMotion *ctrl, double x, double y, gpointer user_data) {
    uint32_t window_id = (uint32_t)(uintptr_t)user_data;
    SguiWindowEntry *entry = find_window_entry(window_id);
    uint32_t btn = SGUI_BTN_NONE;
    uint32_t phase = SGUI_PTR_MOVE;
    if (entry != NULL) {
        entry->pointer_x = x;
        entry->pointer_y = y;
        if (entry->pressed_btn != SGUI_BTN_NONE) {
            btn = entry->pressed_btn;
            phase = SGUI_PTR_DRAG;
        }
    }
    GdkModifierType state = gtk_event_controller_get_current_event_state(GTK_EVENT_CONTROLLER(ctrl));
    push_evt_pointer(window_id, mods_from_gdk(state), phase, btn, 0u, x, y);
}

static void on_leave(GtkEventControllerMotion *ctrl, gpointer user_data) {
    (void)ctrl;
    uint32_t window_id = (uint32_t)(uintptr_t)user_data;
    SguiWindowEntry *entry = find_window_entry(window_id);
    double x = entry != NULL ? entry->pointer_x : 0.0;
    double y = entry != NULL ? entry->pointer_y : 0.0;
    push_evt_pointer(window_id, 0u, SGUI_PTR_LEAVE, SGUI_BTN_NONE, 0u, x, y);
}

static gboolean on_scroll(GtkEventControllerScroll *ctrl, double dx, double dy, gpointer user_data) {
    uint32_t window_id = (uint32_t)(uintptr_t)user_data;
    SguiWindowEntry *entry = find_window_entry(window_id);
    double x = entry != NULL ? entry->pointer_x : 0.0;
    double y = entry != NULL ? entry->pointer_y : 0.0;
    GdkModifierType state = gtk_event_controller_get_current_event_state(GTK_EVENT_CONTROLLER(ctrl));
    double scale = 40.0;
    if (gtk_event_controller_scroll_get_unit(ctrl) == GDK_SCROLL_UNIT_SURFACE) {
        scale = 1.0;
    }
    push_evt_scroll(window_id, mods_from_gdk(state), x, y, dx * scale, dy * scale);
    return TRUE;
}

static gboolean on_key_pressed(
    GtkEventControllerKey *ctrl,
    guint keyval,
    guint keycode,
    GdkModifierType state,
    gpointer user_data
) {
    uint32_t window_id = (uint32_t)(uintptr_t)user_data;
    SguiWindowEntry *entry = find_window_entry(window_id);
    uint32_t mods = mods_from_gdk(state);
    char scratch[32];
    const char *name = map_gdk_keyval(keyval, scratch, sizeof(scratch));
    push_evt_key(window_id, mods, SGUI_KEY_DOWN, (uint32_t)keycode, name);
    if (entry != NULL && entry->im_ctx != NULL && (mods & (SGUI_MOD_CTRL | SGUI_MOD_SUPER)) == 0u) {
        GdkEvent *evt = gtk_event_controller_get_current_event(GTK_EVENT_CONTROLLER(ctrl));
        if (evt != NULL) {
            gtk_im_context_filter_keypress(entry->im_ctx, evt);
        }
    }
    return TRUE;
}

static void on_key_released(
    GtkEventControllerKey *ctrl,
    guint keyval,
    guint keycode,
    GdkModifierType state,
    gpointer user_data
) {
    (void)ctrl;
    uint32_t window_id = (uint32_t)(uintptr_t)user_data;
    char scratch[32];
    const char *name = map_gdk_keyval(keyval, scratch, sizeof(scratch));
    push_evt_key(window_id, mods_from_gdk(state), SGUI_KEY_UP, (uint32_t)keycode, name);
}

static void on_im_commit(GtkIMContext *ctx, const char *str, gpointer user_data) {
    (void)ctx;
    uint32_t window_id = (uint32_t)(uintptr_t)user_data;
    push_evt_ime_preedit(window_id, 0u, 0u, "");
    push_evt_text(window_id, 0u, str);
}

static void on_im_preedit_changed(GtkIMContext *ctx, gpointer user_data) {
    uint32_t window_id = (uint32_t)(uintptr_t)user_data;
    char *str = NULL;
    int cursor_pos = 0;
    gtk_im_context_get_preedit_string(ctx, &str, NULL, &cursor_pos);
    push_evt_ime_preedit(window_id, (uint32_t)cursor_pos, (uint32_t)cursor_pos, str != NULL ? str : "");
    g_free(str);
}

static void on_menu_action(GSimpleAction *action, GVariant *parameter, gpointer user_data) {
    (void)action;
    (void)parameter;
    uint32_t item_id = (uint32_t)(uintptr_t)user_data;
    if (item_id > 0u) push_evt_menu(item_id);
}

/* -------------------------------------------------------------------------- */
/* Public C ABI Implementation                                                */
/* -------------------------------------------------------------------------- */

int32_t sgui_init(void) {
    if (g_initialized) return 0;
    ensure_event_buf();
    if (!gtk_init_check()) return -1;
    ensure_pango_context();
    g_initialized = true;
    return 0;
}

void sgui_shutdown(void) {
    for (size_t i = 0; i < SGUI_MAX_WINDOWS; i++) {
        if (g_windows[i].window_id != 0u) {
            sgui_window_destroy(g_windows[i].window_id);
        }
    }
    if (g_current_menu != NULL) {
        g_object_unref(g_current_menu);
        g_current_menu = NULL;
    }
    if (g_pango_ctx != NULL) {
        g_object_unref(g_pango_ctx);
        g_pango_ctx = NULL;
    }
    free(g_event_buf);
    g_event_buf = NULL;
    g_event_head = 0u;
    g_event_tail = 0u;
    g_initialized = false;
}

uint32_t sgui_window_create(
    const uint8_t *title,
    size_t title_len,
    double width,
    double height,
    uint32_t flags
) {
    if (!g_initialized && sgui_init() != 0) return 0u;
    size_t slot = SGUI_MAX_WINDOWS;
    for (size_t i = 0; i < SGUI_MAX_WINDOWS; i++) {
        if (g_windows[i].window_id == 0u) {
            slot = i;
            break;
        }
    }
    if (slot == SGUI_MAX_WINDOWS) return 0u;

    uint32_t window_id = g_next_window_id++;
    if (window_id == 0u) window_id = g_next_window_id++;

    GtkWidget *win = gtk_window_new();
    char *title_z = (char *)malloc(title_len + 1u);
    if (title_z != NULL) {
        if (title != NULL && title_len > 0u) memcpy(title_z, title, title_len);
        title_z[title_len] = '\0';
        gtk_window_set_title(GTK_WINDOW(win), title_z);
        free(title_z);
    }
    gtk_window_set_default_size(GTK_WINDOW(win), (int)llround(width), (int)llround(height));
    gtk_window_set_resizable(GTK_WINDOW(win), (flags & SGUI_WIN_RESIZABLE) != 0u);
    if ((flags & SGUI_WIN_TITLEBAR_HIDDEN) != 0u) {
        gtk_window_set_decorated(GTK_WINDOW(win), FALSE);
    }

    GtkWidget *vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    GtkWidget *menu_bar = g_current_menu != NULL ? gtk_popover_menu_bar_new_from_model(G_MENU_MODEL(g_current_menu)) : NULL;
    if (menu_bar != NULL) gtk_box_append(GTK_BOX(vbox), menu_bar);

    GtkWidget *area = gtk_drawing_area_new();
    gtk_widget_set_hexpand(area, TRUE);
    gtk_widget_set_vexpand(area, TRUE);
    gtk_widget_set_focusable(area, TRUE);
    gtk_drawing_area_set_draw_func(GTK_DRAWING_AREA(area), on_draw, (gpointer)(uintptr_t)window_id, NULL);
    gtk_box_append(GTK_BOX(vbox), area);
    gtk_window_set_child(GTK_WINDOW(win), vbox);

    GtkIMContext *im_ctx = gtk_im_multicontext_new();
    gtk_im_context_set_client_widget(im_ctx, area);
    g_signal_connect(im_ctx, "commit", G_CALLBACK(on_im_commit), (gpointer)(uintptr_t)window_id);
    g_signal_connect(im_ctx, "preedit-changed", G_CALLBACK(on_im_preedit_changed), (gpointer)(uintptr_t)window_id);

    g_signal_connect(area, "resize", G_CALLBACK(on_resize), (gpointer)(uintptr_t)window_id);
    g_signal_connect(win, "close-request", G_CALLBACK(on_close_request), (gpointer)(uintptr_t)window_id);
    g_signal_connect(win, "notify::is-active", G_CALLBACK(on_is_active_changed), (gpointer)(uintptr_t)window_id);

    GtkGesture *click = gtk_gesture_click_new();
    gtk_gesture_single_set_button(GTK_GESTURE_SINGLE(click), 0);
    g_signal_connect(click, "pressed", G_CALLBACK(on_click_pressed), (gpointer)(uintptr_t)window_id);
    g_signal_connect(click, "released", G_CALLBACK(on_click_released), (gpointer)(uintptr_t)window_id);
    gtk_widget_add_controller(area, GTK_EVENT_CONTROLLER(click));

    GtkEventController *motion = gtk_event_controller_motion_new();
    g_signal_connect(motion, "motion", G_CALLBACK(on_motion), (gpointer)(uintptr_t)window_id);
    g_signal_connect(motion, "leave", G_CALLBACK(on_leave), (gpointer)(uintptr_t)window_id);
    gtk_widget_add_controller(area, motion);

    GtkEventController *scroll = gtk_event_controller_scroll_new(GTK_EVENT_CONTROLLER_SCROLL_BOTH_AXES);
    g_signal_connect(scroll, "scroll", G_CALLBACK(on_scroll), (gpointer)(uintptr_t)window_id);
    gtk_widget_add_controller(area, scroll);

    GtkEventController *key = gtk_event_controller_key_new();
    g_signal_connect(key, "key-pressed", G_CALLBACK(on_key_pressed), (gpointer)(uintptr_t)window_id);
    g_signal_connect(key, "key-released", G_CALLBACK(on_key_released), (gpointer)(uintptr_t)window_id);
    gtk_widget_add_controller(area, key);

    GSimpleActionGroup *group = g_simple_action_group_new();
    gtk_widget_insert_action_group(win, "app", G_ACTION_GROUP(group));

    g_windows[slot] = (SguiWindowEntry){
        .window_id = window_id,
        .flags = flags,
        .window = win,
        .vbox = vbox,
        .menu_bar = menu_bar,
        .area = area,
        .im_ctx = im_ctx,
        .action_group = group,
        .commands = NULL,
        .commands_len = 0u,
        .commands_cap = 0u,
        .pointer_x = 0.0,
        .pointer_y = 0.0,
        .pressed_btn = SGUI_BTN_NONE,
    };

    gtk_window_present(GTK_WINDOW(win));
    gtk_widget_grab_focus(area);
    push_evt_resize(window_id, width, height, (double)gtk_widget_get_scale_factor(area));
    push_evt_focus(window_id, gtk_window_is_active(GTK_WINDOW(win)) ? 1u : 0u, is_dark_mode() ? 1u : 0u);
    return window_id;
}

void sgui_window_destroy(uint32_t window_id) {
    SguiWindowEntry *entry = find_window_entry(window_id);
    if (entry == NULL) return;
    if (entry->im_ctx != NULL) {
        gtk_im_context_set_client_widget(entry->im_ctx, NULL);
        g_object_unref(entry->im_ctx);
    }
    if (entry->action_group != NULL) g_object_unref(entry->action_group);
    if (entry->window != NULL) gtk_window_destroy(GTK_WINDOW(entry->window));
    free(entry->commands);
    memset(entry, 0, sizeof(*entry));
}

void sgui_window_set_title(uint32_t window_id, const uint8_t *title, size_t title_len) {
    SguiWindowEntry *entry = find_window_entry(window_id);
    if (entry == NULL || entry->window == NULL) return;
    char *title_z = (char *)malloc(title_len + 1u);
    if (title_z == NULL) return;
    if (title != NULL && title_len > 0u) memcpy(title_z, title, title_len);
    title_z[title_len] = '\0';
    gtk_window_set_title(GTK_WINDOW(entry->window), title_z);
    free(title_z);
}

int32_t sgui_window_get_metrics(uint32_t window_id, uint8_t *out_metrics, size_t out_len) {
    if (out_metrics == NULL || out_len < SGUI_WINDOW_METRICS_SIZE) return -1;
    SguiWindowEntry *entry = find_window_entry(window_id);
    if (entry == NULL || entry->area == NULL || entry->window == NULL) return -1;
    double w = (double)gtk_widget_get_width(entry->area);
    double h = (double)gtk_widget_get_height(entry->area);
    double scale = (double)gtk_widget_get_scale_factor(entry->area);
    write_f64(out_metrics + 0u, w);
    write_f64(out_metrics + 8u, h);
    write_f64(out_metrics + 16u, scale);
    write_f64(out_metrics + 24u, 0.0);
    write_f64(out_metrics + 32u, 0.0);
    write_u32(out_metrics + 40u, is_dark_mode() ? 1u : 0u);
    write_u32(out_metrics + 44u, gtk_window_is_active(GTK_WINDOW(entry->window)) ? 1u : 0u);
    return 0;
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
    if (out_metrics == NULL || out_len < SGUI_TEXT_METRICS_SIZE) return -1;
    double line_height = 0.0;
    double baseline = 0.0;
    PangoLayout *layout = build_layout(
        ensure_pango_context(),
        font_family,
        font_size,
        font_weight,
        font_flags,
        max_width,
        text,
        text_len,
        &line_height,
        &baseline
    );
    int pw = 0, ph = 0;
    pango_layout_get_pixel_size(layout, &pw, &ph);
    int line_count = pango_layout_get_line_count(layout);
    if (line_count < 1) line_count = 1;
    g_object_unref(layout);

    write_f64(out_metrics + 0u, (double)pw);
    write_f64(out_metrics + 8u, fmax((double)ph, (double)line_count * line_height));
    write_f64(out_metrics + 16u, line_height);
    write_f64(out_metrics + 24u, baseline);
    write_u32(out_metrics + 32u, (uint32_t)line_count);
    return 0;
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
    if (line == NULL || line_len == 0u || byte_offset == 0u) return 0.0;
    PangoLayout *layout = build_layout(
        ensure_pango_context(),
        font_family,
        font_size,
        font_weight,
        font_flags,
        0.0,
        line,
        line_len,
        NULL,
        NULL
    );
    int idx = byte_offset < line_len ? (int)byte_offset : (int)line_len;
    PangoRectangle strong_pos;
    pango_layout_get_cursor_pos(layout, idx, &strong_pos, NULL);
    g_object_unref(layout);
    return (double)strong_pos.x / (double)PANGO_SCALE;
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
    if (line == NULL || line_len == 0u || x <= 0.0) return 0u;
    PangoLayout *layout = build_layout(
        ensure_pango_context(),
        font_family,
        font_size,
        font_weight,
        font_flags,
        0.0,
        line,
        line_len,
        NULL,
        NULL
    );
    int index = 0;
    int trailing = 0;
    pango_layout_xy_to_index(layout, (int)llround(x * (double)PANGO_SCALE), 0, &index, &trailing);
    while (trailing > 0 && (size_t)index < line_len) {
        const char *next = g_utf8_next_char((const char *)line + index);
        index = (int)(next - (const char *)line);
        trailing--;
    }
    g_object_unref(layout);
    if (index < 0) return 0u;
    if ((size_t)index > line_len) return (uint32_t)line_len;
    return (uint32_t)index;
}

int32_t sgui_present(uint32_t window_id, const uint8_t *commands, size_t commands_len) {
    SguiWindowEntry *entry = find_window_entry(window_id);
    if (entry == NULL || entry->area == NULL) return -1;
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
    gtk_widget_queue_draw(entry->area);
    return 0;
}

int32_t sgui_poll_events(uint32_t wait_ms, uint8_t *out_events, size_t out_cap) {
    if (!g_initialized) return 0;
    GMainContext *ctx = g_main_context_default();
    if (wait_ms > 0u && g_event_head == g_event_tail && !g_main_context_pending(ctx)) {
        g_usleep((gulong)wait_ms * 1000ul);
    }
    while (g_main_context_iteration(ctx, FALSE)) {
    }
    if (out_events == NULL || out_cap == 0u || g_event_head == g_event_tail) return 0;

    size_t written = 0u;
    while (g_event_head + 16u <= g_event_tail) {
        uint32_t rec_len = read_u32(g_event_buf + g_event_head + 4u);
        if (rec_len < 16u || g_event_head + rec_len > g_event_tail) {
            g_event_head = g_event_tail;
            break;
        }
        if (written + rec_len > out_cap) break;
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

typedef struct {
    bool done;
    char *text;
} SguiClipReadState;

static void on_clip_read(GObject *src, GAsyncResult *res, gpointer user_data) {
    SguiClipReadState *state = (SguiClipReadState *)user_data;
    state->text = gdk_clipboard_read_text_finish(GDK_CLIPBOARD(src), res, NULL);
    state->done = true;
}

int32_t sgui_clipboard_get_text(uint8_t *out_utf8, size_t out_cap) {
    GdkDisplay *display = gdk_display_get_default();
    if (display == NULL) return -1;
    GdkClipboard *cb = gdk_display_get_clipboard(display);
    if (cb == NULL) return -1;
    SguiClipReadState state = {.done = false, .text = NULL};
    gdk_clipboard_read_text_async(cb, NULL, on_clip_read, &state);
    GMainContext *ctx = g_main_context_default();
    for (int iter = 0; !state.done && iter < 1000; iter++) {
        g_main_context_iteration(ctx, TRUE);
    }
    if (!state.done || state.text == NULL) {
        g_free(state.text);
        return -1;
    }
    size_t len = strlen(state.text);
    if (out_utf8 != NULL && out_cap >= len && len > 0u) {
        memcpy(out_utf8, state.text, len);
    }
    g_free(state.text);
    return (int32_t)len;
}

int32_t sgui_clipboard_set_text(const uint8_t *text, size_t text_len) {
    GdkDisplay *display = gdk_display_get_default();
    if (display == NULL) return -1;
    GdkClipboard *cb = gdk_display_get_clipboard(display);
    if (cb == NULL) return -1;
    char *z = (char *)malloc(text_len + 1u);
    if (z == NULL) return -1;
    if (text != NULL && text_len > 0u) memcpy(z, text, text_len);
    z[text_len] = '\0';
    gdk_clipboard_set_text(cb, z);
    free(z);
    return 0;
}

void sgui_set_cursor(uint32_t window_id, uint32_t cursor_kind) {
    SguiWindowEntry *entry = find_window_entry(window_id);
    if (entry == NULL || entry->area == NULL) return;
    const char *name = "default";
    switch (cursor_kind) {
        case SGUI_CURSOR_IBEAM: name = "text"; break;
        case SGUI_CURSOR_POINTER: name = "pointer"; break;
        case SGUI_CURSOR_RESIZE_EW: name = "ew-resize"; break;
        case SGUI_CURSOR_RESIZE_NS: name = "ns-resize"; break;
        default: name = "default"; break;
    }
    gtk_widget_set_cursor_from_name(entry->area, name);
}

void sgui_set_ime_rect(uint32_t window_id, double x, double y, double width, double height) {
    SguiWindowEntry *entry = find_window_entry(window_id);
    if (entry == NULL || entry->im_ctx == NULL) return;
    GdkRectangle rect = {(int)llround(x), (int)llround(y), (int)llround(fmax(1.0, width)), (int)llround(fmax(1.0, height))};
    gtk_im_context_set_cursor_location(entry->im_ctx, &rect);
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

static char *menu_read_str(SguiMenuReader *r, bool *ok) {
    uint32_t slen = 0u;
    if (!menu_read_u32(r, &slen) || r->pos + slen > r->len) {
        *ok = false;
        return NULL;
    }
    char *s = (char *)malloc((size_t)slen + 1u);
    if (s == NULL) {
        *ok = false;
        return NULL;
    }
    if (slen > 0u) memcpy(s, r->data + r->pos, slen);
    s[slen] = '\0';
    r->pos += slen;
    return s;
}

static void register_menu_action_all(uint32_t item_id, char *action_name, size_t action_name_cap) {
    snprintf(action_name, action_name_cap, "item_%u", (unsigned)item_id);
    for (size_t i = 0; i < SGUI_MAX_WINDOWS; i++) {
        if (g_windows[i].window_id != 0u && g_windows[i].action_group != NULL) {
            GSimpleAction *act = g_simple_action_new(action_name, NULL);
            g_signal_connect(act, "activate", G_CALLBACK(on_menu_action), (gpointer)(uintptr_t)item_id);
            g_action_map_add_action(G_ACTION_MAP(g_windows[i].action_group), G_ACTION(act));
            g_object_unref(act);
        }
    }
}

static bool populate_gmenu(GMenu *target, SguiMenuReader *r, uint32_t count) {
    GMenu *section = g_menu_new();
    for (uint32_t i = 0; i < count; i++) {
        uint32_t kind = 0, item_id = 0, flags = 0, role = 0;
        if (!menu_read_u32(r, &kind) ||
            !menu_read_u32(r, &item_id) ||
            !menu_read_u32(r, &flags) ||
            !menu_read_u32(r, &role)) {
            g_object_unref(section);
            return false;
        }
        (void)flags;
        (void)role;
        bool ok = true;
        char *label = menu_read_str(r, &ok);
        char *shortcut = menu_read_str(r, &ok);
        uint32_t sub_count = 0u;
        if (!ok || (kind == SGUI_MENU_ITEM_SUBMENU && !menu_read_u32(r, &sub_count))) {
            free(label);
            free(shortcut);
            g_object_unref(section);
            return false;
        }
        if (kind == SGUI_MENU_ITEM_SEPARATOR) {
            g_menu_append_section(target, NULL, G_MENU_MODEL(section));
            g_object_unref(section);
            section = g_menu_new();
            free(label);
            free(shortcut);
            continue;
        }
        if (kind == SGUI_MENU_ITEM_SUBMENU) {
            GMenu *sub = g_menu_new();
            if (!populate_gmenu(sub, r, sub_count)) {
                g_object_unref(sub);
                free(label);
                free(shortcut);
                g_object_unref(section);
                return false;
            }
            g_menu_append_submenu(section, label, G_MENU_MODEL(sub));
            g_object_unref(sub);
        } else {
            char act_name[32];
            char full_act[40];
            register_menu_action_all(item_id, act_name, sizeof(act_name));
            snprintf(full_act, sizeof(full_act), "app.%s", act_name);
            g_menu_append(section, label, full_act);
        }
        free(label);
        free(shortcut);
    }
    g_menu_append_section(target, NULL, G_MENU_MODEL(section));
    g_object_unref(section);
    return true;
}

int32_t sgui_set_app_menu(const uint8_t *spec, size_t spec_len) {
    if (!g_initialized && sgui_init() != 0) return -1;
    if (spec == NULL || spec_len < 4u) return -1;
    SguiMenuReader r = {.data = spec, .len = spec_len, .pos = 0u};
    uint32_t menu_count = 0u;
    if (!menu_read_u32(&r, &menu_count)) return -1;

    GMenu *root = g_menu_new();
    for (uint32_t m = 0; m < menu_count; m++) {
        bool ok = true;
        char *title = menu_read_str(&r, &ok);
        uint32_t item_count = 0u;
        if (!ok || !menu_read_u32(&r, &item_count)) {
            free(title);
            g_object_unref(root);
            return -1;
        }
        GMenu *sub = g_menu_new();
        if (!populate_gmenu(sub, &r, item_count)) {
            g_object_unref(sub);
            free(title);
            g_object_unref(root);
            return -1;
        }
        g_menu_append_submenu(root, title, G_MENU_MODEL(sub));
        g_object_unref(sub);
        free(title);
    }

    if (g_current_menu != NULL) g_object_unref(g_current_menu);
    g_current_menu = root;
    for (size_t i = 0; i < SGUI_MAX_WINDOWS; i++) {
        if (g_windows[i].window_id != 0u && g_windows[i].vbox != NULL) {
            if (g_windows[i].menu_bar != NULL) {
                gtk_box_remove(GTK_BOX(g_windows[i].vbox), g_windows[i].menu_bar);
            }
            GtkWidget *bar = gtk_popover_menu_bar_new_from_model(G_MENU_MODEL(root));
            gtk_box_prepend(GTK_BOX(g_windows[i].vbox), bar);
            g_windows[i].menu_bar = bar;
        }
    }
    return 0;
}

int32_t sgui_set_a11y_tree(uint32_t window_id, const uint8_t *nodes, size_t nodes_len) {
    (void)window_id;
    (void)nodes;
    (void)nodes_len;
    return 0;
}

void sgui_window_set_chrome(uint32_t win_id, uint32_t dark_mode, double sidebar_width, uint32_t vibrancy_enabled) {
    (void)win_id;
    (void)dark_mode;
    (void)sidebar_width;
    (void)vibrancy_enabled;
}

void sgui_window_action(uint32_t win_id, uint32_t action) {
    (void)win_id;
    (void)action;
}
