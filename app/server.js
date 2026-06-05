const ws = require("ws");
const fs = require("fs");
const libtextmode = require("./libtextmode/libtextmode");
const action =  {CONNECTED: 0, REFUSED: 1, JOIN: 2, LEAVE: 3, CURSOR: 4, SELECTION: 5, RESIZE_SELECTION: 6, OPERATION: 7, HIDE_CURSOR: 8, DRAW: 9, CHAT: 10, STATUS: 11, SAUCE: 12, ICE_COLORS: 13, USE_9PX_FONT: 14, CHANGE_FONT: 15, SET_CANVAS_SIZE: 16, SET_BG: 21, FRAME_DRAW: 22, FRAME_ADD: 23, FRAME_DELETE: 24, FRAME_MOVE: 25, FRAME_META: 26, FRAME_CLONE: 27};
const status_types = {ACTIVE: 0, IDLE: 1, AWAY: 2, WEB: 3};
const os = require("os");
const url = require("url");
const server = require("http").createServer();
const joints = {};
const path = require("path");
const {HourlySaver} = require("./hourly_saver");
const {WebhookClient} = require("discord.js");
let hourly_saver;

function send(ws, type, data = {}) {
    ws.send(JSON.stringify({type, data}));
}

class Joint {
    log(text, ip) {
        const date = new Date();
        const year = date.getFullYear();
        let month = date.getMonth() + 1;
        let day =  date.getDate();
        let hour = date.getHours();
        let min = date.getMinutes();
        let sec = date.getSeconds();
        month = (month < 10) ? '0' + month : month;
        day = (day < 10) ? '0' + day : day;
        hour = (hour < 10) ? '0' + hour : hour;
        min = (min < 10) ? '0' + min : min;
        sec = (sec < 10) ? '0' + sec : sec;
        const timestamp = year + '-' + month + '-' + day + ' ' + hour + ':' + min + ':' + sec;
        if (!this.quiet) console.log(`${timestamp} ${this.hostname}${this.path}: (${ip}) ${text}`);
    }

    send_all(sender, type, opts = {}) {
        for (const data of this.data_store) {
            if (!data.closed && data.user.nick != undefined && data.ws != sender) send(data.ws, type, opts);
        }
    }

    send_all_including_self(type, opts = {}) {
        for (const data of this.data_store) {
            if (!data.closed && data.user.nick != undefined) send(data.ws, type, opts);
        }
    }

    send_all_including_guests(sender, type, opts = {}) {
        for (const data of this.data_store) {
            if (!data.closed && data.ws != sender) send(data.ws, type, opts);
        }
    }

    connected_users() {
        return this.data_store.filter((data) => !data.closed).map((data) => data.user);
    }

    discord_chat(nick, content) {
        this.webhook.send({
            avatarURL: "https://raw.githubusercontent.com/blocktronics/moebius/master/build/icon.png",
            username: (nick == "") ? "Guest" : nick,
            content,
        }).catch(console.error);
    }

    discord_join(nick) {
        this.webhook.send({
            embeds: [
                {
                    color: "#008000",
                    author: {
                        name: "Moebius collaborative server",
                        url: "https://blocktronics.github.io/moebius/",
                        iconURL: "https://raw.githubusercontent.com/blocktronics/moebius/master/build/icon.png",
                    },
                    description: `${(nick == "") ? "Guest" : nick} has joined`,
                }
            ]
        }).catch(console.error);
    }

