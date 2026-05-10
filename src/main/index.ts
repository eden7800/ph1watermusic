import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { statSync, readdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import chokidar from 'chokidar'
import { create } from 'youtube-dl-exec'
import { Client } from '@xhayper/discord-rpc'

let _parseFile: ((path: string, opts?: any) => Promise<any>) | null = null
async function getParseFile() {
  if (!_parseFile) {
    const mod = await import('music-metadata')
    _parseFile = mod.parseFile
  }
  return _parseFile
}

const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
const ytDlpPath = is.dev
  ? join(__dirname, '../../node_modules/youtube-dl-exec/bin', binName)
  : join(process.resourcesPath, 'app.asar.unpacked/node_modules/youtube-dl-exec/bin', binName)

const youtubeDl = create(ytDlpPath)

// Discord RPC
const DISCORD_CLIENT_ID = '1497198726979125329'
const rpc = new Client({ clientId: DISCORD_CLIENT_ID })
let rpcReady = false

rpc.on('ready', () => {
  rpcReady = true
  console.log('[Discord RPC] Connected')
})

rpc.login().catch((err: Error) => {
  console.warn('[Discord RPC] Login failed (Discord not running?):', err.message)
})

let mainWindow: BrowserWindow | null = null
let watcher: chokidar.FSWatcher | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: '산성뮤직',
    width: 1100,
    height: 750,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#030303',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.ph1water.musicplayer')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  createWindow()
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (rpcReady) rpc.destroy().catch(() => { })
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

async function batchPromises<T>(items: string[], fn: (item: string) => Promise<T>, concurrency = 4): Promise<T[]> {
  const results: T[] = []
  for (let i = 0; i < items.length; i += concurrency) {
    results.push(...await Promise.all(items.slice(i, i + concurrency).map(fn)))
  }
  return results
}

async function parseTrack(filePath: string) {
  try {
    const parseFile = await getParseFile()
    const stats = statSync(filePath)
    const metadata = await parseFile(filePath, { skipCovers: true })

    return {
      id: filePath,
      title: metadata.common.title || 'Unknown',
      artist: metadata.common.artist || 'Unknown',
      album: metadata.common.album,
      url: pathToFileURL(filePath).href,
      addedAt: stats.birthtimeMs,
      format: {
        container: metadata.format.container,
        codec: metadata.format.codec,
        bitrate: metadata.format.bitrate,
        sampleRate: metadata.format.sampleRate,
        lossless: metadata.format.lossless
      }
    }
  } catch {
    return { id: filePath, title: 'Unknown', artist: '', url: pathToFileURL(filePath).href, format: {} }
  }
}

async function parseCover(filePath: string): Promise<string | null> {
  try {
    const parseFile = await getParseFile()
    const metadata = await parseFile(filePath, { skipCovers: false })
    if (metadata.common.picture?.length) {
      const pic = metadata.common.picture[0]
      return `data:${pic.format};base64,${Buffer.from(pic.data).toString('base64')}`
    }
    return null
  } catch {
    return null
  }
}

ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio Files', extensions: ['mp3', 'flac', 'm4a', 'alac', 'wav'] }]
  })
  if (result.canceled) return []
  return batchPromises(result.filePaths, parseTrack, 4)
})

ipcMain.handle('get-tracks-by-paths', async (_, filePaths: string[]) => {
  if (!Array.isArray(filePaths)) return []
  return batchPromises(filePaths, parseTrack, 4)
})

ipcMain.handle('get-cover', async (_, filePath: string) => parseCover(filePath))

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

ipcMain.on('watch-folder', (event, folderPath: string) => {
  if (watcher) {
    watcher.close()
  }

  watcher = chokidar.watch(folderPath, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    depth: 1
  })

  const sendUpdate = async () => {
    const files = readdirSync(folderPath)
    const audioFiles = files.filter(f => /\.(mp3|flac|m4a|wav|alac)$/i.test(f))
    const fullPaths = audioFiles.map(f => join(folderPath, f))
    const tracks = await Promise.all(fullPaths.map(parseTrack))
    event.reply('folder-updated', tracks)
  }

  watcher.on('add', () => sendUpdate())
  watcher.on('unlink', () => sendUpdate())
})

