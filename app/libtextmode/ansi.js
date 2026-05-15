const {ega, c64, palette_256} = require("./palette");
const {Textmode, add_sauce_for_ans} = require("./textmode");
const {cp437_to_unicode_bytes} = require("./encodings");

const sequence_type = {UNKNOWN: 0, UP: "A", DOWN: "B", RIGHT: "C", LEFT: "D", MOVE: "H", MOVE_ALT: "f", ERASE_DISPLAY: "J", ERASE_LINE: "K", SGR: "m", SAVE_POS: "s", TRUE_COLOR: "t", RESTORE_POS: "u"};
const token_type = {ESCAPE_SEQUENCE: 0, LITERAL: 1};
const ascii = {NEW_LINE: 10, CARRIAGE_RETURN: 13, ESCAPE: 27, SPACE: 32, ZERO: 48, NINE: 57, COLON: 58, SEMI_COLON: 59, AT_SYMBOL: 64, OPEN_SQUARE_BRACKET: 91, TILDA: 126};

class EscapeSequence {
    constructor() {
        this.no_value = true;
        this.type = sequence_type.UNKNOWN;
        this.values = [];
    }

    append_numeric(num) {
        if (this.no_value) {
            this.values.push(0);
            this.no_value = false;
        }
        this.values[this.values.length - 1] *= 10;
        this.values[this.values.length - 1] += num;
    }

    set_defaults(default_value, size_limit) {
        if (this.values.length < size_limit) {
            while(this.values.length < size_limit) {
                this.values.push(default_value);
            }
        } else if (this.values.length > size_limit) {
            while(this.values.length > size_limit) {
                this.values.pop();
            }
        }
    }

    set_default(default_value) {
        if (this.values.length == 0) {
            this.values.push(default_value);
        }
    }
}

function tokenize_file({bytes, filesize}) {
    const tokens = [];
    let sequence = new EscapeSequence();
    let pre_escape_mode = false;
    let escape_mode = false;
    for (let i = 0; i < filesize; i++) {
        const code = bytes[i];
        if (escape_mode) {
            if (code >= ascii.ZERO && code <= ascii.NINE) {
                sequence.append_numeric(code - ascii.ZERO);
            } else if (code == ascii.COLON || code == ascii.SEMI_COLON) {
                if (sequence.no_value) {
                    sequence.values.push(1);
                }
                sequence.no_value = true;
            } else if (code >= ascii.AT_SYMBOL && code <= ascii.TILDA) {
                switch(String.fromCharCode(code)) {
                    case sequence_type.UP:
                    sequence.type = sequence_type.UP;
                    sequence.set_defaults(1, 1);
                    break;
                    case sequence_type.DOWN:
                    sequence.type = sequence_type.DOWN;
                    sequence.set_defaults(1, 1);
                    break;
                    case sequence_type.RIGHT:
                    sequence.type = sequence_type.RIGHT;
                    sequence.set_defaults(1, 1);
                    break;
                    case sequence_type.LEFT:
                    sequence.type = sequence_type.LEFT;
                    sequence.set_defaults(1, 1);
                    break;
                    case sequence_type.MOVE:
                    case sequence_type.MOVE_ALT:
                    sequence.type = sequence_type.MOVE;
                    sequence.set_defaults(1, 2);
                    break;
                    case sequence_type.ERASE_DISPLAY:
                    sequence.type = sequence_type.ERASE_DISPLAY;
                    sequence.set_defaults(0, 1);
                    break;
                    case sequence_type.ERASE_LINE:
                    sequence.type = sequence_type.ERASE_LINE;
                    sequence.set_defaults(0, 1);
                    break;
                    case sequence_type.SGR:
                    sequence.type = sequence_type.SGR;
                    sequence.set_default(0);
                    break;
                    case sequence_type.SAVE_POS:
                    sequence.type = sequence_type.SAVE_POS;
                    sequence.values = [];
                    break;
                    case sequence_type.TRUE_COLOR:
                    sequence.type = sequence_type.TRUE_COLOR;
                    break;
                    case sequence_type.RESTORE_POS:
                    sequence.type = sequence_type.RESTORE_POS;
                    sequence.values = [];
                    break;
                    default:
                    sequence.type = sequence_type.UNKNOWN;
                    sequence.values = [];
                    break;
                }
                escape_mode = false;
                delete sequence.no_value;
                tokens.push({type: token_type.ESCAPE_SEQUENCE, sequence});
                sequence = new EscapeSequence();
            }
        } else {
            if (code == ascii.ESCAPE && !pre_escape_mode) {
                pre_escape_mode = true;
            } else if (code == ascii.OPEN_SQUARE_BRACKET && pre_escape_mode) {
                pre_escape_mode = false;
                escape_mode = true;
            } else {
                pre_escape_mode = false;
                tokens.push({type: token_type.LITERAL, code});
            }
        }
    }
    return tokens;
}