    message(ws, msg, ip) {
        switch (msg.type) {
        case action.CONNECTED:
            if (msg.data.nick == undefined || this.pass == "" || msg.data.pass == this.pass) {
                const id = this.data_store.length;
                const users = this.connected_users();
                this.data_store.push({user: {nick: msg.data.nick, group: msg.data.group, id: id, status: (msg.data.nick == undefined) ? status_types.WEB : status_types.ACTIVE}, ws: ws, closed: false});
                const flat_doc = this.animation_mode ? {...this.doc, palette: this.doc.palette || libtextmode.ega, data: this.doc.animation.frames[0].layers[0].data} : this.doc;
                if (msg.data.nick == undefined) {
                    send(ws, action.CONNECTED, {id, doc: libtextmode.compress(flat_doc)});
                    this.log("web joined", ip);
                } else {
                    const response = {id, doc: libtextmode.compress(flat_doc), users, chat_history: this.chat_history, status: status_types.ACTIVE};
                    if (this.animation_mode) {
                        response.animation = {
                            fps: this.doc.animation.fps,
                            frames: this.doc.animation.frames.map(f => ({
                                delay_ms: f.delay_ms,
                                reveal: f.reveal || "inchworm",
                                scene_break: f.scene_break,
                                doc: libtextmode.compress({data: f.layers[0].data, columns: this.doc.columns, rows: this.doc.rows}),
                            })),
                        };
                    }
                    send(ws, action.CONNECTED, response);
                    this.log(`${msg.data.nick} has joined`, ip);
                    if (this.webhook) this.discord_join(msg.data.nick);
                }
                this.send_all(ws, action.JOIN, {id, nick: msg.data.nick, group: msg.data.group, status: (msg.data.nick == undefined) ? status_types.WEB : status_types.ACTIVE});
            } else {
                send(ws, action.REFUSED);
                this.log(`${msg.data.nick} was refused`, ip);
            }
        break;
        case action.DRAW:
            if (!this.animation_mode && (msg.data.x < this.doc.columns) && (msg.data.y < this.doc.rows)) {
                const block = Object.assign(msg.data.block);
                this.doc.data[msg.data.y * this.doc.columns + msg.data.x] = block;
                if (!this.doc.extended_colors && (block.fg_rgb || block.bg_rgb || block.fg_idx !== undefined || block.bg_idx !== undefined)) {
                    this.doc.extended_colors = true;
                }
                this.send_all_including_guests(ws, msg.type, msg.data);
            }
        break;
        case action.FRAME_DRAW: {
            if (!this.animation_mode) break;
            const {frame_idx, x, y, block} = msg.data;
            const anim_frame = this.doc.animation.frames[frame_idx];
            if (anim_frame && anim_frame.layers[0] && x < this.doc.columns && y < this.doc.rows) {
                anim_frame.layers[0].data[y * this.doc.columns + x] = Object.assign(block);
                if (!this.doc.extended_colors && (block.fg_rgb || block.bg_rgb || block.fg_idx !== undefined || block.bg_idx !== undefined)) {
                    this.doc.extended_colors = true;
                }
                this.send_all_including_guests(ws, action.FRAME_DRAW, msg.data);
            }
        }
        break;
        case action.FRAME_ADD: {
            if (!this.animation_mode) break;
            const {after_idx, scene_break} = msg.data;
            const frames = this.doc.animation.frames;
            if (after_idx >= 0 && after_idx < frames.length) {
                const layer_size = this.doc.columns * this.doc.rows;
                frames.splice(after_idx + 1, 0, {
                    delay_ms: 0, reveal: "inchworm", scene_break: !!scene_break,
                    layers: [{name: "Background", visible: true, locked: false, opacity: 1.0, blend_mode: "normal", offset_x: 0, offset_y: 0, data: new Array(layer_size).fill(null).map(() => ({fg: 7, bg: 0, code: 32}))}],
                });
                this.send_all_including_guests(ws, action.FRAME_ADD, {after_idx, scene_break: !!scene_break});
            }
        }
        break;
        case action.FRAME_DELETE: {
            if (!this.animation_mode) break;
            const del_idx = msg.data.frame_idx;
            const frames = this.doc.animation.frames;
            if (del_idx > 0 && del_idx < frames.length && frames.length > 1) {
                frames.splice(del_idx, 1);
                this.send_all_including_guests(ws, action.FRAME_DELETE, {frame_idx: del_idx});
            }
        }
        break;
        case action.FRAME_MOVE: {
            if (!this.animation_mode) break;
            const {from, drop_before} = msg.data;
            const frames = this.doc.animation.frames;
            if (from >= 0 && from < frames.length && drop_before >= 0 && drop_before <= frames.length && drop_before !== from && drop_before !== from + 1) {
                const [moved_frame] = frames.splice(from, 1);
                frames.splice(drop_before > from ? drop_before - 1 : drop_before, 0, moved_frame);
                this.send_all_including_guests(ws, action.FRAME_MOVE, {from, drop_before});
            }
        }
        break;
        case action.FRAME_META: {
            if (!this.animation_mode) break;
            const {frame_idx: meta_idx, delay_ms, reveal, scene_break: meta_sb} = msg.data;
            const meta_frame = this.doc.animation.frames[meta_idx];
            if (meta_frame) {
                if (delay_ms !== undefined) meta_frame.delay_ms = Math.max(0, delay_ms);
                if (reveal !== undefined) meta_frame.reveal = reveal;
                if (meta_sb !== undefined && meta_idx > 0) meta_frame.scene_break = !!meta_sb;
                this.send_all_including_guests(ws, action.FRAME_META, msg.data);
            }
        }
        break;
        case action.FRAME_CLONE: {
            if (!this.animation_mode) break;
            const {after_idx: clone_idx, delay_ms: clone_delay, frame_doc} = msg.data;
            if (clone_idx >= 0 && clone_idx < this.doc.animation.frames.length) {
                const cell_doc = libtextmode.uncompress(frame_doc);
                const bg_layer = libtextmode.make_layer("Background", this.columns, this.rows);
                bg_layer.data = cell_doc.data;
                this.doc.animation.frames.splice(clone_idx + 1, 0, {layers: [bg_layer], delay_ms: clone_delay || 0, scene_break: false});
                this.send_all_including_guests(ws, action.FRAME_CLONE, msg.data);
            }
        }
        break;
        case action.CHAT:
            if (this.data_store[msg.data.id].user.nick != msg.data.nick) this.data_store[msg.data.id].user.nick = msg.data.nick;
            if (this.data_store[msg.data.id].user.group != msg.data.group) this.data_store[msg.data.id].user.group = msg.data.group;
            this.chat_history.push({id: msg.data.id, nick: msg.data.nick, group: msg.data.group, text: msg.data.text, time: Date.now()});
            if (this.chat_history.length > 32) this.chat_history.shift();
            this.send_all(ws, msg.type, msg.data);
            this.log(`${msg.data.nick}: ${msg.data.text}`, ip);
            if (this.webhook) this.discord_chat(msg.data.nick, msg.data.text);
        break;
        case action.STATUS:
            this.data_store[msg.data.id].user.status = msg.data.status;
            this.send_all_including_self(msg.type, msg.data);
            const status = Object.keys(status_types).find(key => status_types[key] === msg.data.status);
            this.log(`status: ${status}`, ip);
            break;
        case action.SAUCE:
            this.doc.title = msg.data.title;
            this.doc.author = msg.data.author;
            this.doc.group = msg.data.group;
            this.doc.comments = msg.data.comments;
            this.send_all_including_guests(ws, msg.type, msg.data);
            break;
        case action.ICE_COLORS:
            this.doc.ice_colors = msg.data.value;
            this.send_all_including_guests(ws, msg.type, msg.data);
            break;
        case action.USE_9PX_FONT:
            this.doc.use_9px_font = msg.data.value;
            this.send_all_including_guests(ws, msg.type, msg.data);
            break;
        case action.CHANGE_FONT:
            this.doc.font_name = msg.data.font_name;
            this.send_all_including_guests(ws, msg.type, msg.data);
            break;
        case action.SET_CANVAS_SIZE:
            libtextmode.resize_canvas(this.doc, msg.data.columns, msg.data.rows);
            this.send_all_including_guests(ws, msg.type, msg.data);
            this.log(`changed canvas: ${msg.data.columns}/${msg.data.rows}`, ip);
            break;
        case action.SET_BG:
            // this.doc.c64_background = msg.data.value;
            // this.send_all_including_guests(ws, msg.type, msg.data);
            break;
        default:
            this.send_all(ws, msg.type, msg.data);
        }
    }

