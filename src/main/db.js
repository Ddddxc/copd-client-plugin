const path = require('node:path');
const { app } = require('electron');
const fs = require('node:fs');
let initSqlJs = null;

class DB {
  constructor() {
    const userFile = path.join(app.getPath('userData'), 'data.sqlite');
    const oldFile = path.join(process.cwd(), 'data.sqlite');
    try {
      if (!fs.existsSync(userFile) && fs.existsSync(oldFile)) {
        fs.mkdirSync(path.dirname(userFile), { recursive: true });
        fs.copyFileSync(oldFile, userFile);
      }
    } catch (_) {}
    this.file = userFile;
    this.dbPromise = this._init();
  }

  async _init() {
    if (!initSqlJs) initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs({ locateFile: (f) => path.join(__dirname, '../../node_modules/sql.js/dist/', f) });
    const exists = fs.existsSync(this.file);
    const db = exists ? new SQL.Database(fs.readFileSync(this.file)) : new SQL.Database();

    db.exec('CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id TEXT, ai_result TEXT, screenshot_path TEXT, created_at INTEGER, meta_json TEXT)');
    db.exec('CREATE TABLE IF NOT EXISTS patients (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id TEXT, patient_name TEXT, created_at INTEGER)');
    db.exec('CREATE TABLE IF NOT EXISTS analyses (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_ref INTEGER, screenshot_path TEXT, output_dir TEXT, detect_dir TEXT, yolo_summary TEXT, meta_json TEXT, created_at INTEGER)');
    db.exec('CREATE TABLE IF NOT EXISTS images (id INTEGER PRIMARY KEY AUTOINCREMENT, analysis_ref INTEGER, image_path TEXT, image_blob BLOB, kind TEXT, created_at INTEGER)');
    try {
      const ti = db.exec('PRAGMA table_info(analyses)');
      const cols = (ti[0]?.values || []).map(v => String(v[1]));
      if (!cols.includes('detect_dir')) db.exec('ALTER TABLE analyses ADD COLUMN detect_dir TEXT');
    } catch (_) {}
    db.exec('CREATE INDEX IF NOT EXISTS idx_patients_id ON patients(patient_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(patient_name)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_analyses_patient ON analyses(patient_ref)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_images_analysis ON images(analysis_ref)');
    db.exec('CREATE TABLE IF NOT EXISTS predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id TEXT, patient_name TEXT, image_path TEXT, created_at INTEGER)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_predictions_pid ON predictions(patient_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_predictions_pname ON predictions(patient_name)');
    
    return db;
  }

