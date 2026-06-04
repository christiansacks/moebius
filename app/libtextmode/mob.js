const zlib = require("zlib");

const MOB_MAGIC = Buffer.from([0x4D, 0x4F, 0x42, 0x01]); // MOB\x01
const MOB_VERSION = 1;

function parse_layer(lj) {
    return {
        name: lj.name || "Layer",
        visible: lj.visible !== false,
        locked: lj.locked === true,
        opacity: typeof lj.opacity === "number" ? lj.opacity : 1.0,
        blend_mode: lj.blend_mode || "normal",
        offset_x: lj.offset_x || 0,
        offset_y: lj.offset_y || 0,
        data: lj.data,
    };
}

function serialize_layer(layer) {
    return {
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        opacity: layer.opacity,
        blend_mode: layer.blend_mode,
        offset_x: layer.offset_x,
        offset_y: layer.offset_y,
        data: layer.data,
    };
}

function read_mob(buffer) {
    if (buffer[0] !== 0x4D || buffer[1] !== 0x4F || buffer[2] !== 0x42 || buffer[3] !== 0x01) {
        throw new Error("Not a .mob file (invalid magic)");
    }
    const payload_len = buffer.readUInt32LE(6);
    const compressed = buffer.slice(10, 10 + payload_len);
    const json_bytes = zlib.inflateSync(compressed);
    const payload = JSON.parse(json_bytes.toString("utf8"));

    let animation = null;
    if (payload.animation && Array.isArray(payload.animation.frames) && payload.animation.frames.length > 0) {
        animation = {
            fps: payload.animation.fps || 8,
            frames: payload.animation.frames.map(f => ({
                delay_ms: f.delay_ms || 0,
                reveal: f.reveal || "inchworm",
                scene_break: f.scene_break,
                layers: Array.isArray(f.layers) ? f.layers.map(parse_layer) : [],
            })),
        };
    }

    // When animation present, use frame 0's layers so doc.layers === animation.frames[0].layers
    const layers = animation ? animation.frames[0].layers : payload.layers.map(parse_layer);

    return {
        columns: payload.columns,
        rows: payload.rows,
        title: payload.title || "",
        author: payload.author || "",
        group: payload.group || "",
        date: payload.date || "",
        comments: payload.comments || "",
        font_name: payload.font_name || "IBM VGA",
        use_9px_font: payload.use_9px_font || false,
        ice_colors: payload.ice_colors || false,
        extended_colors: payload.extended_colors || false,
        palette: payload.palette || undefined,
        layers,
        animation,
    };
}

function encode_as_mob(doc_obj) {
    const anim = doc_obj.animation;
    const payload = {
        columns: doc_obj.columns,
        rows: doc_obj.rows,
        title: doc_obj.title || "",
        author: doc_obj.author || "",
        group: doc_obj.group || "",
        date: doc_obj.date || "",
        comments: doc_obj.comments || "",
        font_name: doc_obj.font_name,
        use_9px_font: doc_obj.use_9px_font || false,
        ice_colors: doc_obj.ice_colors || false,
        extended_colors: doc_obj.extended_colors || false,
        palette: doc_obj.palette || undefined,
        // Top-level layers = current frame for backward compat with non-animation Moebius
        layers: doc_obj.layers.map(serialize_layer),
    };

    if (anim) {
        payload.animation = {
            fps: anim.fps,
            frames: anim.frames.map(f => ({
                delay_ms: f.delay_ms || 0,
                reveal: f.reveal || "inchworm",
                scene_break: f.scene_break,
                layers: f.layers.map(serialize_layer),
            })),
        };
    }

    const compressed = zlib.deflateSync(Buffer.from(JSON.stringify(payload), "utf8"), {level: 9});
    const header = Buffer.alloc(10);
    MOB_MAGIC.copy(header, 0);
    header.writeUInt16LE(MOB_VERSION, 4);
    header.writeUInt32LE(compressed.length, 6);
    return Buffer.concat([header, compressed]);
}

module.exports = {read_mob, encode_as_mob};
