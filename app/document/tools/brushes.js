const doc = require("../doc");
const {toolbar} = require("../ui/ui")

function line(x0, y0, x1, y1, skip_first = false) {
    const dx = Math.abs(x1 - x0);
    const sx = (x0 < x1) ? 1 : -1;
    const dy = Math.abs(y1 - y0);
    const sy = (y0 < y1) ? 1 : -1;
    let err = ((dx > dy) ? dx : -dy) / 2;
    let e2;
    const coords = [];
    while (true) {
        coords.push({x: x0, y: y0});
        if (x0 == x1 && y0 == y1) break;
        e2 = err;
        if (e2 > -dx) {
            err -= dy;
            x0 += sx;
        }
        if (e2 < dy) {
            err += dx;
            y0 += sy;
        }
    }
    if (skip_first && coords.length > 1) coords.shift();
    return coords;
}

function single_half_block_line(sx, sy, dx, dy, col, skip_first, col_rgb = undefined, col_idx = undefined) {
    const coords = line(sx, sy, dx, dy, skip_first);
    for (const coord of coords) doc.set_half_block(coord.x, coord.y, col, col_rgb, col_idx);
}

function half_block_line(sx, sy, dx, dy, col, skip_first, col_rgb = undefined, col_idx = undefined) {
    const coords = line(sx, sy, dx, dy, skip_first);
    for (const coord of coords) {
        for (let x = -Math.floor(toolbar.brush_size / 2); x < -Math.floor(toolbar.brush_size / 2) + toolbar.brush_size; x++) {
            for (let y = -Math.floor(toolbar.brush_size / 2); y < -Math.floor(toolbar.brush_size / 2) + toolbar.brush_size; y++) {
                doc.set_half_block(coord.x + x, coord.y + y, col, col_rgb, col_idx);
            }
        }
    }
}

function single_custom_block_line(sx, sy, dx, dy, fg, bg, skip_first = false, colors_ext = {}) {
    const coords = line(sx, sy, dx, dy, skip_first);
    for (const coord of coords) doc.change_data(coord.x, coord.y, toolbar.custom_block_index, fg, bg, undefined, undefined, true, colors_ext);
}

function custom_block_line(sx, sy, dx, dy, fg, bg, skip_first = false, colors_ext = {}) {
    const coords = line(sx, sy, dx, dy, skip_first);
    for (const coord of coords) {
        for (let x = -Math.floor(toolbar.brush_size / 2); x < -Math.floor(toolbar.brush_size / 2) + toolbar.brush_size; x++) {
            for (let y = -Math.floor(toolbar.brush_size / 2); y < -Math.floor(toolbar.brush_size / 2) + toolbar.brush_size; y++) {
                doc.change_data(coord.x + x, coord.y + y, toolbar.custom_block_index, fg, bg, undefined, undefined, true, colors_ext);
            }
        }
    }
}

function shading_block(x, y, fg, bg, reduce, colors_ext = {}) {
    const block = doc.at(x, y);
    if (block) {
        if (reduce) {
            switch (block.code) {
                case 176: doc.change_data(x, y, 32, fg, bg, undefined, undefined, true, colors_ext); break;
                case 177: doc.change_data(x, y, 176, fg, bg, undefined, undefined, true, colors_ext); break;
                case 178: doc.change_data(x, y, 177, fg, bg, undefined, undefined, true, colors_ext); break;
                case 219: if (block.fg == fg) doc.change_data(x, y, 178, fg, bg, undefined, undefined, true, colors_ext); break;
            }
        } else {
            switch (block.code) {
                case 219: if (block.fg != fg) doc.change_data(x, y, 176, fg, bg, undefined, undefined, true, colors_ext); break;
                case 178: doc.change_data(x, y, 219, fg, bg, undefined, undefined, true, colors_ext); break;
                case 177: doc.change_data(x, y, 178, fg, bg, undefined, undefined, true, colors_ext); break;
                case 176: doc.change_data(x, y, 177, fg, bg, undefined, undefined, true, colors_ext); break;
                default: doc.change_data(x, y, 176, fg, bg, undefined, undefined, true, colors_ext); break;
            }
        }
    }
}

