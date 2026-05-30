const zlib = require("zlib");
const {decompress: zstd_decompress} = require("fzstd");
const {unicode_to_cp437} = require("./encodings");

// ── PNG helpers ─────────────────────────────────────────────────────────────

const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

function check_png_sig(buf) {
    for (let i = 0; i < 8; i++) if (buf[i] !== PNG_SIG[i]) throw new Error("not a PNG/ICY file");
}

// Iterate PNG chunks, call fn(type, data) for each. Stop at IEND.
function each_png_chunk(buf, fn) {
    let off = 8;
    while (off + 12 <= buf.length) {
        const len  = buf.readUInt32BE(off);
        const type = buf.slice(off + 4, off + 8).toString("ascii");
        const data = buf.slice(off + 8, off + 8 + len);
        off += 12 + len;
        fn(type, data);
        if (type === "IEND") break;
    }
}

// ── Color helpers ────────────────────────────────────────────────────────────

function apply_fg(cell, color) {
    if (!color) return;
    if (color.type === "palette")  { cell.fg = color.index; }
    else if (color.type === "extended") { cell.fg = color.index & 0x0f; cell.fg_idx = color.index; }
    else if (color.type === "rgb")      { cell.fg_rgb = {r: color.r, g: color.g, b: color.b}; }
}

function apply_bg(cell, color) {
    if (!color) return;
    if (color.type === "palette")  { cell.bg = color.index; }
    else if (color.type === "extended") { cell.bg = color.index & 0x0f; cell.bg_idx = color.index; }
    else if (color.type === "rgb")      { cell.bg_rgb = {r: color.r, g: color.g, b: color.b}; }
}

// Place a layer's cells onto a full-canvas array (null outside layer bounds)
function build_canvas_data(layer_data, layer_width, layer_height, columns, rows) {
    const canvas = new Array(columns * rows).fill(null);
    for (let y = 0; y < layer_height && y < rows; y++) {
        for (let x = 0; x < layer_width && x < columns; x++) {
            canvas[y * columns + x] = layer_data[y * layer_width + x] ?? null;
        }
    }
    return canvas;
}

// ── V1 format (icYD chunks) ──────────────────────────────────────────────────

const ICYD_CHUNK   = "icYD";
const COMPRESS_ZSTD = 0x02;
const LAYER_VISIBLE   = 0x01;
const LAYER_EDIT_LOCK = 0x04;

// u32 LE length-prefixed UTF-8 string → {value, size}
function read_string(buf, offset) {
    const len = buf.readUInt32LE(offset);
    return {value: buf.slice(offset + 4, offset + 4 + len).toString("utf8"), size: 4 + len};
}

// Variable-length v1 AttributeColor: tag byte + optional extra bytes
function v1_decode_color(buf, offset) {
    const tag = buf[offset];
    if (tag === 0x00) return {color: null, size: 1};
    if (tag >= 0x01 && tag <= 0x10) return {color: {type: "palette", index: tag - 1}, size: 1};
    if (tag === 0x11) return {color: {type: "extended", index: buf[offset + 1]}, size: 2};
    if (tag === 0x12) return {color: {type: "rgb", r: buf[offset + 1], g: buf[offset + 2], b: buf[offset + 3]}, size: 4};
    return {color: null, size: 1};
}

function parse_v1_layer(data) {
    let o = 0;
    const {value: name, size: ns} = read_string(data, o); o += ns;
    if (data.length < o + 25) throw new Error("v1 layer header truncated");
    o += 1;                                    // mode
    o += 4;                                    // layer color RGBA
    const flags    = data.readUInt32LE(o); o += 4;
    o += 4; o += 4;                            // offset_x, offset_y (ignored)
    const width    = data.readInt32LE(o); o += 4;
    const height   = data.readInt32LE(o); o += 4;

    const visible = (flags & LAYER_VISIBLE)   !== 0;
    const locked  = (flags & LAYER_EDIT_LOCK) !== 0;
    const cell_data = [];

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (o + 4 > data.length) throw new Error("v1 cell data truncated");
            const cp = data.readUInt32LE(o); o += 4;
            const fg_res = v1_decode_color(data, o); o += fg_res.size;
            const bg_res = v1_decode_color(data, o); o += bg_res.size;
            o += 1; o += 2;                    // font_page + attr (ignored)

            const is_space = (cp === 0x20 || cp === 0);
            if (!fg_res.color && !bg_res.color && is_space) { cell_data.push(null); continue; }

            const code = cp <= 0xFF ? cp : (unicode_to_cp437(String.fromCodePoint(cp)) ?? 0x20);
            const cell = {code, fg: 7, bg: 0};
            apply_fg(cell, fg_res.color);
            apply_bg(cell, bg_res.color);
            cell_data.push(cell);
        }
    }
    return {name, visible, locked, width, height, data: cell_data};
}

