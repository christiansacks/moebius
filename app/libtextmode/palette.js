const black = {r: 0, g: 0, b: 0};
const blue = {r: 0, g: 0, b: 42};
const green = {r: 0, g: 42, b:   0};
const cyan = {r: 0, g: 42, b: 42};
const red = {r: 42, g: 0, b: 0};
const magenta = {r: 42, g: 0, b: 42};
const yellow = {r: 42, g: 21, b: 0};
const white = {r: 42, g: 42, b: 42};
const bright_black = {r: 21, g: 21, b: 21};
const bright_blue = {r: 21, g: 21, b: 63};
const bright_green = {r: 21, g: 63, b: 21};
const bright_cyan = {r: 21, g: 63, b: 63};
const bright_red = {r: 63, g: 21, b: 21};
const bright_magenta = {r: 63, g: 21, b: 63};
const bright_yellow = {r: 63, g: 63, b: 21};
const bright_white = {r: 63, g: 63, b: 63};

const c64_black = {r: 0, g: 0, b: 0};
const c64_white = {r: 63, g: 63, b: 63};
const c64_red = {r: 32, g: 13, b: 14};
const c64_cyan = {r: 29, g: 51, b: 50};
const c64_violet = {r: 35, g: 15, b: 37};
const c64_green = {r: 21, g: 43, b: 19};
const c64_blue = {r: 12, g: 11, b: 38};
const c64_yellow = {r: 59, g: 60, b: 28};
const c64_orange = {r: 35, g: 20, b: 10};
const c64_brown = {r: 21, g: 14, b: 0};
const c64_light_red = {r: 48, g: 27, b: 28};
const c64_dark_grey = {r: 19, g: 19, b: 18};
const c64_grey = {r: 31, g: 31, b: 31};
const c64_light_green = {r: 42, g: 63, b: 39};
const c64_light_blue = {r: 26, g: 27, b: 58};
const c64_light_grey = {r: 44, g: 44, b: 44};

const ega = [black, blue, green, cyan, red, magenta, yellow, white, bright_black, bright_blue, bright_green, bright_cyan, bright_red, bright_magenta, bright_yellow, bright_white];
const c64 = [c64_black, c64_white, c64_red, c64_cyan, c64_violet, c64_green, c64_blue, c64_yellow, c64_orange, c64_brown, c64_light_red, c64_dark_grey, c64_grey, c64_light_green, c64_light_blue, c64_light_grey];

function get_rgba(rgb) {
    return new Uint8Array([rgb.r, rgb.g, rgb.b, 255]);
}

function convert_6bits_to_8bits(value) {
    return (value << 2) | ((value & 0x30) >> 4);
}

function convert_ega_to_vga(rgb) {
    return {
        r: convert_6bits_to_8bits(rgb.r),
        g: convert_6bits_to_8bits(rgb.g),
        b: convert_6bits_to_8bits(rgb.b)
    };
}

function convert_rgb_to_style(rgb) {
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

function convert_ega_to_style(rgb) {
    return convert_rgb_to_style(convert_ega_to_vga(rgb));
}

function has_ansi_palette(palette) {
    for (let i = 0; i < palette.length; i++) {
        if (palette[i].r != ega[i].r || palette[i].g != ega[i].g || palette[i].b != ega[i].b) return false;
    }
    return true;
}

function has_c64_palette(palette) {
    for (let i = 0; i < palette.length; i++) {
        if (palette[i].r != c64[i].r || palette[i].g != c64[i].g || palette[i].b != c64[i].b) return false;
    }
    return true;
}

function build_palette_256() {
    const p = [];
    // 0-15: xterm/ANSI index order with IBM VGA RGB values.
    // Indices 0-15 in 256-colour sequences follow xterm convention (1=red, 4=blue, etc.),
    // NOT IBM VGA order (where 1=blue, 4=red). Using IBM VGA RGB values keeps colours
    // visually consistent with the 16-colour palette while indexing correctly.
    const ansi16 = [
        {r:0,g:0,b:0},       {r:170,g:0,b:0},   {r:0,g:170,b:0},   {r:170,g:85,b:0},
        {r:0,g:0,b:170},     {r:170,g:0,b:170},  {r:0,g:170,b:170}, {r:170,g:170,b:170},
        {r:85,g:85,b:85},    {r:255,g:85,b:85},  {r:85,g:255,b:85}, {r:255,g:255,b:85},
        {r:85,g:85,b:255},   {r:255,g:85,b:255}, {r:85,g:255,b:255},{r:255,g:255,b:255}
    ];
    for (const c of ansi16) p.push(c);
    // 16-231: 6x6x6 color cube
    const lvl = [0, 95, 135, 175, 215, 255];
    for (let r = 0; r < 6; r++)
        for (let g = 0; g < 6; g++)
            for (let b = 0; b < 6; b++)
                p.push({r: lvl[r], g: lvl[g], b: lvl[b]});
    // 232-255: grayscale ramp
    for (let i = 0; i < 24; i++) { const v = i * 10 + 8; p.push({r:v, g:v, b:v}); }
    return p;
}

const palette_256 = build_palette_256();

module.exports = {white, bright_white, ega, c64, palette_256, get_rgba, convert_ega_to_vga, convert_ega_to_style, has_ansi_palette, has_c64_palette};
