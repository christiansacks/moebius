const {tools, toolbar} = require("../ui/ui");
const keyboard = require("../input/keyboard");
const mouse = require("../input/mouse");
const doc = require("../doc");
const {font_char_to_blocks} = require("../../libtextmode/tdf");
const {EventEmitter} = require("events");

const font_tool = new EventEmitter();

let enabled = false;
let cursor_x = 0, cursor_y = 0;
let line_origin_x = 0;  // x where current line started (for wrap)
let current_font = null; // {name, type, spacing, block_size, chars}
let override_fg = 7, override_bg = 0;
let stamp_history = []; // [{x, y, columns, rows}] for backspace undo

function is_color_font() { return current_font && current_font.type === 2; }

function set_font(font) {
    current_font = font;
    stamp_history = [];
    font_tool.emit("font_changed", font);
}

function set_colors(fg, bg) { override_fg = fg; override_bg = bg; }

function get_char_rows(char_code) {
    if (!current_font) return null;
    const rows = current_font.chars.get(char_code);
    if (!rows) return null;
    return rows;
}

function char_width(char_code) {
    const rows = get_char_rows(char_code);
    if (!rows) return 0;
    return Math.max(...rows.map(r => r.length));
}

function stamp_char(char_code) {
    if (!current_font) return;
    const rows = get_char_rows(char_code);
    const block_size = current_font.block_size || 8;
    const spacing = current_font.spacing || 1;

    if (!rows) {
        // Undefined character: advance by block_size/2 or spacing as space
        cursor_x += spacing + 1;
        check_wrap(0, block_size);
        return;
    }

    const width = Math.max(...rows.map(r => r.length));

    // Wrap before stamping if needed
    if (cursor_x + width > doc.columns) {
        cursor_x = line_origin_x;
        cursor_y += block_size;
    }
    if (cursor_y + block_size > doc.rows) return; // off canvas

    const blocks = font_char_to_blocks(rows, block_size, override_fg, override_bg, is_color_font());

    doc.start_undo();
    doc.place(blocks, cursor_x, cursor_y);

    stamp_history.push({x: cursor_x, y: cursor_y, columns: width, rows: block_size});
    cursor_x += width + spacing;
    font_tool.emit("cursor_moved", cursor_x, cursor_y);
}

function check_wrap(width, block_size) {
    if (cursor_x + width > doc.columns) {
        cursor_x = line_origin_x;
        cursor_y += block_size;
    }
}

function backspace_char() {
    if (stamp_history.length === 0) return;
    const last = stamp_history.pop();
    // Erase the stamped region with transparent/blank cells
    doc.start_undo();
    doc.erase(last.x, last.y, last.x + last.columns - 1, last.y + last.rows - 1);
    cursor_x = last.x;
    cursor_y = last.y;
    font_tool.emit("cursor_moved", cursor_x, cursor_y);
}

function new_line() {
    if (!current_font) return;
    const block_size = current_font.block_size || 8;
    cursor_x = line_origin_x;
    cursor_y += block_size;
    stamp_history = []; // can't backspace past a newline
    font_tool.emit("cursor_moved", cursor_x, cursor_y);
}

tools.on("start", (mode) => {
    enabled = (mode === tools.modes.FONT);
    if (enabled) {
        stamp_history = [];
        toolbar.show_font();
    }
    font_tool.emit("enabled", enabled);
});

mouse.on("down", (x, y, half_y, is_legal) => {
    if (!enabled || !is_legal) return;
    cursor_x = x;
    cursor_y = y;
    line_origin_x = x;
    stamp_history = [];
    font_tool.emit("cursor_moved", cursor_x, cursor_y);
});

keyboard.on("key_typed", (code) => {
    if (!enabled) return;
    stamp_char(code);
});

keyboard.on("backspace", () => {
    if (!enabled) return;
    backspace_char();
});

keyboard.on("new_line", () => {
    if (!enabled) return;
    new_line();
});

module.exports = {font_tool, set_font, set_colors, get_cursor: () => ({x: cursor_x, y: cursor_y}), is_color_font};