function single_shading_block_line(sx, sy, dx, dy, fg, bg, reduce, skip_first = false, colors_ext = {}) {
    const coords = line(sx, sy, dx, dy, skip_first);
    for (const coord of coords) shading_block(coord.x, coord.y, fg, bg, reduce, colors_ext);
}

function shading_block_line(sx, sy, dx, dy, fg, bg, reduce, skip_first = false, colors_ext = {}) {
    const coords = line(sx, sy, dx, dy, skip_first);
    for (const coord of coords) {
        for (let brush_size_x = -Math.floor(toolbar.brush_size / 2); brush_size_x < -Math.floor(toolbar.brush_size / 2) + toolbar.brush_size; brush_size_x++) {
            for (let brush_size_y = -Math.floor(toolbar.brush_size / 2); brush_size_y < -Math.floor(toolbar.brush_size / 2) + toolbar.brush_size; brush_size_y++) {
                shading_block(coord.x + brush_size_x, coord.y + brush_size_y, fg, bg, reduce, colors_ext);
            }
        }
    }
}

function single_clear_block_line(sx, sy, dx, dy, skip_first = false) {
    const coords = line(sx, sy, dx, dy, skip_first);
    for (const coord of coords) doc.change_data(coord.x, coord.y, 32, 7, 0);
}

function clear_block_line(sx, sy, dx, dy, skip_first = false) {
    const coords = line(sx, sy, dx, dy, skip_first);
    for (const coord of coords) {
        for (let x = -Math.floor(toolbar.brush_size / 2); x < -Math.floor(toolbar.brush_size / 2) + toolbar.brush_size; x++) {
            for (let y = -Math.floor(toolbar.brush_size / 2); y < -Math.floor(toolbar.brush_size / 2) + toolbar.brush_size; y++) {
                doc.change_data(coord.x + x, coord.y + y, 32, 7, 0);
            }
        }
    }
}

function color_matches(block_val, block_idx, block_rgb, from, from_idx, from_rgb) {
    if (from_idx !== undefined) return block_idx === from_idx;
    if (from_rgb) return block_rgb && block_rgb.r === from_rgb.r && block_rgb.g === from_rgb.g && block_rgb.b === from_rgb.b;
    return block_val === from;
}

function replace_block(bx, by, to, from, to_rgb, to_idx, from_rgb, from_idx) {
    const block = doc.at(bx, by);
    if (!block) return;
    const fg_match = color_matches(block.fg, block.fg_idx, block.fg_rgb, from, from_idx, from_rgb);
    const bg_match = color_matches(block.bg, block.bg_idx, block.bg_rgb, from, from_idx, from_rgb);
    if (!fg_match && !bg_match) return;
    doc.change_data(bx, by, block.code,
        fg_match ? to : block.fg, bg_match ? to : block.bg,
        undefined, undefined, true,
        {
            fg_rgb: fg_match ? to_rgb : block.fg_rgb, fg_idx: fg_match ? to_idx : block.fg_idx,
            bg_rgb: bg_match ? to_rgb : block.bg_rgb, bg_idx: bg_match ? to_idx : block.bg_idx,
        });
}

function single_replace_color_line(sx, sy, dx, dy, to, from, skip_first = false, to_rgb, to_idx, from_rgb, from_idx) {
    const coords = line(sx, sy, dx, dy, skip_first);
    for (const coord of coords) replace_block(coord.x, coord.y, to, from, to_rgb, to_idx, from_rgb, from_idx);
}

function replace_color_line(sx, sy, dx, dy, to, from, skip_first = false, to_rgb, to_idx, from_rgb, from_idx) {
    const coords = line(sx, sy, dx, dy, skip_first);
    for (const coord of coords) {
        for (let x = -Math.floor(toolbar.brush_size / 2); x < -Math.floor(toolbar.brush_size / 2) + toolbar.brush_size; x++) {
            for (let y = -Math.floor(toolbar.brush_size / 2); y < -Math.floor(toolbar.brush_size / 2) + toolbar.brush_size; y++) {
                replace_block(coord.x + x, coord.y + y, to, from, to_rgb, to_idx, from_rgb, from_idx);
            }
        }
    }
}