ipcMain.on('discord-update-presence', (_, info) => {
  if (!rpcReady || !rpc.user) return
  try {
    let qualityText = '로컬 파일'
    if (info.format) {
      const parts = []
      if (info.format.container) parts.push(info.format.container.toUpperCase())
      if (info.format.sampleRate) parts.push(`${(info.format.sampleRate / 1000).toFixed(1)}kHz`)
      if (info.format.bitrate && !info.format.lossless) parts.push(`${Math.round(info.format.bitrate / 1000)}kbps`)
      if (parts.length) qualityText = parts.join(' · ')
    }

    const largeImageKey = (info.isYouTube && info.cover?.startsWith('http')) ? info.cover : 'logo'
    const largeImageText = info.album || (info.isYouTube ? 'YouTube' : '산성뮤직')
    
    const stateBase = info.isYouTube 
      ? info.artist 
      : (qualityText !== '로컬 파일' ? `${info.artist} · ${qualityText}` : info.artist)

    const activity: any = {
      type: 2,
      details: info.title,
      state: info.isPlaying ? stateBase : `⏸ ${stateBase}`,
      largeImageKey,
      largeImageText,
      instance: false
    }

    if (info.isPlaying) {
      const elapsed = (info.currentTime || 0) * 1000
      activity.startTimestamp = Date.now() - elapsed
      if (info.duration) activity.endTimestamp = activity.startTimestamp + info.duration * 1000
      if (info.isYouTube) {
        activity.smallImageKey = 'youtube'
        activity.smallImageText = 'YouTube 스트리밍'
      }
    }

    rpc.user.setActivity(activity)
  } catch (err) {
    console.warn('[Discord RPC] failed:', err)
  }
})

ipcMain.on('discord-clear-presence', () => {
  if (!rpcReady || !rpc.user) return
  rpc.user.clearActivity().catch(() => { })
})

ipcMain.handle('youtube-search', async (_, query: string) => {
  try {
    const results: any = await youtubeDl(`ytsearch10:${query}`, { dumpSingleJson: true, noWarnings: true, flatPlaylist: true })
    return (results.entries || []).map(entry => ({
      id: entry.id,
      title: entry.title,
      artist: entry.uploader || 'YouTube',
      url: `https://www.youtube.com/watch?v=${entry.id}`,
      cover: entry.thumbnails?.[0]?.url || '',
      duration: entry.duration,
      isYouTube: true
    }))
  } catch {
    return []
  }
})

ipcMain.handle('youtube-get-stream', async (_, videoId: string) => {
  try {
    const info: any = await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, { dumpSingleJson: true, noWarnings: true, format: 'bestaudio/best' })
    return info.url
  } catch {
    return null
  }
})

ipcMain.handle('youtube-get-playlist', async (_, url: string) => {
  try {
    const results: any = await youtubeDl(url, { dumpSingleJson: true, noWarnings: true, flatPlaylist: true, yesPlaylist: true })
    return (results.entries || []).map(entry => ({
      id: entry.id,
      title: entry.title || 'Unknown',
      artist: entry.uploader || entry.channel || 'YouTube',
      url: `https://www.youtube.com/watch?v=${entry.id}`,
      cover: entry.thumbnails?.slice(-1)[0]?.url || entry.thumbnail || '',
      duration: entry.duration,
      isYouTube: true
    }))
  } catch {
    return []
  }
})

ipcMain.handle('youtube-get-subtitles', async (_, videoId: string) => {
  try {
    const info: any = await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, { dumpSingleJson: true, noWarnings: true })
    const formats = info.subtitles?.['ko'] || info.automatic_captions?.['ko'] || info.subtitles?.['en'] || info.automatic_captions?.['en']
    if (!formats?.length) return null
    
    const vttEntry = formats.find(f => f.ext === 'vtt') || formats[0]
    if (!vttEntry?.url) return null
    
    const resp = await fetch(vttEntry.url)
    return resp.ok ? await resp.text() : null
  } catch {
    return null
  }
})