  async insertRecord(row) {
    const db = await this.dbPromise;
    const stmt = db.prepare('INSERT INTO records (patient_id, ai_result, screenshot_path, created_at, meta_json) VALUES (?, ?, ?, ?, ?)');
    stmt.run([row.patient_id, row.ai_result, row.screenshot_path, row.created_at, row.meta_json]);
    stmt.free();
    const data = db.export();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, Buffer.from(data));
    const idRes = db.exec('SELECT last_insert_rowid() as id');
    const id = idRes[0]?.values[0]?.[0] || 0;
    return Number(id);
  }

  async upsertPatient(patientId, patientName) {
    const db = await this.dbPromise;
    try {
      const q = db.exec("SELECT id, patient_name FROM patients WHERE patient_id = '" + String(patientId).replace(/'/g, "''") + "'");
      const existing = q[0]?.values?.[0] || null;
      if (existing) {
        const eid = Number(existing[0] || 0);
        const ename = String(existing[1] || '');
        const pname = String(patientName || '');
        if (pname && pname !== ename) {
          db.exec("UPDATE patients SET patient_name = '" + pname.replace(/'/g, "''") + "' WHERE id = " + eid);
          const dataU = db.export();
          fs.mkdirSync(path.dirname(this.file), { recursive: true });
          fs.writeFileSync(this.file, Buffer.from(dataU));
        }
        return eid;
      }

      const pad = (n) => String(n).padStart(2, '0');
      const d = new Date();
      const createdAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      const stmt = db.prepare('INSERT INTO patients (patient_id, patient_name, created_at) VALUES (?, ?, ?)');
      stmt.run([String(patientId || ''), String(patientName || ''), createdAt]);
      stmt.free();

      const q2 = db.exec("SELECT id FROM patients WHERE patient_id = '" + String(patientId).replace(/'/g, "''") + "' ORDER BY id DESC LIMIT 1");
      const id = q2[0]?.values?.[0]?.[0] || 0;
      const data = db.export();
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, Buffer.from(data));
      return Number(id);
    } catch (e) {
      const logger = require('./logger');
      logger.error('upsertPatient error', { err: String(e && e.stack ? e.stack : e) });
      throw e;
    }
  }

  // 获取所有截图记录，支持分页
  async getRecords(page = 1, pageSize = 10) {
    const db = await this.dbPromise;
    const offset = (page - 1) * pageSize;
    const sql = `SELECT records.id, records.screenshot_path, records.created_at, records.meta_json, patients.patient_id, patients.patient_name 
                 FROM records 
                 LEFT JOIN patients ON patients.patient_id = records.patient_id 
                 ORDER BY records.created_at DESC 
                 LIMIT ${pageSize} OFFSET ${offset}`;
    const res = db.exec(sql);
    const rows = (res[0]?.values || []).map((v) => ({
      id: v[0],
      screenshot_path: v[1],
      created_at: v[2],
      meta_json: v[3],
      patient_id: v[4],
      patient_name: v[5]
    }));
    return rows;
  }

  // 获取指定记录的预测图片，支持懒加载
  async getImagesForRecord(recordId) {
    const db = await this.dbPromise;
    const sql = `SELECT image_path, kind FROM images WHERE analysis_ref = 
                 (SELECT id FROM analyses WHERE screenshot_path = 
                 (SELECT screenshot_path FROM records WHERE id = ?))`;
    const stmt = db.prepare(sql);
    stmt.bind([recordId]);
    const images = [];
    while (stmt.step()) {
      images.push(stmt.getAsObject());
    }
    stmt.free();
    return images;
  }

  async insertAnalysis(row) {
    const db = await this.dbPromise;
    const pid = await this.upsertPatient(row.patientId, row.patientName);
    const stmt = db.prepare('INSERT INTO analyses (patient_ref, screenshot_path, output_dir, detect_dir, yolo_summary, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    stmt.run([pid, String(row.screenshotPath || ''), String(row.outputDir || ''), String(row.detectDir || ''), String(row.yoloSummary || ''), String(row.metaJson || ''), Date.now()]);
    stmt.free();
    const data = db.export();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, Buffer.from(data));
    const idRes = db.exec('SELECT last_insert_rowid() as id');
    const analysisId = Number(idRes[0]?.values[0]?.[0] || 0);
    if (Array.isArray(row.images)) {
      for (const it of row.images) {
        await this.insertImage({ analysisId, imagePath: it.path || it.image_path || '', kind: it.kind || 'artifact', imageBlob: it.blob || null });
      }
    }
    return analysisId;
  }

  async insertImage({ analysisId, imagePath, kind, imageBlob }) {
    const db = await this.dbPromise;
    const stmt = db.prepare('INSERT INTO images (analysis_ref, image_path, image_blob, kind, created_at) VALUES (?, ?, ?, ?, ?)');
    const blob = Buffer.isBuffer(imageBlob) ? new Uint8Array(imageBlob) : null;
    stmt.run([Number(analysisId), String(imagePath || ''), blob, String(kind || 'artifact'), Date.now()]);
    stmt.free();
    const data = db.export();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, Buffer.from(data));
    const idRes = db.exec('SELECT last_insert_rowid() as id');
    const id = idRes[0]?.values[0]?.[0] || 0;
    return Number(id);
  }

  async listAnalyses(page, pageSize, filter) {
    const db = await this.dbPromise;
    const offset = (page - 1) * pageSize;
    const where = [];
    
    // 如果存在搜索关键字，使用 OR 逻辑组合患者ID和姓名
    if (filter?.patientId || filter?.patientName || filter?.keyword) {
      const keywordConditions = [];
      const k = String(filter.keyword || filter.patientId || filter.patientName || '').replace(/'/g, "''");
      if (k) {
        keywordConditions.push("patients.patient_id LIKE '%" + k + "%'");
        keywordConditions.push("patients.patient_name LIKE '%" + k + "%'");
        where.push(`(${keywordConditions.join(' OR ')})`);
      }
    }
    
    if (filter?.start && filter?.end) where.push(`analyses.created_at BETWEEN ${Number(filter.start)} AND ${Number(filter.end)}`);
    else if (filter?.start) where.push(`analyses.created_at >= ${Number(filter.start)}`);
    else if (filter?.end) where.push(`analyses.created_at <= ${Number(filter.end)}`);
    const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const sqlRows = `SELECT analyses.id, COALESCE(patients.patient_id, 'UNKNOWN') as patient_id, COALESCE(patients.patient_name, '') as patient_name, analyses.screenshot_path, analyses.output_dir, analyses.detect_dir, analyses.yolo_summary, analyses.created_at FROM analyses LEFT JOIN patients ON patients.id = analyses.patient_ref ${wsql} ORDER BY analyses.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`;
    const resRows = db.exec(sqlRows);
    const rows = (resRows[0]?.values || []).map((v) => ({ id: v[0], patient_id: v[1], patient_name: v[2], screenshot_path: v[3], output_dir: v[4], detect_dir: v[5], yolo_summary: v[6], created_at: v[7] }));
    const sqlCount = `SELECT COUNT(*) FROM analyses LEFT JOIN patients ON patients.id = analyses.patient_ref ${wsql}`;
    const resCount = db.exec(sqlCount);
    const total = Number(resCount[0]?.values?.[0]?.[0] || 0);
    const logger = require('./logger');
    logger.info('db:listAnalyses:out', { rows: rows.length, total });
    return { rows, total };
  }

  async getAnalysis(id) {
    const db = await this.dbPromise;
    const sql = 'SELECT analyses.id, COALESCE(patients.patient_id, "UNKNOWN") as patient_id, COALESCE(patients.patient_name, "") as patient_name, analyses.screenshot_path, analyses.output_dir, analyses.detect_dir, analyses.yolo_summary, analyses.meta_json, analyses.created_at FROM analyses LEFT JOIN patients ON patients.id = analyses.patient_ref WHERE analyses.id = ?';
    const stmt = db.prepare(sql);
    const rows = [];
    stmt.bind([id]);
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    const imgs = db.exec(`SELECT id, image_path, kind, created_at FROM images WHERE analysis_ref = ${Number(id)} ORDER BY created_at ASC`);
    const images = (imgs[0]?.values || []).map((v) => ({ id: v[0], image_path: v[1], kind: v[2], created_at: v[3] }));
    const row = rows[0] || null;
    if (!row) return null;
    try {
      const dd = String(row.detect_dir || '');
      if (dd && fs.existsSync(dd)) {
        for (const fn of fs.readdirSync(dd)) {
          const lower = fn.toLowerCase();
          if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) images.push({ id: 0, image_path: path.join(dd, fn), kind: 'detect', created_at: row.created_at });
        }
      }
    } catch (_) {}
    return { ...row, images };
  }

  async deleteAnalysis(id) {
    const db = await this.dbPromise;
    db.exec(`DELETE FROM images WHERE analysis_ref = ${Number(id)}`);
    db.exec(`DELETE FROM analyses WHERE id = ${Number(id)}`);
    const data = db.export();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, Buffer.from(data));
    return true;
  }

  async searchPatients(keyword, page, pageSize) {
    const db = await this.dbPromise;
    const offset = (page - 1) * pageSize;
    const sql = `SELECT id, patient_id, patient_name, created_at FROM patients WHERE patient_id LIKE '%${String(keyword).replace(/'/g, "''")}%' OR patient_name LIKE '%${String(keyword).replace(/'/g, "''")}%' ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`;
    const res = db.exec(sql);
    const rows = (res[0]?.values || []).map((v) => ({ id: v[0], patient_id: v[1], patient_name: v[2], created_at: v[3] }));
    return rows;
  }

  async listImages(analysisId, page, pageSize) {
    const db = await this.dbPromise;
    const offset = (page - 1) * pageSize;
    const sql = `SELECT id, image_path, kind, created_at FROM images WHERE analysis_ref = ${Number(analysisId)} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`;
    const res = db.exec(sql);
    const rows = (res[0]?.values || []).map((v) => ({ id: v[0], image_path: v[1], kind: v[2], created_at: v[3] }));
    return rows;
  }

  async insertPrediction({ patientId, patientName, imagePath }) {
    const db = await this.dbPromise;
    const stmt = db.prepare('INSERT INTO predictions (patient_id, patient_name, image_path, created_at) VALUES (?, ?, ?, ?)');
    stmt.run([String(patientId || ''), String(patientName || ''), String(imagePath || ''), Date.now()]);
    stmt.free();
    const data = db.export();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, Buffer.from(data));
    const idRes = db.exec('SELECT last_insert_rowid() as id');
    const id = idRes[0]?.values[0]?.[0] || 0;
    return Number(id);
  }

  async listPredictions(page, pageSize, filter) {
    const db = await this.dbPromise;
    const offset = (page - 1) * pageSize;
    const where = [];
    if (filter?.patientId) where.push("patient_id LIKE '%" + String(filter.patientId).replace(/'/g, "''") + "%'");
    if (filter?.patientName) where.push("patient_name LIKE '%" + String(filter.patientName).replace(/'/g, "''") + "%'");
    const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const sqlRows = `SELECT id, patient_id, patient_name, image_path, created_at FROM predictions ${wsql} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`;
    const resRows = db.exec(sqlRows);
    const rows = (resRows[0]?.values || []).map((v) => ({ id: v[0], patient_id: v[1], patient_name: v[2], image_path: v[3], created_at: v[4] }));
    const sqlCount = `SELECT COUNT(*) FROM predictions ${wsql}`;
    const resCount = db.exec(sqlCount);
    const total = Number(resCount[0]?.values?.[0]?.[0] || 0);
    return { rows, total };
  }

  async deletePrediction(id) {
    const db = await this.dbPromise;
    db.exec(`DELETE FROM predictions WHERE id = ${Number(id)}`);
    const data = db.export();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, Buffer.from(data));
    return true;
  }

  async list(page, pageSize, _filter) {
    const db = await this.dbPromise;
    const offset = (page - 1) * pageSize;
    const res = db.exec(`SELECT id, screenshot_path, created_at, meta_json FROM records ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`);
    const rows = (res[0]?.values || []).map((v) => ({ id: v[0], screenshot_path: v[1], created_at: v[2], meta_json: v[3] }));
    return rows;
  }

  async get(id) {
    const db = await this.dbPromise;
    const stmt = db.prepare('SELECT * FROM records WHERE id = ?');
    const rows = [];
    stmt.bind([id]);
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows[0] || null;
  }
}

const dbInstance = new DB();
module.exports = { db: dbInstance }; 
