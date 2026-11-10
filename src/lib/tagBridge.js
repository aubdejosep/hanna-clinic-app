// One shared connection to the NFC tag reader bridge (the gym app's bridge.py, running on the
// front-desk PC) for the whole app, so a tap works on any screen.
//
// Only the PC with the reader connects: staff turn it on with "Use This PC’s Tag Reader"
// (remembered on that PC). Normally each tap goes to the check-in listener; while a tag is being
// assigned to a pet, that screen "captures" the taps so they don't also check a pet in or out.

const BRIDGE_URL = 'ws://localhost:8765'
const RETRY_MS = 3000
const KEY = 'hpw.tagReader'

let socket = null
let started = false
let retryTimer = null
let state = { enabled: false, connected: false }
const statusListeners = new Set()
const scanListeners = new Set()
let capture = null

function setState(patch) {
  state = { ...state, ...patch }
  statusListeners.forEach((listener) => listener())
}

function connect() {
  try {
    socket = new WebSocket(BRIDGE_URL)
  } catch {
    retryTimer = setTimeout(connect, RETRY_MS)
    return
  }
  socket.onopen = () => setState({ connected: true })
  socket.onmessage = (event) => {
    let data
    try {
      data = JSON.parse(event.data)
    } catch {
      return
    }
    if (data.type !== 'fob_scan' || !data.uid) return
    if (capture) capture(data.uid)
    else scanListeners.forEach((listener) => listener(data.uid))
  }
  socket.onclose = () => {
    setState({ connected: false })
    if (started) retryTimer = setTimeout(connect, RETRY_MS)
  }
  socket.onerror = () => socket.close()
}

function start() {
  if (started) return
  started = true
  connect()
}
function stop() {
  started = false
  clearTimeout(retryTimer)
  if (socket) {
    socket.onclose = null
    socket.close()
  }
  socket = null
  setState({ connected: false })
}

export function readerEnabled() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
export function setReaderEnabled(on) {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch { /* private window: works until the tab closes */ }
  setState({ enabled: on })
  if (on) start()
  else stop()
}
export function initTagReader() {
  if (readerEnabled()) {
    setState({ enabled: true })
    start()
  }
}

export function subscribeReader(listener) {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}
export function getReaderState() {
  return state
}
export function onTagScan(listener) {
  scanListeners.add(listener)
  return () => scanListeners.delete(listener)
}
// Route taps to one handler only (assigning a tag). Returns a release function.
export function captureTagScans(handler) {
  capture = handler
  return () => {
    if (capture === handler) capture = null
  }
}