function single_blink_line(sx, sy, dx, dy, unblink, skip_first = false) {
    const coords = line(sx, sy, dx, dy, skip_first);
    for (const coord of coords) {
        const block = doc.at(coord.x, coord.y);
        if (block && ((!unblink && block.bg < 8) || (unblink && block.bg >= 8)) && (block.code != 0 && block.code != 32 && block.code != 255)) doc.change_data(coord.x, coord.y, block.code, block.fg, unblink ? block.bg - 8 : block.bg + 8, undefined, undefined, true, {fg_rgb: block.fg_rgb, bg_rgb: block.bg_rgb, fg_idx: block.fg_idx, bg_idx: block.bg_idx});
    }
}

function blink_line(sx, sy, dx, dy, unblink, skip_first = false) {
    const coords = line(sx, sy, dx, dy, skip_first);
    for (const coord of coords) {
        for (let x = -Math.floor(toolbar.brush_size / 2); x < -Math.floor(toolbar.brush_size / 2) + toolbar.brush_size; x++) {
            for (let y = -Math.floor(toolbar.brush_size / 2); y < -Math.floor(toolbar.brush_size / 2) + toolbar.brush_size; y++) {
                const block = doc.at(coord.x + x, coord.y + y);
                if (block && ((!unblink && block.bg < 8) || (unblink && block.bg >= 8)) && (block.code != 0 && block.code != 32 && block.code != 255)) doc.change_data(coord.x + x, coord.y + y, block.code, block.fg, unblink ? block.bg - 8 : block.bg + 8, undefined, undefined, true, {fg_rgb: block.fg_rgb, bg_rgb: block.bg_rgb, fg_idx: block.fg_idx, bg_idx: block.bg_idx});
            }
        }
    }
}

function single_colorize_line(sx, sy, dx, dy, fg, bg, skip_first = false, fg_rgb, bg_rgb, fg_idx, bg_idx) {
    const coords = line(sx, sy, dx, dy, skip_first);
    for (const coord of coords) {
        const block = doc.at(coord.x, coord.y);
        if (block) doc.change_data(coord.x, coord.y, block.code, (fg != undefined) ? fg : block.fg, (bg != undefined) ? bg : block.bg, undefined, undefined, true, {fg_rgb: (fg != undefined) ? fg_rgb : block.fg_rgb, bg_rgb: (bg != undefined) ? bg_rgb : block.bg_rgb, fg_idx: (fg != undefined) ? fg_idx : block.fg_idx, bg_idx: (bg != undefined) ? bg_idx : block.bg_idx});
    }
}

function colorize_line(sx, sy, dx, dy, fg, bg, skip_first = false, fg_rgb, bg_rgb, fg_idx, bg_idx) {
    const coords = line(sx, sy, dx, dy, skip_first);
    for (let x = -Math.floor(toolbar.brush_size / 2); x < -Math.floor(toolbar.brush_size / 2) + toolbar.brush_size; x++) {
        for (let y = -Math.floor(toolbar.brush_size / 2); y < -Math.floor(toolbar.brush_size / 2) + toolbar.brush_size; y++) {
            for (const coord of coords) {
                const block = doc.at(coord.x + x, coord.y + y);
                if (block) doc.change_data(coord.x + x, coord.y + y, block.code, (fg != undefined) ? fg : block.fg, (bg != undefined) ? bg : block.bg, undefined, undefined, true, {fg_rgb: (fg != undefined) ? fg_rgb : block.fg_rgb, bg_rgb: (bg != undefined) ? bg_rgb : block.bg_rgb, fg_idx: (fg != undefined) ? fg_idx : block.fg_idx, bg_idx: (bg != undefined) ? bg_idx : block.bg_idx});
            }
        }
    }
}

module.exports = {single_half_block_line, half_block_line, single_custom_block_line, custom_block_line, shading_block, single_shading_block_line, shading_block_line, single_clear_block_line, clear_block_line, replace_block, single_replace_color_line, replace_color_line, single_blink_line, blink_line, single_colorize_line, colorize_line, line};