    save(file = this.file) {
        libtextmode.write_file(this.doc, file);
    }

    constructor({path, file, pass, quiet = false, discord, columns = 80, rows = 25}) {
        this.path = path;
        this.file = file;
        this.pass = pass;
        this.columns = columns;
        this.rows = rows;
        this.quiet = quiet;
        this.webhook = (discord == "") ? undefined : new WebhookClient({ url: discord });
        this.data_store = [];
        this.chat_history = [];
        hourly_saver = new HourlySaver();
        hourly_saver.start();
        hourly_saver.on("save", () => {
            const file = hourly_saver.filename("./", this.file);
            this.save(file);
            if (hourly_saver.keep_if_changes(file)) this.log(`saved backup as ${file}`);
        });
    }

    connection(ws, ip) {
        ws.on("message", msg => this.message(ws, JSON.parse(msg), ip));
        ws.on("close", () => {
            for (let id = 0; id < this.data_store.length; id++) {
                if (this.data_store[id].ws == ws) {
                    this.data_store[id].closed = true;
                    const user = this.data_store[id].user;
                    if (user.nick == undefined) {
                        this.log("web left", ip);
                    } else {
                        this.log(`${user.nick} has left`, ip);
                    }
                    this.send_all(ws, action.LEAVE, {id: user.id});
                }
            }
        });
    }

