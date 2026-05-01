import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { statSync, readdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import chokidar from 'chokidar'
import { create } from 'youtube-dl-exec'
import { Client } from '@xhayper/discord-rpc'
import { parseFile as parseAudioFile } from 'music-metadata'

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

// 동시 실행 수를 제한하는 배치 실행 함수 (I/O 부하 방지)
async function batchPromises<T>(items: string[], fn: (item: string) => Promise<T>, concurrency = 4): Promise<T[]> {
  const results: T[] = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.all(batch.map(fn))
    results.push(...batchResults)
  }
  return results
}

async function parseTrack(filePath: string) {
  try {
    const stats = statSync(filePath)
    // skipCovers: true → 커버아트 제외하고 메타데이터만 빠르게 읽음
    const metadata = await parseAudioFile(filePath, { skipCovers: true })
    const url = pathToFileURL(filePath).href

    return {
      id: filePath,
      title: metadata.common.title || 'Unknown Title',
      artist: metadata.common.artist || 'Unknown Artist',
      album: metadata.common.album,
      url: url,
      cover: undefined, // 커버아트는 필요 시 별도 요청으로 로드
      addedAt: stats.birthtimeMs,
      format: {
        container: metadata.format.container,
        codec: metadata.format.codec,
        bitrate: metadata.format.bitrate,
        sampleRate: metadata.format.sampleRate,
        lossless: metadata.format.lossless
      }
    }
  } catch (e) {
    const url = pathToFileURL(filePath).href
    return { id: filePath, title: 'Error loading', artist: '', url: url, format: {} }
  }
}

// 커버아트만 별도로 로드하는 함수 (클릭한 트랙에만 필요)
async function parseCover(filePath: string): Promise<string | null> {
  try {
    const metadata = await parseAudioFile(filePath, { skipCovers: false })
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const pic = metadata.common.picture[0]
      return `data:${pic.format};base64,${Buffer.from(pic.data).toString('base64')}`
    }
    return null
  } catch {
    return null
  }
}

// IPC Handlers
ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'flac', 'm4a', 'alac', 'wav'] }
    ]
  })
  if (result.canceled) return []
  // 동시 4개씩 배치 처리
  const tracks = await batchPromises(result.filePaths, parseTrack, 4)
  return tracks
})

ipcMain.handle('get-tracks-by-paths', async (_, filePaths: string[]) => {
  if (!filePaths || !Array.isArray(filePaths)) return []
  // 동시 4개씩 배치 처리
  const tracks = await batchPromises(filePaths, parseTrack, 4)
  return tracks
})

// 커버아트 개별 로드 (재생 시작 시 호출)
ipcMain.handle('get-cover', async (_, filePath: string) => {
  return await parseCover(filePath)
})

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

// Discord RPC Handler
ipcMain.on('discord-update-presence', (_, info: {
  title: string
  artist: string
  album?: string
  cover?: string        // 공개 HTTPS URL인 경우에만 (YouTube 썸네일)
  isPlaying: boolean
  isYouTube?: boolean
  currentTime?: number
  duration?: number
  format?: { container?: string; lossless?: boolean; sampleRate?: number; bitrate?: number }
}) => {
  if (!rpcReady || !rpc.user) return
  try {
    // 음질 정보 문자열 구성
    let qualityText = '로컬 파일'
    if (info.format) {
      const parts: string[] = []
      if (info.format.container) parts.push(info.format.container.toUpperCase())
      if (info.format.sampleRate) parts.push(`${(info.format.sampleRate / 1000).toFixed(1)}kHz`)
      if (info.format.bitrate && !info.format.lossless) parts.push(`${Math.round(info.format.bitrate / 1000)}kbps`)
      if (parts.length > 0) qualityText = parts.join(' · ')
    }

    // 앨범아트: YouTube 썸네일(공개 URL) 직접 사용, 로컬은 Developer Portal에 등록된 'logo' 에셋 사용
    const largeImageKey = (info.isYouTube && info.cover?.startsWith('https://')) ? info.cover : 'logo'
    const largeImageText = info.album || (info.isYouTube ? 'YouTube' : '산성뮤직')

    // 재생 state 줄: "아티스트 · FLAC · 96.0kHz" 형태로 항상 표시
    const stateBase = info.isYouTube
      ? info.artist
      : qualityText !== '로컬 파일'
        ? `${info.artist} · ${qualityText}`
        : info.artist

    if (info.isPlaying) {
      const now = Date.now()
      const elapsed = (info.currentTime || 0) * 1000
      const startTimestamp = now - elapsed
      const endTimestamp = info.duration ? startTimestamp + info.duration * 1000 : undefined

      rpc.user.setActivity({
        type: 2, // Listening
        details: info.title,
        state: stateBase,
        largeImageKey,
        largeImageText,
        smallImageKey: info.isYouTube ? 'youtube' : undefined,
        smallImageText: info.isYouTube ? 'YouTube 스트리밍' : undefined,
        startTimestamp,
        endTimestamp,
        instance: false
      })
    } else {
      // 일시정지: 타이머 없이 깔끔하게
      rpc.user.setActivity({
        type: 2, // Listening
        details: info.title,
        state: `⏸ ${stateBase}`,
        largeImageKey,
        largeImageText,
        instance: false
      })
    }
  } catch (err) {
    console.warn('[Discord RPC] setActivity failed:', err)
  }
})