function ansi_to_bin_color(ansi_color) {
    switch (ansi_color) {
    case 4: return 1;
    case 6: return 3;
    case 1: return 4;
    case 3: return 6;
    case 12: return 9;
    case 14: return 11;
    case 9: return 12;
    case 11: return 14;
    default: return ansi_color;
    }
}

class Screen {
    reset_attributes() {
        this.bold = false;
        this.blink = false;
        this.inverse = false;
        this.fg = 7;
        this.bg = 0;
        this.fg_rgb = undefined;
        this.bg_rgb = undefined;
        this.fg_idx = undefined;
        this.bg_idx = undefined;
    }

    clear() {
        this.custom_colors = [];
        this.top_of_screen = 0;
        this.bottom_of_screen = 24;
        this.reset_attributes();
        this.rows = 25;
        this.x = 0;
        this.y = 0;
        this.pending_wrap = false;
        this.data = new Array(this.columns * 1000);
        this.data.fill({fg: 7, bg: 0, code: ascii.SPACE});
    }

    constructor(columns) {
        this.columns = columns;
        this.clear();
        this.position_saved = false;
        this.save_x = 0;
        this.save_y = 0;
    }

    adjust_screen() {
        if (this.y > this.bottom_of_screen) {
            this.top_of_screen += 1;
            this.bottom_of_screen += 1;
        }
    }

    new_line() {
        this.pending_wrap = false;
        this.x = 0;
        this.y += 1;
    }

    fill(extra_rows) {
        const more_data = new Array(this.columns * extra_rows);
        more_data.fill({fg: 7, bg: 0, code: ascii.SPACE});
        this.data = this.data.concat(more_data);
    }

    put({fg = 7, bg = 0, code = ascii.SPACE, fg_rgb, bg_rgb, fg_idx, bg_idx} = {}) {
        if (this.pending_wrap) {
            this.x = 0;
            this.y += 1;
            this.pending_wrap = false;
        }
        const i = this.y * this.columns + this.x;
        if (i >= this.data.length) this.fill(1000);
        this.data[i] = {code, fg: ansi_to_bin_color(fg), bg: ansi_to_bin_color(bg), fg_rgb, bg_rgb, fg_idx, bg_idx};
        this.x += 1;
        if (this.x == this.columns) this.pending_wrap = true;
        if (this.y + 1 > this.rows) this.rows += 1;
        this.adjust_screen();
    }

    literal(code) {
        if (this.inverse) {
            this.put({
                code,
                fg: this.blink ? this.bg + 8 : this.bg,
                bg: this.bold ? this.fg + 8 : this.fg,
                fg_rgb: this.bg_rgb,
                bg_rgb: this.fg_rgb,
                fg_idx: this.bg_idx,
                bg_idx: this.fg_idx
            });
        } else {
            this.put({
                code,
                fg: this.bold ? this.fg + 8 : this.fg,
                bg: this.blink ? this.bg + 8 : this.bg,
                fg_rgb: this.fg_rgb,
                bg_rgb: this.bg_rgb,
                fg_idx: this.fg_idx,
                bg_idx: this.bg_idx
            });
        }
        if (this.fg_rgb) {
            this.custom_colors.push(this.fg_rgb);
        }
        if (this.bg_rgb) {
            this.custom_colors.push(this.bg_rgb);
        }
    }

