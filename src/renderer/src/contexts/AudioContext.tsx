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
  const isLoadingRef = useRef(false) // YouTube 스트림 로딩 중 중복 요청 차단용
  const howlRef = useRef<Howl | null>(null)     // 항상 최신 Howl 인스턴스 참조
  const loadingTrackIdRef = useRef<string | null>(null) // 현재 로딩 중인 트랙 ID
  
  useEffect(() => { queueRef.current = queue }, [queue])
  useEffect(() => { currentIndexRef.current = currentIndex }, [currentIndex])
  useEffect(() => { repeatModeRef.current = repeatMode }, [repeatMode])

  // Load state and stats
  useEffect(() => {
    const init = async () => {
      const savedState = localStorage.getItem(STORAGE_KEY)
      const savedStats = localStorage.getItem(STATS_KEY)
      
      if (savedStats) {
        try { setPlayCounts(JSON.parse(savedStats)) } catch(e) {}
      }

      if (savedState) {
        try {
          const state = JSON.parse(savedState)
          const paths = (state.queuePaths || []).filter(p => !p.startsWith('http'))
          const ytTracks = state.youtubeQueue || []
          
          let restoredQueue: Track[] = []
          if (paths.length > 0) {
            restoredQueue = await window.api.getTracksByPaths(paths)
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
            window.api.watchFolder(state.watchedFolder)
          }
        } catch (e) {
          console.error('[AudioProvider] Init Error:', e)
        }
      }
      setIsLoaded(true)
    }
    init()
  }, [])

  // Folder Watching Listener
  useEffect(() => {
    const cleanup = window.api.onFolderUpdated((newTracks) => {
      // Keep YouTube tracks, update local tracks
      setQueue(prev => [...newTracks, ...prev.filter(t => t.isYouTube)])
      setOriginalQueue(prev => [...newTracks, ...prev.filter(t => t.isYouTube)])
    })
    return cleanup
  }, [])

  // Save state
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

  // Smart Playlists
  const mostPlayed = useMemo(() => {
    return [...queue]
      .sort((a, b) => (playCounts[b.id] || 0) - (playCounts[a.id] || 0))
      .filter(t => (playCounts[t.id] || 0) > 0)
      .slice(0, 20)
      .map(t => ({ ...t, playCount: playCounts[t.id] }))
  }, [queue, playCounts])

  const tracksAddedIn2026 = useMemo(() => {
    const start2026 = new Date('2026-01-01').getTime()
    const end2026 = new Date('2027-01-01').getTime() // 2026년 12월 31일 전체 포함
    return queue.filter(t => t.addedAt && t.addedAt >= start2026 && t.addedAt < end2026)
  }, [queue])

  const selectAndWatchFolder = async () => {
    const folder = await window.api.selectFolder()
    if (folder) {
      setWatchedFolder(folder)
      window.api.watchFolder(folder)
    }
  }

  const incrementPlayCount = (trackId: string) => {
    setPlayCounts(prev => ({
      ...prev,
      [trackId]: (prev[trackId] || 0) + 1
    }))
  }

  const _prepareHowl = async (track: Track, autoPlay: boolean = false) => {
    // 같은 트랙을 이미 로딩 중이면 중복 차단 (다른 트랙 요청은 통과)
    if (track.isYouTube && isLoadingRef.current && loadingTrackIdRef.current === track.id) return

    // 이전 Howl 즉시 정지 (ref 사용으로 항상 최신 인스턴스 접근)
    if (howlRef.current) {
      howlRef.current.off() // 이벤트 핸들러 제거 (onend 재발화 방지)
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
      const streamUrl = await window.api.youtubeGetStream(track.id)
      isLoadingRef.current = false
      loadingTrackIdRef.current = null

      // 로딩 완료 전에 다른 트랙으로 이미 변경됐으면 무시
      if (streamUrl) finalUrl = streamUrl
      else {
        console.error('Failed to get YouTube stream')
        return
      }
    }

    // 로딩 완료 시점에 다른 track이 이미 ref에 있으면 중단
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

    // 로컬 트랙 커버아트 지연 로딩 (재생 시작 후 백그라운드에서)
    if (!track.isYouTube && !track.cover) {
      // @ts-ignore
      window.api.getCover(track.id).then((cover: string | null) => {
        if (!cover) return
        setQueue(prev => prev.map(t => t.id === track.id ? { ...t, cover } : t))
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

  // Audio Sync Effect
  useEffect(() => {
    if (howl) {
      const interval = setInterval(() => {
        if (isPlaying) setCurrentTime(howl.seek() as number)
      }, 100)
      return () => clearInterval(interval)
    }
  }, [howl, isPlaying])

  const playQueue = (tracks: Track[], startIndex: number = 0) => {
    if (tracks.length === 0) return
    setQueue(tracks)
    if (!isShuffle) setOriginalQueue([...tracks])
    setCurrentIndex(startIndex)
    _prepareHowl(tracks[startIndex], true)
  }

  // 기존 큐에 새 로컬 트랙 추가 (중복 제거, 현재 재생 곡 유지)
  const addTracksToQueue = (newTracks: Track[]) => {
    if (newTracks.length === 0) return

    // 현재 재생 중인 트랙 ID 기억 (큐 재정렬 후 인덱스 복원용)
    const currentTrackId = currentIndex >= 0 ? queueRef.current[currentIndex]?.id : null

    const deduped = newTracks.filter(t => !queueRef.current.find(p => p.id === t.id))
    if (deduped.length === 0) return

    const localTracks = queueRef.current.filter(t => !t.isYouTube)
    const ytTracks = queueRef.current.filter(t => t.isYouTube)
    const updated = [...localTracks, ...deduped, ...ytTracks]

    setQueue(updated)
    setOriginalQueue(updated)

    if (currentTrackId) {
      // 현재 재생 곡의 새 인덱스로 업데이트 (재생 중인 곡 변경 없음)
      const newIdx = updated.findIndex(t => t.id === currentTrackId)
      if (newIdx !== -1) setCurrentIndex(newIdx)
    } else if (currentIndex === -1 && deduped.length > 0) {
      // 아무것도 재생 안 하고 있으면 첫 번째 새 트랙 재생
      setCurrentIndex(0)
      _prepareHowl(deduped[0], true)
    }
  }

  const play = (track: Track) => {
    // If track is not in current queue, prepend it
    const existingIdx = queue.findIndex(t => t.id === track.id)
    if (existingIdx !== -1) {
      setCurrentIndex(existingIdx)
      _prepareHowl(queue[existingIdx], true)
    } else {
      const newQueue = [track, ...queue]
      setQueue(newQueue)
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
      // 첫 번째 곡이거나 재생 중이면 처음부터 다시
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

  // 재생목록 전체 삭제
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

  // Discord RPC 자동 업데이트
  useEffect(() => {
    if (!currentTrack) {
      // @ts-ignore
      window.api?.discordClearPresence?.()
      return
    }
    // @ts-ignore
    window.api?.discordUpdatePresence?.({
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
