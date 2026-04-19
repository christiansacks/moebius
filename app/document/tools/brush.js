const {tools, toolbar} = require("../ui/ui");
const doc = require("../doc");
const mouse = require("../input/mouse");
const keyboard = require("../input/keyboard");
const palette = require("../palette");
const brushes = require("./brushes");
const {on} = require("../../senders");
let enabled = false;
let chunked_undo = true;
let tab_held_down = false;
let last_xy;

tools.on("start", (mode) => {
    enabled = (mode == tools.modes.BRUSH);
    if (enabled) {
        toolbar.show_brush();
    } else if (tab_held_down) {
        tab_held_down = false;
    }
});

function mouse_handler(skip_first) {
    return (x, y, half_y, is_legal, button, shift_key) => {
        if (!enabled) return;
        if (!chunked_undo || !skip_first) doc.start_undo();
        mouse.start_drawing();
        const {fg, bg, fg_rgb, bg_rgb, fg_idx, bg_idx} = palette.draw_colors();
        const colors_ext = {fg_rgb, bg_rgb, fg_idx, bg_idx};
        if (toolbar.mode == toolbar.modes.HALF_BLOCK) {
            if (shift_key) {
                brushes.half_block_line(mouse.x, mouse.half_y, x, half_y, 0, skip_first);
            } else {
                const use_fg = (button == mouse.buttons.LEFT);
                brushes.half_block_line(mouse.x, mouse.half_y, x, half_y, use_fg ? fg : bg, skip_first, use_fg ? fg_rgb : bg_rgb, use_fg ? fg_idx : bg_idx);
            }
        } else if (shift_key) {
            brushes.clear_block_line(mouse.x, mouse.y, x, y);
        } else {
            switch (toolbar.mode) {
                case toolbar.modes.CUSTOM_BLOCK:
                    brushes.custom_block_line(mouse.x, mouse.y, x, y, fg, bg, skip_first, colors_ext);
                    break;
                case toolbar.modes.SHADING_BLOCK:
                    brushes.shading_block_line(mouse.x, mouse.y, x, y, fg, bg, button != mouse.buttons.LEFT, skip_first);
                    break;
                case toolbar.modes.REPLACE_COLOR:
                    brushes.replace_color_line(mouse.x, mouse.y, x, y, fg, bg, skip_first);
                    break;
                case toolbar.modes.BLINK:
                    brushes.blink_line(mouse.x, mouse.y, x, y, button != mouse.buttons.LEFT, skip_first);
                    break;
                case toolbar.modes.COLORIZE:
                    brushes.colorize_line(mouse.x, mouse.y, x, y, toolbar.colorize_fg ? fg : undefined, toolbar.colorize_bg ? bg : undefined, skip_first, toolbar.colorize_fg ? fg_rgb : undefined, toolbar.colorize_bg ? bg_rgb : undefined, toolbar.colorize_fg ? fg_idx : undefined, toolbar.colorize_bg ? bg_idx : undefined);
                    break;
            }
        }
    };
}

function mouse_up(x, y, half_y, button, single_point, shift_key) {
    if (!enabled) return;
    if (tab_held_down && single_point && last_xy != undefined) {
        const {fg, bg, fg_rgb, bg_rgb, fg_idx, bg_idx} = palette.draw_colors();
        const colors_ext = {fg_rgb, bg_rgb, fg_idx, bg_idx};
        switch (toolbar.mode) {
            case toolbar.modes.HALF_BLOCK: {
                const use_fg = (button == mouse.buttons.LEFT);
                brushes.half_block_line(last_xy.x, last_xy.half_y, x, half_y, use_fg ? fg : bg, false, use_fg ? fg_rgb : bg_rgb, use_fg ? fg_idx : bg_idx);
                break;
            }
            case toolbar.modes.CUSTOM_BLOCK:
                brushes.custom_block_line(last_xy.x, last_xy.y, x, y, fg, bg, false, colors_ext);
                break;
            case toolbar.modes.SHADING_BLOCK:
                brushes.shading_block_line(last_xy.x, last_xy.y, x, y, fg, bg, button != mouse.buttons.LEFT);
                break;
            case toolbar.modes.REPLACE_COLOR:
                brushes.replace_color_line(last_xy.x, last_xy.y, x, y, fg, bg);
                break;
            case toolbar.modes.BLINK:
                brushes.blink_line(last_xy.x, last_xy.y, x, y, button != mouse.buttons.LEFT);
                break;
            case toolbar.modes.COLORIZE:
                brushes.colorize_line(last_xy.x, last_xy.y, x, y, toolbar.colorize_fg ? fg : undefined, toolbar.colorize_bg ? bg : undefined, false, toolbar.colorize_fg ? fg_rgb : undefined, toolbar.colorize_bg ? bg_rgb : undefined, toolbar.colorize_fg ? fg_idx : undefined, toolbar.colorize_bg ? bg_idx : undefined);
                break;
        }
    }
    last_xy = {x, y, half_y};
}

on("chunked_undo", (event, value) => chunked_undo = value);

document.addEventListener("keydown", (event) => {
    if (!enabled) return;
    if (event.code == "Tab") tab_held_down = true;
}, true);

document.addEventListener("keyup", (event) => {
    if (!enabled) return;
    if (event.code == "Tab") tab_held_down = false;
}, true);

mouse.on("down", mouse_handler(false));
mouse.on("draw", mouse_handler(true));
mouse.on("up", mouse_up);

function select_attribute() {
    if (!enabled) return;
    palette.select_attribute();
}

keyboard.on("escape", () => select_attribute());
on("select_attribute", (event) => select_attribute());

keyboard.on("f_key", (num) => {
    if (!enabled) return;
    toolbar.change_custom_brush(num);
});
