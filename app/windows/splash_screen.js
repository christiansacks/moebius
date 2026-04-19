const libtextmode = require("../libtextmode/libtextmode");
const electron = require("electron");
const remote = require("@electron/remote");
let konami_index = 0;
const konami_code = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "KeyB", "KeyA"];
const {send} = require("../senders");
const ans_path = remote.app.isPackaged ? `${process.resourcesPath}/ans/` : "./build/ans/";

function show_new_version_button() {
    const new_version = document.getElementById("new_version");
    new_version.classList.add("slide_down");
    new_version.addEventListener("click", (event) => electron.shell.openExternal("https://github.com/christiansacks/moebius/releases/latest"), true);
}

function is_newer(remote_ver, local_ver) {
    const r = remote_ver.split(".").map(Number);
    const l = local_ver.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
        if ((r[i] || 0) > (l[i] || 0)) return true;
        if ((r[i] || 0) < (l[i] || 0)) return false;
    }
    return false;
}

function connect(event) {
    const server = document.getElementById("server").value;
    const pass = document.getElementById("pass").value;
    if (server != "") {
        update("server", server);
        update("pass", pass);
        electron.ipcRenderer.send("connect_to_server", {server, pass});
    }
}

function body_key_down(params) {
    if (event.code == konami_code[konami_index]) {
        konami_index += 1;
        if (konami_index == konami_code.length) {
            konami_index = 0;
            send("konami_code");
            new Audio(remote.app.isPackaged ? `${ans_path}6.5.ans` : "../../build/ans/6.5.ans").play();
        }
    } else {
        konami_index = 0;
    }
}

function key_down(params) {
    if (event.code == "Enter" || event.code == "NumpadEnter") connect();
}

function update(key, value) {
    electron.ipcRenderer.send("update_prefs", {key, value});
}

document.addEventListener("DOMContentLoaded", () => {
    const preferences = document.getElementById("preferences");
    if (process.platform != "darwin") preferences.innerText = "Settings";
    document.getElementById("new_document").addEventListener("click", (event) => electron.ipcRenderer.send("new_document"));
    document.getElementById("open").addEventListener("click", (event) => electron.ipcRenderer.send("open"));
    preferences.addEventListener("click", (event) => electron.ipcRenderer.send("preferences"));
    document.getElementById("connect").addEventListener("click", connect, true);
    document.body.addEventListener("keydown", body_key_down, true);
    document.getElementById("server").addEventListener("keydown", key_down, true);
    document.getElementById("pass").addEventListener("keydown", key_down, true);
    libtextmode.animate({file: `${ans_path}MB4K.ans`, ctx: document.getElementById("splash_terminal").getContext("2d")});
    fetch("https://api.github.com/repos/christiansacks/moebius/releases/latest", {cache: "no-cache"})
        .then((response) => response.json())
        .then((json) => {
            const remote_ver = (json.tag_name || "").replace(/^v/, "");
            if (remote_ver && is_newer(remote_ver, remote.app.getVersion())) show_new_version_button();
        }).catch(() => {});
});

electron.ipcRenderer.on("saved_server", (event, {server, pass}) => {
    document.getElementById("server").value = server;
    document.getElementById("pass").value = pass;
});