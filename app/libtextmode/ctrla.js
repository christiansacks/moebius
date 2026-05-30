const {ega} = require("./palette");
const {Textmode, add_sauce_for_ans} = require("./textmode");

// Background color map: Ctrl-A byte → bg index 0-7
const BG_MAP = new Map([
    [0x30, 0], [0x34, 1], [0x32, 2], [0x36, 3],
    [0x31, 4], [0x35, 5], [0x33, 6], [0x37, 7]
]);
// Foreground color map: Ctrl-A byte → fg index 0-7 (case-insensitive)
const FG_MAP = new Map([
    [0x4B, 0], [0x42, 1], [0x47, 2], [0x43, 3], [0x52, 4], [0x4D, 5], [0x59, 6], [0x57, 7],
    [0x6B, 0], [0x62, 1], [0x67, 2], [0x63, 3], [0x72, 4], [0x6D, 5], [0x79, 6], [0x77, 7]
]);
// Background code bytes for encoding: bg index 0-7 → Ctrl-A byte
const BG_CODES = [0x30, 0x34, 0x32, 0x36, 0x31, 0x35, 0x33, 0x37]; // '0','4','2','6','1','5','3','7'
// Foreground code bytes for encoding: fg index 0-7 → Ctrl-A byte (uppercase)
const FG_CODES = [0x4B, 0x42, 0x47, 0x43, 0x52, 0x4D, 0x59, 0x57]; // K,B,G,C,R,M,Y,W

class CtrlA extends Textmode {
    constructor(bytes) {
        super(bytes);
        if (!this.columns) this.columns = 80;

        const MAX_ROWS = 5000;
        const data = new Array(this.columns * MAX_ROWS).fill(null);
        let x = 0, y = 0;
        let fg_base = 7, bg_base = 0, bold = false, blink = false;
        const attr_stack = [];

        const put = (code) => {
            const idx = y * this.columns + x;
            if (idx < data.length) {
                data[idx] = {code, fg: fg_base + (bold ? 8 : 0), bg: bg_base + (blink ? 8 : 0)};
            }
            x++;
            if (x >= this.columns) { x = 0; y++; }
        };

        let i = 0;
        while (i < this.bytes.length) {
            const b = this.bytes[i++];
            if (b === 1) {
                if (i >= this.bytes.length) break;
                const c = this.bytes[i++];
                const bg_v = BG_MAP.get(c);
                const fg_v = FG_MAP.get(c);
                if (bg_v !== undefined) {
                    bg_base = bg_v;
                } else if (fg_v !== undefined) {
                    fg_base = fg_v;
                } else switch (c) {
                    case 0x48: case 0x68: bold = true; break;                   // H/h bold on
                    case 0x49: case 0x69: blink = true; break;                  // I/i blink on
                    case 0x4E: case 0x6E: case 0x5F:                            // N/n/_ reset
                        fg_base = 7; bg_base = 0; bold = false; blink = false; break;
                    case 0x4C: case 0x6C:                                       // L/l clear screen
                        data.fill(null); x = 0; y = 0; break;
                    case 0x3E: {                                                 // > clear to EOL
                        const fill_fg = fg_base + (bold ? 8 : 0);
                        const fill_bg = bg_base + (blink ? 8 : 0);
                        for (let cx = x; cx < this.columns; cx++) {
                            const cidx = y * this.columns + cx;
                            if (cidx < data.length) data[cidx] = {code: 32, fg: fill_fg, bg: fill_bg};
                        }
                        break;
                    }
                    case 0x3C: if (x > 0) x--; break;                          // < back one char
                    case 0x5B: x = 0; break;                                   // [ CR
                    case 0x5D: y++; break;                                      // ] LF (y only)
                    case 0x2B: attr_stack.push({fg_base, bg_base, bold, blink}); break; // + push
                    case 0x2D:                                                  // - pop
                        if (attr_stack.length > 0) ({fg_base, bg_base, bold, blink} = attr_stack.pop());
                        else { fg_base = 7; bg_base = 0; bold = false; blink = false; }
                        break;
                    case 0x41: case 0x61: put(1); break;                       // A/a literal 0x01
                    case 0x5A: case 0x7A: i = this.bytes.length; break;        // Z/z end of file
                    default:
                        if (c >= 128) {
                            // run-length spaces: advance cursor by c-127, clamp to row end
                            x += c - 127;
                            if (x >= this.columns) x = this.columns - 1;
                        }
                        break;
                }
            } else if (b === 13) {
                x = 0;
            } else if (b === 10) {
                y++; x = 0;
            } else {
                put(b);
            }
        }

        // Find last visually non-empty row
        let last_row = 0;
        for (let row = 0; row < MAX_ROWS; row++) {
            for (let col = 0; col < this.columns; col++) {
                const cell = data[row * this.columns + col];
                if (cell !== null && (cell.code !== 32 || cell.bg !== 0)) last_row = row;
            }
        }

        const blank = {code: 32, fg: 7, bg: 0};
        if (!this.rows) this.rows = last_row + 1;
        this.data = [];
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.columns; col++) {
                this.data.push(data[row * this.columns + col] || blank);
            }
        }
        this.palette = ega;
    }
}

