const doc = require("./doc");
const libtextmode = require("../libtextmode/libtextmode");
const keyboard = require("./input/keyboard");
const {on, send_sync} = require("../senders");
const {palette_256} = require("../libtextmode/palette");
const events = require("events");

const CELL = 12, GAP = 1, COLS = 16, SG = 4; // picker grid constants

class PaletteChooser extends events.EventEmitter {

    // ── 16-colour setters (unchanged behaviour, but now clear extended state) ──

    set fg(value) {
        if (this.fg_value != undefined && this.divs) this.divs[this.fg_value].classList.remove("selected_fg");
        this.divs[value].classList.add("selected_fg");
        document.getElementById("fg").style.backgroundColor = this.divs[value].style.backgroundColor;
        this.fg_value = value;
        this.fg_rgb = null;
        this.fg_idx = null;
        this.emit("set_fg", this.fg_value);
    }

    get fg() { return this.fg_value; }

    set bg(value) {
        if (this.bg_value != undefined && this.divs) this.divs[this.bg_value].classList.remove("selected_bg");
        this.divs[value].classList.add("selected_bg");
        document.getElementById("bg").style.backgroundColor = this.divs[value].style.backgroundColor;
        this.bg_value = value;
        this.bg_rgb = null;
        this.bg_idx = null;
        this.emit("set_bg", this.bg_value);
        if (libtextmode.has_c64_palette(doc.palette)) {
            doc.c64_background = this.bg_value;
            doc.start_rendering();
        }
    }

    get bg() { return this.bg_value; }

    // ── Extended colour API ────────────────────────────────────────────────────

    draw_colors() {
        return {
            fg:     this.fg_value,
            bg:     this.bg_value,
            fg_rgb: this.fg_rgb  || undefined,
            bg_rgb: this.bg_rgb  || undefined,
            fg_idx: this.fg_idx !== null ? this.fg_idx : undefined,
            bg_idx: this.bg_idx !== null ? this.bg_idx : undefined,
        };
    }

    set_extended_fg(idx) {
        if (this.fg_value != undefined && this.divs) this.divs[this.fg_value].classList.remove("selected_fg");
        this.fg_idx = idx;
        this.fg_rgb = palette_256[idx];
        const {r, g, b} = this.fg_rgb;
        document.getElementById("fg").style.backgroundColor = `rgb(${r},${g},${b})`;
        if (!doc.extended_colors) doc.extended_colors = true;
        this.emit("set_fg", this.fg_value);
    }

    set_extended_bg(idx) {
        if (this.bg_value != undefined && this.divs) this.divs[this.bg_value].classList.remove("selected_bg");
        this.bg_idx = idx;
        this.bg_rgb = palette_256[idx];
        const {r, g, b} = this.bg_rgb;
        document.getElementById("bg").style.backgroundColor = `rgb(${r},${g},${b})`;
        if (!doc.extended_colors) doc.extended_colors = true;
        this.emit("set_bg", this.bg_value);
    }

    set_truecolor_fg(r, g, b) {
        if (this.fg_value != undefined && this.divs) this.divs[this.fg_value].classList.remove("selected_fg");
        this.fg_idx = null;
        this.fg_rgb = {r, g, b};
        document.getElementById("fg").style.backgroundColor = `rgb(${r},${g},${b})`;
        if (!doc.extended_colors) doc.extended_colors = true;
        this.emit("set_fg", this.fg_value);
    }

    set_truecolor_bg(r, g, b) {
        if (this.bg_value != undefined && this.divs) this.divs[this.bg_value].classList.remove("selected_bg");
        this.bg_idx = null;
        this.bg_rgb = {r, g, b};
        document.getElementById("bg").style.backgroundColor = `rgb(${r},${g},${b})`;
        if (!doc.extended_colors) doc.extended_colors = true;
        this.emit("set_bg", this.bg_value);
    }

    // ── 256-colour picker popup ───────────────────────────────────────────────

    _picker_canvas_xy(i) {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        return {x: col * (CELL + GAP), y: row * (CELL + GAP) + (row > 0 ? SG : 0)};
    }

    _picker_index_at(mx, my) {
        for (let i = 0; i < 256; i++) {
            const {x, y} = this._picker_canvas_xy(i);
            if (mx >= x && mx < x + CELL && my >= y && my < y + CELL) return i;
        }
        return -1;
    }

    _build_picker_canvas() {
        const cw = COLS * (CELL + GAP) - GAP;
        const ch = 16 * (CELL + GAP) - GAP + SG;
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        for (let i = 0; i < 256; i++) {
            const {x, y} = this._picker_canvas_xy(i);
            const c = palette_256[i];
            ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
            ctx.fillRect(x, y, CELL, CELL);
        }
        // thin separator after the 16 basic colours
        const sep_y = (CELL + GAP) + Math.floor(SG / 2);
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.fillRect(0, sep_y, cw, 1);
        return canvas;
    }

