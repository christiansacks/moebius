const doc = require("../doc");

function $(id) { return document.getElementById(id); }

const MIN_HEIGHT = 70;
const MAX_HEIGHT = 400;
const DEFAULT_HEIGHT = 110;
let dock_state = "right"; // "right" | "bottom"

function set_css_height(h) {
    if (dock_state === "right") {
        document.documentElement.style.setProperty("--anim-panel-height", h + "px");
    } else {
        document.documentElement.style.setProperty("--anim-bottom-height", h + "px");
        $("animation_panel").style.height = h + "px";
    }
}

function get_css_height() {
    const val = dock_state === "right"
        ? getComputedStyle(document.documentElement).getPropertyValue("--anim-panel-height")
        : getComputedStyle(document.documentElement).getPropertyValue("--anim-bottom-height");
    return parseInt(val) || DEFAULT_HEIGHT;
}

function show(visible) {
    const panel = $("animation_panel");
    if (visible) {
        panel.classList.remove("hidden");
        if (dock_state === "bottom") {
            document.documentElement.style.setProperty("--anim-bottom-height", get_css_height() + "px");
        }
    } else {
        panel.classList.add("hidden");
        if (dock_state === "bottom") {
            document.documentElement.style.setProperty("--anim-bottom-height", "0px");
        }
    }
}

function toggle_dock() {
    const panel = $("animation_panel");
    const h = get_css_height();
    if (dock_state === "right") {
        // Move from #preview to after #viewport
        dock_state = "bottom";
        panel.classList.add("bottom-docked");
        document.documentElement.style.setProperty("--anim-panel-height", DEFAULT_HEIGHT + "px");
        const viewport = $("viewport");
        viewport.parentNode.insertBefore(panel, viewport.nextSibling);
        document.documentElement.style.setProperty("--anim-bottom-height", h + "px");
        panel.style.height = h + "px";
        $("anim_dock_toggle").title = "Move to right panel";
        $("anim_dock_toggle").textContent = "⇄";
    } else {
        // Move back into #preview
        dock_state = "right";
        panel.classList.remove("bottom-docked");
        panel.style.height = "";
        document.documentElement.style.setProperty("--anim-bottom-height", "0px");
        document.documentElement.style.setProperty("--anim-panel-height", h + "px");
        $("preview").appendChild(panel);
        $("anim_dock_toggle").title = "Move to bottom";
        $("anim_dock_toggle").textContent = "⇅";
    }
}

function init_resize_handle() {
    const handle = $("anim_resize_handle");
    let drag_start_y = 0, drag_start_h = 0, dragging = false;
    handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        dragging = true;
        drag_start_y = e.clientY;
        drag_start_h = get_css_height();
        handle.classList.add("active");
        document.body.style.userSelect = "none";
    });
    document.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        // Dragging up = taller in both dock states
        const delta = drag_start_y - e.clientY;
        const new_h = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, drag_start_h + delta));
        set_css_height(new_h);
    });
    document.addEventListener("mouseup", () => {
        if (dragging) {
            dragging = false;
            handle.classList.remove("active");
            document.body.style.userSelect = "";
        }
    });
}

function init_wheel_scroll() {
    $("anim_strip").addEventListener("wheel", (e) => {
        e.preventDefault();
        $("anim_strip").scrollLeft += e.deltaY + e.deltaX;
    }, {passive: false});
}

function update_controls() {
    if (!doc.animation_mode) return;
    $("anim_frame_info").textContent = `Frame ${doc.current_frame + 1} / ${doc.frame_count}`;
    $("anim_fps").value = doc.animation_fps;
    const frame = doc.animation && doc.animation.frames[doc.current_frame];
    $("anim_delay_ms").value = frame ? frame.delay_ms : 0;
    $("anim_play").textContent = doc.is_playing ? "⏸" : "▶";
    $("anim_play").classList.toggle("playing", doc.is_playing);
    $("anim_del").disabled = doc.frame_count <= 1;
}

function update_strip() {
    if (!doc.animation_mode) return;
    const strip = $("anim_strip");
    const frames = doc.animation ? doc.animation.frames : [];
    const current = doc.current_frame;
    strip.innerHTML = "";
    frames.forEach((frame, idx) => {
        const card = document.createElement("div");
        card.className = "anim_frame_card" + (idx === current ? " active" : "");
        const num = document.createElement("div");
        num.className = "anim_frame_num";
        num.textContent = idx + 1;
        const delay = document.createElement("div");
        delay.className = "anim_frame_delay";
        delay.textContent = frame.delay_ms > 0 ? frame.delay_ms + "ms" : "default";
        card.appendChild(num);
        card.appendChild(delay);
        card.addEventListener("click", () => {
            if (!doc.is_playing) doc.goto_frame(idx);
        });
        strip.appendChild(card);
    });
    const active_card = strip.querySelector(".anim_frame_card.active");
    if (active_card) active_card.scrollIntoView({block: "nearest", inline: "nearest"});
}

function update() {
    update_controls();
    update_strip();
}

function update_frame(idx) {
    update_controls();
    const cards = document.querySelectorAll(".anim_frame_card");
    cards.forEach((card, i) => card.classList.toggle("active", i === idx));
    if (cards[idx]) cards[idx].scrollIntoView({block: "nearest", inline: "nearest"});
    const frame = doc.animation && doc.animation.frames[idx];
    if (frame) $("anim_delay_ms").value = frame.delay_ms;
}

function set_playing(playing) {
    $("anim_play").textContent = playing ? "⏸" : "▶";
    $("anim_play").classList.toggle("playing", playing);
}

function init() {
    init_resize_handle();
    init_wheel_scroll();

    $("anim_dock_toggle").addEventListener("click", toggle_dock);
    $("anim_first").addEventListener("click", () => { if (!doc.is_playing) doc.goto_frame(0); });
    $("anim_prev").addEventListener("click", () => { if (!doc.is_playing) doc.goto_frame(Math.max(0, doc.current_frame - 1)); });
    $("anim_play").addEventListener("click", () => {
        if (doc.is_playing) doc.stop_playback();
        else doc.start_playback();
    });
    $("anim_next").addEventListener("click", () => { if (!doc.is_playing) doc.goto_frame(Math.min(doc.frame_count - 1, doc.current_frame + 1)); });
    $("anim_last").addEventListener("click", () => { if (!doc.is_playing) doc.goto_frame(doc.frame_count - 1); });
    $("anim_clone").addEventListener("click", () => { if (!doc.is_playing) doc.clone_frame(doc.current_frame); });
    $("anim_blank").addEventListener("click", () => { if (!doc.is_playing) doc.add_blank_frame(doc.current_frame); });
    $("anim_del").addEventListener("click", () => { if (!doc.is_playing) doc.delete_frame(doc.current_frame); });
    $("anim_fps").addEventListener("change", () => {
        doc.set_animation_fps(parseInt($("anim_fps").value) || 8);
    });
    $("anim_delay_ms").addEventListener("change", () => {
        doc.set_frame_delay(doc.current_frame, parseInt($("anim_delay_ms").value) || 0);
        update_strip();
    });
}

module.exports = {init, show, update, update_frame, set_playing};
