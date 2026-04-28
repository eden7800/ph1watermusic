"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const electron = require("electron");
const path = require("path");
const url = require("url");
const fs = require("fs");
const utils = require("@electron-toolkit/utils");
const chokidar = require("chokidar");
const youtubeDlExec = require("youtube-dl-exec");
const discordRpc = require("@xhayper/discord-rpc");
const binName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const ytDlpPath = utils.is.dev ? path.join(__dirname, "../../node_modules/youtube-dl-exec/bin", binName) : path.join(process.resourcesPath, "app.asar.unpacked/node_modules/youtube-dl-exec/bin", binName);
const youtubeDl = youtubeDlExec.create(ytDlpPath);
const DISCORD_CLIENT_ID = "1497198726979125329";
const rpc = new discordRpc.Client({ clientId: DISCORD_CLIENT_ID });
let rpcReady = false;
rpc.on("ready", () => {
  rpcReady = true;
  console.log("[Discord RPC] Connected");
});
rpc.login().catch((err) => {
  console.warn("[Discord RPC] Login failed (Discord not running?):", err.message);
});
let mainWindow = null;
let watcher = null;
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    title: "산성뮤직",
    width: 1100,
    height: 750,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: "#030303",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(() => {
  utils.electronApp.setAppUserModelId("com.ph1water.musicplayer");
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  createWindow();
  electron.app.on("activate", function() {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (rpcReady) rpc.destroy().catch(() => {
  });
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
async function parseTrack(filePath) {
  const { parseFile } = await import("music-metadata");
  try {
    const stats = fs.statSync(filePath);
    const metadata = await parseFile(filePath);
    let cover = void 0;
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const pic = metadata.common.picture[0];
      cover = `data:${pic.format};base64,${Buffer.from(pic.data).toString("base64")}`;
    }
    const url$1 = url.pathToFileURL(filePath).href;
    return {
      id: filePath,
      title: metadata.common.title || "Unknown Title",
      artist: metadata.common.artist || "Unknown Artist",
      album: metadata.common.album,
      url: url$1,
      cover,
      addedAt: stats.birthtimeMs,
      format: {
        container: metadata.format.container,
        codec: metadata.format.codec,
        bitrate: metadata.format.bitrate,
        sampleRate: metadata.format.sampleRate,
        lossless: metadata.format.lossless
      }
    };
  } catch (e) {
    const url$1 = url.pathToFileURL(filePath).href;
    return { id: filePath, title: "Error loading", artist: "", url: url$1, format: {} };
  }
}
electron.ipcMain.handle("select-files", async () => {
  const result = await electron.dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Audio Files", extensions: ["mp3", "flac", "m4a", "alac", "wav"] }
    ]
  });
  if (result.canceled) return [];
  const tracks = await Promise.all(result.filePaths.map(parseTrack));
  return tracks;
});
electron.ipcMain.handle("get-tracks-by-paths", async (_, filePaths) => {
  if (!filePaths || !Array.isArray(filePaths)) return [];
  const tracks = await Promise.all(filePaths.map(parseTrack));
  return tracks;
});
electron.ipcMain.handle("select-folder", async () => {
  const result = await electron.dialog.showOpenDialog({
    properties: ["openDirectory"]
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});
electron.ipcMain.on("watch-folder", (event, folderPath) => {
  if (watcher) {
    watcher.close();
  }
  watcher = chokidar.watch(folderPath, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    depth: 1
  });
  const sendUpdate = async () => {
    const files = fs.readdirSync(folderPath);
    const audioFiles = files.filter((f) => /\.(mp3|flac|m4a|wav|alac)$/i.test(f));
    const fullPaths = audioFiles.map((f) => path.join(folderPath, f));
    const tracks = await Promise.all(fullPaths.map(fullPaths.map(parseTrack)));
    event.reply("folder-updated", tracks);
  };
  watcher.on("add", () => sendUpdate());
  watcher.on("unlink", () => sendUpdate());
});
electron.ipcMain.on("discord-update-presence", (_, info) => {
  if (!rpcReady || !rpc.user) return;
  try {
    let qualityText = "로컬 파일";
    if (info.format) {
      const parts = [];
      if (info.format.container) parts.push(info.format.container.toUpperCase());
      if (info.format.sampleRate) parts.push(`${(info.format.sampleRate / 1e3).toFixed(1)}kHz`);
      if (info.format.bitrate && !info.format.lossless) parts.push(`${Math.round(info.format.bitrate / 1e3)}kbps`);
      if (parts.length > 0) qualityText = parts.join(" · ");
    }
    const largeImageKey = info.isYouTube && info.cover?.startsWith("https://") ? info.cover : "logo";
    const largeImageText = info.album || (info.isYouTube ? "YouTube" : "산성뮤직");
    const stateBase = info.isYouTube ? info.artist : qualityText !== "로컬 파일" ? `${info.artist} · ${qualityText}` : info.artist;
    if (info.isPlaying) {
      const now = Date.now();
      const elapsed = (info.currentTime || 0) * 1e3;
      const startTimestamp = now - elapsed;
      const endTimestamp = info.duration ? startTimestamp + info.duration * 1e3 : void 0;
      rpc.user.setActivity({
        type: 2,
        // Listening
        details: info.title,
        state: stateBase,
        largeImageKey,
        largeImageText,
        smallImageKey: info.isYouTube ? "youtube" : void 0,
        smallImageText: info.isYouTube ? "YouTube 스트리밍" : void 0,
        startTimestamp,
        endTimestamp,
        instance: false
      });
    } else {
      rpc.user.setActivity({
        type: 2,
        // Listening
        details: info.title,
        state: `⏸ ${stateBase}`,
        largeImageKey,
        largeImageText,
        instance: false
      });
    }
  } catch (err) {
    console.warn("[Discord RPC] setActivity failed:", err);
  }
});
electron.ipcMain.on("discord-clear-presence", () => {
  if (!rpcReady || !rpc.user) return;
  rpc.user.clearActivity().catch(() => {
  });
});
electron.ipcMain.handle("youtube-search", async (_, query) => {
  try {
    const results = await youtubeDl(`ytsearch10:${query}`, {
      dumpSingleJson: true,
      noWarnings: true,
      flatPlaylist: true
    });
    return (results.entries || []).map((entry) => ({
      id: entry.id,
      title: entry.title,
      artist: entry.uploader || "YouTube",
      url: `https://www.youtube.com/watch?v=${entry.id}`,
      cover: entry.thumbnails?.[0]?.url || "",
      duration: entry.duration,
      isYouTube: true
    }));
  } catch (error) {
    console.error("YouTube Search Error:", error);
    return [];
  }
});
electron.ipcMain.handle("youtube-get-stream", async (_, videoId) => {
  try {
    const info = await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, {
      dumpSingleJson: true,
      noWarnings: true,
      format: "bestaudio/best"
    });
    return info.url;
  } catch (error) {
    console.error("YouTube Stream Error:", error);
    return null;
  }
});
electron.ipcMain.handle("youtube-get-playlist", async (_, url2) => {
  try {
    const results = await youtubeDl(url2, {
      dumpSingleJson: true,
      noWarnings: true,
      flatPlaylist: true,
      yesPlaylist: true
    });
    const entries = results.entries || [];
    return entries.map((entry) => ({
      id: entry.id,
      title: entry.title || "알 수 없는 곡",
      artist: entry.uploader || entry.channel || "YouTube",
      url: `https://www.youtube.com/watch?v=${entry.id}`,
      cover: entry.thumbnails?.slice(-1)[0]?.url || entry.thumbnail || "",
      duration: entry.duration,
      isYouTube: true
    }));
  } catch (error) {
    console.error("YouTube Playlist Error:", error);
    return [];
  }
});
electron.ipcMain.handle("youtube-get-subtitles", async (_, videoId) => {
  try {
    const info = await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, {
      dumpSingleJson: true,
      noWarnings: true
    });
    const subs = info.subtitles || {};
    const autoCaps = info.automatic_captions || {};
    for (const lang of ["ko", "en"]) {
      const formats = subs[lang] || autoCaps[lang];
      if (!formats || formats.length === 0) continue;
      const vttEntry = formats.find((f) => f.ext === "vtt") || formats[0];
      if (!vttEntry?.url) continue;
      const resp = await fetch(vttEntry.url);
      if (!resp.ok) continue;
      return await resp.text();
    }
    return null;
  } catch (e) {
    console.error("Subtitle Error:", e);
    return null;
  }
});
