const fs = require("fs");
const path = require("path");
const os = require("os");
const electron = require("electron");
const libtextmode = require("../libtextmode/libtextmode");
const {unzipSync} = require("fflate");

const SUPPORTED_EXT = new Set([".ans", ".xb", ".bin", ".diz", ".asc", ".txt", ".nfo", ".msg", ".mob", ".icy"]);
const MAX_PREVIEW_BYTES = 100 * 1024;
const NO_PREVIEW_EXT = new Set([".txt", ".nfo"]);
const COLO_API = "https://api.sixteencolors.net/v0";

let current_dir = os.homedir();
let win_id = null;
let entries = [];
let selected_index = -1;
let selected_zip_key = null;
let preview_gen = 0;

// null = real filesystem
// {type:'zip', zip_data, source_path, subdir, breadcrumb_prefix, on_exit, pack_name}
// {type:'colo', level:'root'|'year', year}
let nav_state = null;
const colo_cache = new Map();

function $(id) { return document.getElementById(id); }

function format_size(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} kB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

function show_file_list_message(text) {
    const list = $("picker_files");
    list.innerHTML = "";
    const el = document.createElement("div");
    el.className = "file_list_empty";
    el.textContent = text;
    list.appendChild(el);
}

// ─── Filesystem ───────────────────────────────────────────────────────────────

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
                    } else if (ext === ".zip") {
                        result.push({name, full, is_dir: false, is_zip: true, size: stat.size});
                    }
                }
            } catch (e) { /* skip inaccessible entries */ }
        }
        result.sort((a, b) => {
            if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, {sensitivity: "base"});
        });
        return result;
    } catch (e) { return []; }
}

// ─── Zip navigation ───────────────────────────────────────────────────────────

function list_zip_entries(zip_data, subdir) {
    const dirs = new Set();
    const files = [];
    for (const key of Object.keys(zip_data)) {
        if (!key.startsWith(subdir)) continue;
        const rest = key.slice(subdir.length);
        if (!rest) continue;
        const first = rest.split("/")[0];
        if (!first || first.startsWith(".") || first === "__MACOSX") continue;
        if (rest.includes("/")) {
            dirs.add(first);
        } else {
            const ext = path.extname(first).toLowerCase();
            if (SUPPORTED_EXT.has(ext)) files.push({name: first, is_dir: false, size: zip_data[key].length});
        }
    }
    const sorted_dirs = [...dirs].sort((a, b) => a.localeCompare(b, undefined, {sensitivity: "base"}));
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: "base"}));
    return [
        ...sorted_dirs.map(name => ({name, is_dir: true, size: 0})),
        ...files,
    ];
}

function navigate_into_zip(source_path, zip_data, breadcrumb_prefix, on_exit, pack_name = null) {
    nav_state = {type: "zip", zip_data, source_path, subdir: "", breadcrumb_prefix, on_exit, pack_name};
    selected_index = -1; selected_zip_key = null;
    $("filename_input").value = ""; $("open_btn").disabled = true;
    entries = list_zip_entries(zip_data, "");
    render_file_list();
    update_breadcrumb();
    update_sidebar_active();
    clear_preview();
    $("picker_files").focus();
}

function enter_zip_subdir(subdir) {
    nav_state.subdir = subdir;
    selected_index = -1; selected_zip_key = null;
    $("filename_input").value = ""; $("open_btn").disabled = true;
    entries = list_zip_entries(nav_state.zip_data, subdir);
    render_file_list();
    update_breadcrumb();
    clear_preview();
    $("picker_files").focus();
}

function open_local_zip(entry) {
    show_file_list_message("Opening zip…");
    try {
        const zip_data = unzipSync(fs.readFileSync(entry.full));
        navigate_into_zip(entry.full, zip_data, null, () => navigate_to(path.dirname(entry.full)));
    } catch (e) {
        show_file_list_message(`Could not open zip: ${e.message}`);
    }
}

