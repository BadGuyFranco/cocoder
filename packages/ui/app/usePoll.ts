// Poll a fetcher on an interval, pausing when the tab/window is hidden (matches the v1 app's posture).
// Runs once immediately, then every `ms`. `key` resets the loop (e.g. workspace or run switch).
import { useEffect, useState } from 'react'

export function usePoll<T>(fetcher: () => Promise<T>, ms: number, key: string): { data: T | null; error: string } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setData(null)
    setError('')
    const tick = async () => {
      if (document.hidden) return
      try {
        const r = await fetcher()
        if (live) setData(r)
      } catch (e) {
        if (live) setError((e as Error).message)
      }
    }
    void tick()
    const h = setInterval(() => void tick(), ms)
    return () => {
      live = false
      clearInterval(h)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms])

  return { data, error }
}