    up(value) {
        this.y = Math.max(this.y - value, this.top_of_screen);
    }

    down(value) {
        this.y = Math.min(this.y + value, this.bottom_of_screen);
    }

    right(value) {
        this.x = Math.min(this.x + value, this.columns - 1);
    }

    left(value) {
        this.x = Math.max(this.x - value, 0);
    }

    move(x, y) {
        this.x = x - 1;
        this.y = y - 1 + this.top_of_screen;
    }

    clear_until_end_of_screen() {
        const tmp_x = this.x;
        const tmp_y = this.y;
        this.x = 0;
        while (!(this.x == this.columns && this.y == this.bottom_of_screen - 1)) {
            this.put();
        }
        this.x = tmp_x;
        this.y = tmp_y;
    }

    clear_from_start_of_screen() {
        const tmp_x = this.x;
        const tmp_y = this.y;
        this.x = 0;
        this.y = 0;
        while(!(this.x == this.columns && this.y == tmp_y)) {
            this.put();
        }
        this.x = tmp_x;
        this.y = tmp_y;
    }

    clear_until_end_of_line() {
        const tmp_x = this.x;
        while(this.x < this.columns) {
            this.put();
        }
        this.x = tmp_x;
    }

    clear_from_start_of_line() {
        const tmp_x = this.x;
        this.x = 0;
        while(this.x < tmp_x + 1) {
            this.put();
        }
        this.x = tmp_x;
    }

    clear_line() {
        const tmp_x = this.x;
        this.x = 0;
        while(this.x < this.columns) {
            putc();
        }
        this.x = tmp_x;
    }

    save_pos() {
        this.position_saved = true;
        this.save_x = this.x;
        this.save_y = this.y;
    }

    restore_pos() {
        if (this.position_saved) {
            this.x = this.save_x;
            this.y = this.save_y;
        }
    }

    trim_data() {
        return this.data.slice(0, this.rows * this.columns);
    }

    unique_custom_colors() {
        const unique_colors = [];
        for (const rgb of this.custom_colors) {
            if (unique_colors.find(stored_rgb => stored_rgb.r == rgb.r && stored_rgb.g == rgb.g && stored_rgb.b == rgb.b) == undefined) {
                unique_colors.push(rgb);
            }
        }
        return unique_colors;
    }
}

const erase_display_types = {UNTIL_END_OF_SCREEN: 0, FROM_START_OF_SCREEN: 1, CLEAR_SCREEN: 2};
const erase_line_types = {UNTIL_END_OF_LINE: 0, FROM_START_OF_LINE: 1, CLEAR_LINE: 2};
const sgr_types = {RESET_ATTRIBUTES: 0, BOLD_ON: 1, BLINK_ON: 5, INVERSE_ON: 7, BOLD_OFF: 22, BLINK_OFF: 21, BLINK_OFF_ALT: 22, INVERSE_OFF: 27, CHANGE_FG_START: 30, CHANGE_FG_END: 37, CHANGE_BG_START: 40, CHANGE_BG_END: 47};
const true_color_type = {BACKGROUND: 0, FOREGROUND: 1};

