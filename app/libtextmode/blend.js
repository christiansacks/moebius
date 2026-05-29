const {palette_256} = require("./palette");

const BLEND_MODES = {NORMAL: "normal", MULTIPLY: "multiply", SCREEN: "screen", OVERLAY: "overlay"};

function block_fg_rgb(block, extended_colors) {
    if (extended_colors && block.fg_rgb) return block.fg_rgb;
    if (extended_colors && block.fg_idx !== undefined) return palette_256[block.fg_idx] || palette_256[block.fg];
    return palette_256[block.fg] || {r: 170, g: 170, b: 170};
}

function block_bg_rgb(block, extended_colors) {
    if (extended_colors && block.bg_rgb) return block.bg_rgb;
    if (extended_colors && block.bg_idx !== undefined) return palette_256[block.bg_idx] || palette_256[block.bg];
    return palette_256[block.bg] || {r: 0, g: 0, b: 0};
}

function lerp(a, b, t) {
    return Math.round(a + (b - a) * t);
}

function blend_channel(top, bot, mode) {
    switch (mode) {
        case BLEND_MODES.MULTIPLY: return Math.round(top * bot / 255);
        case BLEND_MODES.SCREEN: return 255 - Math.round((255 - top) * (255 - bot) / 255);
        case BLEND_MODES.OVERLAY:
            return bot < 128
                ? Math.round(2 * top * bot / 255)
                : 255 - Math.round(2 * (255 - top) * (255 - bot) / 255);
        default: return top;
    }
}

function blend_rgb(top_c, bot_c, opacity, mode) {
    return {
        r: lerp(bot_c.r, blend_channel(top_c.r, bot_c.r, mode), opacity),
        g: lerp(bot_c.g, blend_channel(top_c.g, bot_c.g, mode), opacity),
        b: lerp(bot_c.b, blend_channel(top_c.b, bot_c.b, mode), opacity),
    };
}

function nearest_16color(rgb) {
    let best = 0, best_dist = Infinity;
    for (let i = 0; i < 16; i++) {
        const p = palette_256[i];
        const d = (rgb.r - p.r) ** 2 + (rgb.g - p.g) ** 2 + (rgb.b - p.b) ** 2;
        if (d < best_dist) { best_dist = d; best = i; }
    }
    return best;
}

function nearest_256color(rgb) {
    let best = 0, best_dist = Infinity;
    for (let i = 0; i < 256; i++) {
        const p = palette_256[i];
        const d = (rgb.r - p.r) ** 2 + (rgb.g - p.g) ** 2 + (rgb.b - p.b) ** 2;
        if (d < best_dist) { best_dist = d; best = i; }
    }
    return best;
}

function composite_block(top, bot, opacity, mode, extended_colors) {
    if (top === null || top === undefined) return bot;
    if (bot === null || bot === undefined) return top;
    if (opacity >= 1.0 && mode === BLEND_MODES.NORMAL) return top;
    const code = opacity >= 0.5 ? top.code : bot.code;
    const top_fg = block_fg_rgb(top, extended_colors);
    const top_bg = block_bg_rgb(top, extended_colors);
    const bot_fg = block_fg_rgb(bot, extended_colors);
    const bot_bg = block_bg_rgb(bot, extended_colors);
    const fg_blended = blend_rgb(top_fg, bot_fg, opacity, mode);
    const bg_blended = blend_rgb(top_bg, bot_bg, opacity, mode);
    if (extended_colors) {
        const fg_idx = nearest_256color(fg_blended);
        const bg_idx = nearest_256color(bg_blended);
        return {code, fg: nearest_16color(fg_blended), bg: nearest_16color(bg_blended), fg_rgb: fg_blended, bg_rgb: bg_blended, fg_idx, bg_idx};
    }
    return {code, fg: nearest_16color(fg_blended), bg: nearest_16color(bg_blended)};
}

module.exports = {BLEND_MODES, composite_block};