async function show_preview_from_zip(key) {
    const my_gen = ++preview_gen;
    $("preview_info").innerHTML = `<div class="preview_dim">Rendering…</div>`;
    try {
        const bytes = nav_state.zip_data[key];
        if (!bytes) throw new Error("not found");
        const doc = libtextmode.read_bytes(bytes, path.basename(key));
        if (doc.layers) doc.data = libtextmode.composite_layers(doc.layers, doc.columns, doc.rows, doc.extended_colors);
        if (my_gen !== preview_gen) return;
        const {canvas: src} = await libtextmode.render(doc);
        if (my_gen !== preview_gen) return;
        const wrap = $("preview_canvas_wrap");
        const scale = Math.min((wrap.clientWidth - 4) / src.width, (wrap.clientHeight - 4) / src.height, 1);
        const dw = Math.max(1, Math.floor(src.width * scale));
        const dh = Math.max(1, Math.floor(src.height * scale));
        const display = $("preview_canvas");
        display.width = dw; display.height = dh;
        const ctx = display.getContext("2d");
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
        ctx.drawImage(src, 0, 0, dw, dh);
        const color_mode = doc.extended_colors !== false
            ? (doc.data.some(b => b.fg_rgb || b.bg_rgb) ? "True color" : "256 colors")
            : "16 colors";
        $("preview_info").innerHTML =
            `<div class="preview_filename">${path.basename(key)}</div>` +
            `<div class="preview_dim">${doc.columns} × ${doc.rows} • ${color_mode}</div>` +
            `<div class="preview_dim">${format_size(bytes.length)}</div>`;
    } catch (e) {
        if (my_gen !== preview_gen) return;
        $("preview_canvas").width = 1; $("preview_canvas").height = 1;
        $("preview_info").innerHTML = `<div class="preview_dim">Could not render preview</div>`;
    }
}

function open_from_zip(key) {
    try {
        const bytes = nav_state.zip_data[key];
        const temp_dir = path.join(os.tmpdir(), "moebius_extract");
        if (!fs.existsSync(temp_dir)) fs.mkdirSync(temp_dir, {recursive: true});
        const temp_path = path.join(temp_dir, path.basename(key));
        fs.writeFileSync(temp_path, bytes);
        electron.ipcRenderer.send("file_picker_open", {
            files: [temp_path], win_id, last_dir: current_dir, extracted_from_zip: true,
        });
        window.close();
    } catch (e) {
        $("preview_info").innerHTML = `<div class="preview_dim">Could not extract: ${e.message}</div>`;
    }
}

// ─── 16colo.rs ────────────────────────────────────────────────────────────────

async function colo_fetch(url) {
    if (colo_cache.has(url)) return colo_cache.get(url);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    colo_cache.set(url, data);
    return data;
}

async function navigate_colo_root() {
    nav_state = {type: "colo", level: "root"};
    selected_index = -1; selected_zip_key = null;
    $("filename_input").value = ""; $("open_btn").disabled = true;
    update_breadcrumb();
    update_sidebar_active();
    show_file_list_message("Loading…");
    $("picker_files").focus();
    try {
        const years = await colo_fetch(`${COLO_API}/year?rows=0`);
        entries = years
            .map(y => ({name: String(y.year), display: `${y.year}  (${y.packs} pack${y.packs === 1 ? "" : "s"})`, is_dir: true, size: 0}))
            .sort((a, b) => b.name.localeCompare(a.name));
        render_file_list();
    } catch (e) {
        show_file_list_message(`Could not load 16colo.rs: ${e.message}`);
    }
}

async function navigate_colo_year(year) {
    nav_state = {type: "colo", level: "year", year};
    selected_index = -1; selected_zip_key = null;
    $("filename_input").value = ""; $("open_btn").disabled = true;
    update_breadcrumb();
    update_sidebar_active();
    show_file_list_message("Loading…");
    $("picker_files").focus();
    try {
        const packs = await colo_fetch(`${COLO_API}/year/${year}?rows=0`);
        entries = packs
            .map(p => ({name: p.name, is_dir: true, size: 0, colo_pack: p}))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: "base"}));
        render_file_list();
    } catch (e) {
        show_file_list_message(`Could not load year ${year}: ${e.message}`);
    }
}