class Ansi extends Textmode {
    constructor(bytes) {
        super(bytes);
        const tokens = tokenize_file({bytes: this.bytes, filesize: this.filesize});
        if (!this.columns) this.columns = detect_columns(this.bytes) || 80;
        let screen = new Screen(this.columns);
        for (const token of tokens) {
            if (token.type == token_type.LITERAL) {
                const code = token.code;
                switch (code) {
                    case ascii.NEW_LINE:
                    screen.new_line();
                    break;
                    case ascii.CARRIAGE_RETURN:
                    break;
                    default:
                    screen.literal(code);
                    break;
                }
            } else if (token.type == token_type.ESCAPE_SEQUENCE) {
                const sequence = token.sequence;
                switch (sequence.type) {
                    case sequence_type.UP: screen.up(sequence.values[0]); break;
                    case sequence_type.DOWN: screen.down(sequence.values[0]); break;
                    case sequence_type.RIGHT: screen.right(sequence.values[0]); break;
                    case sequence_type.LEFT: screen.left(sequence.values[0]); break;
                    case sequence_type.MOVE: screen.move(sequence.values[1], sequence.values[0]); break;
                    case sequence.ERASE_DISPLAY:
                    switch (sequence.values[0]) {
                        // case erase_display_types.UNTIL_END_OF_SCREEN: screen.clear_until_end_of_screen(); break;
                        // case erase_display_types.FROM_START_OF_SCREEN: screen.clear_from_start_of_screen(); break;
                        // case erase_display_types.CLEAR_SCREEN: screen.clear(); break;
                    }
                    break;
                    case sequence_type.ERASE_LINE:
                    switch (sequence.values[0]) {
                        // case erase_line_types.UNTIL_END_OF_LINE: screen.clear_until_end_of_line(); break;
                        // case erase_line_types.FROM_START_OF_LINE: screen.clear_from_start_of_line(); break;
                        // case erase_line_types.CLEAR_LINE: screen.clear_line(); break;
                    }
                    break;
                    case sequence_type.SGR: {
                    const vals = sequence.values;
                    for (let vi = 0; vi < vals.length; vi++) {
                        const value = vals[vi];
                        if (value === 38 && vals[vi + 1] === 5 && vi + 2 < vals.length) {
                            const idx = vals[vi + 2];
                            screen.fg_idx = idx;
                            screen.fg_rgb = palette_256[idx];
                            vi += 2;
                        } else if (value === 48 && vals[vi + 1] === 5 && vi + 2 < vals.length) {
                            const idx = vals[vi + 2];
                            screen.bg_idx = idx;
                            screen.bg_rgb = palette_256[idx];
                            vi += 2;
                        } else if (value === 38 && vals[vi + 1] === 2 && vi + 4 < vals.length) {
                            screen.fg_rgb = {r: vals[vi + 2], g: vals[vi + 3], b: vals[vi + 4]};
                            screen.fg_idx = undefined;
                            vi += 4;
                        } else if (value === 48 && vals[vi + 1] === 2 && vi + 4 < vals.length) {
                            screen.bg_rgb = {r: vals[vi + 2], g: vals[vi + 3], b: vals[vi + 4]};
                            screen.bg_idx = undefined;
                            vi += 4;
                        } else if (value >= sgr_types.CHANGE_FG_START && value <= sgr_types.CHANGE_FG_END) {
                            screen.fg = value - sgr_types.CHANGE_FG_START;
                            screen.fg_rgb = undefined;
                            screen.fg_idx = undefined;
                        } else if (value >= sgr_types.CHANGE_BG_START && value <= sgr_types.CHANGE_BG_END) {
                            screen.bg = value - sgr_types.CHANGE_BG_START;
                            screen.bg_rgb = undefined;
                            screen.bg_idx = undefined;
                        } else {
                            switch (value) {
                                case sgr_types.RESET_ATTRIBUTES: screen.reset_attributes(); break;
                                case sgr_types.BOLD_ON: screen.bold = true; screen.fg_rgb = undefined; screen.fg_idx = undefined; break;
                                case sgr_types.BLINK_ON: screen.blink = true; break;
                                case sgr_types.INVERSE_ON: screen.inverse = true; break;
                                case sgr_types.BOLD_OFF:
                                case sgr_types.BLINK_OFF_ALT:
                                screen.bold = false;
                                break;
                                case sgr_types.BLINK_OFF: screen.blink = false; break;
                                case sgr_types.INVERSE_OFF: screen.inverse = false; break;
                            }
                        }
                    }
                    break;
                    }
                    case sequence_type.SAVE_POS: screen.save_pos(); break;
                    case sequence_type.TRUE_COLOR:
                    if (sequence.values.length >= 4) {
                        switch (sequence.values[0]) {
                            case true_color_type.BACKGROUND: screen.bg_rgb = {r: sequence.values[1], g: sequence.values[2], b: sequence.values[3]}; break;
                            case true_color_type.FOREGROUND: screen.fg_rgb = {r: sequence.values[1], g: sequence.values[2], b: sequence.values[3]}; break;
                        }
                    }
                    break;
                    case sequence_type.RESTORE_POS: screen.restore_pos(); break;
                    case sequence_type.UNKNOWN: break;
                }
            }
        }
        if (!this.rows) {
            this.rows = screen.rows;
        } else if (this.rows > screen.rows) {
            screen.fill(this.rows - screen.rows);
            screen.rows = this.rows;
        } else if (this.rows < screen.rows) {
            screen.rows = this.rows;
        }
        if (this.font_name == "C64 PETSCII unshifted" || this.font_name == "C64 PETSCII shifted") {
            this.palette = c64;
        } else {
            this.palette = ega;
        }
        this.custom_colors = screen.unique_custom_colors();
        this.data = screen.trim_data();
    }
}

