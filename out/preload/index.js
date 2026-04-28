"use strict";
const electron = require("electron");
const preload = require("@electron-toolkit/preload");
const api = {
  selectFiles: () => electron.ipcRenderer.invoke("select-files"),
  getTracksByPaths: (paths) => electron.ipcRenderer.invoke("get-tracks-by-paths", paths),
  selectFolder: () => electron.ipcRenderer.invoke("select-folder"),
  watchFolder: (path) => electron.ipcRenderer.send("watch-folder", path),
  onFolderUpdated: (callback) => {
    const listener = (_event, tracks) => callback(tracks);
    electron.ipcRenderer.on("folder-updated", listener);
    return () => electron.ipcRenderer.removeListener("folder-updated", listener);
  },
  // YouTube API
  youtubeSearch: (query) => electron.ipcRenderer.invoke("youtube-search", query),
  youtubeGetStream: (videoId) => electron.ipcRenderer.invoke("youtube-get-stream", videoId),
  youtubeGetPlaylist: (url) => electron.ipcRenderer.invoke("youtube-get-playlist", url),
  youtubeGetSubtitles: (videoId) => electron.ipcRenderer.invoke("youtube-get-subtitles", videoId),
  // Discord RPC
  discordUpdatePresence: (info) => electron.ipcRenderer.send("discord-update-presence", info),
  discordClearPresence: () => electron.ipcRenderer.send("discord-clear-presence")
};
if (process.contextIsolated) {
  try {
    preload.exposeElectronAPI();
    electron.contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  window.api = api;
}
