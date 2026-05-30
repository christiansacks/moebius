const path = require("path");
const {send_sync, send} = require("../../senders");
const {build_font_index, get_font} = require("../../libtextmode/tdf");
const {font_tool, set_font, set_colors, is_color_font} = require("../tools/font");
const {tools} = require("./ui");
const palette = require("../palette");

// TDF directory comes from prefs; user can change it via Browse button
let tdf_dir = send_sync("get_pref", {key: "tdf_dir"}) || "";

// Lazily built index; invalidated when tdf_dir changes
let font_index = null;
let current_entry = null;

function $(id) { return document.getElementById(id); }

function get_index() {
    if (!font_index && tdf_dir) font_index = build_font_index(tdf_dir);
    return font_index || [];
}

function render_font_list(filter) {
    const list = $("font_picker_list");
    list.innerHTML = "";
    const idx = get_index();
    const lc = filter.toLowerCase();
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
    set_font(font);
    update_panel_name(font.name);
    update_color_pickers_visibility();
    render_picker_preview();
    // Highlight in list
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

function render_picker_preview() {
    const canvas = $("font_preview_canvas");
    if (!canvas) return;
    const text_el = $("font_preview_text");
    const text = text_el ? (text_el.value || "Moebius Rulez") : "Moebius Rulez";
    // TODO: render font output onto canvas using libtextmode.render()
    // For now, clear and show placeholder
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#aaa";
    ctx.font = "12px monospace";
    ctx.fillText("Preview: " + text, 8, canvas.height / 2);
}

function show_font_picker() {
    const dialog = $("font_picker_dialog");
    dialog.classList.remove("hidden");
    render_font_list($("font_search").value || "");
    render_picker_preview();
}

function hide_font_picker() {
    $("font_picker_dialog").classList.add("hidden");
}

function init() {
    // Mini panel "change font" button
    const change_btn = $("font_change_btn");
    if (change_btn) change_btn.addEventListener("click", show_font_picker);

    // Picker dialog search
    const search = $("font_search");
    if (search) search.addEventListener("input", () => render_font_list(search.value));

    // Picker dialog close
    const close_btn = $("font_picker_close");
    if (close_btn) close_btn.addEventListener("click", hide_font_picker);

    // Browse for TDF folder
    const browse_btn = $("font_browse_btn");
    if (browse_btn) browse_btn.addEventListener("click", () => {
        const result = send_sync("open_dir_dialog", {title: "Select TDF Fonts Folder"});
        if (result) {
            tdf_dir = result;
            font_index = null; // invalidate cache
            send("set_pref", {key: "tdf_dir", value: tdf_dir});
            render_font_list($("font_search").value || "");
        }
    });

    // Preview text input
    const preview_text = $("font_preview_text");
    if (preview_text) {
        preview_text.addEventListener("input", render_picker_preview);
        preview_text.placeholder = "Moebius Rulez";
    }

    // Sync color pickers to palette
    palette.on("change", () => {
        if (!is_color_font()) {
            set_colors(palette.fg, palette.bg);
        }
    });

    font_tool.on("enabled", (on) => {
        const panel = $("font_panel");
        if (panel) panel.classList.toggle("hidden", !on);
        if (!on) hide_font_picker();
    });

    font_tool.on("font_changed", (font) => {
        update_panel_name(font ? font.name : "No font selected");
        update_color_pickers_visibility();
    });
}

module.exports = {init};
