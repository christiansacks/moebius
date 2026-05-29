const doc = require("../doc");
const {send} = require("../../senders");

function $(id) { return document.getElementById(id); }

let ctx_target_idx = -1;

function show_context_menu(idx, x, y) {
    ctx_target_idx = idx;
    const layer = doc.layers[idx];
    const count = doc.layers.length;
    const menu = $("layer_context_menu");
    menu.innerHTML = "";

    const add_item = (label, action, disabled = false) => {
        const el = document.createElement("div");
        el.className = "ctx_item" + (disabled ? " disabled" : "");
        el.textContent = label;
        if (!disabled) el.addEventListener("mousedown", (e) => { e.preventDefault(); hide_context_menu(); action(); });
        menu.appendChild(el);
    };
    const add_sep = () => { const el = document.createElement("div"); el.className = "ctx_sep"; menu.appendChild(el); };

    add_item("Rename", () => {
        const item = document.querySelector(`.layer_item[data-index="${idx}"] .layer_name`);
        if (item) start_rename(idx, item);
    });
    add_item("Duplicate", () => doc.duplicate_layer());
    add_sep();
    add_item("Move Up", () => doc.move_layer_up(idx), idx >= count - 1);
    add_item("Move Down", () => doc.move_layer_down(idx), idx <= 0);
    add_sep();
    add_item("Merge Down", () => doc.merge_layer_down(idx), idx <= 0);
    add_sep();
    add_item("Delete", () => { if (count > 1) doc.delete_layer(idx); }, count <= 1);

    menu.classList.add("visible");
    const vw = window.innerWidth, vh = window.innerHeight;
    const mw = menu.offsetWidth || 160, mh = menu.offsetHeight || 180;
    menu.style.left = (x + mw > vw ? vw - mw - 4 : x) + "px";
    menu.style.top = (y + mh > vh ? vh - mh - 4 : y) + "px";
}

function hide_context_menu() {
    $("layer_context_menu").classList.remove("visible");
}

function set_btn_state(id, disabled) {
    const el = $(id);
    if (disabled) el.classList.add("disabled");
    else el.classList.remove("disabled");
}

function render_list() {
    if (!doc.layers) return;
    const list = $("layers_list");
    list.innerHTML = "";
    for (let i = doc.layers.length - 1; i >= 0; i--) {
        const layer = doc.layers[i];
        const item = document.createElement("div");
        item.className = "layer_item" + (i === doc.active_layer ? " active" : "");
        item.dataset.index = i;

        const vis = document.createElement("div");
        vis.className = "layer_vis" + (layer.visible ? " on" : "");
        vis.title = layer.visible ? "Hide layer" : "Show layer";
        vis.textContent = "●";
        vis.addEventListener("click", (e) => {
            e.stopPropagation();
            doc.set_layer_visible(i, !layer.visible);
        });

        const lock = document.createElement("div");
        lock.className = "layer_lock" + (layer.locked ? " on" : "");
        lock.title = layer.locked ? "Unlock layer" : "Lock layer";
        lock.textContent = layer.locked ? "■" : "□";
        lock.addEventListener("click", (e) => {
            e.stopPropagation();
            doc.set_layer_locked(i, !layer.locked);
        });

        const name = document.createElement("div");
        name.className = "layer_name";
        name.innerText = layer.name;
        name.addEventListener("dblclick", () => start_rename(i, name));

        item.tabIndex = 0;
        item.appendChild(vis);
        item.appendChild(lock);
        item.appendChild(name);
        item.addEventListener("click", () => { if (doc.active_layer !== i) doc.active_layer = i; item.focus(); });
        item.addEventListener("keydown", (e) => {
            if (e.key === "F2") { e.preventDefault(); start_rename(i, name); }
        });
        item.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            doc.active_layer = i;
            show_context_menu(i, e.clientX, e.clientY);
        });
        list.appendChild(item);
    }
}

function update_controls() {
    if (!doc.layers) return;
    const layer = doc.layers[doc.active_layer];
    $("layer_blend_mode").value = layer.blend_mode;
    const pct = Math.round(layer.opacity * 100);
    $("layer_opacity").value = pct;
    $("layer_opacity_num").value = pct;
    set_btn_state("layer_move_up", doc.active_layer >= doc.layers.length - 1);
    set_btn_state("layer_move_down", doc.active_layer <= 0);
    set_btn_state("layer_merge_down", doc.active_layer <= 0);
    set_btn_state("layer_delete", doc.layers.length <= 1);
    send("update_layer_menu", {active_layer: doc.active_layer, layer_count: doc.layers.length});
}

function update_panel() {
    render_list();
    update_controls();
}

function start_rename(idx, el) {
    el.contentEditable = "true";
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const finish = () => {
        el.contentEditable = "false";
        const trimmed = el.innerText.trim();
        doc.rename_layer(idx, trimmed || doc.layers[idx].name);
    };
    el.addEventListener("blur", finish, {once: true});
    el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); el.blur(); }
        if (e.key === "Escape") { el.textContent = doc.layers[idx].name; el.blur(); }
    });
}

function show_layers_panel(visible) {
    document.documentElement.style.setProperty(
        "--layers-panel-height", visible ? "250px" : "0px"
    );
}

function init() {
    doc.on("layers_changed", () => update_panel());
    doc.on("new_document", () => update_panel());

    // dismiss context menu on any click outside it
    document.addEventListener("mousedown", (e) => {
        if (!$("layer_context_menu").contains(e.target)) hide_context_menu();
    });

    // resize handle drag
    const handle = $("layers_resize_handle");
    let drag_start_y = 0, drag_start_h = 0, dragging = false;
    handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        dragging = true;
        drag_start_y = e.clientY;
        const cur = getComputedStyle(document.documentElement).getPropertyValue("--layers-panel-height");
        drag_start_h = parseInt(cur) || 250;
        document.body.style.userSelect = "none";
    });
    document.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const delta = drag_start_y - e.clientY;
        const new_h = Math.max(80, Math.min(700, drag_start_h + delta));
        document.documentElement.style.setProperty("--layers-panel-height", new_h + "px");
    });
    document.addEventListener("mouseup", () => {
        if (dragging) { dragging = false; document.body.style.userSelect = ""; }
    });

    $("layer_add").addEventListener("click", () => doc.add_layer());
    $("layer_delete").addEventListener("click", () => {
        if (doc.layers && doc.layers.length > 1) doc.delete_layer(doc.active_layer);
    });
    $("layer_move_up").addEventListener("click", () => doc.move_layer_up(doc.active_layer));
    $("layer_move_down").addEventListener("click", () => doc.move_layer_down(doc.active_layer));
    $("layer_merge_down").addEventListener("click", () => doc.merge_layer_down(doc.active_layer));
    $("layer_merge_all").addEventListener("click", () => {
        if (doc.layers && doc.layers.length > 1) doc.merge_all_layers();
    });

    $("layer_opacity").addEventListener("input", () => {
        const val = parseInt($("layer_opacity").value);
        $("layer_opacity_num").value = val;
        doc.set_layer_opacity(doc.active_layer, val / 100);
    });
    $("layer_opacity_num").addEventListener("change", () => {
        const val = Math.max(0, Math.min(100, parseInt($("layer_opacity_num").value) || 0));
        $("layer_opacity").value = val;
        doc.set_layer_opacity(doc.active_layer, val / 100);
    });
    $("layer_blend_mode").addEventListener("change", () => {
        doc.set_layer_blend_mode(doc.active_layer, $("layer_blend_mode").value);
    });
}

module.exports = {init, show_layers_panel, update_panel};