ipcMain.on('discord-clear-presence', () => {
  if (!rpcReady || !rpc.user) return
  rpc.user.clearActivity().catch(() => { })
})

// YouTube Handlers
ipcMain.handle('youtube-search', async (_, query: string) => {
  try {
    const results = await youtubeDl(`ytsearch10:${query}`, {
      dumpSingleJson: true,
      noWarnings: true,
      flatPlaylist: true
    }) as any

    return (results.entries || []).map(entry => ({
      id: entry.id,
      title: entry.title,
      artist: entry.uploader || 'YouTube',
      url: `https://www.youtube.com/watch?v=${entry.id}`,
      cover: entry.thumbnails?.[0]?.url || '',
      duration: entry.duration,
      isYouTube: true
    }))
  } catch (error) {
    console.error('YouTube Search Error:', error)
    return []
  }
})

ipcMain.handle('youtube-get-stream', async (_, videoId: string) => {
  try {
    const info = await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, {
      dumpSingleJson: true,
      noWarnings: true,
      format: 'bestaudio/best'
    }) as any
    return info.url // Direct stream URL
  } catch (error) {
    console.error('YouTube Stream Error:', error)
    return null
  }
})

// YouTube 플레이리스트 전체 가져오기
ipcMain.handle('youtube-get-playlist', async (_, url: string) => {
  try {
    const results = await youtubeDl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      flatPlaylist: true,
      yesPlaylist: true
    }) as any

    const entries = results.entries || []
    return entries.map((entry: any) => ({
      id: entry.id,
      title: entry.title || '알 수 없는 곡',
      artist: entry.uploader || entry.channel || 'YouTube',
      url: `https://www.youtube.com/watch?v=${entry.id}`,
      cover: entry.thumbnails?.slice(-1)[0]?.url || entry.thumbnail || '',
      duration: entry.duration,
      isYouTube: true
    }))
  } catch (error) {
    console.error('YouTube Playlist Error:', error)
    return []
  }
})

// YouTube 자막 가져오기 (한국어 → 영어 순으로 시도)
ipcMain.handle('youtube-get-subtitles', async (_, videoId: string) => {
  try {
    const info = await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, {
      dumpSingleJson: true,
      noWarnings: true
    }) as any

    const subs: Record<string, any[]> = info.subtitles || {}
    const autoCaps: Record<string, any[]> = info.automatic_captions || {}

    for (const lang of ['ko', 'en']) {
      const formats = subs[lang] || autoCaps[lang]
      if (!formats || formats.length === 0) continue
      const vttEntry = formats.find((f: any) => f.ext === 'vtt') || formats[0]
      if (!vttEntry?.url) continue
      const resp = await fetch(vttEntry.url)
      if (!resp.ok) continue
      return await resp.text()
    }
    return null
  } catch (e) {
    console.error('Subtitle Error:', e)
    return null
  }
})
