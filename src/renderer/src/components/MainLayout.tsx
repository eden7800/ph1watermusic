import React, { useState, useEffect, useRef } from 'react'
import { FastAverageColor } from 'fast-average-color'
import { Home, Play, Pause, SkipBack, SkipForward, Volume2, Plus, Search, ThumbsUp, ThumbsDown, MoreVertical, Repeat, Shuffle, Repeat1, ChevronUp, ChevronDown, FileAudio, Menu, Heart, Calendar, FolderSearch, ListMusic, Youtube, Loader2, X, ListVideo, Trash2 } from 'lucide-react'
import { useAudio } from '../contexts/AudioContext'
import { useLyrics } from '../hooks/useLyrics'
import { motion, AnimatePresence } from 'framer-motion'

interface LrcLine {
  time: number;
  text: string;
}

interface VttLine {
  start: number;
  end: number;
  text: string;
}

const parseLRC = (lrcStr: string): LrcLine[] => {
  if (!lrcStr) return []
  const lines = lrcStr.split('\n')
  return lines.map(line => {
    const match = line.match(/^\[(\d{2}):(\d{2}\.\d{2})\](.*)/)
    if (match) {
      const mins = parseInt(match[1], 10)
      const secs = parseFloat(match[2])
      return { time: mins * 60 + secs, text: match[3].trim() }
    }
    return null
  }).filter(l => l !== null) as LrcLine[]
}

const parseVTT = (vtt: string): VttLine[] => {
  const lines = vtt.split('\n')
  const result: VttLine[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    // HH:MM:SS.mmm --> HH:MM:SS.mmm 또는 MM:SS.mmm --> MM:SS.mmm
    const t = line.match(/(?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3}) --> (?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3})/)
    if (t) {
      const toSec = (h: string|undefined, m: string, s: string, ms: string) =>
        (parseInt(h||'0')) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000
      const start = toSec(t[1], t[2], t[3], t[4])
      const end = toSec(t[5], t[6], t[7], t[8])
      i++
      const textLines: string[] = []
      while (i < lines.length && lines[i].trim() !== '') {
        const cleaned = lines[i].replace(/<[^>]+>/g, '').trim()
        if (cleaned) textLines.push(cleaned)
        i++
      }
      if (textLines.length > 0) {
        const text = [...new Set(textLines)].join(' ') // 중복 제거
        if (result.length === 0 || result[result.length - 1].text !== text) {
          result.push({ start, end, text })
        }
      }
    }
    i++
  }
  return result
}