async function navigate_colo_pack(pack, year) {
    show_file_list_message("Fetching pack info…");
    try {
        const details = await colo_fetch(`${COLO_API}/pack/${pack.name}?rows=0`);
        const raw_url = details.pack_file_location;
        if (!raw_url) throw new Error("no download URL in API response");
        const zip_url = raw_url.startsWith("http") ? raw_url : `https://16colo.rs${raw_url}`;
        show_file_list_message(`Downloading ${pack.name}…`);
        const resp = await fetch(zip_url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const zip_data = unzipSync(new Uint8Array(await resp.arrayBuffer()));
        navigate_into_zip(null, zip_data,
            [{label: "16colo.rs", onclick: () => navigate_colo_root()}, {label: year, onclick: () => navigate_colo_year(year)}],
            () => navigate_colo_year(year),
            pack.name);
    } catch (e) {
        show_file_list_message(`Could not load pack: ${e.message}`);
    }
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function navigate_to(dir) {
    try { fs.accessSync(dir, fs.constants.R_OK); } catch (e) { return; }
    nav_state = null;
    current_dir = dir;
    selected_index = -1; selected_zip_key = null;
    $("filename_input").value = ""; $("open_btn").disabled = true;
    update_breadcrumb();
    entries = list_dir(dir);
    render_file_list();
    clear_preview();
    update_sidebar_active();
    $("picker_files").focus();
}

function go_up() {
    if (nav_state?.type === "zip") {
        if (nav_state.subdir === "") {
            nav_state.on_exit();
        } else {
            const trimmed = nav_state.subdir.replace(/\/$/, "");
            const parent = trimmed.includes("/") ? trimmed.slice(0, trimmed.lastIndexOf("/") + 1) : "";
            enter_zip_subdir(parent);
        }
    } else if (nav_state?.type === "colo") {
        if (nav_state.level === "root") { nav_state = null; navigate_to(current_dir); }
        else navigate_colo_root();
    } else {
        const parent = path.dirname(current_dir);
        if (parent !== current_dir) navigate_to(parent);
    }
}

function update_breadcrumb() {
    const crumb = $("picker_breadcrumb");
    crumb.innerHTML = "";

    const add = (label, onclick, current = false) => {
        if (crumb.children.length > 0) {
            const sep = document.createElement("span");
            sep.className = "breadcrumb_sep"; sep.textContent = " › ";
            crumb.appendChild(sep);
        }
        const el = document.createElement("span");
        el.className = current ? "breadcrumb_part current" : "breadcrumb_part";
        el.textContent = label;
        if (onclick) el.addEventListener("click", onclick);
        crumb.appendChild(el);
    };

    const add_subdir_segs = (subdir) => {
        if (!subdir) return;
        const parts = subdir.replace(/\/$/, "").split("/");
        let built = "";
        for (let i = 0; i < parts.length; i++) {
            built += parts[i] + "/";
            const bs = built;
            add(parts[i], i < parts.length - 1 ? () => enter_zip_subdir(bs) : null, i === parts.length - 1);
        }
    };

    if (nav_state?.type === "colo") {
        add("16colo.rs", nav_state.level !== "root" ? () => navigate_colo_root() : null, nav_state.level === "root");
        if (nav_state.level === "year") add(nav_state.year, null, true);
        return;
    }

    if (nav_state?.type === "zip") {
        if (nav_state.breadcrumb_prefix) {
            for (const p of nav_state.breadcrumb_prefix) add(p.label, p.onclick);
            add(nav_state.pack_name || "pack", nav_state.subdir ? () => enter_zip_subdir("") : null, !nav_state.subdir);
        } else {
            // local zip — show FS path + zip filename
            const zip_dir = path.dirname(nav_state.source_path);
            if (process.platform === "win32") {
                const parts = zip_dir.split(path.sep).filter(Boolean);
                let built = parts[0] + path.sep;
                add(parts[0], () => navigate_to(built));
                for (let i = 1; i < parts.length; i++) {
                    built = path.join(built, parts[i]);
                    const nb = built;
                    add(parts[i], () => navigate_to(nb));
                }
            } else {
                add("/", () => navigate_to(path.sep));
                let built = path.sep;
                for (const part of zip_dir.split(path.sep).filter(Boolean)) {
                    built = path.join(built, part);
                    const nb = built;
                    add(part, () => navigate_to(nb));
                }
            }
            add(path.basename(nav_state.source_path), nav_state.subdir ? () => enter_zip_subdir("") : null, !nav_state.subdir);
        }
        add_subdir_segs(nav_state.subdir);
        return;
    }

    // Normal filesystem
    if (process.platform === "win32") {
        const parts = current_dir.split(path.sep).filter(Boolean);
        let built = parts[0] + path.sep;
        add(parts[0], parts.length > 1 ? () => navigate_to(built) : null, parts.length === 1);
        for (let i = 1; i < parts.length; i++) {
            built = path.join(built, parts[i]);
            const nb = built; const is_last = i === parts.length - 1;
            add(parts[i], !is_last ? () => navigate_to(nb) : null, is_last);
        }
    } else {
        add("/", current_dir !== path.sep ? () => navigate_to(path.sep) : null, current_dir === path.sep);
        let built = path.sep;
        for (const part of current_dir.split(path.sep).filter(Boolean)) {
            built = path.join(built, part);
            const nb = built; const is_last = nb === current_dir;
            add(part, !is_last ? () => navigate_to(nb) : null, is_last);
        }
    }
}

// ─── File list ────────────────────────────────────────────────────────────────

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
        if (entry.is_zip) row.classList.add("zip");
        row.dataset.index = i;

        const icon = document.createElement("span");
        icon.className = "file_icon";
        icon.textContent = entry.is_dir ? "📁" : entry.is_zip ? "🗜️" : "📄";

        const name = document.createElement("span");
        name.className = "file_name";
        name.textContent = entry.display || entry.name;

        row.appendChild(icon);
        row.appendChild(name);

        if (!entry.is_dir && nav_state?.type !== "colo") {
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

    if (nav_state?.type === "zip" && !entry.is_dir) {
        selected_zip_key = nav_state.subdir + entry.name;
        const ext = path.extname(entry.name).toLowerCase();
        if (entry.size <= MAX_PREVIEW_BYTES && !NO_PREVIEW_EXT.has(ext)) {
            show_preview_from_zip(selected_zip_key);
        } else {
            clear_preview();
            $("preview_info").innerHTML = `<div class="preview_dim">No preview available</div>`;
        }
    } else if (!nav_state && !entry.is_dir && !entry.is_zip) {
        selected_zip_key = null;
        const ext = path.extname(entry.name).toLowerCase();
        if (entry.size <= MAX_PREVIEW_BYTES && !NO_PREVIEW_EXT.has(ext)) {
            show_preview(entry.full);
        } else {
            clear_preview();
            $("preview_info").innerHTML = `<div class="preview_dim">No preview available</div>`;
        }
    } else {
        selected_zip_key = null;
        clear_preview();
    }
}

function activate_entry(index) {
    const entry = entries[index];
    if (nav_state?.type === "colo") {
        if (nav_state.level === "root") navigate_colo_year(entry.name);
        else if (nav_state.level === "year") navigate_colo_pack(entry.colo_pack, nav_state.year);
    } else if (nav_state?.type === "zip") {
        if (entry.is_dir) enter_zip_subdir(nav_state.subdir + entry.name + "/");
        else open_from_zip(nav_state.subdir + entry.name);
    } else {
        if (entry.is_dir) navigate_to(entry.full);
        else if (entry.is_zip) open_local_zip(entry);
        else open_files([entry.full]);
    }
}

function scroll_selected_into_view() {
    const selected = $("picker_files").querySelector(".file_entry.selected");
    if (selected) selected.scrollIntoView({block: "nearest"});
}

function confirm_selection() {
    if (selected_index >= 0) {
        activate_entry(selected_index);
        return;
    }
    if (nav_state) return; // typed path nav only makes sense in FS mode
    const typed = $("filename_input").value.trim();
    if (!typed) return;
    let full = path.isAbsolute(typed) ? typed : path.join(current_dir, typed);
    if (process.platform === "win32" && /^[A-Za-z]:$/.test(typed)) full = typed.toUpperCase() + path.sep;
    try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) navigate_to(full);
        else if (SUPPORTED_EXT.has(path.extname(full).toLowerCase())) open_files([full]);
    } catch (e) { /* path doesn't exist */ }
}