    build_picker() {
        const popup = document.createElement("div");
        popup.id = "color_picker_popup";

        const canvas = this._build_picker_canvas();

        const tooltip = document.createElement("div");
        tooltip.className = "picker_tooltip";
        tooltip.textContent = "\u00a0";

        // true-colour inputs
        const tc_fg = document.createElement("input");
        tc_fg.type = "color"; tc_fg.title = "Custom true-color FG"; tc_fg.value = "#aaaaaa";
        tc_fg.addEventListener("input", (e) => {
            const v = e.target.value;
            this.set_truecolor_fg(parseInt(v.slice(1,3),16), parseInt(v.slice(3,5),16), parseInt(v.slice(5,7),16));
        });

        const tc_bg = document.createElement("input");
        tc_bg.type = "color"; tc_bg.title = "Custom true-color BG"; tc_bg.value = "#000000";
        tc_bg.addEventListener("input", (e) => {
            const v = e.target.value;
            this.set_truecolor_bg(parseInt(v.slice(1,3),16), parseInt(v.slice(3,5),16), parseInt(v.slice(5,7),16));
        });

        const bottom = document.createElement("div");
        bottom.className = "picker_bottom";
        const lbl = document.createElement("span");
        lbl.textContent = "L=fg  R=bg  Custom:";
        const lbl_fg = document.createElement("label"); lbl_fg.textContent = "FG"; lbl_fg.title = "True-color FG";
        const lbl_bg = document.createElement("label"); lbl_bg.textContent = "BG"; lbl_bg.title = "True-color BG";
        bottom.appendChild(lbl);
        bottom.appendChild(tc_fg); bottom.appendChild(lbl_fg);
        bottom.appendChild(tc_bg); bottom.appendChild(lbl_bg);

        canvas.addEventListener("mousemove", (e) => {
            const r = canvas.getBoundingClientRect();
            const idx = this._picker_index_at(e.clientX - r.left, e.clientY - r.top);
            if (idx >= 0) {
                const c = palette_256[idx];
                tooltip.textContent = `#${idx}  rgb(${c.r},${c.g},${c.b})`;
            } else {
                tooltip.textContent = "\u00a0";
            }
        });
        canvas.addEventListener("mouseleave", () => { tooltip.textContent = "\u00a0"; });
        canvas.addEventListener("mousedown", (e) => {
            e.preventDefault();
            const r = canvas.getBoundingClientRect();
            const idx = this._picker_index_at(e.clientX - r.left, e.clientY - r.top);
            if (idx < 0) return;
            if (e.button === 2 || e.ctrlKey) {
                this.set_extended_bg(idx);
            } else {
                this.set_extended_fg(idx);
            }
        });
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());

        popup.appendChild(canvas);
        popup.appendChild(tooltip);
        popup.appendChild(bottom);
        document.body.appendChild(popup);

        // close on outside click
        document.addEventListener("mousedown", (e) => {
            if (!popup.contains(e.target) && e.target.id !== "fg" && e.target.id !== "bg") {
                this.hide_picker();
            }
        }, true);

