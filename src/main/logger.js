const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

function ts() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

function filePath() {
  const name = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.log'
  const dir = path.join(app.getPath('userData'), 'logs')
  try { fs.mkdirSync(dir, { recursive: true }) } catch (_) {}
  return path.join(dir, name)
}

function write(level, msg, meta) {
  const fp = filePath()
  const m = typeof msg === 'string' ? msg : String(msg || '')
  const s = meta ? `${m} ${JSON.stringify(meta)}` : m
  try { fs.appendFileSync(fp, `${ts()} ${level} ${s}\n`) } catch (_) {}
}

module.exports = {
  info: (m, meta) => write('INFO', m, meta),
  warn: (m, meta) => write('WARN', m, meta),
  error: (m, meta) => write('ERROR', m, meta)
}
