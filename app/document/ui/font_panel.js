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
let tdf_root = tdf_dir; // user's chosen base folder; tdf_dir changes as user navigates

// Index is built async in the main process to avoid blocking the renderer
let font_index = null;
let index_loading = false;
let current_entry = null;
let current_font = null;
let preview_gen = 0; // cancels stale renders
let dialog_open = false; // flag for keyboard handler

function $(id) { return document.getElementById(id); }

async function ensure_index(silent = false) {
    if (font_index) return font_index;
    if (!tdf_dir || index_loading) return [];
    index_loading = true;
    if (!silent) show_list_loading();
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

function build_font_preview_doc(text, font, fg, bg, fg_rgb, bg_rgb) {
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
                    const block = {
                        code: cell.code,
                        fg:   is_color ? cell.fg : fg,
                        bg:   is_color ? cell.bg : bg,
                    };
                    if (!is_color) {
                        if (fg_rgb) block.fg_rgb = fg_rgb;
                        if (bg_rgb) block.bg_rgb = bg_rgb;
                    }
                    data[idx] = block;
                }
            }
        }
        x += w + spacing;
    }

    return {
        columns,
        rows,
        data,
        palette:         ega,
        font_name:       "IBM VGA",
        use_9px_font:    false,
        ice_colors:      false,
        extended_colors: !!(fg_rgb || bg_rgb),
        xterm_base16:    false,
        c64_background:  undefined,
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
        update_watermark();
        return;
    }

    const text_el = $("font_preview_text");
    const text = (text_el && text_el.value) ? text_el.value : "Moebius Rulez";

    const fg = palette.fg ?? 7;
    const bg = palette.bg ?? 0;
    const fg_rgb = palette.fg_rgb || null;
    const bg_rgb = palette.bg_rgb || null;
    const preview_doc = build_font_preview_doc(text, current_font, fg, bg, fg_rgb, bg_rgb);

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

    // Scale to fill full width of the preview canvas
    const scale = canvas.width / src.width;
    const dw = canvas.width;
    const dh = Math.max(1, Math.floor(src.height * scale));

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, dw, dh);
    update_watermark();
}

function update_watermark() {
    const wm = $("font_preview_watermark");
    if (!wm) return;
    if (current_entry && current_font) {
        const actual_rows = current_font.chars.size > 0
            ? Math.max(...[...current_font.chars.values()].map(r => r.length))
            : current_font.block_size;
        wm.textContent = `${path.basename(current_entry.file)}  ·  ${actual_rows} rows`;
        wm.classList.remove("hidden");
    } else {
        wm.classList.add("hidden");
    }
}

// ── Font list ─────────────────────────────────────────────────────────────────

async function render_font_list(filter, silent = false) {
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

    const idx = await ensure_index(silent);

    list.innerHTML = "";

    if (tdf_dir !== tdf_root) {
        const el = document.createElement("div");
        el.className = "font_list_item font_dir_item";
        el.textContent = "[..]";
        el.addEventListener("mousedown", (e) => { e.stopPropagation(); navigate_to(path.dirname(tdf_dir)); });
        list.appendChild(el);
    }

    const lc = (filter || "").toLowerCase();
    const matches = lc ? idx.filter(e => !e.is_dir && e.name.toLowerCase().includes(lc)) : idx;

    if (matches.length === 0 && !lc && tdf_dir === tdf_root) {
        const msg = document.createElement("div");
        msg.className = "font_list_item";
        msg.style.color = "#666";
        msg.style.fontStyle = "italic";
        msg.textContent = "No .TDF files found in that folder";
        list.appendChild(msg);
        return;
    }

    for (const entry of matches) {
        const el = document.createElement("div");
        el.className = "font_list_item" + (entry === current_entry ? " selected" : "") + (entry.is_dir ? " font_dir_item" : "");
        el.textContent = entry.is_dir ? `[${entry.name}]` : entry.name;
        el.addEventListener("mousedown", (e) => { if (entry.is_dir) e.stopPropagation(); select_entry(entry); });
        list.appendChild(el);
    }
}

function navigate_to(dir) {
    tdf_dir = dir;
    font_index = null;
    index_loading = false;
    const search = $("font_search");
    if (search) search.value = "";
    render_font_list("", true);
}