        return popup;
    }

    show_picker() {
        if (!this.picker_popup) this.picker_popup = this.build_picker();
        const rect = document.getElementById("fg").getBoundingClientRect();
        this.picker_popup.style.top = Math.max(0, rect.top - 4) + "px";
        this.picker_popup.style.display = "block";
    }

    hide_picker() {
        if (this.picker_popup) this.picker_popup.style.display = "none";
    }

    // ── Existing palette methods ──────────────────────────────────────────────

    update_swatches() {
        const swatches = document.getElementById("swatches");
        if (this.divs) for (const div of this.divs) swatches.removeChild(div);
        this.divs = doc.palette.map((rgb, i) => {
            const div = document.createElement("div");
            div.style.backgroundColor = libtextmode.convert_ega_to_style(rgb);
            div.addEventListener("mousedown", (event) => {
                if (event.button == 2 || event.ctrlKey) {
                    this.bg = i;
                } else if (event.button == 0) {
                    this.fg = i;
                }
            });
            return div;
        });
        for (const div of this.divs) swatches.appendChild(div);
        this.fg = this.fg_value;
        this.bg = this.bg_value;
        if (libtextmode.has_c64_palette(doc.palette)) {
            doc.c64_background = this.bg_value;
        } else {
            doc.c64_background = undefined;
        }
    }

    new_document() {
        this.fg_rgb = null; this.fg_idx = null;
        this.bg_rgb = null; this.bg_idx = null;
        if (doc.c64_background != undefined) {
            this.bg_value = doc.c64_background;
        } else if (libtextmode.has_c64_palette(doc.palette)) {
            this.bg_value = doc.get_blocks(0, 0, 0, 0).data[0].bg;
            this.emit("set_bg", this.bg_value);
            doc.c64_background = this.bg_value;
        }
        this.update_swatches();
    }

    previous_foreground_color() { this.fg = (this.fg == 0) ? 15 : this.fg - 1; }
    next_foreground_color()     { this.fg = (this.fg == 15) ? 0 : this.fg + 1; }

    previous_background_color() {
        this.bg = (this.bg == 0) ? 15 : this.bg - 1;
        if (doc.connection) doc.connection.set_bg(this.bg);
    }

    next_background_color() {
        this.bg = (this.bg == 15) ? 0 : this.bg + 1;
        if (doc.connection) doc.connection.set_bg(this.bg);
    }

    default_color() {
        this.fg_rgb = null; this.fg_idx = null;
        this.bg_rgb = null; this.bg_idx = null;
        this.fg = 7;
        this.bg = 0;
        if (doc.connection) doc.connection.set_bg(this.bg);
    }

    switch_foreground_background() {
        // Save everything before touching setters (which have side-effects)
        const old_fg_val = this.fg_value, old_bg_val = this.bg_value;
        const old_fg_rgb = this.fg_rgb, old_fg_idx = this.fg_idx;
        const old_bg_rgb = this.bg_rgb, old_bg_idx = this.bg_idx;

        // Swap swatch highlights without going through setter
        if (this.divs) {
            if (old_fg_val != undefined) this.divs[old_fg_val].classList.remove("selected_fg");
            if (old_bg_val != undefined) this.divs[old_bg_val].classList.remove("selected_bg");
        }
        this.fg_value = old_bg_val; this.bg_value = old_fg_val;
        this.fg_rgb = old_bg_rgb;   this.fg_idx = old_bg_idx;
        this.bg_rgb = old_fg_rgb;   this.bg_idx = old_fg_idx;
        if (this.divs) {
            if (!this.fg_rgb) this.divs[this.fg_value].classList.add("selected_fg");
            if (!this.bg_rgb) this.divs[this.bg_value].classList.add("selected_bg");
        }

        const _rgb_str = (rgb, idx) => rgb
            ? `rgb(${rgb.r},${rgb.g},${rgb.b})`
            : (this.divs ? this.divs[idx].style.backgroundColor : "");
        document.getElementById("fg").style.backgroundColor = _rgb_str(this.fg_rgb, this.fg_value);
        document.getElementById("bg").style.backgroundColor = _rgb_str(this.bg_rgb, this.bg_value);

        this.emit("set_fg", this.fg_value);
        this.emit("set_bg", this.bg_value);
        if (doc.connection) doc.connection.set_bg(this.bg_value);
    }

    toggle_fg(num) {
        if (this.fg == num || (this.fg >= 8 && this.fg != num + 8)) {
            this.fg = num + 8;
        } else {
            this.fg = num;
        }
    }

    toggle_bg(num) {
        if (this.bg == num || (this.bg >= 8 && this.bg != num + 8)) {
            this.bg = num + 8;
        } else {
            this.bg = num;
            if (doc.connection) doc.connection.set_bg(this.bg);
        }
    }

    select_attribute() {
        send_sync("select_attribute", {fg: this.fg, bg: this.bg, palette: doc.palette});
    }

    _attach_picker_handlers() {
        if (this._picker_attached) return;
        this._picker_attached = true;
        const fg_el = document.getElementById("fg");
        const bg_el = document.getElementById("bg");
        if (fg_el) fg_el.addEventListener("mousedown", (e) => { e.stopPropagation(); this.show_picker(); });
        if (bg_el) bg_el.addEventListener("mousedown", (e) => { e.stopPropagation(); this.show_picker(); });
    }

    constructor() {
        super();
        this.fg_value = 7;
        this.bg_value = 0;
        this.fg_rgb = null; this.fg_idx = null;
        this.bg_rgb = null; this.bg_idx = null;
        this.picker_popup = null;
        this._picker_attached = false;

        doc.on("new_document",    () => this.new_document());
        doc.on("update_swatches", () => this.update_swatches());
        doc.on("set_bg", (value) => this.bg = value);

        keyboard.on("previous_foreground_color", () => this.previous_foreground_color());
        keyboard.on("next_foreground_color",     () => this.next_foreground_color());
        keyboard.on("previous_background_color", () => this.previous_background_color());
        keyboard.on("next_background_color",     () => this.next_background_color());
        on("previous_foreground_color", () => this.previous_foreground_color());
        on("next_foreground_color",     () => this.next_foreground_color());
        on("previous_background_color", () => this.previous_background_color());
        on("next_background_color",     () => this.next_background_color());
        on("default_color",             () => this.default_color());
        on("switch_foreground_background", () => this.switch_foreground_background());
        on("set_fg", (event, new_fg) => this.fg = new_fg);
        on("set_bg", (event, new_bg) => {
            this.bg = new_bg;
            if (doc.connection) doc.connection.set_bg(this.bg);
        });
        keyboard.on("toggle_fg", (num) => this.toggle_fg(num));
        keyboard.on("toggle_bg", (num) => this.toggle_bg(num));

        if (document.readyState !== "loading") {
            this._attach_picker_handlers();
        } else {
            document.addEventListener("DOMContentLoaded", () => this._attach_picker_handlers());
        }
    }
}

module.exports = new PaletteChooser();