function read_icy_v1(buf) {
    const icyd_chunks = [];
    each_png_chunk(buf, (type, data) => { if (type === ICYD_CHUNK) icyd_chunks.push(data); });
    if (icyd_chunks.length === 0) return null;

    let compression = 0, columns = 80, rows = 25;
    const layers = [];

    for (const chunk of icyd_chunks) {
        if (chunk.length < 7) continue;
        const kw_len  = chunk.readUInt16LE(1);
        const keyword = chunk.slice(3, 3 + kw_len).toString("utf8");
        const data_len = chunk.readUInt32LE(3 + kw_len);
        let data = chunk.slice(3 + kw_len + 4, 3 + kw_len + 4 + data_len);

        if (keyword === "END") break;
        if (keyword !== "ICED" && keyword !== "SIXEL" && compression === COMPRESS_ZSTD) {
            data = Buffer.from(zstd_decompress(new Uint8Array(data)));
        }

        if (keyword === "ICED") {
            if (data.length < 17) continue;
            compression = data[2];
            // width+height always occupy the last 8 bytes before optional font dims (v1 has 2 extra)
            const w_off = data.length - 10;
            columns = data.readUInt32LE(w_off);
            rows    = data.readUInt32LE(w_off + 4);
        } else if (keyword === "LAYER") {
            try { layers.push(parse_v1_layer(data)); } catch (_) {}
        }
    }

    if (layers.length === 0) return null;
    return {columns, rows, layers};
}

// ── V0 format (zTXt / tEXt chunks with base64-encoded binary) ────────────────

const V0_EOL             = 0xC000;
const V0_SHORT_DATA_MASK = 0x0800 | 0x4000;
const V0_INVISIBLE_CELL  = 0x8000;

function v0_decode_legacy_color(raw, ext_attr, is_fg) {
    if (raw === 0x80000000) return null;
    const rgb_flag = is_fg ? 0x01 : 0x02;
    const ext_flag = is_fg ? 0x04 : 0x08;
    if (ext_attr & rgb_flag) return {type: "rgb", r: (raw >> 16) & 0xFF, g: (raw >> 8) & 0xFF, b: raw & 0xFF};
    if (ext_attr & ext_flag) return {type: "extended", index: raw & 0xFF};
    return {type: "palette", index: raw & 0xFF};
}

// Decode v0 cell stream starting at offset o into a flat cell array.
// width/height: layer dimensions; start_y: row to start writing into;
// Returns {cells: Array(width*height), next_y: number}
function v0_decode_cells(data, o, width, height, start_y, existing) {
    const cells = existing || new Array(width * height).fill(null);
    let y = start_y;
    while (y < height && o + 2 <= data.length) {
        for (let x = 0; x < width; x++) {
            if (o + 2 > data.length) { return {cells, next_y: y, o}; }
            const attr_raw = data.readUInt16LE(o); o += 2;
            if (attr_raw === V0_EOL) break;

            const is_short = (attr_raw & V0_SHORT_DATA_MASK) !== 0;
            const attr = attr_raw & ~V0_SHORT_DATA_MASK;
            if (attr === V0_INVISIBLE_CELL) continue;

            if (is_short) {
                if (o + 4 > data.length) return {cells, next_y: y, o};
                const ch_u32  = data[o];
                const fg_raw  = data[o + 1];
                const bg_raw  = data[o + 2];
                const code = ch_u32 <= 0xFF ? ch_u32 : (unicode_to_cp437(String.fromCodePoint(ch_u32)) ?? ch_u32);
                const cell = {code, fg: fg_raw & 0x0f, bg: bg_raw & 0x0f};
                if (x < width && y < height) cells[y * width + x] = cell;
                o += 4;
            } else {
                if (o + 14 > data.length) return {cells, next_y: y, o};
                const ch_u32   = data.readUInt32LE(o);
                const fg_raw   = data.readUInt32LE(o + 4);
                const bg_raw   = data.readUInt32LE(o + 8);
                const font_page = data[o + 12];
                const ext_attr  = data[o + 13];
                o += 14;
                const fg_color = v0_decode_legacy_color(fg_raw, ext_attr, true);
                const bg_color = v0_decode_legacy_color(bg_raw, ext_attr, false);
                const code = ch_u32 <= 0xFF ? ch_u32 : (unicode_to_cp437(String.fromCodePoint(ch_u32)) ?? 0x20);
                const cell = {code, fg: 7, bg: 0};
                apply_fg(cell, fg_color);
                apply_bg(cell, bg_color);
                if (x < width && y < height) cells[y * width + x] = cell;
            }
        }
        y++;
    }
    return {cells, next_y: y, o};
}

