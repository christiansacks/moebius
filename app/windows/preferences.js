const electron = require("electron");
let backup_folder_value;

function prefs({nick, group, use_numpad, use_flashing_cursor, use_pixel_aliasing, hide_scrollbars, use_backup, backup_folder}) {
    document.getElementById("nick").value = nick;
    document.getElementById("group").value = group;
    document.getElementById("use_numpad").checked = use_numpad;
    document.getElementById("use_flashing_cursor").checked = use_flashing_cursor;
    document.getElementById("use_pixel_aliasing").checked = use_pixel_aliasing;
    document.getElementById("hide_scrollbars").checked = hide_scrollbars;
    document.getElementById("use_backup").checked = use_backup;
    backup_folder_value = backup_folder;
    document.getElementById("backup_folder").innerText = (backup_folder == "") ? "No Backup Folder Set" : backup_folder;
}

function update(key, value) {
    electron.ipcRenderer.send("update_prefs", {key, value});
}

function nick() {
    update("nick", document.getElementById("nick").value);
}

function group() {
    update("group", document.getElementById("group").value);
}

function use_numpad() {
    update("use_numpad", document.getElementById("use_numpad").checked);
}

function use_flashing_cursor() {
    update("use_flashing_cursor", document.getElementById("use_flashing_cursor").checked);
}

function use_pixel_aliasing() {
    update("use_pixel_aliasing", document.getElementById("use_pixel_aliasing").checked);
}

function hide_scrollbars() {
    update("hide_scrollbars", document.getElementById("hide_scrollbars").checked);
}

function use_backup() {
    update("use_backup", document.getElementById("use_backup").checked);
}

function choose_folder() {
    const defaultPath = (backup_folder_value && backup_folder_value != "") ? backup_folder_value : electron.remote.app.getPath("documents");
    electron.remote.dialog.showOpenDialog(electron.remote.getCurrentWindow(), {defaultPath, properties: ["openDirectory", "createDirectory"]}, (files) => {
        if (files) {
            const folder = files[0];
            document.getElementById("backup_folder").innerText = folder;
            update("backup_folder", folder);
        }
    });
}

function override_submit(event) {
    if (event.key == "Enter" || event.key == "NumpadEnter") event.preventDefault();
}

document.addEventListener("DOMContentLoaded", (event) => {
    document.getElementById("nick").addEventListener("keydown", override_submit, true);
    document.getElementById("nick").addEventListener("keyup", (event) => nick(), true);
    document.getElementById("group").addEventListener("keydown", override_submit, true);
    document.getElementById("group").addEventListener("keyup", (event) => group(), true);
    document.getElementById("use_numpad").addEventListener("change", (event) => use_numpad(), true);
    document.getElementById("use_flashing_cursor").addEventListener("change", (event) => use_flashing_cursor(), true);
    document.getElementById("hide_scrollbars").addEventListener("change", (event) => hide_scrollbars(), true);
    document.getElementById("use_pixel_aliasing").addEventListener("change", (event) => use_pixel_aliasing(), true);
    document.getElementById("backup_choose").addEventListener("click", (event) => {
        choose_folder();
        event.preventDefault();
    }, true);
    document.getElementById("use_backup").addEventListener("change", (event) => use_backup(), true);
    document.body.addEventListener("keydown", (event) => {
        if (event.code == "Escape") electron.remote.getCurrentWindow().close();
    }, true);
}, true);

electron.ipcRenderer.on("prefs", (event, opts) => prefs(opts));