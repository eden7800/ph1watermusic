import { contextBridge, ipcRenderer } from 'electron'
import { exposeElectronAPI } from '@electron-toolkit/preload'

const api = {
  selectFiles: () => ipcRenderer.invoke('select-files'),
  getTracksByPaths: (paths: string[]) => ipcRenderer.invoke('get-tracks-by-paths', paths),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  watchFolder: (path: string) => ipcRenderer.send('watch-folder', path),
  onFolderUpdated: (callback: (tracks: any[]) => void) => {
    const listener = (_event: any, tracks: any[]) => callback(tracks)
    ipcRenderer.on('folder-updated', listener)
    return () => ipcRenderer.removeListener('folder-updated', listener)
  },
  // YouTube API
  youtubeSearch: (query: string) => ipcRenderer.invoke('youtube-search', query),
  youtubeGetStream: (videoId: string) => ipcRenderer.invoke('youtube-get-stream', videoId),
  youtubeGetPlaylist: (url: string) => ipcRenderer.invoke('youtube-get-playlist', url),
  youtubeGetSubtitles: (videoId: string) => ipcRenderer.invoke('youtube-get-subtitles', videoId),
  // Discord RPC
  discordUpdatePresence: (info: { title: string; artist: string; isPlaying: boolean; isYouTube?: boolean }) => 
    ipcRenderer.send('discord-update-presence', info),
  discordClearPresence: () => ipcRenderer.send('discord-clear-presence'),
  // 커버아트 지연 로딩
  getCover: (filePath: string) => ipcRenderer.invoke('get-cover', filePath)
}

if (process.contextIsolated) {
  try {
    exposeElectronAPI()
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