function parse_v0_layer(data) {
    let o = 0;
    const {value: name, size: ns} = read_string(data, o); o += ns;
    const role = data[o]; o += 1;            // 0=Normal, 1=Image
    o += 4;                                   // unused
    o += 1;                                   // mode
    o += 4;                                   // color RGBA
    const flags = data.readUInt32LE(o); o += 4;
    o += 1;                                   // transparency
    o += 4; o += 4;                           // offset_x, offset_y
    const width  = data.readInt32LE(o); o += 4;
    const height = data.readInt32LE(o); o += 4;
    o += 2;                                   // default_font_page
    o += 8;                                   // length u64

    const visible = (flags & LAYER_VISIBLE)   !== 0;
    const locked  = (flags & LAYER_EDIT_LOCK) !== 0;

    if (role === 1) return null; // skip image layers
    if (width <= 0 || height <= 0) return null;

    const {cells} = v0_decode_cells(data, o, width, height, 0, null);
    return {name, visible, locked, width, height, data: cells};
}

// V0 continuation chunk: decode more rows into an existing layer
function v0_apply_continuation(layer_obj, data, start_y) {
    const {cells, next_y} = v0_decode_cells(data, 0, layer_obj.width, layer_obj.height, start_y, layer_obj.data);
    layer_obj.data = cells;
    return next_y;
}

// Extract v0 records from tEXt / zTXt chunks → [{keyword, data: Buffer}]
function extract_v0_records(buf) {
    const records = [];
    each_png_chunk(buf, (type, data) => {
        let keyword, binary;
        if (type === "tEXt") {
            const nul = data.indexOf(0);
            if (nul < 0) return;
            keyword = data.slice(0, nul).toString("ascii");
            const text = data.slice(nul + 1).toString("latin1");
            binary = Buffer.from(text, "base64");
        } else if (type === "zTXt") {
            const nul = data.indexOf(0);
            if (nul < 0) return;
            keyword = data.slice(0, nul).toString("ascii");
            try {
                const text = zlib.inflateSync(data.slice(nul + 2)).toString("utf8");
                binary = Buffer.from(text, "base64");
            } catch (_) { return; }
        } else { return; }
        records.push({keyword, data: binary});
    });
    return records;
}

const LAYER_CONT_RE = /^LAYER_(\d+)~(\d+)$/;

function read_icy_v0(buf) {
    const records = extract_v0_records(buf);
    if (records.length === 0) return null;

    const iced = records.find(r => r.keyword === "ICED");
    if (!iced || iced.data.length < 17) return null;
    const iced_version = iced.data.readUInt16LE(0);
    // v0 ICED: no font dims at end (last 8 bytes = width+height)
    // v1 ICED in zTXt container: font dims at end (last 10 bytes = width+height+fw+fh)
    const w_off = iced_version === 0 ? iced.data.length - 8 : iced.data.length - 10;
    const columns = iced.data.readUInt32LE(w_off);
    const rows    = iced.data.readUInt32LE(w_off + 4);
    if (columns <= 0 || rows <= 0 || columns > 65535 || rows > 65535) return null;

    const layer_objs   = [];  // parsed layer objects
    const layer_resume = [];  // next_y per layer index for continuations

    for (const {keyword, data} of records) {
        if (keyword === "END") break;
        if (keyword === "ICED" || keyword === "FONT" || keyword.startsWith("FONT_")) continue;

        const cont = LAYER_CONT_RE.exec(keyword);
        if (cont) {
            const idx = parseInt(cont[1], 10);
            if (layer_objs[idx]) {
                const start_y = layer_resume[idx] ?? 0;
                layer_resume[idx] = v0_apply_continuation(layer_objs[idx], data, start_y);
            }
            continue;
        }

        if (keyword.startsWith("LAYER_")) {
            try {
                const layer = parse_v0_layer(data);
                if (layer) {
                    layer_resume.push(layer.height); // mark done (will be overridden by continuations)
                    layer_objs.push(layer);
                }
            } catch (_) {}
        }
    }

    const layers = layer_objs.filter(Boolean);
    if (layers.length === 0) return null;
    return {columns, rows, layers};
}

// ── Public entry point ───────────────────────────────────────────────────────

function read_icy(buffer) {
    check_png_sig(buffer);

    const result = read_icy_v1(buffer) ?? read_icy_v0(buffer);
    if (!result) throw new Error("no character layers found in .icy file");

    const {columns, rows, layers} = result;

    const extended_colors = layers.some(l =>
        l.data.some(b => b && (b.fg_rgb || b.bg_rgb || b.fg_idx !== undefined || b.bg_idx !== undefined))
    );

    const our_layers = layers.map(l => ({
        name:       l.name || "Layer",
        visible:    l.visible,
        locked:     l.locked,
        opacity:    1.0,
        blend_mode: "normal",
        offset_x:   0,
        offset_y:   0,
        data: build_canvas_data(l.data, l.width, l.height, columns, rows),
    }));

    return {columns, rows, layers: our_layers, extended_colors};
}

module.exports = {read_icy};
