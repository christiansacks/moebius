const fs = require("fs");
const path = require("path");

const TDF_SIG = "\x13TheDraw FONTS file\x1a";

// Parse a single font record from a buffer starting at `off` (the 0x0C separator byte).
// Returns {name, type, spacing, block_size, chars} or null if invalid.
// chars: Map of char_code (33–126) → array of rows, each row = [{code, fg, bg}]
function parse_font(buf, off) {
    if (buf[off] !== 0x0C) return null;
    const name      = buf.slice(off + 1, off + 13).toString("ascii").replace(/\0/g, "").trim();
    const type      = buf[off + 17]; // 0=outline, 1=block, 2=color
    const spacing   = buf[off + 18];
    const block_size = buf[off + 19];
    const table_off = off + 20;
    const data_off  = table_off + 94 * 2;

    const chars = new Map();
    for (let i = 0; i < 94; i++) {
        const char_off = buf.readUInt16LE(table_off + i * 2);
        if ((char_off >> 8) === 0xFF) continue; // undefined

        const abs = data_off + char_off;
        if (abs >= buf.length) continue;

        const rows = [];
        let row = [], p = abs;
        while (p < buf.length) {
            const b = buf[p++];
            if (b === 0x00) break;
            if (b === 0x0D) { rows.push(row); row = []; }
            else {
                const attr = (type === 2) ? buf[p++] : 0;
                const fg = (type === 2) ? (attr & 0x0F) : 7;
                const bg = (type === 2) ? ((attr >> 4) & 0x0F) : 0;
                row.push({code: b, fg, bg});
            }
        }
        if (row.length > 0) rows.push(row);
        if (rows.length > 0) chars.set(33 + i, rows);
    }

    return {name, type, spacing, block_size, chars};
}

// Scan a .TDF file and return an array of parsed fonts.
function parse_tdf_file(file_path) {
    let buf;
    try { buf = fs.readFileSync(file_path); } catch (_) { return []; }
    if (buf.length < TDF_SIG.length) return [];
    if (buf.slice(0, TDF_SIG.length).toString("ascii") !== TDF_SIG) return [];

    const fonts = [];
    let off = 24; // skip global header
    while (off < buf.length) {
        if (buf[off] !== 0x0C) { off++; continue; }
        const font = parse_font(buf, off);
        if (font) fonts.push(font);
        // advance past this font: next 0x0C
        off++;
        while (off < buf.length && buf[off] !== 0x0C) off++;
    }
    return fonts;
}

// Build a flat index of all fonts in a directory (name → {file, font_index}).
// Does NOT load cell data — call get_font() for that.
function build_font_index(dir) {
    const index = [];
    let files;
    try { files = fs.readdirSync(dir); } catch (_) { return index; }
    for (const f of files) {
        if (path.extname(f).toLowerCase() !== ".tdf") continue;
        const full = path.join(dir, f);
        let buf;
        try { buf = fs.readFileSync(full); } catch (_) { continue; }
        if (buf.length < TDF_SIG.length) continue;
        if (buf.slice(0, TDF_SIG.length).toString("ascii") !== TDF_SIG) continue;
        // Scan for font names without parsing cell data
        let off = 24;
        let font_index = 0;
        while (off < buf.length) {
            if (buf[off] !== 0x0C) { off++; continue; }
            const name = buf.slice(off + 1, off + 13).toString("ascii").replace(/\0/g, "").trim();
            if (name) index.push({name, file: full, font_index});
            font_index++;
            off++;
            while (off < buf.length && buf[off] !== 0x0C) off++;
        }
    }
    index.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return index;
}

// Load full font data for a specific entry from the index.
function get_font(entry) {
    const fonts = parse_tdf_file(entry.file);
    return fonts[entry.font_index] || null;
}

// Convert a font character's rows into a blocks object for doc.place().
// Returns {columns, rows, data: [{code, fg, bg}|null]}
// For outline/block fonts (type != 2), fg/bg come from the caller's palette selection.
function font_char_to_blocks(rows, block_size, override_fg, override_bg, is_color) {
    const width = Math.max(...rows.map(r => r.length));
    const height = block_size || rows.length;
    const data = new Array(width * height).fill(null);
    for (let r = 0; r < rows.length && r < height; r++) {
        for (let c = 0; c < rows[r].length; c++) {
            const cell = rows[r][c];
            data[r * width + c] = {
                code: cell.code,
                fg: is_color ? cell.fg : override_fg,
                bg: is_color ? cell.bg : override_bg,
            };
        }
    }
    return {columns: width, rows: height, data};
}

module.exports = {build_font_index, get_font, font_char_to_blocks};
