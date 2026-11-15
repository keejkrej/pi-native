#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef UNICODE
#define UNICODE
#endif

#include <windows.h>
#include <windowsx.h>
#include <d2d1.h>
#include <dwrite.h>
#include <dwmapi.h>
#include <imm.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../../include/sgui.h"

#ifdef __cplusplus
extern "C" {
#endif

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

static inline D2D1_COLOR_F d2d_color_from_rgba(uint32_t rgba) {
    D2D1_COLOR_F c;
    c.r = (float)((rgba >> 24) & 0xFFu) / 255.0f;
    c.g = (float)((rgba >> 16) & 0xFFu) / 255.0f;
    c.b = (float)((rgba >> 8) & 0xFFu) / 255.0f;
    c.a = (float)(rgba & 0xFFu) / 255.0f;
    return c;
}

static wchar_t *utf8_to_wide(const uint8_t *utf8, size_t utf8_len, int *out_wlen) {
    if (utf8 == NULL || utf8_len == 0u) {
        wchar_t *empty = (wchar_t *)malloc(sizeof(wchar_t));
        if (empty != NULL) empty[0] = L'\0';
        if (out_wlen != NULL) *out_wlen = 0;
        return empty;
    }
    int needed = MultiByteToWideChar(CP_UTF8, 0, (const char *)utf8, (int)utf8_len, NULL, 0);
    if (needed <= 0) needed = 0;
    wchar_t *wide = (wchar_t *)malloc((size_t)(needed + 1) * sizeof(wchar_t));
    if (wide == NULL) return NULL;
    if (needed > 0) {
        MultiByteToWideChar(CP_UTF8, 0, (const char *)utf8, (int)utf8_len, wide, needed);
    }
    wide[needed] = L'\0';
    if (out_wlen != NULL) *out_wlen = needed;
    return wide;
}

static UINT32 utf8_byte_to_utf16(const uint8_t *s, size_t len, uint32_t byte_off) {
    size_t limit = byte_off < len ? (size_t)byte_off : len;
    size_t i = 0;
    UINT32 units = 0;
    while (i < limit) {
        uint8_t b = s[i];
        if (b < 0x80u) { i += 1; units += 1; }
        else if ((b & 0xE0u) == 0xC0u) { i += 2; units += 1; }
        else if ((b & 0xF0u) == 0xE0u) { i += 3; units += 1; }
        else if ((b & 0xF8u) == 0xF0u) { i += 4; units += 2; }
        else { i += 1; units += 1; }
    }
    return units;
}

static uint32_t utf16_to_utf8_byte(const uint8_t *s, size_t len, UINT32 target_units) {
    if (target_units == 0u) return 0u;
    size_t i = 0;
    UINT32 units = 0;
    while (i < len && units < target_units) {
        uint8_t b = s[i];
        size_t adv = 1;
        UINT32 uadv = 1;
        if (b < 0x80u) { adv = 1; uadv = 1; }
        else if ((b & 0xE0u) == 0xC0u) { adv = 2; uadv = 1; }
        else if ((b & 0xF0u) == 0xE0u) { adv = 3; uadv = 1; }
        else if ((b & 0xF8u) == 0xF0u) { adv = 4; uadv = 2; }
        if (i + adv > len || units + uadv > target_units) break;
        i += adv;
        units += uadv;
    }
    return (uint32_t)i;
}

/* -------------------------------------------------------------------------- */
/* Direct2D / DirectWrite Globals                                             */
/* -------------------------------------------------------------------------- */

static ID2D1Factory *g_d2d = NULL;
static IDWriteFactory *g_dwrite = NULL;
static bool g_initialized = false;

static void ensure_dwrite(void) {
    if (g_dwrite == NULL) {
        DWriteCreateFactory(
            DWRITE_FACTORY_TYPE_SHARED,
            __uuidof(IDWriteFactory),
            (IUnknown **)&g_dwrite
        );
    }
}

static IDWriteTextLayout *create_dw_layout(
    uint32_t family,
    double font_size,
    uint32_t weight,
    uint32_t flags,
    double max_width,
    const uint8_t *text,
    size_t text_len
) {
    ensure_dwrite();
    if (g_dwrite == NULL) return NULL;
    const wchar_t *face = (family == SGUI_FONT_MONO) ? L"Consolas" : L"Segoe UI";
    DWRITE_FONT_STYLE style = (flags & SGUI_FONT_FLAG_ITALIC) != 0u
        ? DWRITE_FONT_STYLE_ITALIC
        : DWRITE_FONT_STYLE_NORMAL;
    float fsize = (float)(font_size > 1.0 ? font_size : 1.0);
    IDWriteTextFormat *fmt = NULL;
    HRESULT hr = g_dwrite->CreateTextFormat(
        face,
        NULL,
        (DWRITE_FONT_WEIGHT)weight,
        style,
        DWRITE_FONT_STRETCH_NORMAL,
        fsize,
        L"en-us",
        &fmt
    );
    if (FAILED(hr) || fmt == NULL) return NULL;

    int wlen = 0;
    wchar_t *wtext = utf8_to_wide(text, text_len, &wlen);
    if (wtext == NULL) {
        fmt->Release();
        return NULL;
    }

    float max_w = max_width > 0.0 ? (float)max_width : 1e7f;
    if (max_width <= 0.0) {
        fmt->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);
    } else {
        fmt->SetWordWrapping(DWRITE_WORD_WRAPPING_WRAP);
    }

    IDWriteTextLayout *layout = NULL;
    hr = g_dwrite->CreateTextLayout(wtext, (UINT32)wlen, fmt, max_w, 1e7f, &layout);
    free(wtext);
    fmt->Release();
    if (FAILED(hr) || layout == NULL) return NULL;

    DWRITE_TEXT_RANGE range = {0, (UINT32)wlen};
    if ((flags & SGUI_FONT_FLAG_UNDERLINE) != 0u) layout->SetUnderline(TRUE, range);
    if ((flags & SGUI_FONT_FLAG_STRIKETHROUGH) != 0u) layout->SetStrikethrough(TRUE, range);
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

static uint32_t current_mods(void) {
    uint32_t mods = 0u;
    if ((GetKeyState(VK_SHIFT) & 0x8000) != 0) mods |= SGUI_MOD_SHIFT;
    if ((GetKeyState(VK_CONTROL) & 0x8000) != 0) mods |= SGUI_MOD_CTRL;
    if ((GetKeyState(VK_MENU) & 0x8000) != 0) mods |= SGUI_MOD_ALT;
    if (((GetKeyState(VK_LWIN) | GetKeyState(VK_RWIN)) & 0x8000) != 0) mods |= SGUI_MOD_SUPER;
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

static void push_evt_key(uint32_t window_id, uint32_t mods, uint32_t phase, uint32_t code, const char *name) {
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
    write_u32(rec + 20, code);
    write_u32(rec + 24, (uint32_t)name_len);
    write_u32(rec + 28, 0u);
    if (name_len > 0u) memcpy(rec + 32, name, name_len);
    push_event_record(rec, total);
    if (rec != stack_buf) free(rec);
}

static void push_evt_text_wide(uint32_t window_id, uint32_t mods, const wchar_t *wstr, int wlen) {
    if (wstr == NULL || wlen <= 0) return;
    int utf8_len = WideCharToMultiByte(CP_UTF8, 0, wstr, wlen, NULL, 0, NULL, NULL);
    if (utf8_len <= 0) return;
    size_t total = align8(24u + (size_t)utf8_len);
    uint8_t *rec = (uint8_t *)malloc(total);
    if (rec == NULL) return;
    memset(rec, 0, total);
    write_u32(rec + 0, SGUI_EVT_TEXT);
    write_u32(rec + 4, (uint32_t)total);
    write_u32(rec + 8, window_id);
    write_u32(rec + 12, mods);
    write_u32(rec + 16, (uint32_t)utf8_len);
    write_u32(rec + 20, 0u);
    WideCharToMultiByte(CP_UTF8, 0, wstr, wlen, (char *)(rec + 24), utf8_len, NULL, NULL);
    push_event_record(rec, total);
    free(rec);
}

static void push_evt_ime_wide(uint32_t window_id, uint32_t c0, uint32_t c1, const wchar_t *wstr, int wlen) {
    int utf8_len = (wstr != NULL && wlen > 0)
        ? WideCharToMultiByte(CP_UTF8, 0, wstr, wlen, NULL, 0, NULL, NULL)
        : 0;
    size_t total = align8(32u + (size_t)utf8_len);
    uint8_t *rec = (uint8_t *)malloc(total);
    if (rec == NULL) return;
    memset(rec, 0, total);
    write_u32(rec + 0, SGUI_EVT_IME_PREEDIT);
    write_u32(rec + 4, (uint32_t)total);
    write_u32(rec + 8, window_id);
    write_u32(rec + 12, 0u);
    write_u32(rec + 16, c0);
    write_u32(rec + 20, c1);
    write_u32(rec + 24, (uint32_t)utf8_len);
    write_u32(rec + 28, 0u);
    if (utf8_len > 0) {
        WideCharToMultiByte(CP_UTF8, 0, wstr, wlen, (char *)(rec + 32), utf8_len, NULL, NULL);
    }
    push_event_record(rec, total);
    free(rec);
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
/* Window Registry & Direct2D Drawing                                         */
/* -------------------------------------------------------------------------- */

typedef struct {
    uint32_t window_id;
    uint32_t flags;
    HWND hwnd;
    ID2D1HwndRenderTarget *rt;
    uint8_t *commands;
    size_t commands_len;
    size_t commands_cap;
    HCURSOR cursor;
    bool tracking_leave;
    uint32_t pressed_btn;
} SguiWindowEntry;

#define SGUI_MAX_WINDOWS 64

static SguiWindowEntry g_windows[SGUI_MAX_WINDOWS];
static uint32_t g_next_window_id = 1u;
static HMENU g_app_menu = NULL;

static SguiWindowEntry *find_window_entry(uint32_t window_id) {
    if (window_id == 0u) return NULL;
    for (size_t i = 0; i < SGUI_MAX_WINDOWS; i++) {
        if (g_windows[i].window_id == window_id) return &g_windows[i];
    }
    return NULL;
}

static SguiWindowEntry *find_window_by_hwnd(HWND hwnd) {
    for (size_t i = 0; i < SGUI_MAX_WINDOWS; i++) {
        if (g_windows[i].window_id != 0u && g_windows[i].hwnd == hwnd) return &g_windows[i];
    }
    return NULL;
}

static double window_scale(HWND hwnd) {
    UINT dpi = GetDpiForWindow(hwnd);
    return dpi > 0 ? (double)dpi / 96.0 : 1.0;
}

static bool is_dark_mode(void) {
    HKEY hkey = NULL;
    if (RegOpenKeyExW(
            HKEY_CURRENT_USER,
            L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
            0,
            KEY_READ,
            &hkey) == ERROR_SUCCESS) {
        DWORD val = 1;
        DWORD size = sizeof(val);
        if (RegQueryValueExW(hkey, L"AppsUseLightTheme", NULL, NULL, (LPBYTE)&val, &size) == ERROR_SUCCESS) {
            RegCloseKey(hkey);
            return val == 0;
        }
        RegCloseKey(hkey);
    }
    return false;
}

static void render_d2d(SguiWindowEntry *entry) {
    if (entry == NULL || entry->hwnd == NULL || g_d2d == NULL) return;
    RECT rc;
    GetClientRect(entry->hwnd, &rc);
    UINT32 px_w = (UINT32)(rc.right - rc.left);
    UINT32 px_h = (UINT32)(rc.bottom - rc.top);
    if (px_w == 0u || px_h == 0u) return;

    if (entry->rt == NULL) {
        D2D1_RENDER_TARGET_PROPERTIES rtp = D2D1::RenderTargetProperties();
        D2D1_HWND_RENDER_TARGET_PROPERTIES hrtp =
            D2D1::HwndRenderTargetProperties(entry->hwnd, D2D1::SizeU(px_w, px_h));
        if (FAILED(g_d2d->CreateHwndRenderTarget(rtp, hrtp, &entry->rt))) return;
        float dpi = (float)(window_scale(entry->hwnd) * 96.0);
        entry->rt->SetDpi(dpi, dpi);
    }

    ID2D1HwndRenderTarget *rt = entry->rt;
    ID2D1SolidColorBrush *brush = NULL;
    rt->CreateSolidColorBrush(D2D1::ColorF(0.0f, 0.0f, 0.0f, 1.0f), &brush);
    if (brush == NULL) return;

    rt->BeginDraw();
    int clip_depth = 0;
    const uint8_t *buf = entry->commands;
    size_t len = entry->commands_len;
    size_t off = 0u;
    while (buf != NULL && off + 8u <= len) {
        uint32_t op = read_u32(buf + off + 0u);
        uint32_t cmd_len = read_u32(buf + off + 4u);
        if (cmd_len < 8u || off + cmd_len > len) break;
        const uint8_t *cmd = buf + off;
        switch (op) {
            case SGUI_CMD_CLEAR: {
                if (cmd_len >= 16u) rt->Clear(d2d_color_from_rgba(read_u32(cmd + 8u)));
                break;
            }
            case SGUI_CMD_FILL_RECT: {
                if (cmd_len >= 56u) {
                    float x = (float)read_f64(cmd + 8u);
                    float y = (float)read_f64(cmd + 16u);
                    float w = (float)read_f64(cmd + 24u);
                    float h = (float)read_f64(cmd + 32u);
                    float rad = (float)read_f64(cmd + 40u);
                    brush->SetColor(d2d_color_from_rgba(read_u32(cmd + 48u)));
                    D2D1_RECT_F r = D2D1::RectF(x, y, x + w, y + h);
                    if (rad > 0.0f) {
                        rt->FillRoundedRectangle(D2D1::RoundedRect(r, rad, rad), brush);
                    } else {
                        rt->FillRectangle(r, brush);
                    }
                }
                break;
            }
            case SGUI_CMD_STROKE_RECT: {
                if (cmd_len >= 64u) {
                    float x = (float)read_f64(cmd + 8u);
                    float y = (float)read_f64(cmd + 16u);
                    float w = (float)read_f64(cmd + 24u);
                    float h = (float)read_f64(cmd + 32u);
                    float rad = (float)read_f64(cmd + 40u);
                    float sw = (float)read_f64(cmd + 48u);
                    brush->SetColor(d2d_color_from_rgba(read_u32(cmd + 56u)));
                    float inset = sw * 0.5f;
                    D2D1_RECT_F r = D2D1::RectF(x + inset, y + inset, x + w - inset, y + h - inset);
                    if (rad > 0.0f) {
                        rt->DrawRoundedRectangle(D2D1::RoundedRect(r, rad, rad), brush, sw);
                    } else {
                        rt->DrawRectangle(r, brush, sw);
                    }
                }
                break;
            }
            case SGUI_CMD_PUSH_CLIP: {
                if (cmd_len >= 40u) {
                    float x = (float)read_f64(cmd + 8u);
                    float y = (float)read_f64(cmd + 16u);
                    float w = (float)read_f64(cmd + 24u);
                    float h = (float)read_f64(cmd + 32u);
                    rt->PushAxisAlignedClip(D2D1::RectF(x, y, x + w, y + h), D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
                    clip_depth++;
                }
                break;
            }
            case SGUI_CMD_POP_CLIP: {
                if (clip_depth > 0) {
                    rt->PopAxisAlignedClip();
                    clip_depth--;
                }
                break;
            }
            case SGUI_CMD_DRAW_TEXT: {
                if (cmd_len >= 56u) {
                    float x = (float)read_f64(cmd + 8u);
                    float y = (float)read_f64(cmd + 16u);
                    double max_width = read_f64(cmd + 24u);
                    double font_size = read_f64(cmd + 32u);
                    uint32_t rgba = read_u32(cmd + 40u);
                    uint16_t family = read_u16(cmd + 44u);
                    uint16_t weight = read_u16(cmd + 46u);
                    uint32_t flags = read_u32(cmd + 48u);
                    uint32_t utf8_len = read_u32(cmd + 52u);
                    if (utf8_len > 0u && 56u + (size_t)utf8_len <= cmd_len) {
                        IDWriteTextLayout *layout = create_dw_layout(
                            family, font_size, weight, flags, max_width, cmd + 56u, utf8_len
                        );
                        if (layout != NULL) {
                            brush->SetColor(d2d_color_from_rgba(rgba));
                            rt->DrawTextLayout(D2D1::Point2F(x, y), layout, brush);
                            layout->Release();
                        }
                    }
                }
                break;
            }
            case SGUI_CMD_DRAW_LINE: {
                if (cmd_len >= 56u) {
                    float x1 = (float)read_f64(cmd + 8u);
                    float y1 = (float)read_f64(cmd + 16u);
                    float x2 = (float)read_f64(cmd + 24u);
                    float y2 = (float)read_f64(cmd + 32u);
                    float sw = (float)read_f64(cmd + 40u);
                    brush->SetColor(d2d_color_from_rgba(read_u32(cmd + 48u)));
                    rt->DrawLine(D2D1::Point2F(x1, y1), D2D1::Point2F(x2, y2), brush, sw);
                }
                break;
            }
            case SGUI_CMD_DRAW_IMAGE_RGBA: {
                if (cmd_len >= 56u) {
                    float x = (float)read_f64(cmd + 8u);
                    float y = (float)read_f64(cmd + 16u);
                    float w = (float)read_f64(cmd + 24u);
                    float h = (float)read_f64(cmd + 32u);
                    uint32_t img_w = read_u32(cmd + 48u);
                    uint32_t img_h = read_u32(cmd + 52u);
                    size_t byte_size = (size_t)img_w * (size_t)img_h * 4u;
                    if (img_w > 0u && img_h > 0u && 56u + byte_size <= cmd_len) {
                        D2D1_BITMAP_PROPERTIES bp = D2D1::BitmapProperties(
                            D2D1::PixelFormat(DXGI_FORMAT_R8G8B8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED)
                        );
                        ID2D1Bitmap *bmp = NULL;
                        if (SUCCEEDED(rt->CreateBitmap(D2D1::SizeU(img_w, img_h), cmd + 56u, img_w * 4u, bp, &bmp))) {
                            rt->DrawBitmap(bmp, D2D1::RectF(x, y, x + w, y + h));
                            bmp->Release();
                        }
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
        rt->PopAxisAlignedClip();
        clip_depth--;
    }

    HRESULT hr = rt->EndDraw();
    brush->Release();
    if (hr == D2DERR_RECREATE_TARGET) {
        rt->Release();
        entry->rt = NULL;
    }
}

static const char *map_vk_name(WPARAM vk, char *scratch, size_t cap) {
    switch (vk) {
        case VK_RETURN: return "enter";
        case VK_TAB: return "tab";
        case VK_SPACE: return "space";
        case VK_BACK: return "backspace";
        case VK_ESCAPE: return "escape";
        case VK_DELETE: return "delete";
        case VK_HOME: return "home";
        case VK_END: return "end";
        case VK_PRIOR: return "pageUp";
        case VK_NEXT: return "pageDown";
        case VK_LEFT: return "left";
        case VK_RIGHT: return "right";
        case VK_UP: return "up";
        case VK_DOWN: return "down";
        default: break;
    }
    if (vk >= 'A' && vk <= 'Z') {
        scratch[0] = (char)(vk + 32);
        scratch[1] = '\0';
        return scratch;
    }
    if (vk >= '0' && vk <= '9') {
        scratch[0] = (char)vk;
        scratch[1] = '\0';
        return scratch;
    }
    snprintf(scratch, cap, "vk%u", (unsigned)vk);
    return scratch;
}

static LRESULT CALLBACK sgui_wnd_proc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    SguiWindowEntry *entry = find_window_by_hwnd(hwnd);
    if (entry == NULL) return DefWindowProcW(hwnd, msg, wp, lp);
    double scale = window_scale(hwnd);

    switch (msg) {
        case WM_CLOSE:
            push_evt_simple(SGUI_EVT_CLOSE, entry->window_id, 0u);
            return 0;
        case WM_SIZE: {
            UINT w = LOWORD(lp);
            UINT h = HIWORD(lp);
            if (entry->rt != NULL) entry->rt->Resize(D2D1::SizeU(w, h));
            push_evt_resize(entry->window_id, (double)w / scale, (double)h / scale, scale);
            return 0;
        }
        case WM_SETFOCUS:
        case WM_KILLFOCUS:
            push_evt_focus(entry->window_id, msg == WM_SETFOCUS ? 1u : 0u, is_dark_mode() ? 1u : 0u);
            return 0;
        case WM_PAINT: {
            PAINTSTRUCT ps;
            BeginPaint(hwnd, &ps);
            render_d2d(entry);
            EndPaint(hwnd, &ps);
            return 0;
        }
        case WM_SETCURSOR:
            if (LOWORD(lp) == HTCLIENT && entry->cursor != NULL) {
                SetCursor(entry->cursor);
                return TRUE;
            }
            break;
        case WM_LBUTTONDOWN:
        case WM_MBUTTONDOWN:
        case WM_RBUTTONDOWN: {
            SetFocus(hwnd);
            SetCapture(hwnd);
            uint32_t btn = (msg == WM_LBUTTONDOWN) ? SGUI_BTN_LEFT : (msg == WM_RBUTTONDOWN ? SGUI_BTN_RIGHT : SGUI_BTN_MIDDLE);
            entry->pressed_btn = btn;
            push_evt_pointer(
                entry->window_id, current_mods(), SGUI_PTR_DOWN, btn, 1u,
                (double)GET_X_LPARAM(lp) / scale, (double)GET_Y_LPARAM(lp) / scale
            );
            return 0;
        }
        case WM_LBUTTONUP:
        case WM_MBUTTONUP:
        case WM_RBUTTONUP: {
            ReleaseCapture();
            uint32_t btn = (msg == WM_LBUTTONUP) ? SGUI_BTN_LEFT : (msg == WM_RBUTTONUP ? SGUI_BTN_RIGHT : SGUI_BTN_MIDDLE);
            entry->pressed_btn = SGUI_BTN_NONE;
            push_evt_pointer(
                entry->window_id, current_mods(), SGUI_PTR_UP, btn, 1u,
                (double)GET_X_LPARAM(lp) / scale, (double)GET_Y_LPARAM(lp) / scale
            );
            return 0;
        }
        case WM_MOUSEMOVE: {
            if (!entry->tracking_leave) {
                TRACKMOUSEEVENT tme = {sizeof(TRACKMOUSEEVENT), TME_LEAVE, hwnd, 0};
                TrackMouseEvent(&tme);
                entry->tracking_leave = true;
            }
            uint32_t phase = entry->pressed_btn != SGUI_BTN_NONE ? SGUI_PTR_DRAG : SGUI_PTR_MOVE;
            push_evt_pointer(
                entry->window_id, current_mods(), phase, entry->pressed_btn, 0u,
                (double)GET_X_LPARAM(lp) / scale, (double)GET_Y_LPARAM(lp) / scale
            );
            return 0;
        }
        case WM_MOUSELEAVE:
            entry->tracking_leave = false;
            push_evt_pointer(entry->window_id, 0u, SGUI_PTR_LEAVE, SGUI_BTN_NONE, 0u, 0.0, 0.0);
            return 0;
        case WM_MOUSEWHEEL: {
            POINT pt = {GET_X_LPARAM(lp), GET_Y_LPARAM(lp)};
            ScreenToClient(hwnd, &pt);
            double dy = -(double)GET_WHEEL_DELTA_WPARAM(wp) / (double)WHEEL_DELTA * 40.0;
            push_evt_scroll(entry->window_id, current_mods(), (double)pt.x / scale, (double)pt.y / scale, 0.0, dy);
            return 0;
        }
        case WM_KEYDOWN:
        case WM_SYSKEYDOWN: {
            char scratch[32];
            uint32_t phase = (lp & (1 << 30)) != 0 ? SGUI_KEY_REPEAT : SGUI_KEY_DOWN;
            push_evt_key(entry->window_id, current_mods(), phase, (uint32_t)wp, map_vk_name(wp, scratch, sizeof(scratch)));
            return 0;
        }
        case WM_KEYUP:
        case WM_SYSKEYUP: {
            char scratch[32];
            push_evt_key(entry->window_id, current_mods(), SGUI_KEY_UP, (uint32_t)wp, map_vk_name(wp, scratch, sizeof(scratch)));
            return 0;
        }
        case WM_CHAR: {
            if (wp >= 32 && wp != 127 && (current_mods() & (SGUI_MOD_CTRL | SGUI_MOD_SUPER)) == 0u) {
                wchar_t ch = (wchar_t)wp;
                push_evt_text_wide(entry->window_id, 0u, &ch, 1);
            }
            return 0;
        }
        case WM_IME_COMPOSITION: {
            if ((lp & GCS_COMPSTR) != 0) {
                HIMC himc = ImmGetContext(hwnd);
                if (himc != NULL) {
                    LONG bytes = ImmGetCompositionStringW(himc, GCS_COMPSTR, NULL, 0);
                    if (bytes > 0) {
                        wchar_t *buf = (wchar_t *)malloc((size_t)bytes + sizeof(wchar_t));
                        if (buf != NULL) {
                            ImmGetCompositionStringW(himc, GCS_COMPSTR, buf, (DWORD)bytes);
                            int wlen = (int)(bytes / (LONG)sizeof(wchar_t));
                            LONG cur = ImmGetCompositionStringW(himc, GCS_CURSORPOS, NULL, 0);
                            uint32_t cpos = cur >= 0 ? (uint32_t)cur : 0u;
                            push_evt_ime_wide(entry->window_id, cpos, cpos, buf, wlen);
                            free(buf);
                        }
                    } else {
                        push_evt_ime_wide(entry->window_id, 0u, 0u, NULL, 0);
                    }
                    ImmReleaseContext(hwnd, himc);
                }
            }
            break;
        }
        case WM_COMMAND:
            if (HIWORD(wp) == 0 && LOWORD(wp) > 0) {
                push_evt_menu((uint32_t)LOWORD(wp));
                return 0;
            }
            break;
        default:
            break;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

int32_t sgui_init(void) {
    if (g_initialized) return 0;
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    ensure_event_buf();
    D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, &g_d2d);
    ensure_dwrite();
    WNDCLASSEXW wc = {};
    wc.cbSize = sizeof(wc);
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = sgui_wnd_proc;
    wc.hInstance = GetModuleHandleW(NULL);
    wc.hCursor = LoadCursorW(NULL, IDC_ARROW);
    wc.lpszClassName = L"SguiWindowClass";
    RegisterClassExW(&wc);
    g_initialized = true;
    return 0;
}

void sgui_shutdown(void) {
    for (size_t i = 0; i < SGUI_MAX_WINDOWS; i++) {
        if (g_windows[i].window_id != 0u) sgui_window_destroy(g_windows[i].window_id);
    }
    if (g_app_menu != NULL) {
        DestroyMenu(g_app_menu);
        g_app_menu = NULL;
    }
    if (g_dwrite != NULL) { g_dwrite->Release(); g_dwrite = NULL; }
    if (g_d2d != NULL) { g_d2d->Release(); g_d2d = NULL; }
    free(g_event_buf);
    g_event_buf = NULL;
    g_event_head = 0u;
    g_event_tail = 0u;
    g_initialized = false;
}

uint32_t sgui_window_create(const uint8_t *title, size_t title_len, double width, double height, uint32_t flags) {
    if (!g_initialized && sgui_init() != 0) return 0u;
    size_t slot = SGUI_MAX_WINDOWS;
    for (size_t i = 0; i < SGUI_MAX_WINDOWS; i++) {
        if (g_windows[i].window_id == 0u) { slot = i; break; }
    }
    if (slot == SGUI_MAX_WINDOWS) return 0u;

    uint32_t window_id = g_next_window_id++;
    if (window_id == 0u) window_id = g_next_window_id++;

    DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
    if ((flags & SGUI_WIN_RESIZABLE) != 0u) style |= WS_THICKFRAME | WS_MAXIMIZEBOX;

    wchar_t *wtitle = utf8_to_wide(title, title_len, NULL);
    HWND hwnd = CreateWindowExW(
        0,
        L"SguiWindowClass",
        wtitle != NULL ? wtitle : L"Pi",
        style,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        (int)llround(width),
        (int)llround(height),
        NULL,
        g_app_menu,
        GetModuleHandleW(NULL),
        NULL
    );
    free(wtitle);
    if (hwnd == NULL) return 0u;

    g_windows[slot] = {};
    g_windows[slot].window_id = window_id;
    g_windows[slot].flags = flags;
    g_windows[slot].hwnd = hwnd;
    g_windows[slot].cursor = LoadCursorW(NULL, IDC_ARROW);

    if (is_dark_mode()) {
        BOOL dark = TRUE;
        DwmSetWindowAttribute(hwnd, 20, &dark, sizeof(dark));
    }

    ShowWindow(hwnd, SW_SHOW);
    UpdateWindow(hwnd);
    double scale = window_scale(hwnd);
    push_evt_resize(window_id, width, height, scale);
    push_evt_focus(window_id, GetForegroundWindow() == hwnd ? 1u : 0u, is_dark_mode() ? 1u : 0u);
    return window_id;
}

void sgui_window_destroy(uint32_t window_id) {
    SguiWindowEntry *entry = find_window_entry(window_id);
    if (entry == NULL) return;
    if (entry->rt != NULL) entry->rt->Release();
    if (entry->hwnd != NULL) DestroyWindow(entry->hwnd);
    free(entry->commands);
    memset(entry, 0, sizeof(*entry));
}

void sgui_window_set_title(uint32_t window_id, const uint8_t *title, size_t title_len) {
    SguiWindowEntry *entry = find_window_entry(window_id);
    if (entry == NULL || entry->hwnd == NULL) return;
    wchar_t *wtitle = utf8_to_wide(title, title_len, NULL);
    if (wtitle != NULL) {
        SetWindowTextW(entry->hwnd, wtitle);
        free(wtitle);
    }
}

int32_t sgui_window_get_metrics(uint32_t window_id, uint8_t *out_metrics, size_t out_len) {
    if (out_metrics == NULL || out_len < SGUI_WINDOW_METRICS_SIZE) return -1;
    SguiWindowEntry *entry = find_window_entry(window_id);
    if (entry == NULL || entry->hwnd == NULL) return -1;
    RECT rc;
    GetClientRect(entry->hwnd, &rc);
    double scale = window_scale(entry->hwnd);
    write_f64(out_metrics + 0u, (double)(rc.right - rc.left) / scale);
    write_f64(out_metrics + 8u, (double)(rc.bottom - rc.top) / scale);
    write_f64(out_metrics + 16u, scale);
    write_f64(out_metrics + 24u, 0.0);
    write_f64(out_metrics + 32u, 0.0);
    write_u32(out_metrics + 40u, is_dark_mode() ? 1u : 0u);
    write_u32(out_metrics + 44u, GetForegroundWindow() == entry->hwnd ? 1u : 0u);
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
    IDWriteTextLayout *layout = create_dw_layout(
        font_family, font_size, font_weight, font_flags, max_width, text, text_len
    );
    if (layout == NULL) return -1;
    DWRITE_TEXT_METRICS tm = {};
    layout->GetMetrics(&tm);
    DWRITE_LINE_METRICS lm = {};
    UINT32 lines = 1;
    layout->GetLineMetrics(&lm, 1, &lines);
    double lh = tm.lineCount > 0 ? tm.height / (double)tm.lineCount : ceil(font_size * 1.25);
    double baseline = lm.baseline > 0.0f ? (double)lm.baseline : font_size;
    layout->Release();
    write_f64(out_metrics + 0u, (double)tm.widthIncludingTrailingWhitespace);
    write_f64(out_metrics + 8u, (double)tm.height);
    write_f64(out_metrics + 16u, lh);
    write_f64(out_metrics + 24u, baseline);
    write_u32(out_metrics + 32u, tm.lineCount > 0 ? tm.lineCount : 1u);
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
    IDWriteTextLayout *layout = create_dw_layout(font_family, font_size, font_weight, font_flags, 0.0, line, line_len);
    if (layout == NULL) return 0.0;
    UINT32 u16_pos = utf8_byte_to_utf16(line, line_len, byte_offset);
    FLOAT x = 0.0f, y = 0.0f;
    DWRITE_HIT_TEST_METRICS htm = {};
    layout->HitTestTextPosition(u16_pos, FALSE, &x, &y, &htm);
    layout->Release();
    return (double)x;
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
    IDWriteTextLayout *layout = create_dw_layout(font_family, font_size, font_weight, font_flags, 0.0, line, line_len);
    if (layout == NULL) return 0u;
    BOOL is_trailing = FALSE;
    BOOL is_inside = FALSE;
    DWRITE_HIT_TEST_METRICS htm = {};
    layout->HitTestPoint((FLOAT)x, 0.0f, &is_trailing, &is_inside, &htm);
    layout->Release();
    UINT32 u16_idx = htm.textPosition + (is_trailing ? htm.length : 0u);
    return utf16_to_utf8_byte(line, line_len, u16_idx);
}

int32_t sgui_present(uint32_t window_id, const uint8_t *commands, size_t commands_len) {
    SguiWindowEntry *entry = find_window_entry(window_id);
    if (entry == NULL || entry->hwnd == NULL) return -1;
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
    render_d2d(entry);
    ValidateRect(entry->hwnd, NULL);
    return 0;
}

int32_t sgui_poll_events(uint32_t wait_ms, uint8_t *out_events, size_t out_cap) {
    if (!g_initialized) return 0;
    if (wait_ms > 0u && g_event_head == g_event_tail) {
        MsgWaitForMultipleObjects(0, NULL, FALSE, (DWORD)wait_ms, QS_ALLINPUT);
    }
    MSG msg;
    while (PeekMessageW(&msg, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
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

int32_t sgui_clipboard_get_text(uint8_t *out_utf8, size_t out_cap) {
    if (!OpenClipboard(NULL)) return -1;
    HANDLE hdata = GetClipboardData(CF_UNICODETEXT);
    if (hdata == NULL) { CloseClipboard(); return -1; }
    const wchar_t *wstr = (const wchar_t *)GlobalLock(hdata);
    if (wstr == NULL) { CloseClipboard(); return -1; }
    int utf8_len = WideCharToMultiByte(CP_UTF8, 0, wstr, -1, NULL, 0, NULL, NULL);
    int32_t result = -1;
    if (utf8_len > 0) {
        size_t len = (size_t)(utf8_len - 1);
        if (out_utf8 != NULL && out_cap >= len && len > 0u) {
            WideCharToMultiByte(CP_UTF8, 0, wstr, (int)wcslen(wstr), (char *)out_utf8, (int)len, NULL, NULL);
        }
        result = (int32_t)len;
    }
    GlobalUnlock(hdata);
    CloseClipboard();
    return result;
}

int32_t sgui_clipboard_set_text(const uint8_t *text, size_t text_len) {
    int wlen = 0;
    wchar_t *wstr = utf8_to_wide(text, text_len, &wlen);
    if (wstr == NULL) return -1;
    if (!OpenClipboard(NULL)) { free(wstr); return -1; }
    EmptyClipboard();
    SIZE_T bytes = (SIZE_T)(wlen + 1) * sizeof(wchar_t);
    HGLOBAL hmem = GlobalAlloc(GMEM_MOVEABLE, bytes);
    if (hmem != NULL) {
        void *dst = GlobalLock(hmem);
        if (dst != NULL) {
            memcpy(dst, wstr, bytes);
            GlobalUnlock(hmem);
            SetClipboardData(CF_UNICODETEXT, hmem);
        } else {
            GlobalFree(hmem);
        }
    }
    CloseClipboard();
    free(wstr);
    return 0;
}

void sgui_set_cursor(uint32_t window_id, uint32_t cursor_kind) {
    SguiWindowEntry *entry = find_window_entry(window_id);
    if (entry == NULL) return;
    LPCWSTR idc = IDC_ARROW;
    switch (cursor_kind) {
        case SGUI_CURSOR_IBEAM: idc = IDC_IBEAM; break;
        case SGUI_CURSOR_POINTER: idc = IDC_HAND; break;
        case SGUI_CURSOR_RESIZE_EW: idc = IDC_SIZEWE; break;
        case SGUI_CURSOR_RESIZE_NS: idc = IDC_SIZENS; break;
        default: idc = IDC_ARROW; break;
    }
    entry->cursor = LoadCursorW(NULL, idc);
    SetCursor(entry->cursor);
}

void sgui_set_ime_rect(uint32_t window_id, double x, double y, double width, double height) {
    (void)width;
    SguiWindowEntry *entry = find_window_entry(window_id);
    if (entry == NULL || entry->hwnd == NULL) return;
    double scale = window_scale(entry->hwnd);
    HIMC himc = ImmGetContext(entry->hwnd);
    if (himc == NULL) return;
    COMPOSITIONFORM cf = {};
    cf.dwStyle = CFS_POINT;
    cf.ptCurrentPos.x = (LONG)llround(x * scale);
    cf.ptCurrentPos.y = (LONG)llround((y + height) * scale);
    ImmSetCompositionWindow(himc, &cf);
    ImmReleaseContext(entry->hwnd, himc);
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

static wchar_t *menu_read_wide(SguiMenuReader *r, bool *ok) {
    uint32_t slen = 0u;
    if (!menu_read_u32(r, &slen) || r->pos + slen > r->len) {
        *ok = false;
        return NULL;
    }
    wchar_t *w = utf8_to_wide(r->data + r->pos, slen, NULL);
    r->pos += slen;
    if (w == NULL) *ok = false;
    return w;
}

static bool populate_hmenu(HMENU menu, SguiMenuReader *r, uint32_t count) {
    for (uint32_t i = 0; i < count; i++) {
        uint32_t kind = 0, item_id = 0, flags = 0, role = 0;
        if (!menu_read_u32(r, &kind) ||
            !menu_read_u32(r, &item_id) ||
            !menu_read_u32(r, &flags) ||
            !menu_read_u32(r, &role)) {
            return false;
        }
        (void)role;
        bool ok = true;
        wchar_t *label = menu_read_wide(r, &ok);
        wchar_t *shortcut = menu_read_wide(r, &ok);
        uint32_t sub_count = 0u;
        if (!ok || (kind == SGUI_MENU_ITEM_SUBMENU && !menu_read_u32(r, &sub_count))) {
            free(label);
            free(shortcut);
            return false;
        }
        if (kind == SGUI_MENU_ITEM_SEPARATOR) {
            AppendMenuW(menu, MF_SEPARATOR, 0, NULL);
        } else if (kind == SGUI_MENU_ITEM_SUBMENU) {
            HMENU sub = CreatePopupMenu();
            if (!populate_hmenu(sub, r, sub_count)) {
                DestroyMenu(sub);
                free(label);
                free(shortcut);
                return false;
            }
            AppendMenuW(menu, MF_POPUP, (UINT_PTR)sub, label);
        } else {
            UINT mf = MF_STRING;
            if ((flags & SGUI_MENU_FLAG_DISABLED) != 0u) mf |= MF_GRAYED;
            if ((flags & SGUI_MENU_FLAG_CHECKED) != 0u) mf |= MF_CHECKED;
            AppendMenuW(menu, mf, (UINT_PTR)item_id, label);
        }
        free(label);
        free(shortcut);
    }
    return true;
}

int32_t sgui_set_app_menu(const uint8_t *spec, size_t spec_len) {
    if (!g_initialized && sgui_init() != 0) return -1;
    if (spec == NULL || spec_len < 4u) return -1;
    SguiMenuReader r = {.data = spec, .len = spec_len, .pos = 0u};
    uint32_t menu_count = 0u;
    if (!menu_read_u32(&r, &menu_count)) return -1;

    HMENU bar = CreateMenu();
    for (uint32_t m = 0; m < menu_count; m++) {
        bool ok = true;
        wchar_t *title = menu_read_wide(&r, &ok);
        uint32_t item_count = 0u;
        if (!ok || !menu_read_u32(&r, &item_count)) {
            free(title);
            DestroyMenu(bar);
            return -1;
        }
        HMENU sub = CreatePopupMenu();
        if (!populate_hmenu(sub, &r, item_count)) {
            DestroyMenu(sub);
            free(title);
            DestroyMenu(bar);
            return -1;
        }
        AppendMenuW(bar, MF_POPUP, (UINT_PTR)sub, title);
        free(title);
    }

    if (g_app_menu != NULL) DestroyMenu(g_app_menu);
    g_app_menu = bar;
    for (size_t i = 0; i < SGUI_MAX_WINDOWS; i++) {
        if (g_windows[i].window_id != 0u && g_windows[i].hwnd != NULL) {
            SetMenu(g_windows[i].hwnd, bar);
            DrawMenuBar(g_windows[i].hwnd);
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

#ifdef __cplusplus
}
#endif
