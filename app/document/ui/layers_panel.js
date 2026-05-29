const doc = require("../doc");
const {send} = require("../../senders");

function $(id) { return document.getElementById(id); }

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
        name.textContent = layer.name;
        name.addEventListener("dblclick", () => start_rename(i, name));

        item.appendChild(vis);
        item.appendChild(lock);
        item.appendChild(name);
        item.addEventListener("click", () => { doc.active_layer = i; });
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
        const trimmed = el.textContent.trim();
        doc.rename_layer(idx, trimmed || doc.layers[idx].name);
    };
    el.addEventListener("blur", finish, {once: true});
    el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); el.blur(); }
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
