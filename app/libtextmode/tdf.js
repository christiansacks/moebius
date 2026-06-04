const fs = require("fs");
const path = require("path");

const TDF_MAGIC = "\x13TheDraw FONTS file\x1a";

// Parse a single font block starting at buf[offset].
// Each block begins with 0x55 0xAA. Returns {name, type, spacing, block_size, chars} or null.
function parse_font_block(buf, offset) {
    if (offset + 213 > buf.length) return null;
    if (buf[offset] !== 0x55 || buf[offset + 1] !== 0xAA) return null;

    const name_len = buf[offset + 4];
    if (name_len < 0 || name_len > 12) return null;
    const name = buf.slice(offset + 5, offset + 5 + name_len).toString("ascii").replace(/[^\x20-\x7E]/g, "").trim();
    if (!name) return null;

    const type       = buf[offset + 21];
    const spacing    = buf[offset + 22];
    const block_size = buf[offset + 23];

    const table_off = offset + 25;
    const data_off  = offset + 213; // 25 + 94*2

    const chars = new Map();
    for (let i = 0; i < 94; i++) {
        const char_off = buf.readUInt16LE(table_off + i * 2);
        if (char_off === 0xffff) continue;

        const abs = data_off + char_off;
        if (abs + 2 > buf.length) continue;

        const width = buf[abs];
        const height = buf[abs + 1];
        let p = abs + 2;

        const rows = [];
        let row = [];

        while (p < buf.length && buf[p] !== 0x00) {
            let ch = buf[p++];
            if (ch === 0x0D) {
                rows.push(row);
                row = [];
            } else {
                const attr = (type === 2) ? buf[p++] : 0;
                const fg = (type === 2) ? (attr & 0x0F) : 7;
                const bg = (type === 2) ? ((attr >> 4) & 0x0F) : 0;
                row.push({code: ch, fg, bg});
            }
        }
        if (row.length > 0) rows.push(row);
        if (rows.length > 0) chars.set(33 + i, rows);
    }

    return {name, type, spacing, block_size, chars};
}

// Parse all fonts from a TDF file buffer. Returns array (empty if invalid).
// TDF files may contain multiple font blocks concatenated after the file magic.
// Each block starts with 0x55 0xAA — scan for all of them.
function parse_tdf_file(buf) {
    if (buf.length < 233) return [];
    for (let i = 0; i < TDF_MAGIC.length; i++) {
        if (buf[i] !== TDF_MAGIC.charCodeAt(i)) return [];
    }

    const fonts = [];
    // Font blocks start at offset 20 (immediately after magic).
    // Scan for 0x55 0xAA markers; validate with name check to skip false positives.
    for (let i = 20; i < buf.length - 4; i++) {
        if (buf[i] === 0x55 && buf[i + 1] === 0xAA && buf[i + 2] === 0x00 && buf[i + 3] === 0xFF) {
            const font = parse_font_block(buf, i);
            if (font) fonts.push(font);
        }
    }
    return fonts;
}

// Scan one buffer for all font name entries.
function scan_names_from_buf(buf, full_path) {
    return parse_tdf_file(buf).map((font, idx) => ({
        name: font.name,
        file: full_path,
        font_index: idx,
    }));
}


// Build a flat index of all fonts in a directory (async, batched parallel reads).
// Does NOT load cell data — call get_font() for that.
async function build_font_index(dir) {
    let entries;
    try { entries = await fs.promises.readdir(dir, {withFileTypes: true}); } catch (_) { return []; }

    const subdirs = entries
        .filter(e => e.isDirectory() && !e.name.startsWith("."))
        .map(e => ({name: e.name, file: path.join(dir, e.name), is_dir: true}))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    const tdf_files = entries
        .filter(e => !e.isDirectory() && path.extname(e.name).toLowerCase() === ".tdf")
        .map(e => e.name);

    const index = [];
    const batch_size = 50;
    for (let i = 0; i < tdf_files.length; i += batch_size) {
        const batch = tdf_files.slice(i, i + batch_size);
        const results = await Promise.all(batch.map(async (f) => {
            const full = path.join(dir, f);
            try {
                const buf = await fs.promises.readFile(full);
                return scan_names_from_buf(buf, full);
            } catch (_) { return []; }
        }));
        index.push(...results.flat());
    }
    index.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return [...subdirs, ...index];
}

// Load full font data for a specific entry from the index.
function get_font(entry) {
    try {
        const buf = fs.readFileSync(entry.file);
        const fonts = parse_tdf_file(buf);
        return fonts[entry.font_index ?? 0] ?? null;
    } catch (_) {
        return null;
    }
}

// Convert a font character's rows into a blocks object for doc.place().
// Returns {columns, rows, data: [{code, fg, bg}|null]}
// For outline/block fonts (type != 2), fg/bg come from the caller's palette selection.
function font_char_to_blocks(rows, block_size, override_fg, override_bg, is_color, override_fg_rgb, override_bg_rgb) {
    const width = Math.max(...rows.map(r => r.length));
    const height = block_size || rows.length;
    const data = new Array(width * height).fill(null);
    for (let r = 0; r < rows.length && r < height; r++) {
        for (let c = 0; c < rows[r].length; c++) {
            const cell = rows[r][c];
            const block = {
                code: cell.code,
                fg: is_color ? cell.fg : override_fg,
                bg: is_color ? cell.bg : override_bg,
            };
            if (!is_color) {
                if (override_fg_rgb) block.fg_rgb = override_fg_rgb;
                if (override_bg_rgb) block.bg_rgb = override_bg_rgb;
            }
            data[r * width + c] = block;
        }
    }
    return {columns: width, rows: height, data};
}

module.exports = {build_font_index, get_font, font_char_to_blocks};
