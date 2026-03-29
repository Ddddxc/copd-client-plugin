const { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, session, screen, protocol } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { registerIpc } = require('./ipc')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app-resource', privileges: { secure: true, standard: true, supportFetchAPI: true, bypassCSP: true } }
])

let mainWindow = null
let floatWindow = null
let tray = null

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 700,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  const url = process.env.VITE_DEV_SERVER_URL ? `${process.env.VITE_DEV_SERVER_URL}?view=history` : `file://${path.join(__dirname, '../../dist-renderer/index.html')}?view=history`
  mainWindow.loadURL(url)
  mainWindow.on('closed', () => { mainWindow = null })
}

function createFloatWindow() {
  floatWindow = new BrowserWindow({
    width: 150,
    height: 150,
    alwaysOnTop: true,
    frame: false,
    resizable: false,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  const url = process.env.VITE_DEV_SERVER_URL ? `${process.env.VITE_DEV_SERVER_URL}?view=float` : `file://${path.join(__dirname, '../../dist-renderer/index.html')}?view=float`
  const wa = screen.getPrimaryDisplay().workArea
  const x = wa.x + 10
  const y = wa.y + Math.floor(wa.height / 2) - 75
  floatWindow.setPosition(x, y)
  floatWindow.loadURL(url)
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../build/icon.png'))
  tray = new Tray(icon)
  const menu = Menu.buildFromTemplate([
    { label: '记录', click: () => openHistoryWindow() },
    { label: '显示悬浮窗', click: () => floatWindow?.show() },
    { label: '退出', click: () => app.quit() }
  ])
  tray.setToolTip('Medical QC Client')
  tray.setContextMenu(menu)
}

function openHistoryWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

app.whenReady().then(() => {
  protocol.registerBufferProtocol('app-resource', (request, callback) => {
    try {
      // 使用标准的 URL 解析器来获取 drive (hostname) 和 rest (pathname)
      const url = new URL(request.url);
      const drive = url.hostname.toLowerCase(); // e.g. "d"
      const restPath = decodeURIComponent(url.pathname).replace(/^\/+/, ''); // e.g. "code/project/..."
      
      let finalPath = '';
      if (drive && drive.length === 1 && /^[a-z]$/.test(drive)) {
        // Windows 驱动器路径
        finalPath = path.normalize(`${drive.toUpperCase()}:/${restPath}`);
      } else {
        // 非驱动器形式的绝对路径，例如 /usr/local 或 之前格式的冗余
        finalPath = path.normalize(restPath);
      }
      
      if (!fs.existsSync(finalPath)) {
        console.error('[protocol] File not found:', finalPath, '(Source URL:', request.url, ')');
        callback({ mimeType: 'text/plain', data: Buffer.from('File not found') });
        return;
      }
      
      const ext = path.extname(finalPath).toLowerCase();
      const mimeTypes = { 
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', 
        '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp' 
      };
      const mime = mimeTypes[ext] || 'application/octet-stream';
      const data = fs.readFileSync(finalPath);
      callback({ mimeType: mime, data: data });
    } catch (e) {
      console.error('[protocol] Handler Error:', e && e.message ? e.message : String(e), '(Source URL:', request.url, ')');
      callback({ mimeType: 'text/plain', data: Buffer.from('Internal error') });
    }
  });
  createFloatWindow()
  createTray()
  registerIpc({ mainWindow, floatWindow, openHistory: openHistoryWindow })
  globalShortcut.register('Alt+S', () => {
    if (floatWindow) floatWindow.webContents.send('shortcut:screenshot')
  })
  const s = session.defaultSession
  s.setPermissionRequestHandler((_wc, _perm, callback) => callback(false))
  s.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, cb) => cb({ cancel: true }))
});

const { ipcMain } = require('electron')
ipcMain.on('ball:expand', () => {
  if (!floatWindow) return
  const wa = screen.getPrimaryDisplay().workArea
  const [x0, y0] = floatWindow.getPosition()
  const [w] = floatWindow.getSize()
  const center = x0 + w / 2
  const mid = wa.x + wa.width / 2
  const isLeft = center <= mid
  const x = isLeft ? (wa.x + 10) : (wa.x + wa.width - w - 10)
  floatWindow.setPosition(x, y0)
})
ipcMain.on('ball:collapse', () => {
  if (!floatWindow) return
  const wa = screen.getPrimaryDisplay().workArea
  const [x0, y0] = floatWindow.getPosition()
  const [w] = floatWindow.getSize()
  const center = x0 + w / 2
  const mid = wa.x + wa.width / 2
  const isLeft = center <= mid
  const x = isLeft ? (wa.x - (w - 12)) : (wa.x + wa.width - 12)
  floatWindow.setPosition(x, y0)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
