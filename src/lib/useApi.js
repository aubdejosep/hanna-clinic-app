import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'

// Loads `path` and reloads whenever it changes. Keeps the last data on screen while the
// next page loads, so lists don't flash empty.
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const latest = useRef(path)
  const load = useCallback(() => {
    latest.current = path
    setState((s) => ({ ...s, loading: true, error: null }))
    api(path)
      .then((data) => { if (latest.current === path) setState({ data, error: null, loading: false }) })
      .catch((error) => { if (latest.current === path) setState((s) => ({ ...s, error, loading: false })) })
  }, [path])
  useEffect(load, [load])
  return { ...state, reload: load, setData: (data) => setState((s) => ({ ...s, data })) }
}

// Waits until typing stops before searching.
export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
