const fs = require("fs");
const path = require("path");
const os = require("os");
const electron = require("electron");
const libtextmode = require("../libtextmode/libtextmode");

const SUPPORTED_EXT = new Set([".ans", ".xb", ".bin", ".diz", ".asc", ".txt", ".nfo"]);

let current_dir = os.homedir();
let win_id = null;
let entries = [];
let selected_index = -1;
let selected_path = null;
let preview_gen = 0;

function $(id) { return document.getElementById(id); }

function format_size(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} kB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

function list_dir(dir) {
    try {
        const names = fs.readdirSync(dir);
        const result = [];
        for (const name of names) {
            if (name.startsWith(".")) continue;
            try {
                const full = path.join(dir, name);
                const stat = fs.statSync(full);
                if (stat.isDirectory()) {
                    result.push({name, full, is_dir: true, size: 0});
                } else {
                    const ext = path.extname(name).toLowerCase();
                    if (SUPPORTED_EXT.has(ext)) {
                        result.push({name, full, is_dir: false, size: stat.size});
                    }
                }
            } catch (e) { /* skip inaccessible entries */ }
        }
        result.sort((a, b) => {
            if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, {sensitivity: "base"});
        });
        return result;
    } catch (e) {
        return [];
    }
}

function navigate_to(dir) {
    try { fs.accessSync(dir, fs.constants.R_OK); } catch (e) { return; }
    current_dir = dir;
    selected_index = -1;
    selected_path = null;
    $("filename_input").value = "";
    $("open_btn").disabled = true;
    update_breadcrumb();
    entries = list_dir(dir);
    render_file_list();
    clear_preview();
    update_sidebar_active();
    $("picker_files").focus();
}

function go_up() {
    const parent = path.dirname(current_dir);
    if (parent !== current_dir) navigate_to(parent);
}

function update_breadcrumb() {
    const crumb = $("picker_breadcrumb");
    crumb.innerHTML = "";
    const segments = [];
    if (process.platform === "win32") {
        const parts = current_dir.split(path.sep).filter(Boolean);
        let built = parts[0] + path.sep;
        segments.push({label: parts[0], path: built});
        for (let i = 1; i < parts.length; i++) {
            built = path.join(built, parts[i]);
            segments.push({label: parts[i], path: built});
        }
    } else {
        let built = path.sep;
        segments.push({label: "/", path: built});
        for (const part of current_dir.split(path.sep).filter(Boolean)) {
            built = path.join(built, part);
            segments.push({label: part, path: built});
        }
    }
    for (let i = 0; i < segments.length; i++) {
        if (i > 0) {
            const sep = document.createElement("span");
            sep.className = "breadcrumb_sep";
            sep.textContent = " › ";
            crumb.appendChild(sep);
        }
        const el = document.createElement("span");
        el.className = i === segments.length - 1 ? "breadcrumb_part current" : "breadcrumb_part";
        el.textContent = segments[i].label;
        if (i < segments.length - 1) {
            const nav_path = segments[i].path;
            el.addEventListener("click", () => navigate_to(nav_path));
        }
        crumb.appendChild(el);
    }
}

function render_file_list() {
    const file_list = $("picker_files");
    file_list.innerHTML = "";
    if (entries.length === 0) {
        const empty = document.createElement("div");
        empty.className = "file_list_empty";
        empty.textContent = "No supported files in this folder";
        file_list.appendChild(empty);
        return;
    }
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const row = document.createElement("div");
        row.className = `file_entry ${entry.is_dir ? "folder" : "file"}`;
        row.dataset.index = i;

        const icon = document.createElement("span");
        icon.className = "file_icon";
        icon.textContent = entry.is_dir ? "📁" : "📄";

        const name = document.createElement("span");
        name.className = "file_name";
        name.textContent = entry.name;

        row.appendChild(icon);
        row.appendChild(name);

        if (!entry.is_dir) {
            const size_el = document.createElement("span");
            size_el.className = "file_size";
            size_el.textContent = format_size(entry.size);
            row.appendChild(size_el);
        }

        row.addEventListener("click", () => select_entry(i));
        row.addEventListener("dblclick", () => activate_entry(i));
        file_list.appendChild(row);
    }
}

function select_entry(index) {
    selected_index = index;
    const entry = entries[index];
    for (const el of document.querySelectorAll(".file_entry.selected")) el.classList.remove("selected");
    const rows = $("picker_files").querySelectorAll(".file_entry");
    if (rows[index]) rows[index].classList.add("selected");
    $("filename_input").value = entry.name;
    $("open_btn").disabled = false;
    if (!entry.is_dir) {
        selected_path = entry.full;
        show_preview(entry.full);
    } else {
        selected_path = null;
        clear_preview();
    }
}

function activate_entry(index) {
    const entry = entries[index];
    if (entry.is_dir) {
        navigate_to(entry.full);
    } else {
        open_files([entry.full]);
    }
}

function scroll_selected_into_view() {
    const selected = $("picker_files").querySelector(".file_entry.selected");
    if (selected) selected.scrollIntoView({block: "nearest"});
}

