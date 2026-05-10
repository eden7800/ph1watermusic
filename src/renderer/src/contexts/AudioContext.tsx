import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react'
import { Howl } from 'howler'

export interface Track {
  id: string
  title: string
  artist: string
  album?: string
  url: string
  cover?: string
  addedAt?: number
  format: {
    container?: string
    codec?: string
    bitrate?: number
    sampleRate?: number
    lossless?: boolean
  }
  isYouTube?: boolean
  videoId?: string
  playCount?: number
}

interface AudioContextType {
  currentTrack: Track | null
  queue: Track[]
  currentIndex: number
  isPlaying: boolean
  repeatMode: 'off' | 'all' | 'one'
  isShuffle: boolean
  play: (track: Track) => void
  playQueue: (tracks: Track[], startIndex?: number) => void
  addTracksToQueue: (tracks: Track[]) => void
  playNext: () => void
  playPrev: () => void
  pause: () => void
  resume: () => void
  seek: (pos: number) => void
  toggleRepeatMode: () => void
  toggleShuffle: () => void
  duration: number
  currentTime: number
  volume: number
  setVolume: (v: number) => void
  mostPlayed: Track[]
  tracksAddedIn2026: Track[]
  selectAndWatchFolder: () => Promise<void>
  watchedFolder: string | null
  youtubeQueue: Track[]
  setYoutubeQueue: React.Dispatch<React.SetStateAction<Track[]>>
  removeTrack: (trackId: string, e?: React.MouseEvent) => void
  clearQueue: () => void
}

const AudioContext = createContext<AudioContextType | null>(null)

const STORAGE_KEY = 'sanseong-music-state'
const STATS_KEY = 'sanseong-music-stats'

