const { desktopCapturer, BrowserWindow, screen, app, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const logger = require('./logger')
async function runScreenshot(region) {
  logger.info('截图开始')
  let sel = region
  if (!sel) {
    sel = await openOverlay()
  }
  const primary = screen.getPrimaryDisplay()
  let sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
  let source = sources.find(s => s.display_id === String(primary.id)) || sources[0]
  let img = source.thumbnail
  let size = img.getSize()
  if (!size.width || !size.height) {
    const sf = primary.scaleFactor || 1
    sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.floor(primary.size.width * sf), height: Math.floor(primary.size.height * sf) } })
    source = sources.find(s => s.display_id === String(primary.id)) || sources[0]
    img = source.thumbnail
    size = img.getSize()
  }
  const crop = sel
    ? {
        x: Math.max(0, sel.x),
        y: Math.max(0, sel.y),
        width: Math.max(1, Math.min(sel.w, size.width - sel.x)),
        height: Math.max(1, Math.min(sel.h, size.height - sel.y))
      }
    : { x: 0, y: 0, width: size.width, height: size.height }
  logger.info('截图尺寸', { size: size.width + 'x' + size.height, crop })
  const cropped = img.crop(crop)
  const png = cropped.toPNG()
  const dir = path.join(app.getPath('userData'), 'screenshots', new Date().toISOString().slice(0, 10).replace(/-/g, ''))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${Date.now()}.png`)
  fs.writeFileSync(file, png)
  logger.info('截图成功', { file })
  return file
}

function openOverlay() {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: screen.getPrimaryDisplay().size.width,
      height: screen.getPrimaryDisplay().size.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      fullscreen: true,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })
    const distOverlay = path.join(__dirname, '../../dist-renderer/overlay.html')
    const srcOverlay = path.join(__dirname, '../../src/renderer/overlay.html')
    const target = fs.existsSync(distOverlay) ? distOverlay : srcOverlay
    win.loadURL(`file://${target}`)
    const handler = (_e, payload) => {
      ipcMain.removeListener('overlay:region', handler)
      win.close()
      if (!payload) reject(new Error('cancel'))
      else resolve(payload)
    }
    ipcMain.on('overlay:region', handler)
  })
}

module.exports = { runScreenshot }

async function runFullScreenshot() {
  logger.info('全屏截图开始')
  const primary = screen.getPrimaryDisplay()
  let sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
  let source = sources.find(s => s.display_id === String(primary.id)) || sources[0]
  let img = source.thumbnail
  let size = img.getSize()
  if (!size.width || !size.height) {
    const sf = primary.scaleFactor || 1
    sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.floor(primary.size.width * sf), height: Math.floor(primary.size.height * sf) } })
    source = sources.find(s => s.display_id === String(primary.id)) || sources[0]
    img = source.thumbnail
    size = img.getSize()
  }
  const crop = { x: 0, y: 0, width: Math.max(1, size.width), height: Math.max(1, size.height) }
  logger.info('全屏截图尺寸', { size: size.width + 'x' + size.height })
  const png = img.crop(crop).toPNG()
  const dir = path.join(app.getPath('userData'), 'screenshots', new Date().toISOString().slice(0, 10).replace(/-/g, ''))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${Date.now()}.png`)
  fs.writeFileSync(file, png)
  logger.info('截图成功', { file })
  return file
}

module.exports.runFullScreenshot = runFullScreenshot