    new_mob_doc(columns = 80, rows = 25) {
        const layer_size = columns * rows;
        const layer = {name: "Background", visible: true, locked: false, opacity: 1.0, blend_mode: "normal", offset_x: 0, offset_y: 0, data: new Array(layer_size).fill(null).map(() => ({fg: 7, bg: 0, code: 32}))};
        const animation = {fps: 8, frames: [{delay_ms: 0, reveal: "inchworm", scene_break: true, layers: [layer]}]};
        return {columns, rows, title: "", author: "", group: "", date: "", comments: "", font_name: "IBM VGA", use_9px_font: false, ice_colors: false, extended_colors: false, palette: libtextmode.ega, layers: animation.frames[0].layers, animation};
    }

    async start() {
        this.hostname = os.hostname();
        if (!fs.existsSync(this.file) && path.extname(this.file).toLowerCase() === ".mob") {
            this.doc = this.new_mob_doc(this.columns, this.rows);
            libtextmode.write_file(this.doc, this.file);
            this.log(`created new file: ${this.file}`);
        } else {
            this.doc = await libtextmode.read_file(this.file);
        }
        this.animation_mode = !!(this.doc.animation);
        this.wss = new ws.Server({noServer: true});
        this.log(`started${this.animation_mode ? " (animation mode)" : ""}`);
        hourly_saver.start();
    }

    close() {
        for (const data of this.data_store) {
            if (!data.closed) data.ws.close();
        }
        this.wss.close();
        hourly_saver.stop();
        this.save();
    }
}

async function start_joint({path: server_path, file, pass = "", quiet = false, server_port, discord = "", columns = 80, rows = 25} = {}) {
    server_path = (server_path != undefined) ? server_path : path.parse(file).base;
    server_path = `/${server_path.toLowerCase()}`;
    if (!server.address()) server.listen(server_port);
    if (joints[server_path]) throw "Path already in use.";
    server_path = server_path.toLowerCase();
    joints[server_path] = new Joint({path: server_path, file, pass, quiet, discord, columns, rows});
    await joints[server_path].start();
    return server_path;
}

function end_joint(path) {
    if (joints[path]) {
        joints[path].close();
        delete joints[path];
    }
}

server.on("upgrade", (req, socket, head) => {
    const path = decodeURI(url.parse(req.url).pathname).toLowerCase();
    if (joints[path]) {
        const ip = req.connection.remoteAddress;
        joints[path].wss.handleUpgrade(req, socket, head, (ws) => joints[path].connection(ws, ip));
    } else {
        socket.destroy();
    }
});

function has_joint(path) {
    return joints[path] != undefined;
}

function close() {
    for (const path of Object.keys(joints)) end_joint(path);
    if (server.address()) server.close();
}

module.exports = {close, start_joint, end_joint, has_joint};
