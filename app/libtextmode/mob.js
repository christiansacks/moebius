const zlib = require("zlib");

const MOB_MAGIC = Buffer.from([0x4D, 0x4F, 0x42, 0x01]); // MOB\x01
const MOB_VERSION = 1;

function read_mob(buffer) {
    if (buffer[0] !== 0x4D || buffer[1] !== 0x4F || buffer[2] !== 0x42 || buffer[3] !== 0x01) {
        throw new Error("Not a .mob file (invalid magic)");
    }
    // bytes 4-5: version u16 LE (reserved for future use)
    const payload_len = buffer.readUInt32LE(6);
    const compressed = buffer.slice(10, 10 + payload_len);
    const json_bytes = zlib.inflateSync(compressed);
    const payload = JSON.parse(json_bytes.toString("utf8"));

    const layers = payload.layers.map(lj => ({
        name: lj.name || "Layer",
        visible: lj.visible !== false,
        locked: lj.locked === true,
        opacity: typeof lj.opacity === "number" ? lj.opacity : 1.0,
        blend_mode: lj.blend_mode || "normal",
        offset_x: lj.offset_x || 0,
        offset_y: lj.offset_y || 0,
        data: lj.data,
    }));

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
    };
}

function encode_as_mob(doc_obj) {
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
        layers: doc_obj.layers.map(layer => ({
            name: layer.name,
            visible: layer.visible,
            locked: layer.locked,
            opacity: layer.opacity,
            blend_mode: layer.blend_mode,
            offset_x: layer.offset_x,
            offset_y: layer.offset_y,
            data: layer.data,
        })),
    };

    const compressed = zlib.deflateSync(Buffer.from(JSON.stringify(payload), "utf8"), {level: 9});
    const header = Buffer.alloc(10);
    MOB_MAGIC.copy(header, 0);
    header.writeUInt16LE(MOB_VERSION, 4);
    header.writeUInt32LE(compressed.length, 6);
    return Buffer.concat([header, compressed]);
}

module.exports = {read_mob, encode_as_mob};