function confirm_selection() {
    if (selected_index >= 0) {
        activate_entry(selected_index);
    }
}

function open_files(files) {
    electron.ipcRenderer.send("file_picker_open", {files, win_id, last_dir: current_dir});
    window.close();
}

function clear_preview() {
    preview_gen++;
    const canvas = $("preview_canvas");
    canvas.width = 1;
    canvas.height = 1;
    canvas.getContext("2d").clearRect(0, 0, 1, 1);
    $("preview_info").innerHTML = "";
}

async function show_preview(file_path) {
    const my_gen = ++preview_gen;
    $("preview_info").innerHTML = `<div class="preview_dim">Rendering…</div>`;
    try {
        const doc = await libtextmode.read_file(file_path);
        if (my_gen !== preview_gen) return;
        const {canvas: src} = await libtextmode.render(doc);
        if (my_gen !== preview_gen) return;

        const wrap = $("preview_canvas_wrap");
        const max_w = wrap.clientWidth - 4;
        const max_h = wrap.clientHeight - 4;
        const scale = Math.min(max_w / src.width, max_h / src.height, 1);
        const dw = Math.max(1, Math.floor(src.width * scale));
        const dh = Math.max(1, Math.floor(src.height * scale));

        const display = $("preview_canvas");
        display.width = dw;
        display.height = dh;
        const ctx = display.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(src, 0, 0, dw, dh);

        let file_size_str = "";
        try { file_size_str = format_size(fs.statSync(file_path).size); } catch (e) {}
        const color_mode = doc.extended_colors !== false
            ? (doc.data.some(b => b.fg_rgb || b.bg_rgb) ? "True color" : "256 colors")
            : "16 colors";
        $("preview_info").innerHTML =
            `<div class="preview_filename">${path.basename(file_path)}</div>` +
            `<div class="preview_dim">${doc.columns} × ${doc.rows} • ${color_mode}</div>` +
            `<div class="preview_dim">${file_size_str}</div>`;
    } catch (e) {
        if (my_gen !== preview_gen) return;
        $("preview_canvas").width = 1;
        $("preview_canvas").height = 1;
        $("preview_info").innerHTML = `<div class="preview_dim">Could not render preview</div>`;
    }
}

function build_sidebar(recent_files) {
    const home = os.homedir();
    const bookmarks_el = $("bookmarks");
    const candidates = [
        {label: "Home", path: home},
        {label: "Desktop", path: path.join(home, "Desktop")},
        {label: "Downloads", path: path.join(home, "Downloads")},
        {label: "Documents", path: path.join(home, "Documents")},
        {label: "Pictures", path: path.join(home, "Pictures")},
    ];
    for (const bk of candidates) {
        try {
            if (!fs.statSync(bk.path).isDirectory()) continue;
        } catch (e) { continue; }
        const el = document.createElement("div");
        el.className = "sidebar_item";
        el.dataset.nav = bk.path;
        el.textContent = bk.label;
        el.addEventListener("click", () => navigate_to(bk.path));
        bookmarks_el.appendChild(el);
    }

    const recents_el = $("recents");
    const seen_dirs = new Set();
    for (const file of (recent_files || []).slice(0, 15)) {
        const dir = path.dirname(file);
        if (seen_dirs.has(dir)) continue;
        seen_dirs.add(dir);
        try { if (!fs.statSync(dir).isDirectory()) continue; } catch (e) { continue; }
        const el = document.createElement("div");
        el.className = "sidebar_item recent";
        el.dataset.nav = dir;
        el.title = dir;
        el.textContent = path.basename(dir);
        el.addEventListener("click", () => navigate_to(dir));
        recents_el.appendChild(el);
    }
    if (recents_el.children.length === 0) {
        const el = document.createElement("div");
        el.className = "sidebar_item dim";
        el.textContent = "None";
        recents_el.appendChild(el);
    }
}

function update_sidebar_active() {
    for (const el of document.querySelectorAll(".sidebar_item.active")) el.classList.remove("active");
    for (const el of document.querySelectorAll(".sidebar_item[data-nav]")) {
        if (el.dataset.nav === current_dir) el.classList.add("active");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    $("cancel_btn").addEventListener("click", () => window.close());
    $("open_btn").addEventListener("click", confirm_selection);
    $("filename_input").addEventListener("keydown", (e) => {
        if (e.key === "Enter") confirm_selection();
    });
    $("picker_files").addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (selected_index < entries.length - 1) {
                select_entry(selected_index + 1);
                scroll_selected_into_view();
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (selected_index > 0) {
                select_entry(selected_index - 1);
                scroll_selected_into_view();
            }
        } else if (e.key === "Enter") {
            if (selected_index >= 0) activate_entry(selected_index);
        } else if (e.key === "Backspace") {
            go_up();
        }
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") window.close();
    });
});

electron.ipcRenderer.on("file_picker_init", (event, {win_id: wid, recent_files, start_dir}) => {
    win_id = wid;
    build_sidebar(recent_files);
    navigate_to(start_dir || os.homedir());
});
