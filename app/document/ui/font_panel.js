const path = require("path");
const electron = require("electron");
const {send_sync, send} = require("../../senders");
const {get_font} = require("../../libtextmode/tdf");
const {font_tool, set_font, set_colors, is_color_font} = require("../tools/font");
const libtextmode = require("../../libtextmode/libtextmode");
const {ega} = require("../../libtextmode/palette");
const palette = require("../palette");

// TDF directory comes from prefs; user can change it via Browse button
let tdf_dir = send_sync("get_pref", {key: "tdf_dir"}) || "";

// Index is built async in the main process to avoid blocking the renderer
let font_index = null;
let index_loading = false;
let current_entry = null;
let current_font = null;
let preview_gen = 0; // cancels stale renders
let dialog_open = false; // flag for keyboard handler

function $(id) { return document.getElementById(id); }

async function ensure_index() {
    if (font_index) return font_index;
    if (!tdf_dir || index_loading) return [];
    index_loading = true;
    show_list_loading();
    try {
        font_index = await electron.ipcRenderer.invoke("build_font_index", {dir: tdf_dir});
    } catch (_) {
        font_index = [];
    }
    index_loading = false;
    return font_index;
}

function show_list_loading() {
    const list = $("font_picker_list");
    if (!list) return;
    list.innerHTML = "";
    const el = document.createElement("div");
    el.className = "font_list_item";
    el.style.color = "#666";
    el.style.fontStyle = "italic";
    el.textContent = "Loading fonts…";
    list.appendChild(el);
}

// ── Preview doc builder ───────────────────────────────────────────────────────

function build_font_preview_doc(text, font, fg, bg) {
    if (!font || !text) return null;
    const block_size = font.block_size || 8;
    const spacing    = font.spacing    || 0;
    const is_color   = font.type === 2;

    // First pass: measure total width
    let total_w = 0;
    for (const ch of text) {
        const code = ch.charCodeAt(0);
        const rows = font.chars.get(code);
        if (rows && rows.length > 0) {
            total_w += Math.max(...rows.map(r => r.length)) + spacing;
        } else {
            total_w += Math.max(spacing, 1); // space for undefined chars
        }
    }
    if (total_w <= 0) return null;

    const columns = total_w;
    const rows    = block_size;
    // Build flat data array (blank space cells as default)
    const data = Array.from({length: columns * rows}, () => ({code: 32, fg: 7, bg: 0}));

    let x = 0;
    for (const ch of text) {
        const code = ch.charCodeAt(0);
        const char_rows = font.chars.get(code);
        if (!char_rows || char_rows.length === 0) {
            x += Math.max(spacing, 1);
            continue;
        }
        const w = Math.max(...char_rows.map(r => r.length));
        for (let r = 0; r < char_rows.length && r < rows; r++) {
            for (let c = 0; c < char_rows[r].length; c++) {
                const cell = char_rows[r][c];
                const idx  = r * columns + x + c;
                if (idx < data.length) {
                    data[idx] = {
                        code: cell.code,
                        fg:   is_color ? cell.fg : fg,
                        bg:   is_color ? cell.bg : bg,
                    };
                }
            }
        }
        x += w + spacing;
    }

    return {
        columns,
        rows,
        data,
        palette:        ega,
        font_name:      "IBM VGA",
        use_9px_font:   false,
        ice_colors:     false,
        extended_colors: false,
        xterm_base16:   false,
        c64_background: undefined,
    };
}

// ── Preview renderer ──────────────────────────────────────────────────────────

async function render_picker_preview() {
    const canvas = $("font_preview_canvas");
    if (!canvas) return;

    const my_gen = ++preview_gen;
    const ctx = canvas.getContext("2d");

    if (!current_font) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#555";
        ctx.font = "12px monospace";
        ctx.textAlign = "center";
        ctx.fillText("Select a font to preview", canvas.width / 2, canvas.height / 2);
        ctx.textAlign = "left";
        return;
    }

    const text_el = $("font_preview_text");
    const text = (text_el && text_el.value) ? text_el.value : "Moebius Rulez";

    const fg = palette.fg ?? 7;
    const bg = palette.bg ?? 0;
    const preview_doc = build_font_preview_doc(text, current_font, fg, bg);

    if (!preview_doc) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
    }

    let src;
    try {
        ({canvas: src} = await libtextmode.render(preview_doc));
    } catch (_) { return; }

    if (my_gen !== preview_gen) return; // superseded by a newer render

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scale = Math.min(canvas.width / src.width, canvas.height / src.height, 2);
    const dw = Math.max(1, Math.floor(src.width  * scale));
    const dh = Math.max(1, Math.floor(src.height * scale));
    const dx = Math.floor((canvas.width  - dw) / 2);
    const dy = Math.floor((canvas.height - dh) / 2);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, dx, dy, dw, dh);
}

// ── Font list ─────────────────────────────────────────────────────────────────

