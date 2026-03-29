const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  takeScreenshot: (region) => ipcRenderer.invoke('screenshot:take', { region }),
  fullScreenshot: () => ipcRenderer.invoke('screenshot:full'),
  runAnalysis: (image_path) => ipcRenderer.invoke('analysis:run', { image_path }),
  listRecords: (payload) => ipcRenderer.invoke('records:list', payload),
  getRecord: (id) => ipcRenderer.invoke('records:get', { id }),
  onLatest: (cb) => ipcRenderer.on('analysis:latest', (_e, data) => cb(data)),
  onShortcut: (cb) => ipcRenderer.on('shortcut:screenshot', () => cb()),
  showHistory: () => ipcRenderer.invoke('window:showHistory'),
  patientsSearch: (payload) => ipcRenderer.invoke('patients:search', payload),
  analysesList: (payload) => ipcRenderer.invoke('analyses:list', payload),
  analysesGet: (id) => ipcRenderer.invoke('analyses:get', { id }),
  analysesDelete: (id) => ipcRenderer.invoke('analyses:delete', { id }),
  imagesList: (payload) => ipcRenderer.invoke('images:list', payload),
  predictionsList: (payload) => ipcRenderer.invoke('predictions:list', payload),
  predictionsDelete: (id) => ipcRenderer.invoke('predictions:delete', { id }),
  notify: (payload) => ipcRenderer.invoke('notify:show', payload)
})

contextBridge.exposeInMainWorld('overlay', {
  submit: (region) => ipcRenderer.send('overlay:region', region),
  cancel: () => ipcRenderer.send('overlay:region', null)
})

contextBridge.exposeInMainWorld('ball', {
  expand: () => ipcRenderer.send('ball:expand'),
  collapse: () => ipcRenderer.send('ball:collapse')
})
