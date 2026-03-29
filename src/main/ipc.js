const { ipcMain, app, Notification } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { runScreenshot, runFullScreenshot } = require('./screenshot')
const { analyzeImage } = require('./python-bridge')
const { db } = require('./db')
const logger = require('./logger')

function isUserDataPath(p) {
  const base = app.getPath('userData')
  const rel = path.relative(base, p)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function registerIpc(ctx) {
  ipcMain.handle('screenshot:take', async (_e, payload) => {
    const region = payload && payload.region
    const file = await runScreenshot(region)
    return { path: file }
  })

  ipcMain.handle('screenshot:full', async () => {
    const file = await runFullScreenshot()
    logger.info('分析开始', { image_path: file })
    const t0 = Date.now()
    const res = await analyzeImage(file)
    const ms = Date.now() - t0
    logger.info('分析结束', { image_path: file, ms })

    // 验证逻辑：未识别到患者信息 或 模型未输出预测数据时，抛出异常
    const patientId = String(res.patient_id || '').trim()
    const patientName = String((res.meta && res.meta.patient_name) || '').trim()
    const curvesDir = res.yolo && res.yolo.curves_dir
    const detectDir = res.yolo && res.yolo.detect_dir
    const hasPredictionData = (curvesDir && fs.existsSync(curvesDir)) || (detectDir && fs.existsSync(detectDir))
    
    if ((!patientId && !patientName) || !hasPredictionData) {
      logger.error('分析验证失败：缺失患者信息或预测数据', { patientId, patientName, hasPredictionData })
      throw new Error('未识别到患者信息或模型未输出预测数据')
    }

    const images = []
    if (Array.isArray(res.artifacts)) for (const p of res.artifacts) images.push({ path: p, kind: 'artifact' })
    if (curvesDir && fs.existsSync(curvesDir)) {
      for (const fn of fs.readdirSync(curvesDir)) {
        const lower = fn.toLowerCase()
        if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) images.push({ path: path.join(curvesDir, fn), kind: 'curve_pred' })
      }
    }
    if (Array.isArray(res.annotated)) for (const p of res.annotated) images.push({ path: p, kind: 'annotated' })
    const id = await db.insertAnalysis({ patientId: String(res.patient_id || ''), patientName: String((res.meta && res.meta.patient_name) || ''), screenshotPath: file, outputDir: String(res.output_dir || ''), detectDir: String((res.yolo && res.yolo.detect_dir) || ''), yoloSummary: String((res.yolo && res.yolo.summary) || ''), metaJson: JSON.stringify(res), images })
    const pid = String(res.patient_id || '')
    const pname = String((res.meta && res.meta.patient_name) || '')
    for (const it of images) {
      if (it.kind === 'curve_pred') await db.insertPrediction({ patientId: pid, patientName: pname, imagePath: it.path })
    }
    if (ctx.floatWindow) ctx.floatWindow.webContents.send('analysis:latest', { id, patient_id: res.patient_id, ai_result: (res.yolo && res.yolo.summary) || '' })
    return { id, path: file, result: res }
  })

  ipcMain.handle('analysis:run', async (_e, payload) => {
    if (!payload || typeof payload.image_path !== 'string') throw new Error('invalid path')
    if (!isUserDataPath(payload.image_path)) throw new Error('forbidden path')
    logger.info('分析开始', { image_path: payload.image_path })
    const t0 = Date.now()
    const result = await analyzeImage(payload.image_path)
    const ms = Date.now() - t0
    logger.info('分析结束', { image_path: payload.image_path, ms })

    // 验证逻辑：未识别到患者信息 或 模型未输出预测数据时，抛出异常
    const patientId = String(result.patient_id || '').trim()
    const patientName = String((result.meta && result.meta.patient_name) || '').trim()
    const curvesDir = result.yolo && result.yolo.curves_dir
    const detectDir = result.yolo && result.yolo.detect_dir
    const hasPredictionData = (curvesDir && fs.existsSync(curvesDir)) || (detectDir && fs.existsSync(detectDir))
    
    if ((!patientId && !patientName) || !hasPredictionData) {
      logger.error('分析验证失败：缺失患者信息或预测数据', { patientId, patientName, hasPredictionData })
      throw new Error('未识别到患者信息或模型未输出预测数据')
    }

    const images = []
    if (Array.isArray(result.artifacts)) for (const p of result.artifacts) images.push({ path: p, kind: 'artifact' })
    if (curvesDir && fs.existsSync(curvesDir)) {
      for (const fn of fs.readdirSync(curvesDir)) {
        const lower = fn.toLowerCase()
        if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) images.push({ path: path.join(curvesDir, fn), kind: 'curve_pred' })
      }
    }
    if (Array.isArray(result.annotated)) for (const p of result.annotated) images.push({ path: p, kind: 'annotated' })
    const id = await db.insertAnalysis({ patientId: String(result.patient_id || ''), patientName: String((result.patient_name) || ''), screenshotPath: payload.image_path, outputDir: String(result.output_dir || ''), detectDir: String((result.yolo && result.yolo.detect_dir) || ''), yoloSummary: String((result.yolo && result.yolo.summary) || ''), metaJson: JSON.stringify(result), images })
    const pid = String(result.patient_id || '')
    const pname = String((result.meta && result.meta.patient_name) || '')
    for (const it of images) {
      if (it.kind === 'curve_pred') await db.insertPrediction({ patientId: pid, patientName: pname, imagePath: it.path })
    }
    if (ctx.floatWindow) ctx.floatWindow.webContents.send('analysis:latest', { id, patient_id: result.patient_id, ai_result: (result.yolo && result.yolo.summary) || '' })
    return { id, result }
  })

  ipcMain.handle('records:list', async (_e, payload) => {
    const rows = await db.list(payload.page, payload.pageSize, payload.filter)
    return rows
  })

  ipcMain.handle('records:get', async (_e, payload) => {
    const row = await db.get(payload.id)
    return row
  })
  ipcMain.handle('window:showHistory', async () => {
    if (ctx.openHistory) ctx.openHistory()
    return true
  })
  ipcMain.handle('patients:search', async (_e, payload) => {
    const keyword = payload && payload.keyword
    const page = (payload && payload.page) || 1
    const pageSize = (payload && payload.pageSize) || 20
    const rows = await db.searchPatients(String(keyword || ''), page, pageSize)
    return rows
  })
  ipcMain.handle('analyses:list', async (_e, payload) => {
    const page = (payload && payload.page) || 1
    const pageSize = (payload && payload.pageSize) || 20
    const filter = (payload && payload.filter) || {}
    logger.info('analyses:list:req', { page, pageSize, filter })
    const out = await db.listAnalyses(page, pageSize, filter)
    logger.info('analyses:list:res', { rows: (out && out.rows ? out.rows.length : 0), total: (out && out.total) })
    return out
  })
  ipcMain.handle('analyses:get', async (_e, payload) => {
    const row = await db.getAnalysis(payload.id)
    return row
  })
  ipcMain.handle('analyses:delete', async (_e, payload) => {
    const ok = await db.deleteAnalysis(payload.id)
    return ok
  })
  ipcMain.handle('images:list', async (_e, payload) => {
    const analysisId = payload && payload.analysisId
    const page = (payload && payload.page) || 1
    const pageSize = (payload && payload.pageSize) || 50
    const rows = await db.listImages(Number(analysisId), page, pageSize)
    return rows
  })
  ipcMain.handle('predictions:list', async (_e, payload) => {
    const page = (payload && payload.page) || 1
    const pageSize = (payload && payload.pageSize) || 20
    const filter = (payload && payload.filter) || {}
    const out = await db.listPredictions(page, pageSize, filter)
    return out
  })
  ipcMain.handle('predictions:delete', async (_e, payload) => {
    const ok = await db.deletePrediction(payload.id)
    return ok
  })
  ipcMain.handle('notify:show', async (_e, payload) => {
    const title = String((payload && payload.title) || '提示')
    const body = String((payload && payload.body) || '')
    if (Notification.isSupported()) {
      const n = new Notification({ title, body })
      n.show()
    }
    return true
  })
}

module.exports = { registerIpc }