function encode_as_ctrla(doc, save_without_sauce) {
    const out = [];
    const w = (b) => out.push(b);
    const wca = (b) => { w(1); w(b); };

    // Find last row/col with visible content
    let end_row = 0;
    for (let y = 0; y < doc.rows; y++) {
        for (let x = 0; x < doc.columns; x++) {
            const b = doc.data[y * doc.columns + x];
            if (b && (b.code !== 32 || b.bg !== 0)) end_row = y;
        }
    }

    wca(0x4E); // initial reset

    let cur_fg_base = 7, cur_bg_base = 0, cur_bold = false, cur_blink = false;

    const emit_attr = (fg, bg) => {
        const next_bold = fg >= 8;
        const next_blink = !doc.ice_colors && bg >= 8;
        const next_fg_base = fg % 8;
        const next_bg_base = bg % 8;

        if (next_fg_base === cur_fg_base && next_bg_base === cur_bg_base &&
            next_bold === cur_bold && next_blink === cur_blink) return;

        const need_reset = (cur_bold && !next_bold) || (cur_blink && !next_blink);
        if (need_reset) {
            wca(0x4E); // N reset
            cur_fg_base = 7; cur_bg_base = 0; cur_bold = false; cur_blink = false;
        }
        if (!cur_blink && next_blink) { wca(0x49); cur_blink = true; }         // I blink on
        if (!cur_bold && next_bold) { wca(0x48); cur_bold = true; }             // H bold on
        if (next_bg_base !== cur_bg_base) { wca(BG_CODES[next_bg_base]); cur_bg_base = next_bg_base; }
        if (next_fg_base !== cur_fg_base) { wca(FG_CODES[next_fg_base]); cur_fg_base = next_fg_base; }
    };

    for (let y = 0; y <= end_row; y++) {
        let end_col = -1;
        for (let x = 0; x < doc.columns; x++) {
            const b = doc.data[y * doc.columns + x];
            if (b && (b.code !== 32 || b.bg !== 0)) end_col = x;
        }

        for (let x = 0; x <= end_col; x++) {
            const block = doc.data[y * doc.columns + x] || {code: 32, fg: 7, bg: 0};
            emit_attr(block.fg || 7, block.bg || 0);
            let code = block.code;
            switch (code) {
                case 10: code = 9; break;
                case 13: code = 14; break;
                case 26: code = 16; break;
                case 27: code = 17; break;
            }
            if (code === 1) wca(0x41);
            else w(code);
        }

        if (y < end_row && end_col < doc.columns - 1) { w(13); w(10); }
    }

    wca(0x5A); // Z end-of-file marker

    const result = new Uint8Array(out);
    return save_without_sauce ? result : add_sauce_for_ans({doc, bytes: result});
}

module.exports = {CtrlA, encode_as_ctrla};