function bin_to_ansi_colour(bin_colour) {
    switch (bin_colour) {
    case 1: return 4;
    case 3: return 6;
    case 4: return 1;
    case 6: return 3;
    case 9: return 12;
    case 11: return 14;
    case 12: return 9;
    case 14: return 11;
    default: return bin_colour;
    }
}

function clr_to_ascii(color, output) {
    switch (color) {
        case 10: output.push(49, 48); break;
        case 11: output.push(49, 49); break;
        case 12: output.push(49, 50); break;
        case 13: output.push(49, 51); break;
        case 14: output.push(49, 52); break;
        case 15: output.push(49, 53); break;
        default: output.push(color + 48); break;
    }
}

function push_num(output, n) {
    for (const c of String(n)) output.push(c.charCodeAt(0));
}

function detect_columns(bytes) {
    let max_line = 0, cur_line = 0, total = 0;
    let has_newlines = false;
    let i = 0;
    while (i < bytes.length) {
        const b = bytes[i];
        if (b === 26) break; // SUB before SAUCE
        if (b === 27 && i + 1 < bytes.length && bytes[i + 1] === 91) { // ESC[
            i += 2;
            while (i < bytes.length && bytes[i] >= 0x20 && bytes[i] <= 0x3f) i++;
            i++; // final byte
            continue;
        }
        if (b === 10) { // LF
            has_newlines = true;
            if (cur_line > max_line) max_line = cur_line;
            cur_line = 0;
        } else if (b === 13) { // CR
            cur_line = 0;
        } else {
            cur_line++;
            total++;
        }
        i++;
    }
    if (cur_line > max_line) max_line = cur_line;

    // File has explicit newlines and content wider than 80 — use max line length
    if (has_newlines && max_line > 80) return max_line;

    // Pure auto-wrap — try standard ANSI widths first, then fall back to scoring
    if (!has_newlines && total > 0) {
        for (const w of [80, 132, 160, 40]) {
            if (total % w === 0) return w;
        }
        let best = 0, best_score = -1;
        for (let c = 80; c <= Math.min(2000, total); c++) {
            if (total % c !== 0) continue;
            const score = c % 100 === 0 ? 100 : c % 80 === 0 ? 80 : c % 40 === 0 ? 40 :
                          c % 20 === 0 ? 20 : c % 10 === 0 ? 10 : c % 5 === 0 ? 5 : 1;
            if (score > best_score || (score === best_score && c < best)) {
                best = c;
                best_score = score;
            }
        }
        return best;
    }

    return 0;
}

