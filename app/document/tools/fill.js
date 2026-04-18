const doc = require("../doc");
const {tools, toolbar} = require("../ui/ui");
const mouse = require("../input/mouse");
const keyboard = require("../input/keyboard");
const palette = require("../palette");
const {on, msg_box} = require("../../senders");
let enabled = false;

tools.on("start", (mode) => {
    enabled = (mode == tools.modes.FILL);
    if (enabled) toolbar.show_sample();
});

function same_color(a, a_rgb, b, b_rgb) {
    return (a_rgb || b_rgb) ? (a_rgb && b_rgb && a_rgb.r === b_rgb.r && a_rgb.g === b_rgb.g && a_rgb.b === b_rgb.b) : (a === b);
}

function fill(x, y, col, col_rgb = undefined, col_idx = undefined) {
    const block = doc.get_half_block(x, y);
    if (block.is_blocky) {
        const target_color = block.is_top ? block.upper_block_color : block.lower_block_color;
        const target_rgb = block.is_top ? block.upper_block_rgb : block.lower_block_rgb;
        if (same_color(target_color, target_rgb, col, col_rgb)) return;
        if (doc.connection) {
            const choice = msg_box("Fill", "Using fill whilst connected to a server is a potentially destructive operation. Are you sure?", {type: "question", buttons: ["Perform Fill", "Cancel"], defaultId: 1, cancelId: 1});
            if (choice == 1) return;
        }
        doc.start_undo();
        const queue = [{to: {x, y}, from: {x, y}}];
        while (queue.length) {
            const coord = queue.pop();
            const block = doc.get_half_block(coord.to.x, coord.to.y);
            if (block.is_blocky && ((block.is_top && same_color(block.upper_block_color, block.upper_block_rgb, target_color, target_rgb)) || (!block.is_top && same_color(block.lower_block_color, block.lower_block_rgb, target_color, target_rgb)))) {
                doc.set_half_block(coord.to.x, coord.to.y, col, col_rgb, col_idx);
                if (coord.to.x > 0) queue.push({to: {x: coord.to.x - 1, y: coord.to.y}, from: Object.assign(coord.to)});
                if (coord.to.y > 0) queue.push({to: {x: coord.to.x, y: coord.to.y - 1}, from: Object.assign(coord.to)});
                if (coord.to.x < doc.columns - 1) queue.push({to: {x: coord.to.x + 1, y: coord.to.y}, from: Object.assign(coord.to)});
                if (coord.to.y < doc.rows * 2 - 1) queue.push({to: {x: coord.to.x, y: coord.to.y + 1}, from: Object.assign(coord.to)});
            } else if (block.is_vertically_blocky) {
                if (coord.from.y == coord.to.y - 1 && same_color(block.left_block_color, block.left_block_rgb, target_color, target_rgb)) {
                    doc.change_data(coord.to.x, block.text_y, 221, col, block.right_block_color, undefined, undefined, true, {fg_rgb: col_rgb, fg_idx: col_idx, bg_rgb: block.right_block_rgb, bg_idx: block.right_block_idx});
                } else if (coord.from.y == coord.to.y - 1 && same_color(block.right_block_color, block.right_block_rgb, target_color, target_rgb)) {
                    doc.change_data(coord.to.x, block.text_y, 222, col, block.left_block_color, undefined, undefined, true, {fg_rgb: col_rgb, fg_idx: col_idx, bg_rgb: block.left_block_rgb, bg_idx: block.left_block_idx});
                } else if (coord.from.y == coord.to.y + 1 && same_color(block.right_block_color, block.right_block_rgb, target_color, target_rgb)) {
                    doc.change_data(coord.to.x, block.text_y, 222, col, block.left_block_color, undefined, undefined, true, {fg_rgb: col_rgb, fg_idx: col_idx, bg_rgb: block.left_block_rgb, bg_idx: block.left_block_idx});
                } else if (coord.from.y == coord.to.y + 1 && same_color(block.left_block_color, block.left_block_rgb, target_color, target_rgb)) {
                    doc.change_data(coord.to.x, block.text_y, 221, col, block.right_block_color, undefined, undefined, true, {fg_rgb: col_rgb, fg_idx: col_idx, bg_rgb: block.right_block_rgb, bg_idx: block.right_block_idx});
                } else if (coord.from.x == coord.to.x - 1 && same_color(block.left_block_color, block.left_block_rgb, target_color, target_rgb)) {
                    doc.change_data(coord.to.x, block.text_y, 221, col, block.right_block_color, undefined, undefined, true, {fg_rgb: col_rgb, fg_idx: col_idx, bg_rgb: block.right_block_rgb, bg_idx: block.right_block_idx});
                } else if (coord.from.x == coord.to.x + 1 && same_color(block.right_block_color, block.right_block_rgb, target_color, target_rgb)) {
                    doc.change_data(coord.to.x, block.text_y, 222, col, block.left_block_color, undefined, undefined, true, {fg_rgb: col_rgb, fg_idx: col_idx, bg_rgb: block.left_block_rgb, bg_idx: block.left_block_idx});
                }
            }
        }
    }
}

mouse.on("down", (x, y, half_y, is_legal, button, shift_key) => {
    if (!enabled || !is_legal) return;
    const {fg, bg, fg_rgb, bg_rgb, fg_idx, bg_idx} = palette.draw_colors();
    const use_fg = (button == mouse.buttons.LEFT);
    if (shift_key) {
        fill(x, half_y, 0);
    } else {
        fill(x, half_y, use_fg ? fg : bg, use_fg ? fg_rgb : bg_rgb, use_fg ? fg_idx : bg_idx);
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
