import { useState, useEffect } from 'react'

interface LyricsData {
  plainLyrics?: string
  syncedLyrics?: string
}

export const useLyrics = (artist: string, title: string) => {
  const [lyrics, setLyrics] = useState<LyricsData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!artist || !title) return

    const fetchLyrics = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const query = new URLSearchParams({
          artist_name: artist,
          track_name: title
        })
        const response = await fetch(`https://lrclib.net/api/get?${query.toString()}`)
        
        if (response.ok) {
          const data = await response.json()
          setLyrics({
            plainLyrics: data.plainLyrics,
            syncedLyrics: data.syncedLyrics
          })
        } else {
          setLyrics(null)
          setError('Lyrics not found')
        }
      } catch (err) {
        setError('Failed to fetch lyrics')
      } finally {
        setIsLoading(false)
      }
    }

    fetchLyrics()
  }, [artist, title])

  return { lyrics, isLoading, error }
}