export const AudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [queue, setQueue] = useState<Track[]>([])
  const [youtubeQueue, setYoutubeQueue] = useState<Track[]>([])
  const [originalQueue, setOriginalQueue] = useState<Track[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const currentTrack = currentIndex >= 0 ? queue[currentIndex] : null
  const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>('off')
  const [isShuffle, setIsShuffle] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [watchedFolder, setWatchedFolder] = useState<string | null>(null)
  const [playCounts, setPlayCounts] = useState<Record<string, number>>({})

  const [howl, setHowl] = useState<Howl | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.5)

  const queueRef = useRef(queue)
  const currentIndexRef = useRef(currentIndex)
  const repeatModeRef = useRef(repeatMode)
  const isLoadingRef = useRef(false)
  const howlRef = useRef<Howl | null>(null)
  const loadingTrackIdRef = useRef<string | null>(null)
  
  useEffect(() => { queueRef.current = queue }, [queue])
  useEffect(() => { currentIndexRef.current = currentIndex }, [currentIndex])
  useEffect(() => { repeatModeRef.current = repeatMode }, [repeatMode])

  useEffect(() => {
    const init = async () => {
      const savedState = localStorage.getItem(STORAGE_KEY)
      const savedStats = localStorage.getItem(STATS_KEY)
      
      if (savedStats) {
        try { setPlayCounts(JSON.parse(savedStats)) } catch {}
      }

      if (savedState) {
        try {
          const state = JSON.parse(savedState)
          const paths = (state.queuePaths || []).filter((p: string) => !p.startsWith('http'))
          const ytTracks = state.youtubeQueue || []
          
          let restoredQueue: Track[] = []
          if (paths.length > 0) {
            restoredQueue = await (window as any).api.getTracksByPaths(paths)
          }
          
          const fullQueue = [...restoredQueue, ...ytTracks]
          setQueue(fullQueue)
          setYoutubeQueue(ytTracks)
          setOriginalQueue(fullQueue)

          const targetIdx = state.currentIndex ?? -1
          if (targetIdx >= 0 && targetIdx < fullQueue.length) {
            setCurrentIndex(targetIdx)
            _prepareHowl(fullQueue[targetIdx], false)
          }

          if (state.volume !== undefined) setVolume(state.volume)
          if (state.repeatMode) setRepeatMode(state.repeatMode)
          if (state.isShuffle !== undefined) setIsShuffle(state.isShuffle)
          if (state.watchedFolder) {
            setWatchedFolder(state.watchedFolder)
            ;(window as any).api.watchFolder(state.watchedFolder)
          }
        } catch (e) {
          console.error('[AudioProvider] Init Error:', e)
        }
      }
      setIsLoaded(true)
    }
    init()
  }, [])

  useEffect(() => {
    const cleanup = (window as any).api.onFolderUpdated((newTracks: Track[]) => {
      setQueue(prev => [...newTracks, ...prev.filter(t => t.isYouTube)])
      setOriginalQueue(prev => [...newTracks, ...prev.filter(t => t.isYouTube)])
    })
    return cleanup
  }, [])

  useEffect(() => {
    if (!isLoaded) return
    const state = {
      queuePaths: queue.filter(t => !t.isYouTube).map(t => t.id),
      youtubeQueue: queue.filter(t => t.isYouTube),
      currentIndex,
      volume,
      repeatMode,
      isShuffle,
      watchedFolder
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    localStorage.setItem(STATS_KEY, JSON.stringify(playCounts))
  }, [queue, currentIndex, volume, repeatMode, isShuffle, isLoaded, watchedFolder, playCounts])
  const mostPlayed = useMemo(() => {
    return [...queue]
      .sort((a, b) => (playCounts[b.id] || 0) - (playCounts[a.id] || 0))
      .filter(t => (playCounts[t.id] || 0) > 0)
      .slice(0, 20)
      .map(t => ({ ...t, playCount: playCounts[t.id] }))
  }, [queue, playCounts])

  const tracksAddedIn2026 = useMemo(() => {
    const start2026 = new Date('2026-01-01').getTime()
    const end2026 = new Date('2027-01-01').getTime()
    return queue.filter(t => t.addedAt && t.addedAt >= start2026 && t.addedAt < end2026)
  }, [queue])

  const selectAndWatchFolder = async () => {
    const folder = await (window as any).api.selectFolder()
    if (folder) {
      setWatchedFolder(folder)
      ;(window as any).api.watchFolder(folder)
    }
  }

  const incrementPlayCount = (trackId: string) => {
    setPlayCounts(prev => ({
      ...prev,
      [trackId]: (prev[trackId] || 0) + 1
    }))
  }

  const _prepareHowl = async (track: Track, autoPlay: boolean = false) => {
    if (track.isYouTube && isLoadingRef.current && loadingTrackIdRef.current === track.id) return

    if (howlRef.current) {
      howlRef.current.off()
      howlRef.current.stop()
      howlRef.current.unload()
      howlRef.current = null
    }
    setHowl(null)

    if (track.isYouTube) {
      isLoadingRef.current = true
      loadingTrackIdRef.current = track.id
    }

    let finalUrl = track.url
    if (track.isYouTube) {
      const streamUrl = await (window as any).api.youtubeGetStream(track.id)
      isLoadingRef.current = false
      loadingTrackIdRef.current = null

      if (streamUrl) finalUrl = streamUrl
      else return
    }

    if (howlRef.current !== null) return

    const newHowl = new Howl({
      src: [finalUrl],
      html5: true,
      preload: true,
      format: track.isYouTube ? ['webm', 'm4a', 'mp3'] : ['flac', 'mp3', 'wav', 'm4a', 'alac'],
      volume,
      onplay: () => {
        setIsPlaying(true)
        setDuration(newHowl.duration())
      },
      onload: () => setDuration(newHowl.duration()),
      onpause: () => setIsPlaying(false),
      onstop: () => setIsPlaying(false),
      onend: () => handleTrackEnd()
    })
    
    howlRef.current = newHowl
    setHowl(newHowl)
    if (autoPlay) newHowl.play()

    if (!track.isYouTube && !track.cover) {
      ;(window as any).api.getCover(track.id).then((cover: string | null) => {
        if (cover) setQueue(prev => prev.map(t => t.id === track.id ? { ...t, cover } : t))
      })
    }
  }


  const handleTrackEnd = () => {
    setIsPlaying(false)
    setCurrentTime(0)
    if (currentIndexRef.current >= 0) incrementPlayCount(queueRef.current[currentIndexRef.current].id)

    if (repeatModeRef.current === 'one') {
      _prepareHowl(queueRef.current[currentIndexRef.current], true)
    } else {
      const nextIdx = currentIndexRef.current + 1
      if (nextIdx < queueRef.current.length) {
        setCurrentIndex(nextIdx)
        _prepareHowl(queueRef.current[nextIdx], true)
      } else if (repeatModeRef.current === 'all' && queueRef.current.length > 0) {
        setCurrentIndex(0)
        _prepareHowl(queueRef.current[0], true)
      }
    }
  }

  useEffect(() => {
    if (!howl) return
    const interval = setInterval(() => {
      if (isPlaying) setCurrentTime(howl.seek() as number)
    }, 100)
    return () => clearInterval(interval)
  }, [howl, isPlaying])

  const playQueue = (tracks: Track[], startIndex: number = 0) => {
    if (!tracks.length) return
    setQueue(tracks)
    if (!isShuffle) setOriginalQueue([...tracks])
    setCurrentIndex(startIndex)
    _prepareHowl(tracks[startIndex], true)
  }

  const addTracksToQueue = (newTracks: Track[]) => {
    if (!newTracks.length) return

    const currentTrackId = currentIndex >= 0 ? queueRef.current[currentIndex]?.id : null
    const deduped = newTracks.filter(t => !queueRef.current.find(p => p.id === t.id))
    if (!deduped.length) return

    const localTracks = queueRef.current.filter(t => !t.isYouTube)
    const ytTracks = queueRef.current.filter(t => t.isYouTube)
    const updated = [...localTracks, ...deduped, ...ytTracks]

    setQueue(updated)
    setOriginalQueue(updated)

    if (currentTrackId) {
      const newIdx = updated.findIndex(t => t.id === currentTrackId)
      if (newIdx !== -1) setCurrentIndex(newIdx)
    } else if (currentIndex === -1 && deduped.length) {
      setCurrentIndex(0)
      _prepareHowl(deduped[0], true)
    }
  }

  const play = (track: Track) => {
    const existingIdx = queue.findIndex(t => t.id === track.id)
    if (existingIdx !== -1) {
      setCurrentIndex(existingIdx)
      _prepareHowl(queue[existingIdx], true)
    } else {
      setQueue([track, ...queue])
      setOriginalQueue([track, ...originalQueue])
      setCurrentIndex(0)
      _prepareHowl(track, true)
    }
  }

  const playNext = () => {
    let nextIdx = currentIndex + 1
    if (nextIdx >= queue.length) {
      if (repeatMode === 'all') nextIdx = 0
      else return
    }
    setCurrentIndex(nextIdx)
    _prepareHowl(queue[nextIdx], true)
  }

  const playPrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
      _prepareHowl(queue[currentIndex - 1], true)
    } else {
      if (howlRef.current) seek(0)
      else if (currentTrack) _prepareHowl(currentTrack, true)
    }
  }

  const toggleRepeatMode = () => setRepeatMode(p => (p === 'off' ? 'all' : p === 'all' ? 'one' : 'off'))
  
  const toggleShuffle = () => {
    if (!isShuffle) {
      const current = currentTrack
      const shuffled = [...queue.filter(t => t.id !== current?.id)].sort(() => Math.random() - 0.5)
      setQueue(current ? [current, ...shuffled] : shuffled)
      setCurrentIndex(0)
      setIsShuffle(true)
    } else {
      const originalIdx = originalQueue.findIndex(t => t.id === currentTrack?.id)
      setQueue([...originalQueue])
      setCurrentIndex(originalIdx !== -1 ? originalIdx : 0)
      setIsShuffle(false)
    }
  }
  const removeTrack = (trackId: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation()
      e.preventDefault()
    }
    const targetIdx = queue.findIndex(t => t.id === trackId)
    if (targetIdx === -1) return

    const isCurrentTrack = targetIdx === currentIndex

    const newQueue = queue.filter(t => t.id !== trackId)
    const newOriginalQueue = originalQueue.filter(t => t.id !== trackId)
    
    setQueue(newQueue)
    setOriginalQueue(newOriginalQueue)
    setYoutubeQueue(prev => prev.filter(t => t.id !== trackId))

    if (isCurrentTrack) {
      if (newQueue.length === 0) {
        if (howlRef.current) {
          howlRef.current.off()
          howlRef.current.stop()
          howlRef.current.unload()
          howlRef.current = null
          setHowl(null)
        }
        setIsPlaying(false)
        setCurrentIndex(-1)
      } else {
        const nextIdx = targetIdx >= newQueue.length ? 0 : targetIdx
        setCurrentIndex(nextIdx)
        _prepareHowl(newQueue[nextIdx], true)
      }
    } else if (targetIdx < currentIndex) {
      setCurrentIndex(prev => prev - 1)
    }
  }

  const pause = () => { setIsPlaying(false); howlRef.current?.pause() }
  const resume = () => {
    if (!howlRef.current && currentTrack) _prepareHowl(currentTrack, true)
    else { setIsPlaying(true); howlRef.current?.play() }
  }
  const seek = (pos: number) => { setCurrentTime(pos); howlRef.current?.seek(pos) }

  const clearQueue = () => {
    if (howlRef.current) {
      howlRef.current.off()
      howlRef.current.stop()
      howlRef.current.unload()
      howlRef.current = null
    }
    setHowl(null)
    setQueue([])
    setOriginalQueue([])
    setYoutubeQueue([])
    setCurrentIndex(-1)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
  }

  useEffect(() => { if (howlRef.current) howlRef.current.volume(volume) }, [volume])

  useEffect(() => {
    const api = (window as any).api
    if (!currentTrack) {
      api?.discordClearPresence?.()
      return
    }
    api?.discordUpdatePresence?.({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album,
      cover: currentTrack.cover,
      isPlaying,
      isYouTube: currentTrack.isYouTube,
      currentTime,
      duration,
      format: currentTrack.format
    })
  }, [currentTrack?.id, isPlaying, duration])

  return (
    <AudioContext.Provider value={{
      currentTrack,
      queue,
      currentIndex,
      isPlaying,
      repeatMode,
      isShuffle,
      play,
      playQueue,
      addTracksToQueue,
      playNext,
      playPrev,
      pause,
      resume,
      seek,
      toggleRepeatMode,
      toggleShuffle,
      duration,
      currentTime,
      volume,
      setVolume,
      mostPlayed,
      tracksAddedIn2026,
      selectAndWatchFolder,
      watchedFolder,
      youtubeQueue,
      setYoutubeQueue,
      removeTrack,
      clearQueue
    }}>
      {children}
    </AudioContext.Provider>
  )
}

export const useAudio = () => {
  const context = useContext(AudioContext)
  if (!context) throw new Error('useAudio must be used within an AudioProvider')
  return context
}
