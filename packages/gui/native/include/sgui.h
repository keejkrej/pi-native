#ifndef SGUI_H
#define SGUI_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Window creation flags */
#define SGUI_WIN_TITLEBAR_HIDDEN   1u
#define SGUI_WIN_RESIZABLE         2u
#define SGUI_WIN_UNIFIED_TITLEBAR  4u

/* Font families and style flags */
#define SGUI_FONT_REGULAR          0u
#define SGUI_FONT_MONO             1u

#define SGUI_FONT_FLAG_ITALIC         1u
#define SGUI_FONT_FLAG_UNDERLINE      2u
#define SGUI_FONT_FLAG_STRIKETHROUGH  4u

/* Cursor kinds */
#define SGUI_CURSOR_ARROW          0u
#define SGUI_CURSOR_IBEAM          1u
#define SGUI_CURSOR_POINTER        2u
#define SGUI_CURSOR_RESIZE_EW      3u
#define SGUI_CURSOR_RESIZE_NS      4u

/* Modifier bitmask */
#define SGUI_MOD_SHIFT             1u
#define SGUI_MOD_CTRL              2u
#define SGUI_MOD_ALT               4u
#define SGUI_MOD_SUPER             8u

/* Draw opcodes (all commands padded to 8-byte alignment) */
#define SGUI_CMD_CLEAR             1u
#define SGUI_CMD_FILL_RECT         2u
#define SGUI_CMD_STROKE_RECT       3u
#define SGUI_CMD_PUSH_CLIP         4u
#define SGUI_CMD_POP_CLIP          5u
#define SGUI_CMD_DRAW_TEXT         6u
#define SGUI_CMD_DRAW_LINE         7u
#define SGUI_CMD_DRAW_IMAGE_RGBA   8u

/* Event kinds (all events padded to 8-byte alignment) */
#define SGUI_EVT_CLOSE             1u
#define SGUI_EVT_RESIZE            2u
#define SGUI_EVT_FOCUS             3u
#define SGUI_EVT_POINTER           4u
#define SGUI_EVT_SCROLL            5u
#define SGUI_EVT_KEY               6u
#define SGUI_EVT_TEXT              7u
#define SGUI_EVT_IME_PREEDIT       8u
#define SGUI_EVT_MENU              9u
#define SGUI_EVT_A11Y_ACTION       10u

/* Accessibility roles */
#define SGUI_A11Y_ROLE_GROUP       0u
#define SGUI_A11Y_ROLE_BUTTON      1u
#define SGUI_A11Y_ROLE_TEXT_FIELD  2u
#define SGUI_A11Y_ROLE_TEXT_AREA   3u
#define SGUI_A11Y_ROLE_CHECKBOX    4u
#define SGUI_A11Y_ROLE_SLIDER      5u
#define SGUI_A11Y_ROLE_RADIO_GROUP 6u
#define SGUI_A11Y_ROLE_LIST        7u
#define SGUI_A11Y_ROLE_STATIC_TEXT 8u

/* Accessibility state flags */
#define SGUI_A11Y_STATE_ENABLED    1u
#define SGUI_A11Y_STATE_FOCUSED    2u
#define SGUI_A11Y_STATE_CHECKED    4u
#define SGUI_A11Y_STATE_SELECTED   8u

/* Accessibility actions */
#define SGUI_A11Y_ACT_PRESS        1u
#define SGUI_A11Y_ACT_FOCUS        2u
#define SGUI_A11Y_ACT_SET_VALUE    3u
#define SGUI_A11Y_ACT_INCREMENT    4u
#define SGUI_A11Y_ACT_DECREMENT    5u

/* Pointer phases & buttons */
#define SGUI_PTR_MOVE              0u
#define SGUI_PTR_DOWN              1u
#define SGUI_PTR_UP                2u
#define SGUI_PTR_DRAG              3u
#define SGUI_PTR_LEAVE             4u

#define SGUI_BTN_NONE              0u
#define SGUI_BTN_LEFT              1u
#define SGUI_BTN_MIDDLE            2u
#define SGUI_BTN_RIGHT             3u