function open_files(files) {
    electron.ipcRenderer.send("file_picker_open", {files, win_id, last_dir: current_dir});
    window.close();
}

// ─── Preview ─────────────────────────────────────────────────────────────────

function clear_preview() {
    preview_gen++;
    const canvas = $("preview_canvas");
    canvas.width = 1; canvas.height = 1;
    canvas.getContext("2d").clearRect(0, 0, 1, 1);
    $("preview_info").innerHTML = "";
}

async function show_preview(file_path) {
    const my_gen = ++preview_gen;
    $("preview_info").innerHTML = `<div class="preview_dim">Rendering…</div>`;
    try {
        const doc = await libtextmode.read_file(file_path);
        if (doc.layers) doc.data = libtextmode.composite_layers(doc.layers, doc.columns, doc.rows, doc.extended_colors);
        if (my_gen !== preview_gen) return;
        const {canvas: src} = await libtextmode.render(doc);
        if (my_gen !== preview_gen) return;
        const wrap = $("preview_canvas_wrap");
        const max_w = wrap.clientWidth - 4, max_h = wrap.clientHeight - 4;
        const scale = Math.min(max_w / src.width, max_h / src.height, 1);
        const dw = Math.max(1, Math.floor(src.width * scale));
        const dh = Math.max(1, Math.floor(src.height * scale));
        const display = $("preview_canvas");
        display.width = dw; display.height = dh;
        const ctx = display.getContext("2d");
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
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
        $("preview_canvas").width = 1; $("preview_canvas").height = 1;
        $("preview_info").innerHTML = `<div class="preview_dim">Could not render preview</div>`;
    }
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function build_drives_section() {
    const sidebar = $("picker_sidebar");
    const heading = document.createElement("div");
    heading.className = "sidebar_heading"; heading.textContent = "Drives";
    const drives_el = document.createElement("div"); drives_el.id = "drives";
    sidebar.prepend(drives_el); sidebar.prepend(heading);
    for (let c = 65; c <= 90; c++) {
        const letter = String.fromCharCode(c);
        const drive = letter + ":\\";
        try {
            fs.accessSync(drive, fs.constants.R_OK);
            const el = document.createElement("div");
            el.className = "sidebar_item"; el.dataset.nav = drive;
            el.textContent = letter + ":";
            el.addEventListener("click", () => navigate_to(drive));
            drives_el.appendChild(el);
        } catch (e) {}
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
        el.className = "sidebar_item"; el.dataset.nav = bk.path;
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
        el.className = "sidebar_item recent"; el.dataset.nav = dir;
        el.title = dir; el.textContent = path.basename(dir);
        el.addEventListener("click", () => navigate_to(dir));
        recents_el.appendChild(el);
    }
    if (recents_el.children.length === 0) {
        const el = document.createElement("div");
        el.className = "sidebar_item dim"; el.textContent = "None";
        recents_el.appendChild(el);
    }

    const sidebar = $("picker_sidebar");
    const online_heading = document.createElement("div");
    online_heading.className = "sidebar_heading"; online_heading.textContent = "Online";
    const colo_el = document.createElement("div");
    colo_el.className = "sidebar_item"; colo_el.id = "sidebar_16colo";
    colo_el.textContent = "16colo.rs";
    colo_el.addEventListener("click", () => navigate_colo_root());
    sidebar.appendChild(online_heading);
    sidebar.appendChild(colo_el);
}

function update_sidebar_active() {
    for (const el of document.querySelectorAll(".sidebar_item.active")) el.classList.remove("active");
    const is_colo = nav_state?.type === "colo" || (nav_state?.type === "zip" && nav_state.breadcrumb_prefix);
    if (is_colo) {
        const item = $("sidebar_16colo");
        if (item) item.classList.add("active");
    } else {
        for (const el of document.querySelectorAll(".sidebar_item[data-nav]")) {
            if (el.dataset.nav === current_dir) el.classList.add("active");
        }
    }
}

// ─── Event listeners ─────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    $("cancel_btn").addEventListener("click", () => window.close());
    $("open_btn").addEventListener("click", confirm_selection);
    $("filename_input").addEventListener("keydown", (e) => {
        if (e.key === "Enter") confirm_selection();
    });
    $("picker_files").addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (selected_index < entries.length - 1) { select_entry(selected_index + 1); scroll_selected_into_view(); }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (selected_index > 0) { select_entry(selected_index - 1); scroll_selected_into_view(); }
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
    if (process.platform === "win32") build_drives_section();
    build_sidebar(recent_files);
    navigate_to(start_dir || os.homedir());
});
