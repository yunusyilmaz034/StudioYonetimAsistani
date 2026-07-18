// Minimal data hook: run an async loader, expose { data, loading, error, reload }. Keeps every screen
// free of repeated useState/useEffect plumbing without pulling a data-fetching library into v1.
import { useCallback, useEffect, useState } from 'react'

export function useFetch<T>(loader: () => Promise<T>, deps: readonly unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setError(null)
    try {
      setData(await loader())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    let alive = true
    setLoading(true)
    loader()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error, reload }
}