const formatDuration = (secs: number): string => {
  if (!secs || isNaN(secs)) return ''
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const MainLayout: React.FC = () => {
  const { 
    currentTrack, queue, currentIndex, isPlaying, playQueue, addTracksToQueue, playNext, playPrev, 
    pause, resume, seek, currentTime, duration, volume, setVolume,
    repeatMode, isShuffle, toggleRepeatMode, toggleShuffle,
    mostPlayed, tracksAddedIn2026, selectAndWatchFolder, watchedFolder,
    youtubeQueue, setYoutubeQueue, play, removeTrack, clearQueue
  } = useAudio()
  
  const [dynamicBg, setDynamicBg] = useState('rgba(50, 50, 50, 0.4)')
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'lyrics'|'playlist'>('lyrics')
  const [currentView, setCurrentView] = useState<'home' | 'most-played' | 'added-2026' | 'youtube'>('home')

  // YouTube Search States
  const [ytSearchQuery, setYtSearchQuery] = useState('')
  const [ytSearchResults, setYtSearchResults] = useState<any[]>([])
  const [isYtSearching, setIsYtSearching] = useState(false)
  const [localSearchQuery, setLocalSearchQuery] = useState('')
  const [isPlaylistLoading, setIsPlaylistLoading] = useState(false)
  const [playlistPreview, setPlaylistPreview] = useState<{ title: string; count: number } | null>(null)

  const { lyrics, isLoading: lyricsLoading } = useLyrics(currentTrack?.artist || '', currentTrack?.title || '')
  
  const [parsedLrc, setParsedLrc] = useState<LrcLine[]>([])
  const lyricsContainerRef = useRef<HTMLDivElement>(null)
  const [ytSubtitles, setYtSubtitles] = useState<VttLine[]>([])
  const [isSubLoading, setIsSubLoading] = useState(false)

  // 가사 업데이트 (로컬 + YouTube 공통 — lrclib 결과 우선 적용)
  useEffect(() => {
    if (lyrics?.syncedLyrics) {
      setParsedLrc(parseLRC(lyrics.syncedLyrics))
    } else {
      setParsedLrc([])
    }
  }, [lyrics])

  // YouTube 자막: lrclib 없을 때만 YouTube 자막으로 폴백
  useEffect(() => {
    if (!currentTrack?.isYouTube) {
      setYtSubtitles([])
      return
    }
    // lrclib이 이미 로딩 중이면 잠깐 대기 후 체크
    let cancelled = false
    setYtSubtitles([])

    const tryFetchVtt = async () => {
      // lrclib 결과가 있으면 VTT 불필요
      if (lyrics?.syncedLyrics) return

      setIsSubLoading(true)
      // @ts-ignore
      const vtt = await window.api.youtubeGetSubtitles(currentTrack.id)
      if (cancelled) return
      setIsSubLoading(false)
      if (vtt) setYtSubtitles(parseVTT(vtt))
    }

    // lrclib 응답 대기 (최대 3초)
    const timer = setTimeout(tryFetchVtt, 1500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [currentTrack?.id, lyrics?.syncedLyrics])

  const activeLineIndex = parsedLrc.findIndex((line, i) => {
    const nextLine = parsedLrc[i + 1]
    if (!nextLine) return currentTime >= line.time
    return currentTime >= line.time && currentTime < nextLine.time
  })

  useEffect(() => {
    if (activeLineIndex >= 0 && lyricsContainerRef.current) {
      const innerContainer = lyricsContainerRef.current.children[0] as HTMLElement
      if (innerContainer && innerContainer.children[activeLineIndex]) {
        const activeEl = innerContainer.children[activeLineIndex] as HTMLElement
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [activeLineIndex])

  useEffect(() => {
    if (currentTrack?.cover) {
      const fac = new FastAverageColor();
      fac.getColorAsync(currentTrack.cover)
        .then(color => setDynamicBg(`rgba(${color.value[0]}, ${color.value[1]}, ${color.value[2]}, 0.8)`))
        .catch(() => setDynamicBg('rgba(20, 20, 20, 0.9)'))
    } else setDynamicBg('rgba(20, 20, 20, 0.9)')
  }, [currentTrack])

  const handleSelectFiles = async () => {
    // @ts-ignore
    const tracks = await window.api.selectFiles()
    if (tracks && tracks.length > 0) addTracksToQueue(tracks) // 기존 큐에 추가
  }

  const isPlaylistUrl = (url: string) =>
    /youtube\.com\/playlist\?/.test(url) || /youtu\.be\/playlist/.test(url)

  const handleYtSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!ytSearchQuery.trim()) return

    // 플레이리스트 URL이면 자동으로 임포트
    if (isPlaylistUrl(ytSearchQuery)) {
      handlePlaylistImport(ytSearchQuery)
      return
    }

    setIsYtSearching(true)
    setCurrentView('youtube') // 결과 보이도록 YouTube 탭으로 자동 전환
    // @ts-ignore
    const results = await window.api.youtubeSearch(ytSearchQuery)
    setYtSearchResults(results)
    setIsYtSearching(false)
  }

  const handlePlaylistImport = async (url?: string) => {
    const targetUrl = url || ytSearchQuery
    if (!targetUrl.trim()) return
    setIsPlaylistLoading(true)
    setPlaylistPreview(null)
    setCurrentView('youtube')
    // @ts-ignore
    const tracks = await window.api.youtubeGetPlaylist(targetUrl)
    if (tracks && tracks.length > 0) {
      // 중복 제거 후 큐에 추가
      const newTracks = tracks.filter((t: any) => !youtubeQueue.find((q: any) => q.id === t.id))
      setYoutubeQueue(prev => [...prev, ...newTracks])
      setPlaylistPreview({ title: `플레이리스트`, count: tracks.length })
      setYtSearchQuery('')
    }
    setIsPlaylistLoading(false)
  }

  const handlePlayYt = (track: any) => {
    play(track)
    // Add to youtubeQueue if not already there
    if (!youtubeQueue.find(t => t.id === track.id)) {
      setYoutubeQueue([track, ...youtubeQueue])
    }
  }

  const formatTime = (time: number) => {
    if (!time || isNaN(time)) return '0:00'
    const mins = Math.floor(time / 60)
    const secs = Math.floor(time % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const handlePlayToggle = () => {
    if (!currentTrack) return
    isPlaying ? pause() : resume()
  }

  // 로컬 트랙 필터링
  const getLocalTracks = () => {
    const base = currentView === 'most-played' ? mostPlayed :
                 currentView === 'added-2026' ? tracksAddedIn2026 : queue
    if (!localSearchQuery.trim()) return base
    const q = localSearchQuery.toLowerCase()
    return base.filter(t =>
      t.title?.toLowerCase().includes(q) ||
      t.artist?.toLowerCase().includes(q) ||
      t.album?.toLowerCase().includes(q)
    )
  }

  const displayedTracks = currentView === 'youtube' ? youtubeQueue : getLocalTracks()

  const viewTitle = currentView === 'most-played' ? '자주 듣는 곡' : 
                    currentView === 'added-2026' ? '2026년 추가된 곡' : 
                    currentView === 'youtube' ? 'YouTube 뮤직' :
                    '전체 곡'

  return (
    <div className="flex flex-col h-screen bg-[#030303] text-white overflow-hidden select-none" style={{ fontFamily: 'Paperlogy, sans-serif' }}>
      <header className="h-[80px] flex items-center px-6 justify-between border-b border-white/5 z-50 backdrop-blur-3xl bg-black/40 drag">
        <div className="flex items-center gap-4 w-1/4">
          <div className="flex items-center gap-2.5 text-[20px] font-black tracking-tighter">
            <div className="w-7 h-7 bg-[#fa243c] rounded-full flex items-center justify-center shadow-lg">
              <Play size={14} fill="white" className="ml-0.5" />
            </div>
            산성 Music
          </div>
        </div>
        
        <div className="flex-1 flex justify-center max-w-2xl px-4 no-drag">
          {currentView === 'youtube' ? (
            // YouTube 검색창 (검색어 or 플레이리스트 URL)
            <form onSubmit={handleYtSearch} className="w-full max-w-xl bg-white/10 rounded-lg flex items-center px-4 py-2 border border-white/5 focus-within:bg-white/20 transition-colors">
              {isPlaylistUrl(ytSearchQuery)
                ? <ListVideo size={18} className="text-[#fa243c] mr-3 shrink-0" />
                : <Youtube size={18} className="text-[#fa243c] mr-3 shrink-0" />
              }
              <input 
                type="text" 
                placeholder="검색어 또는 플레이리스트 URL 붙여넣기..."
                value={ytSearchQuery}
                onChange={(e) => setYtSearchQuery(e.target.value)}
                className="bg-transparent border-none outline-none text-sm w-full text-white placeholder-white/50"
              />
              {(isYtSearching || isPlaylistLoading)
                ? <Loader2 size={18} className="animate-spin text-[#fa243c] shrink-0" />
                : isPlaylistUrl(ytSearchQuery)
                  ? <button type="submit" className="text-xs bg-[#fa243c] text-white px-2 py-1 rounded-md font-bold shrink-0 hover:bg-[#ff2d4a] transition-colors">가져오기</button>
                  : null
              }
            </form>
          ) : (
            // 로컬 검색창
            <div className="w-full max-w-xl bg-white/10 rounded-lg flex items-center px-4 py-2 border border-white/5 focus-within:bg-white/20 transition-colors">
              <Search size={20} className="text-white/50 mr-3 shrink-0" />
              <input 
                type="text" 
                placeholder="노래, 앨범, 아티스트 검색..."
                value={localSearchQuery}
                onChange={(e) => setLocalSearchQuery(e.target.value)}
                className="bg-transparent border-none outline-none text-sm w-full text-white placeholder-white/50"
              />
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 w-1/4"></div>
      </header>

      <div className="flex flex-1 overflow-hidden z-10 relative">
        <aside className="w-[240px] flex flex-col shrink-0 px-3 py-4 overflow-y-auto bg-black/30 backdrop-blur-md border-r border-white/5">
          <nav className="space-y-1 mb-8">
            <button 
              onClick={() => setCurrentView('home')}
              className={`sidebar-link w-full ${currentView === 'home' ? 'sidebar-link-active' : ''}`}
            >
              <Home size={20} className="shrink-0" /> 홈
            </button>
            <button 
              onClick={() => setCurrentView('youtube')}
              className={`sidebar-link w-full ${currentView === 'youtube' ? 'sidebar-link-active' : ''}`}
            >
              <Youtube size={20} className="shrink-0" /> YouTube
            </button>
            <button 
              onClick={() => setCurrentView('most-played')}
              className={`sidebar-link w-full ${currentView === 'most-played' ? 'sidebar-link-active' : ''}`}
            >
              <Heart size={20} className="shrink-0" /> 자주 듣는 곡
            </button>
            <button 
              onClick={() => setCurrentView('added-2026')}
              className={`sidebar-link w-full ${currentView === 'added-2026' ? 'sidebar-link-active' : ''}`}
            >
              <Calendar size={20} className="shrink-0" /> 2026년 추가된 곡
            </button>
          </nav>

          <div className="mb-8">
            <h3 className="px-4 text-[11px] font-bold text-white/40 uppercase tracking-widest mb-3">라이브러리</h3>
            <button onClick={handleSelectFiles} className="sidebar-link w-full">
              <Plus size={20} className="shrink-0" /> 파일 추가
            </button>
            <button onClick={selectAndWatchFolder} className="sidebar-link w-full">
              <FolderSearch size={20} className="shrink-0" /> 폴더 감시 설정
            </button>
          </div>

          <div className="mt-auto border-t border-white/10 pt-4 px-4 pb-4">
             <div className="flex items-center gap-2 mb-2">
                <ListMusic size={16} className="text-[#fa243c]" />
                <h3 className="text-[13px] font-bold text-white/80">감시 중인 폴더</h3>
             </div>
             <p className="text-[11px] text-white/40 break-all leading-relaxed">
               {watchedFolder ? watchedFolder : '폴더를 선택해주세요.'}
             </p>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto px-10 pb-32 pt-8 relative custom-scrollbar">
          <div className="flex items-end justify-between mb-10">
            <div className="relative z-10">
              <p className="text-[14px] font-bold text-[#fa243c] mb-1 uppercase tracking-wider">
                {currentView === 'youtube' ? 'Infinite Discovery' : 'Smart Playlist'}
              </p>
              <h2 className="text-[40px] font-extrabold tracking-tighter leading-none">{viewTitle}</h2>
            </div>
            <div className="flex items-center gap-3 relative z-10">
              {displayedTracks.length > 0 && (currentView === 'home' || currentView === 'youtube') && (
                <button
                  onClick={() => {
                    if (currentView === 'youtube') {
                      setYoutubeQueue([])
                    } else {
                      clearQueue()
                    }
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-white/10 text-white/40 hover:text-white hover:border-red-500/50 hover:bg-red-500/10 transition-all text-sm font-bold active:scale-95"
                >
                  <Trash2 size={14} /> 전체 삭제
                </button>
              )}
              {currentView === 'home' && (
                <button onClick={handleSelectFiles} className="bg-[#fa243c] hover:bg-[#ff2d4a] text-white px-6 py-2.5 rounded-full font-bold text-sm shadow-lg shadow-[#fa243c]/20 transition-all active:scale-95 flex items-center gap-2">
                  <Plus size={18} /> 음악 추가
                </button>
              )}
            </div>
          </div>

          {/* 플레이리스트 로딩 중 배너 */}
          {currentView === 'youtube' && isPlaylistLoading && (
            <div className="mb-6 relative z-10 flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10">
              <Loader2 size={18} className="animate-spin text-[#fa243c] shrink-0" />
              <span className="text-sm text-white/70">플레이리스트 불러오는 중... 곡 수에 따라 시간이 걸릴 수 있습니다</span>
            </div>
          )}

          {/* 플레이리스트 완료 토스트 */}
          {currentView === 'youtube' && playlistPreview && !isPlaylistLoading && (
            <div className="mb-6 relative z-10 flex items-center justify-between px-4 py-3 rounded-xl bg-[#fa243c]/10 border border-[#fa243c]/20">
              <div className="flex items-center gap-3">
                <ListVideo size={18} className="text-[#fa243c] shrink-0" />
                <span className="text-sm text-white/80"><span className="font-bold text-white">{playlistPreview.count}곡</span>을 큐에 추가했습니다</span>
              </div>
              <button onClick={() => setPlaylistPreview(null)} className="text-white/40 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>
          )}

          {currentView === 'youtube' && ytSearchResults.length > 0 && (
             <div className="mb-12 relative z-10">
                <h3 className="text-[18px] font-black mb-6 text-white/60 flex items-center gap-2">
                   <Search size={20} className="text-[#fa243c]" /> 검색 결과
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   {ytSearchResults.map((track) => (
                     <div 
                       key={track.id} 
                       onClick={() => handlePlayYt(track)}
                       className="group flex items-center gap-4 p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-[#fa243c]/30 hover:bg-white/10 transition-all cursor-pointer"
                     >
                       <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0 shadow-lg relative">
                          <img src={track.cover} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Play size={24} fill="white" className="text-white" />
                          </div>
                       </div>
                       <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-[16px] truncate">{track.title}</h4>
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-[13px] text-white/40 truncate">{track.artist}</p>
                            {track.duration && <span className="text-[11px] text-white/25 shrink-0 tabular-nums">{formatDuration(track.duration)}</span>}
                          </div>
                       </div>
                     </div>
                   ))}
                </div>
             </div>
          )}

          <div className="grid grid-cols-1 gap-1 relative z-10">
            {displayedTracks.map((track, i) => (
              <div 
                key={track.id + i} 
                onClick={() => playQueue(displayedTracks, i)}
                className="group flex items-center gap-4 p-3 rounded-xl cursor-pointer hover:bg-white/5 transition-all border border-transparent hover:border-white/5"
              >
                <div className="w-14 h-14 bg-black/40 rounded-lg flex items-center justify-center shrink-0 overflow-hidden shadow-md relative group-hover:shadow-xl transition-all">
                  {track.cover ? <img src={track.cover} className="w-full h-full object-cover" /> : <FileAudio className="text-white/20" size={24} />}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Play size={20} fill="white" className="text-white" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-[17px] truncate text-white/90 group-hover:text-white">{track.title}</h4>
                    {track.isYouTube && <Youtube size={14} className="text-[#fa243c] shrink-0" />}
                  </div>
                  <p className="text-[14px] text-white/40 truncate mt-0.5 group-hover:text-white/60">{track.artist}</p>
                </div>
                <div className="flex items-center gap-6 text-white/30 px-4">
                  {track.playCount !== undefined && track.playCount > 0 && (
                    <span className="text-[13px] font-medium group-hover:text-white/60">{track.playCount}회 재생</span>
                  )}
                  {track.format?.lossless && (
                    <span className="px-2 py-0.5 bg-white/5 rounded text-[10px] font-bold text-white/40 border border-white/5">LOSSLESS</span>
                  )}
                  <button 
                    onClick={(e) => removeTrack(track.id, e)} 
                    className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-[#fa243c] p-2 -mr-2"
                    title="재생목록에서 제거"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>
            ))}
            {displayedTracks.length === 0 && (
               <div className="flex flex-col items-center justify-center py-40 text-white/10">
                  <Youtube size={80} strokeWidth={1} className="mb-6 opacity-20" />
                  <p className="text-xl font-black italic tracking-tighter">음악을 검색하거나 추가해보세요.</p>
               </div>
            )}
          </div>
        </main>

        <AnimatePresence>
          {isNowPlayingOpen && (
            <motion.div 
              initial={{ y: '100%', opacity: 0 }} 
              animate={{ y: 0, opacity: 1 }} 
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 200 }}
              className="absolute inset-0 z-[40] flex flex-col overflow-hidden"
            >
              <div className="absolute inset-0 backdrop-blur-[60px] bg-black/80 z-0"></div>
              
              <div 
                className="absolute inset-0 opacity-50 z-1" 
                style={{ background: `radial-gradient(circle at 30% 50%, ${dynamicBg}, transparent 70%)` }}
              ></div>

              <div className="flex-1 flex flex-col lg:flex-row p-8 lg:p-20 gap-8 lg:gap-16 items-center justify-center relative overflow-hidden z-10 max-w-[1400px] mx-auto w-full">
                 <button onClick={() => setIsNowPlayingOpen(false)} className="absolute top-8 right-8 p-3 hover:bg-white/10 rounded-full transition-all text-white/40 hover:text-white z-50"><ChevronDown size={32} /></button>

                 <div className="flex-1 flex flex-col items-center lg:items-start justify-center min-w-0 w-full lg:max-w-[420px]">
                    <motion.div 
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.2 }}
                      className="w-[240px] h-[240px] lg:w-[380px] lg:h-[380px] rounded-2xl overflow-hidden shadow-[0_40px_80px_rgba(0,0,0,0.8)] relative group mb-8 lg:mb-10"
                    >
                      {currentTrack?.cover ? (
                        <img src={currentTrack.cover} alt="cover" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-white/5 flex items-center justify-center">
                          <FileAudio size={80} className="text-white/10" />
                        </div>
                      )}
                    </motion.div>

                    <motion.div 
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.3 }}
                      className="text-center lg:text-left w-full"
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3 mb-2 overflow-hidden">
                         <h2 className="text-[24px] lg:text-[38px] font-black text-white leading-tight tracking-tight drop-shadow-xl whitespace-pre-wrap">{currentTrack?.title}</h2>
                         <div className="flex justify-center lg:justify-start items-center gap-2">
                           {currentTrack?.isYouTube && <Youtube size={16} className="text-[#fa243c]" />}
                           {currentTrack?.format?.lossless && <span className="px-2 py-0.5 bg-white/10 rounded text-[9px] lg:text-[10px] font-black tracking-widest text-white/80 border border-white/20 shrink-0">LOSSLESS</span>}
                         </div>
                      </div>
                      <p className="text-[16px] lg:text-[24px] text-white/40 font-bold tracking-tight drop-shadow-lg whitespace-pre-wrap">{currentTrack?.artist}</p>
                    </motion.div>
                 </div>

                 <div className="w-full lg:w-[500px] flex flex-col h-full lg:max-h-[600px] justify-center mt-4 lg:mt-0 overflow-hidden">
                    <div className="hidden lg:flex items-center gap-3 mb-6">
                      <h3 className="text-[12px] font-black uppercase tracking-[0.2em] text-white/30">
                        {currentTrack?.isYouTube
                          ? (parsedLrc.length > 0 ? 'Lyrics (lrclib)' : 'Subtitles')
                          : 'Lyrics'}
                      </h3>
                      {isSubLoading && <Loader2 size={12} className="animate-spin text-white/30" />}
                    </div>
                    
                    <div className="flex-1 overflow-y-auto pr-4 lg:pr-10 custom-scrollbar scroll-smooth" ref={lyricsContainerRef}>
                       <div className="space-y-6 lg:space-y-8 pb-40 lg:pb-60 text-center lg:text-left">
                         {currentTrack?.isYouTube && parsedLrc.length > 0 ? (
                           // YouTube 트랙 + lrclib 가사 있음 → LRC 표시
                           parsedLrc.map((line, idx) => (
                             <p key={idx}
                               className={`font-black transition-all duration-700 cursor-pointer leading-[1.3] lg:origin-left ${
                                 idx === activeLineIndex
                                   ? 'text-[22px] lg:text-[34px] text-white opacity-100 scale-[1.03] drop-shadow-[0_10px_20px_rgba(255,255,255,0.2)]'
                                   : 'text-[16px] lg:text-[24px] text-white/10 opacity-30 hover:opacity-100 hover:text-white/50 blur-[0.3px] hover:blur-0'
                               }`}
                               onClick={() => seek(line.time)}
                             >
                               {line.text || ' '}
                             </p>
                           ))
                         ) : currentTrack?.isYouTube ? (
                           // YouTube 트랙 + lrclib 없음 → YouTube 자막
                           ytSubtitles.length > 0 ? ytSubtitles.map((line, idx) => {
                             const isActive = currentTime >= line.start && currentTime < line.end
                             return (
                               <p key={idx}
                                 className={`font-black transition-all duration-500 cursor-pointer leading-[1.3] lg:origin-left ${
                                   isActive
                                     ? 'text-[22px] lg:text-[32px] text-white opacity-100 scale-[1.03] drop-shadow-[0_10px_20px_rgba(255,255,255,0.2)]'
                                     : 'text-[16px] lg:text-[24px] text-white/10 opacity-30 hover:opacity-100 hover:text-white/50'
                                 }`}
                                 onClick={() => seek(line.start)}
                               >
                                 {line.text}
                               </p>
                             )
                           }) : (
                             <div className="h-full flex flex-col items-center lg:items-start justify-center text-white/20 pt-10">
                               <p className="text-xl font-black italic tracking-tighter opacity-20">
                                 {isSubLoading ? '자막 불러오는 중...' : '자막이 없습니다.'}
                               </p>
                             </div>
                           )
                         ) : (
                           parsedLrc.length > 0 ? (
                             parsedLrc.map((line, idx) => (
                               <p key={idx}
                                 className={`font-black transition-all duration-700 cursor-pointer leading-[1.3] lg:origin-left ${
                                   idx === activeLineIndex
                                     ? 'text-[22px] lg:text-[34px] text-white opacity-100 scale-[1.03] drop-shadow-[0_10px_20px_rgba(255,255,255,0.2)]'
                                     : 'text-[16px] lg:text-[24px] text-white/10 opacity-30 hover:opacity-100 hover:text-white/50 blur-[0.3px] hover:blur-0'
                                 }`}
                                 onClick={() => seek(line.time)}
                               >
                                 {line.text || ' '}
                               </p>
                             ))
                           ) : (
                             <div className="h-full flex flex-col items-center lg:items-start justify-center text-white/20 pt-10">
                               <p className="text-xl font-black italic tracking-tighter opacity-20">가사가 없습니다.</p>
                             </div>
                           )
                         )}
                       </div>
                    </div>
                 </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="relative z-[60]">
        <div className="absolute bottom-[80px] left-0 right-0 h-[2px] bg-transparent hover:h-[6px] transition-all flex items-end group cursor-pointer">
          <input type="range" min="0" max={duration || 0} value={currentTime} onChange={e => seek(parseFloat(e.target.value))} className="absolute inset-0 w-full h-[6px] -top-[2px] opacity-0 cursor-pointer z-20" />
          <div className="w-full h-full bg-white/10 relative">
             <div className="absolute left-0 top-0 bottom-0 bg-[#fa243c]" style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`}}></div>
          </div>
        </div>

        <footer className="h-[80px] bg-black/40 flex items-center px-6 justify-between border-t border-white/5 backdrop-blur-3xl">
          <div className="flex items-center gap-6 w-1/4 min-w-[220px]">
            <button onClick={playPrev} className="text-white/60 hover:text-white transition-all active:scale-90"><SkipBack size={26} fill="currentColor" /></button>
            <button onClick={handlePlayToggle} className="text-white hover:scale-110 transition-all active:scale-90 flex items-center justify-center bg-white/5 p-2 rounded-full border border-white/10">{isPlaying ? <Pause size={38} fill="white" /> : <Play size={38} fill="white" className="ml-1" />}</button>
            <button onClick={playNext} className="text-white/60 hover:text-white transition-all active:scale-90"><SkipForward size={26} fill="currentColor" /></button>
            <span className="text-[11px] font-black text-white/40 ml-1 tracking-widest tabular-nums">{formatTime(currentTime)} / {formatTime(duration)}</span>
          </div>

          <div className="flex items-center justify-center flex-1 px-8 min-w-0 relative">
             {currentTrack ? (
               <div className="flex items-center gap-5 max-w-full">
                 <div onClick={() => setIsNowPlayingOpen(!isNowPlayingOpen)} className="w-12 h-12 bg-black/40 rounded-xl flex-shrink-0 overflow-hidden shadow-2xl cursor-pointer hover:opacity-80 transition-all hover:scale-105 active:scale-95 border border-white/5">
                   {currentTrack.cover ? <img src={currentTrack.cover} alt="cover" className="w-full h-full object-cover" /> : <FileAudio className="m-auto mt-2 text-white/20" />}
                 </div>
                 <div className="flex flex-col min-0 min-w-0">
                   <div className="flex items-center gap-2">
                     <h4 onClick={() => setIsNowPlayingOpen(!isNowPlayingOpen)} className="text-[15px] font-black truncate text-white cursor-pointer hover:underline max-w-[240px] tracking-tight">{currentTrack.title}</h4>
                     {currentTrack.isYouTube && <Youtube size={14} className="text-[#fa243c] shrink-0" />}
                     {currentTrack.format?.lossless && <span className="px-1.5 py-[1px] bg-white/10 rounded text-[9px] font-black tracking-[0.1em] text-white/80 shrink-0 border border-white/10">LOSSLESS</span>}
                     {currentTrack.format?.sampleRate && <span className="px-1.5 py-[1px] bg-white/5 rounded text-[8px] font-black text-white/40 border border-white/5 tracking-tighter uppercase">{Math.round(currentTrack.format.sampleRate / 100) / 10}kHz</span>}
                   </div>
                   <p onClick={() => setIsNowPlayingOpen(!isNowPlayingOpen)} className="text-[12px] text-white/40 truncate cursor-pointer hover:underline font-bold mt-0.5 tracking-tight">{currentTrack.artist}</p>
                 </div>
               </div>
             ) : <span className="text-[13px] font-bold text-white/20 tracking-tighter uppercase">No track selected</span>}
          </div>

          <div className="flex items-center justify-end gap-6 w-1/4 min-w-[220px] text-white/40">
             <div className="flex items-center gap-3 group">
                <Volume2 size={18} className="group-hover:text-white transition-colors" />
                <div className="w-24 flex items-center relative h-6">
                   <input type="range" min="0" max="1" step="0.01" value={volume} onChange={e => setVolume(parseFloat(e.target.value))} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                   <div className="w-full h-[4px] bg-white/10 rounded-full overflow-hidden">
                     <div className="h-full bg-white/60 group-hover:bg-[#fa243c] transition-all" style={{ width: `${volume * 100}%` }}></div>
                 </div>
              </div>
           </div>
           <button onClick={toggleRepeatMode} className={`transition-all hover:scale-110 active:scale-90 ${repeatMode !== 'off' ? 'text-[#fa243c]' : 'hover:text-white'}`}>{repeatMode === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}</button>
           <button onClick={toggleShuffle} className={`transition-all hover:scale-110 active:scale-90 ${isShuffle ? 'text-[#fa243c]' : 'hover:text-white'}`}><Shuffle size={20} /></button>
           <button onClick={() => setIsNowPlayingOpen(!isNowPlayingOpen)} className="hover:text-white transition-all hover:scale-110 active:scale-90 border border-white/10 rounded-full p-2 bg-white/5">{isNowPlayingOpen ? <ChevronDown size={22} /> : <ChevronUp size={22} />}</button>
        </div>
      </footer>
    </div>
  </div>
  )
}

export default MainLayout