function select_entry(entry) {
    if (entry.is_dir) { navigate_to(entry.file); return; }
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

// ── Arrow key navigation ──────────────────────────────────────────────────────

function navigate_list(dir) {
    if (!font_index || font_index.length === 0) return;
    const search_val = ($("font_search") && $("font_search").value) ? $("font_search").value.toLowerCase() : "";
    const visible = (search_val ? font_index.filter(e => !e.is_dir && e.name.toLowerCase().includes(search_val)) : font_index.filter(e => !e.is_dir));
    if (visible.length === 0) return;

    let idx = current_entry ? visible.indexOf(current_entry) : -1;
    idx = Math.max(0, Math.min(visible.length - 1, idx + dir));
    select_entry(visible[idx]);

    // Scroll selected item into view
    const list = $("font_picker_list");
    if (list) {
        const selected = list.querySelector(".font_list_item.selected");
        if (selected) selected.scrollIntoView({block: "nearest"});
    }
}

// ── Dialog show/hide ──────────────────────────────────────────────────────────

async function show_font_picker() {
    const dialog = $("font_picker_dialog");
    if (!dialog) return;
    // Reset to centered position each time it opens
    dialog.style.left = "";
    dialog.style.top = "";
    dialog.style.transform = "";
    dialog.classList.remove("hidden");
    dialog_open = true;
    const preview_text = $("font_preview_text");
    if (preview_text) preview_text.focus();
    await render_font_list($("font_search").value || "");
    if (!current_entry && font_index) {
        const first_font = font_index.find(e => !e.is_dir);
        if (first_font) select_entry(first_font);
    } else {
        render_picker_preview();
    }
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
            if (e.key === "ArrowDown") { e.preventDefault(); navigate_list(1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); navigate_list(-1); }
            else if (e.key === "Escape") { e.preventDefault(); hide_font_picker(); }
        }, true);
    }

    const close_btn = $("font_picker_close");
    if (close_btn) close_btn.addEventListener("click", hide_font_picker);

    const browse_btn = $("font_browse_btn");
    if (browse_btn) browse_btn.addEventListener("click", async () => {
        const result = send_sync("open_dir_dialog", {title: "Select TDF Fonts Folder"});
        if (result) {
            tdf_root = result;
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

    // Dialog dragging by header (exclude close/browse buttons)
    let drag_state = null;
    const header = $("font_picker_header");
    const dialog_el = $("font_picker_dialog");
    if (header && dialog_el) {
        header.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            if (e.target.closest("#font_picker_close, #font_browse_btn")) return;
            e.preventDefault();
            const rect = dialog_el.getBoundingClientRect();
            drag_state = {
                start_x: e.clientX,
                start_y: e.clientY,
                dialog_x: rect.left,
                dialog_y: rect.top,
                moved: false,
            };
        });
        document.addEventListener("mousemove", (e) => {
            if (!drag_state) return;
            const dx = e.clientX - drag_state.start_x;
            const dy = e.clientY - drag_state.start_y;
            if (!drag_state.moved) {
                // First move — pin to absolute position, remove centering transform
                dialog_el.style.transform = "none";
                drag_state.moved = true;
            }
            dialog_el.style.left = (drag_state.dialog_x + dx) + "px";
            dialog_el.style.top = (drag_state.dialog_y + dy) + "px";
        });
        document.addEventListener("mouseup", () => { drag_state = null; });
    }

    // Font panel resize handle — drag up/down to resize (same as layers panel)
    const fp_resize = $("font_panel_resize_handle");
    if (fp_resize) {
        let fp_dragging = false, fp_drag_start_y = 0, fp_drag_start_h = 0;
        fp_resize.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            fp_dragging = true;
            fp_drag_start_y = e.clientY;
            const cur = getComputedStyle(document.documentElement).getPropertyValue("--font-panel-height");
            fp_drag_start_h = parseInt(cur) || 80;
            document.body.style.userSelect = "none";
            fp_resize.classList.add("active");
        });
        document.addEventListener("mousemove", (e) => {
            if (!fp_dragging) return;
            const delta = fp_drag_start_y - e.clientY;
            const new_h = Math.max(60, Math.min(400, fp_drag_start_h + delta));
            document.documentElement.style.setProperty("--font-panel-height", new_h + "px");
        });
        document.addEventListener("mouseup", () => {
            if (fp_dragging) {
                fp_dragging = false;
                document.body.style.userSelect = "";
                fp_resize.classList.remove("active");
            }
        });
    }

    // Font panel header — click to toggle above/below layers
    const fp_header_label = $("font_panel_header");
    const fp = $("font_panel");
    const lp = $("layers_panel");
    if (fp_header_label && fp && lp) {
        fp_header_label.style.cursor = "pointer";
        fp_header_label.title = "Click to move above/below Layers";
        fp_header_label.addEventListener("click", () => {
            const fp_rect = fp.getBoundingClientRect();
            const lp_rect = lp.getBoundingClientRect();
            if (fp_rect.top > lp_rect.top) {
                fp.parentNode.insertBefore(fp, lp);
            } else {
                fp.parentNode.insertBefore(fp, lp.nextSibling);
            }
        });
    }

    // Arrow key navigation — document-level capture so it works regardless of focus
    document.addEventListener("keydown", (e) => {
        if (!dialog_open) return;
        if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); navigate_list(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); navigate_list(-1); }
        else if (e.key === "Escape") { hide_font_picker(); }
    }, true);

    // Re-render preview when palette changes (affects outline/block fonts)
    function on_palette_change() {
        if (!is_color_font()) {
            set_colors(palette.fg, palette.bg, palette.fg_rgb || null, palette.bg_rgb || null);
            render_picker_preview();
        }
    }
    palette.on("set_fg", on_palette_change);
    palette.on("set_bg", on_palette_change);

    font_tool.on("enabled", (enabled) => {
        const panel = $("font_panel");
        if (panel) panel.classList.toggle("hidden", !enabled);
        if (!enabled) hide_font_picker();
        if (enabled && !is_color_font()) set_colors(palette.fg ?? 7, palette.bg ?? 0, palette.fg_rgb || null, palette.bg_rgb || null);
    });

    font_tool.on("font_changed", (font) => {
        current_font = font;
        update_panel_name(font ? font.name : "No font selected");
        update_color_pickers_visibility();
        send("update_font_menu", {font_name: font ? font.name : null});
        if (font && !is_color_font()) set_colors(palette.fg ?? 7, palette.bg ?? 0, palette.fg_rgb || null, palette.bg_rgb || null);
    });

    // Dismiss dialog on outside click
    document.addEventListener("mousedown", (e) => {
        const dialog = $("font_picker_dialog");
        if (!dialog || dialog.classList.contains("hidden")) return;
        if (e.target === $("font_change_btn")) return;
        const rect = dialog.getBoundingClientRect();
        const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                       e.clientY >= rect.top  && e.clientY <= rect.bottom;
        if (!inside) hide_font_picker();
    });
}

module.exports = {init, open_picker: show_font_picker, get dialog_open() { return dialog_open; }};
