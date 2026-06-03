const fs = require("fs");
const path = require("path");

const TDF_SIG = "\x13TheDraw FONTS file\x1a";

// Parse a single font from a complete .TDF file buffer (one font per file).
// Returns {name, type, spacing, block_size, chars} or null if invalid.
// Format from tdfonts.js: each file has exactly one font at fixed offsets
function parse_font(buf) {
    if (buf.length < 233) return null;

    // Check magic signature
    const magic = "\x13TheDraw FONTS file\x1a";
    for (let i = 0; i < magic.length; i++) {
        if (buf[i] !== magic.charCodeAt(i)) return null;
    }

    // Parse header at fixed offsets (from tdfonts.js)
    const nameLen   = buf[24];
    const name      = buf.slice(25, 25 + nameLen).toString("ascii").trim();
    const type      = buf[41]; // 0=outline, 1=block, 2=color
    const spacing   = buf[42];
    const block_size = buf[43];

    // Character offset table at offset 45 (94 chars * 2 bytes each)
    const table_off = 45;
    const data_off  = 233; // Font data starts here

    const chars = new Map();
    for (let i = 0; i < 94; i++) {
        const char_off = buf.readUInt16LE(table_off + i * 2);
        if (char_off === 0xffff) continue; // undefined character

        const abs = data_off + char_off;
        if (abs >= buf.length) continue;

        // Read character: width, height, then cell data
        const width = buf[abs];
        const height = buf[abs + 1];
        let p = abs + 2;

        const rows = [];
        let row = [];

        while (p < buf.length && buf[p] !== 0x00) {
            let ch = buf[p++];

            if (ch === 0x0D) { // Carriage return / end of row
                rows.push(row);
                row = [];
            } else {
                // Read color byte if color font
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


// Scan one buffer for font name entries. Each .TDF file contains exactly one font.
function scan_names_from_buf(buf, full_path) {
    const font = parse_font(buf);
    if (font && font.name) {
        return [{name: font.name, file: full_path, font_index: 0}];
    }
    return [];
}


// Build a flat index of all fonts in a directory (async, batched parallel reads).
// Does NOT load cell data — call get_font() for that.
async function build_font_index(dir) {
    let files;
    try { files = await fs.promises.readdir(dir); } catch (_) { return []; }
    const tdf_files = files.filter(f => path.extname(f).toLowerCase() === ".tdf");
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
    return index;
}

// Load full font data for a specific entry from the index.
function get_font(entry) {
    try {
        const buf = fs.readFileSync(entry.file);
        return parse_font(buf);
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
