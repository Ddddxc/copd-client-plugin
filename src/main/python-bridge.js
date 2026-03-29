const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const { app } = require('electron')
const logger = require('./logger')

let proc = null
let ready = false

function resolvePython() {
  const base = app.isPackaged ? (process.resourcesPath || '') : path.join(__dirname, '../../')
  const script = path.join(base, 'resources', 'python', 'analyze_new.py')
  const candidates = []
  if (process.env.PYTHON_EXE) candidates.push(process.env.PYTHON_EXE)
  candidates.push(
    path.join(base, 'resources', 'python', 'venv', 'Scripts', 'python.exe'),
    path.join(base, 'resources', 'python', 'python.exe'),
    'python'
  )
  const exe = candidates.find(p => p === 'python' || fs.existsSync(p))
  logger.info('[PY] resolve', { exe, script, base })
  return { exe, script, base }
}

function ensureProc() {
  if (proc && ready) return proc
  const { exe, script, base } = resolvePython()
  const env = { ...process.env }
  if (!env.YOLO_WEIGHTS_PATH) env.YOLO_WEIGHTS_PATH = path.join(base, 'resources', 'python', 'models', 'best.pt')
  env.YOLO_AUTOINSTALL = 'false'
  proc = spawn(exe, [script], { stdio: ['pipe', 'pipe', 'pipe'], env })
  const stdout = proc.stdout
  stdout.on('data', d => {
    const s = d.toString()
    if (s.startsWith('__ready__')) ready = true
  })
  proc.stderr.on('data', d => {
    const s = d.toString()
    console.error('[PY] stderr', s.trim())
  })
  proc.on('error', e => {
    console.error('[PY] error', String(e && e.stack ? e.stack : e))
  })
  proc.on('close', (code, signal) => {
    console.log('[PY] close', JSON.stringify({ code, signal }))
    ready = false
    proc = null
  })
  return proc
}

async function analyzeImage(image_path) {
  function analyzeImageOneShot(img) {
    const { exe, script, base } = resolvePython()
    const env = { ...process.env }
    if (!env.YOLO_WEIGHTS_PATH) env.YOLO_WEIGHTS_PATH = path.join(base, 'resources', 'python', 'models', 'best.pt')
    env.YOLO_AUTOINSTALL = 'false'
    const cp = spawn(exe, [script, img], { stdio: ['ignore', 'pipe', 'pipe'], env })
    return new Promise((resolve, reject) => {
      let buf = ''
      const t0 = Date.now()
      const onData = (d) => {
        buf += d.toString()
        let idx = buf.indexOf('\n')
        while (idx !== -1) {
          const line = buf.slice(0, idx)
          buf = buf.slice(idx + 1)
        const t = line.trim()
        if (t && (t.startsWith('{') || t.startsWith('['))) {
          let obj
          try { obj = JSON.parse(t) } catch (_e) { idx = buf.indexOf('\n'); continue }
          cp.stdout.off('data', onData)
          logger.info('[PY] oneshot done', { ms: Date.now() - t0 })
          resolve(obj)
          return
        }
        idx = buf.indexOf('\n')
      }
    }
      cp.stdout.on('data', onData)
      cp.stderr.on('data', d => logger.error('[PY] oneshot stderr', { msg: String(d) }))
      const timer = setTimeout(() => {
        try { cp.stdout.off('data', onData) } catch (_) {}
        logger.error('[PY] oneshot timeout', { ms: Date.now() - t0, image_path: img })
        reject(new Error('python oneshot timeout'))
      }, 30000)
      cp.on('close', (code, signal) => {
        logger.info('[PY] oneshot close', { code, signal })
      })
    })
  }
  const p = ensureProc()
  return new Promise((resolve, reject) => {
    let buf = ''
    const t0 = Date.now()
    let finished = false
    const cleanup = () => {
      try { p.stdout.off('data', onData) } catch (_) {}
    }
    const onData = (d) => {
      buf += d.toString()
      let idx = buf.indexOf('\n')
      while (idx !== -1) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        const t = line.trim()
        if (t && (t.startsWith('{') || t.startsWith('['))) {
          let obj
          try { obj = JSON.parse(t) } catch (_e) { idx = buf.indexOf('\n'); continue }
          cleanup()
          finished = true
          console.log('[PY] done', JSON.stringify({ ms: Date.now() - t0 }))
          resolve(obj)
          return
        }
        idx = buf.indexOf('\n')
      }
    }
    p.stdout.on('data', onData)
    console.log('[PY] send', JSON.stringify({ image_path }))
    p.stdin.write(JSON.stringify({ image_path }) + '\n')
    setTimeout(async () => {
      if (finished) return
      cleanup()
      console.error('[PY] timeout', JSON.stringify({ ms: Date.now() - t0, image_path }))
      try {
        const out = await analyzeImageOneShot(image_path)
        resolve(out)
      } catch (e) {
        reject(e)
      }
    }, 30000)
  })
}

module.exports = { analyzeImage }