function has_extended_colors(doc) {
    return doc.data.some(b => b.fg_rgb || b.bg_rgb || b.fg_idx !== undefined || b.bg_idx !== undefined);
}

function encode_as_ansi_extended(doc, save_without_sauce) {
    const output = [27, 91, 48, 109]; // ESC[0m
    let cur_fg_idx = -1, cur_bg_idx = -1;
    let cur_fg_rgb = null, cur_bg_rgb = null;
    let cur_fg_sgr = -1, cur_bg_sgr = -1;
    let cur_bold = false;
    const rgb_eq = (a, b) => a && b && a.r === b.r && a.g === b.g && a.b === b.b;

    for (let row = 0; row < doc.rows; row++) {
        // find last non-blank cell in row to skip trailing spaces
        let last_col = doc.columns - 1;
        while (last_col >= 0) {
            const b = doc.data[row * doc.columns + last_col];
            if (b.code !== ascii.SPACE || b.bg !== 0 || b.bg_rgb || b.bg_idx !== undefined) break;
            last_col--;
        }

        for (let col = 0; col <= last_col; col++) {
            let {code, fg, bg, fg_rgb, bg_rgb, fg_idx, bg_idx} = doc.data[row * doc.columns + col];
            switch (code) {
                case 10: code = 9; break;
                case 13: code = 14; break;
                case 26: code = 16; break;
                case 27: code = 17; break;
            }

            // Bold state: only legacy 16-colour bright cells (fg 8-15) use ESC[1m].
            // 256-colour/truecolor cells don't interact with bold.
            const needs_bold = !fg_rgb && fg_idx === undefined && bin_to_ansi_colour(fg) >= 8;
            if (needs_bold && !cur_bold) {
                output.push(27, 91, 49, 109); // ESC[1m
                cur_bold = true;
            } else if (!needs_bold && cur_bold) {
                output.push(27, 91, 48, 109); // ESC[0m — ESC[22m not reliable on BBS renderers
                cur_bold = false;
                cur_fg_sgr = -1; cur_fg_idx = -1; cur_fg_rgb = null;
                cur_bg_sgr = 40; cur_bg_idx = -1; cur_bg_rgb = null;
            }

            // fg color
            if (fg_idx !== undefined) {
                if (fg_idx !== cur_fg_idx) {
                    output.push(27, 91, 51, 56, 59, 53, 59); // ESC[38;5;
                    push_num(output, fg_idx);
                    output.push(109);
                    cur_fg_idx = fg_idx; cur_fg_rgb = null; cur_fg_sgr = -1;
                }
            } else if (fg_rgb) {
                if (!rgb_eq(fg_rgb, cur_fg_rgb)) {
                    output.push(27, 91, 51, 56, 59, 50, 59); // ESC[38;2;
                    push_num(output, fg_rgb.r); output.push(59);
                    push_num(output, fg_rgb.g); output.push(59);
                    push_num(output, fg_rgb.b); output.push(109);
                    cur_fg_rgb = fg_rgb; cur_fg_idx = -1; cur_fg_sgr = -1;
                }
            } else {
                const ai = bin_to_ansi_colour(fg);
                const sgr = 30 + (ai >= 8 ? ai - 8 : ai); // always 3X; bold handled above
                if (sgr !== cur_fg_sgr) {
                    output.push(27, 91); push_num(output, sgr); output.push(109);
                    cur_fg_sgr = sgr; cur_fg_idx = -1; cur_fg_rgb = null;
                }
            }

            // bg color
            if (bg_idx !== undefined) {
                if (bg_idx !== cur_bg_idx) {
                    output.push(27, 91, 52, 56, 59, 53, 59); // ESC[48;5;
                    push_num(output, bg_idx);
                    output.push(109);
                    cur_bg_idx = bg_idx; cur_bg_rgb = null; cur_bg_sgr = -1;
                }
            } else if (bg_rgb) {
                if (!rgb_eq(bg_rgb, cur_bg_rgb)) {
                    output.push(27, 91, 52, 56, 59, 50, 59); // ESC[48;2;
                    push_num(output, bg_rgb.r); output.push(59);
                    push_num(output, bg_rgb.g); output.push(59);
                    push_num(output, bg_rgb.b); output.push(109);
                    cur_bg_rgb = bg_rgb; cur_bg_idx = -1; cur_bg_sgr = -1;
                }
            } else {
                const ai = bin_to_ansi_colour(bg);
                const sgr = ai < 8 ? 40 + ai : 100 + (ai - 8);
                if (sgr !== cur_bg_sgr) {
                    output.push(27, 91); push_num(output, sgr); output.push(109);
                    cur_bg_sgr = sgr; cur_bg_idx = -1; cur_bg_rgb = null;
                }
            }

            output.push(code);
        }

        if (last_col < doc.columns - 1) output.push(13, 10);
    }

    const bytes = new Uint8Array(output);
    if (!save_without_sauce) return add_sauce_for_ans({doc, bytes});
    return bytes;
}