/* Key phases */
#define SGUI_KEY_DOWN              1u
#define SGUI_KEY_UP                2u
#define SGUI_KEY_REPEAT            3u

/* Window metrics buffer size: 48 bytes
 *   [0..8]   f64 width
 *   [8..16]  f64 height
 *   [16..24] f64 scale
 *   [24..32] f64 insetLeft
 *   [32..40] f64 titlebarHeight
 *   [40..44] u32 darkMode (0 or 1)
 *   [44..48] u32 focused  (0 or 1)
 */
#define SGUI_WINDOW_METRICS_SIZE   48u

/* Text metrics buffer size: 36 bytes
 *   [0..8]   f64 width
 *   [8..16]  f64 height
 *   [16..24] f64 lineHeight
 *   [24..32] f64 baseline
 *   [32..36] u32 lineCount
 */
#define SGUI_TEXT_METRICS_SIZE     36u

/* Menu item kinds & roles */
#define SGUI_MENU_ITEM_ACTION      0u
#define SGUI_MENU_ITEM_SEPARATOR   1u
#define SGUI_MENU_ITEM_SUBMENU     2u

#define SGUI_MENU_FLAG_DISABLED    1u
#define SGUI_MENU_FLAG_CHECKED     2u

#define SGUI_MENU_ROLE_NONE        0u
#define SGUI_MENU_ROLE_ABOUT       1u
#define SGUI_MENU_ROLE_HIDE        2u
#define SGUI_MENU_ROLE_QUIT        3u
#define SGUI_MENU_ROLE_UNDO        4u
#define SGUI_MENU_ROLE_REDO        5u
#define SGUI_MENU_ROLE_CUT         6u
#define SGUI_MENU_ROLE_COPY        7u
#define SGUI_MENU_ROLE_PASTE       8u
#define SGUI_MENU_ROLE_SELECT_ALL  9u
#define SGUI_MENU_ROLE_MINIMIZE    10u
#define SGUI_MENU_ROLE_ZOOM        11u
#define SGUI_MENU_ROLE_CLOSE       12u
#define SGUI_MENU_ROLE_FULLSCREEN  13u

int32_t sgui_init(void);
void sgui_shutdown(void);

uint32_t sgui_window_create(
    const uint8_t *title,
    size_t title_len,
    double width,
    double height,
    uint32_t flags
);
void sgui_window_destroy(uint32_t window_id);
void sgui_window_set_title(uint32_t window_id, const uint8_t *title, size_t title_len);
int32_t sgui_window_get_metrics(uint32_t window_id, uint8_t *out_metrics, size_t out_len);

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
);
double sgui_text_caret_x(
    uint32_t font_family,
    double font_size,
    uint32_t font_weight,
    uint32_t font_flags,
    const uint8_t *line,
    size_t line_len,
    uint32_t byte_offset
);
uint32_t sgui_text_hit_index(
    uint32_t font_family,
    double font_size,
    uint32_t font_weight,
    uint32_t font_flags,
    const uint8_t *line,
    size_t line_len,
    double x
);

int32_t sgui_present(uint32_t window_id, const uint8_t *commands, size_t commands_len);
int32_t sgui_poll_events(uint32_t wait_ms, uint8_t *out_events, size_t out_cap);

/* Returns full UTF-8 byte length on success (copies min(N, out_cap) bytes if out_utf8 != NULL),
 * or -1 if clipboard has no UTF-8 text / failed. */
int32_t sgui_clipboard_get_text(uint8_t *out_utf8, size_t out_cap);
int32_t sgui_clipboard_set_text(const uint8_t *text, size_t text_len);

void sgui_set_cursor(uint32_t window_id, uint32_t cursor_kind);
void sgui_set_ime_rect(uint32_t window_id, double x, double y, double width, double height);
int32_t sgui_set_app_menu(const uint8_t *spec, size_t spec_len);
int32_t sgui_set_a11y_tree(uint32_t window_id, const uint8_t *nodes, size_t nodes_len);

#ifdef __cplusplus
}
#endif

#endif
