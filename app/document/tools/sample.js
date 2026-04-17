const {tools, toolbar} = require("../ui/ui");
const mouse = require("../input/mouse");
const keyboard = require("../input/keyboard");
const palette = require("../palette");
const doc = require("../doc");
const {on} = require("../../senders");
let enabled = false;

tools.on("start", (mode) => {
    enabled = (mode == tools.modes.SAMPLE);
    if (enabled) toolbar.show_sample();
});

mouse.on("down", (x, y, half_y, is_legal) => {
    if (!enabled || !is_legal) return;
    const block = doc.at(x, y);
    tools.change_to_previous_mode();
    if (block.fg_rgb || block.fg_idx !== undefined) {
        if (block.fg_idx !== undefined) {
            palette.set_extended_fg(block.fg_idx);
        } else {
            palette.set_truecolor_fg(block.fg_rgb.r, block.fg_rgb.g, block.fg_rgb.b);
        }
    } else {
        palette.fg = block.fg;
    }
    if (block.bg_rgb || block.bg_idx !== undefined) {
        if (block.bg_idx !== undefined) {
            palette.set_extended_bg(block.bg_idx);
        } else {
            palette.set_truecolor_bg(block.bg_rgb.r, block.bg_rgb.g, block.bg_rgb.b);
        }
    } else {
        palette.bg = block.bg;
    }
});

mouse.on("move", (x, y, half_y, is_legal) => {
    if (!enabled || !is_legal) return;
    toolbar.set_sample(x, y);
});

function select_attribute() {
    if (!enabled) return;
    palette.select_attribute();
}

keyboard.on("escape", () => select_attribute());
on("select_attribute", (event) => select_attribute());