function encode_as_ansi(doc, save_without_sauce, {utf8 = false} = {}) {
    if (!utf8 && doc.extended_colors !== false && has_extended_colors(doc)) return encode_as_ansi_extended(doc, save_without_sauce);
    let output = [27, 91, 48, 109];
    let bold = false;
    let blink = false;
    let current_fg = 7;
    let current_bg = 0;
    let current_bold = false;
    let current_blink = false;
    let cur_utf8_fg_idx = -1, cur_utf8_bg_idx = -1;
    let cur_utf8_fg_rgb = null, cur_utf8_bg_rgb = null;
    const rgb_eq = (a, b) => a && b && a.r === b.r && a.g === b.g && a.b === b.b;
    for (let i = 0; i < doc.data.length; i++) {
        let attribs = [];
        let {code, fg, bg, fg_rgb, bg_rgb, fg_idx, bg_idx} = doc.data[i];
        if (doc.c64_background != undefined) {
            bg = doc.c64_background;
        }
        switch (code) {
        case 10: code = 9; break;
        case 13: code = 14; break;
        case 26: code = 16; break;
        case 27: code = 17; break;
        default:
        }
        if (utf8 && i > 0 && i % doc.columns == 0) {
            if (cur_utf8_bg_idx !== -1 || cur_utf8_bg_rgb !== null || current_bg !== 0) {
                output.push(27, 91, 52, 57, 109); // ESC[49m
                current_bg = 0;
                cur_utf8_bg_idx = -1;
                cur_utf8_bg_rgb = null;
            }
            output.push(10);
        }
        if (utf8) {
            // fg
            if (fg_idx !== undefined) {
                if (fg_idx !== cur_utf8_fg_idx) {
                    output.push(27, 91, 51, 56, 59, 53, 59); // ESC[38;5;
                    push_num(output, fg_idx);
                    output.push(109);
                    cur_utf8_fg_idx = fg_idx; cur_utf8_fg_rgb = null; current_fg = -1;
                }
            } else if (fg_rgb) {
                if (!rgb_eq(fg_rgb, cur_utf8_fg_rgb)) {
                    output.push(27, 91, 51, 56, 59, 50, 59); // ESC[38;2;
                    push_num(output, fg_rgb.r); output.push(59);
                    push_num(output, fg_rgb.g); output.push(59);
                    push_num(output, fg_rgb.b); output.push(109);
                    cur_utf8_fg_rgb = fg_rgb; cur_utf8_fg_idx = -1; current_fg = -1;
                }
            } else {
                cur_utf8_fg_idx = -1; cur_utf8_fg_rgb = null;
                if (fg != current_fg) {
                    output.push(27, 91, 51, 56, 59, 53, 59); // ESC[38;5;
                    clr_to_ascii(bin_to_ansi_colour(fg), output);
                    output.push(109);
                    current_fg = fg;
                }
            }
            // bg
            if (bg_idx !== undefined) {
                if (bg_idx !== cur_utf8_bg_idx) {
                    output.push(27, 91, 52, 56, 59, 53, 59); // ESC[48;5;
                    push_num(output, bg_idx);
                    output.push(109);
                    cur_utf8_bg_idx = bg_idx; cur_utf8_bg_rgb = null; current_bg = -1;
                }
            } else if (bg_rgb) {
                if (!rgb_eq(bg_rgb, cur_utf8_bg_rgb)) {
                    output.push(27, 91, 52, 56, 59, 50, 59); // ESC[48;2;
                    push_num(output, bg_rgb.r); output.push(59);
                    push_num(output, bg_rgb.g); output.push(59);
                    push_num(output, bg_rgb.b); output.push(109);
                    cur_utf8_bg_rgb = bg_rgb; cur_utf8_bg_idx = -1; current_bg = -1;
                }
            } else {
                cur_utf8_bg_idx = -1; cur_utf8_bg_rgb = null;
                if (bg != current_bg) {
                    if (bg == 0) {
                        output.push(27, 91, 52, 57, 109); // ESC[49m
                    } else {
                        output.push(27, 91, 52, 56, 59, 53, 59); // ESC[48;5;
                        clr_to_ascii(bin_to_ansi_colour(bg), output);
                        output.push(109);
                    }
                    current_bg = bg;
                }
            }
        }
        else {
            if (fg > 7) {
                bold = true;
                fg = fg - 8;
            } else {
                bold = false;
            }
            if (bg > 7) {
                blink = true;
                bg = bg - 8;
            } else {
                blink = false;
            }
            if ((current_bold && !bold) || (current_blink && !blink)) {
                attribs.push([48]);
                current_fg = 7;
                current_bg = 0;
                current_bold = false;
                current_blink = false;
            }
            if (bold && !current_bold) {
                attribs.push([49]);
                current_bold = true;
            }
            if (blink && !current_blink) {
                attribs.push([53]);
                current_blink = true;
            }
            if (fg != current_fg) {
                attribs.push([51, 48 + bin_to_ansi_colour(fg)]);
                current_fg = fg;
            }
            if (bg != current_bg) {
                attribs.push([52, 48 + bin_to_ansi_colour(bg)]);
                current_bg = bg;
            }
            if (attribs.length) {
                output.push(27, 91);
                for (let i = 0; i < attribs.length; i += 1) {
                    for (const attrib of attribs[i]) {
                        output.push(attrib);
                    }
                    if (i != attribs.length - 1) {
                        output.push(59);
                    } else {
                        output.push(109);
                    }
                }
            }
        }
        if (code == 32 && bg == 0 && bg_idx === undefined && !bg_rgb) {
            for (let j = i + 1; j < doc.data.length; j++) {
                if (j % doc.columns == 0) {
                    if (!utf8) output.push(13, 10);
                    i = j - 1;
                    break;
                }
                let {code: look_ahead_code, bg: look_ahead_bg, bg_idx: look_ahead_bg_idx, bg_rgb: look_ahead_bg_rgb} = doc.data[j];
                if (look_ahead_code != 32 || look_ahead_bg != 0 || look_ahead_bg_idx !== undefined || look_ahead_bg_rgb) {
                    while (i < j) {
                        output.push(32);
                        i += 1;
                    }
                    i = j - 1;
                    break;
                }
            }
        } else if (utf8) {
            output.push.apply(output, cp437_to_unicode_bytes(code));
        } else {
            output.push(code);
        }
    }
    const bytes = new Uint8Array(output);
    if (utf8) return bytes;
    if (!save_without_sauce) {
        return add_sauce_for_ans({doc, bytes});
    }
    return bytes;
}

module.exports = {Ansi, encode_as_ansi, ansi_to_bin_color};