async function render_font_list(filter) {
    const list = $("font_picker_list");
    if (!list) return;

    if (!tdf_dir) {
        list.innerHTML = "";
        const msg = document.createElement("div");
        msg.className = "font_list_item";
        msg.style.color = "#666";
        msg.style.fontStyle = "italic";
        msg.textContent = 'Click "Browse folder…" to locate your TDF fonts';
        list.appendChild(msg);
        return;
    }

    const idx = await ensure_index();

    list.innerHTML = "";
    if (idx.length === 0) {
        const msg = document.createElement("div");
        msg.className = "font_list_item";
        msg.style.color = "#666";
        msg.style.fontStyle = "italic";
        msg.textContent = "No .TDF files found in that folder";
        list.appendChild(msg);
        return;
    }

    const lc = (filter || "").toLowerCase();
    const matches = lc ? idx.filter(e => e.name.toLowerCase().includes(lc)) : idx;
    for (const entry of matches) {
        const el = document.createElement("div");
        el.className = "font_list_item" + (entry === current_entry ? " selected" : "");
        el.textContent = entry.name;
        el.addEventListener("mousedown", () => select_entry(entry));
        list.appendChild(el);
    }
}

function select_entry(entry) {
    current_entry = entry;
    const font = get_font(entry);
    if (!font) return;
    current_font = font;
    set_font(font);
    update_panel_name(font.name);
    update_color_pickers_visibility();
    render_picker_preview();
    for (const el of $("font_picker_list").querySelectorAll(".font_list_item")) {
        el.classList.toggle("selected", el.textContent === entry.name);
    }
}

function update_panel_name(name) {
    const el = $("font_current_name");
    if (el) el.textContent = name || "No font selected";
}

function update_color_pickers_visibility() {
    const pickers = $("font_color_pickers");
    if (pickers) pickers.classList.toggle("hidden", is_color_font());
}

// ── Dialog show/hide ──────────────────────────────────────────────────────────

async function show_font_picker() {
    const dialog = $("font_picker_dialog");
    if (!dialog) return;
    dialog.classList.remove("hidden");
    dialog_open = true;
    const preview_text = $("font_preview_text");
    if (preview_text) preview_text.focus();
    await render_font_list($("font_search").value || "");
    render_picker_preview();
}

function hide_font_picker() {
    const dialog = $("font_picker_dialog");
    if (dialog) dialog.classList.add("hidden");
    dialog_open = false;
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
    const change_btn = $("font_change_btn");
    if (change_btn) change_btn.addEventListener("click", show_font_picker);

    const search = $("font_search");
    if (search) {
        search.addEventListener("input", () => render_font_list(search.value));
        search.addEventListener("keydown", (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
        }, true);
    }

    const close_btn = $("font_picker_close");
    if (close_btn) close_btn.addEventListener("click", hide_font_picker);

    const browse_btn = $("font_browse_btn");
    if (browse_btn) browse_btn.addEventListener("click", async () => {
        const result = send_sync("open_dir_dialog", {title: "Select TDF Fonts Folder"});
        if (result) {
            tdf_dir = result;
            font_index = null;
            index_loading = false;
            send("set_pref", {key: "tdf_dir", value: tdf_dir});
            await render_font_list($("font_search").value || "");
        }
    });

    const preview_text = $("font_preview_text");
    if (preview_text) {
        preview_text.addEventListener("input", render_picker_preview);
        preview_text.addEventListener("keydown", (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
        }, true);
        preview_text.placeholder = "Moebius Rulez";
    }

    // Dialog dragging by header
    let drag_state = null;
    const header = $("font_picker_header");
    const dialog = $("font_picker_dialog");
    if (header && dialog) {
        header.addEventListener("mousedown", (e) => {
            e.preventDefault();
            const rect = dialog.getBoundingClientRect();
            // Remove transform to allow left/top positioning
            dialog.style.transform = "none";
            drag_state = {
                start_x: e.clientX,
                start_y: e.clientY,
                dialog_x: rect.left,
                dialog_y: rect.top,
            };
        });
        document.addEventListener("mousemove", (e) => {
            if (!drag_state) return;
            const dx = e.clientX - drag_state.start_x;
            const dy = e.clientY - drag_state.start_y;
            dialog.style.left = (drag_state.dialog_x + dx) + "px";
            dialog.style.top = (drag_state.dialog_y + dy) + "px";
        });
        document.addEventListener("mouseup", () => {
            drag_state = null;
        });
    }

    // Re-render preview when palette changes (affects outline/block fonts)
    palette.on("change", () => {
        if (!is_color_font()) {
            set_colors(palette.fg, palette.bg);
            render_picker_preview();
        }
    });

    font_tool.on("enabled", (enabled) => {
        const panel = $("font_panel");
        if (panel) panel.classList.toggle("hidden", !enabled);
        if (!enabled) hide_font_picker();
    });

    font_tool.on("font_changed", (font) => {
        current_font = font;
        update_panel_name(font ? font.name : "No font selected");
        update_color_pickers_visibility();
    });

    // Dismiss dialog on outside click
    document.addEventListener("mousedown", (e) => {
        const dialog = $("font_picker_dialog");
        if (dialog && !dialog.classList.contains("hidden") && !dialog.contains(e.target) && e.target !== $("font_change_btn")) {
            hide_font_picker();
        }
    });
}

module.exports = {init, get dialog_open() { return dialog_open; }};
