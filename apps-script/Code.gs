/**
 * IRR Web App — ตัวดึงข้อมูลจาก Google Sheet (แท็บ irr1) ส่งให้หน้าเว็บเป็น JSON
 *
 * วิธีติดตั้ง (ทำครั้งเดียว):
 *   1. เปิด Google Sheet ที่มีแท็บ irr1 > เมนู ส่วนขยาย (Extensions) > Apps Script
 *   2. ลบโค้ดเดิมในไฟล์ Code.gs ทั้งหมด แล้ววางโค้ดนี้แทน > กดบันทึก
 *   3. เลือกฟังก์ชัน testPayload ด้านบน > กด เรียกใช้ (Run) > อนุญาตสิทธิ์ (ครั้งแรกเท่านั้น)
 *      ดูผลใน "บันทึกการดำเนินการ" ว่าจำนวนแถวถูกต้อง และไม่มีคำเตือน
 *   4. ทำให้ใช้งานได้ (Deploy) > การทำให้ใช้งานได้รายการใหม่ (New deployment) > ประเภท: เว็บแอป
 *      - เรียกใช้ในฐานะ (Execute as): ฉัน (Me)
 *      - ผู้ที่มีสิทธิ์เข้าถึง (Who has access): ทุกคน (Anyone)
 *   5. คัดลอก URL ที่ลงท้ายด้วย /exec ไปใส่ในไฟล์ web/config.js
 *
 * แก้โค้ดนี้ภายหลัง: ต้อง Deploy > จัดการการทำให้ใช้งานได้ > แก้ไข > เวอร์ชัน: ใหม่ ทุกครั้ง
 * (แก้ข้อมูลใน Sheet ไม่ต้อง Deploy ใหม่)
 */

const SHEET_NAME = 'irr1';
const CACHE_SECONDS = 600;          // เก็บผลไว้ 10 นาที (แก้ข้อมูลใน Sheet แล้วล้างให้อัตโนมัติ)
const CACHE_PREFIX = 'irr1_v3_';       // เปลี่ยนชื่อเมื่อรูปแบบข้อมูลเปลี่ยน (ไม่ใช้แคชเก่า)
const CACHE_CHUNK = 90000;          // CacheService เก็บได้ไม่เกิน 100KB ต่อช่อง

/**
 * คอลัมน์ที่ใช้ — อ่านจากตัวอักษรคอลัมน์ในช่อง col และตรวจหัวคอลัมน์ในแถวที่ 1 ให้ด้วย
 * ถ้าหัวคอลัมน์ไม่ตรง (เช่น แทรกคอลัมน์ใหม่) จะหาคอลัมน์ที่มีหัวชื่อนั้นแทน ถ้าเจอที่เดียว
 */
const FIELDS = [
  { key: 'code',      header: 'product_code',  col: 'A',  type: 'text' },
  { key: 'name',      header: 'product_name',  col: 'B',  type: 'text' },
  { key: 'gender',    header: 'gender',        col: 'C',  type: 'text' },
  { key: 'age',       header: 'age group',     col: 'D',  type: 'text' },
  { key: 'premium',   header: 'premium',       col: 'E',  type: 'number' },
  { key: 'dividend',  header: 'dividend',      col: 'F',  type: 'text' },
  { key: 'divLow',    header: 'dividend_low',  col: 'G',  type: 'number' },
  { key: 'divMid',    header: 'dividend_mid',  col: 'H',  type: 'number' },
  { key: 'divHigh',   header: 'dividend_high', col: 'I',  type: 'number' },
  { key: 'payment',   header: 'payment',       col: 'J',  type: 'number' },
  { key: 'irr',       header: 'irr',           col: 'DX', type: 'number' },
  { key: 'irrLow',    header: 'irr_div_low',   col: 'DY', type: 'number' },
  { key: 'irrMid',    header: 'irr_div_mid',   col: 'DZ', type: 'number' },
  { key: 'irrHigh',   header: 'irr_div_high',  col: 'EA', type: 'number' },
  { key: 'extra',     header: 'extra',         col: 'EC', type: 'text' },
  { key: 'compare',   header: 'compare',       col: 'EF', type: 'text' },   // Yes = ใช้ทำรายงานเปรียบเทียบ
  { key: 'extra1',    header: 'extra_data_1',  col: 'EG', type: 'text' },   // ผลประโยชน์พิเศษ เรื่องที่ 1
  { key: 'extra2',    header: 'extra_data_2',  col: 'EH', type: 'text' },   // ผลประโยชน์พิเศษ เรื่องที่ 2
];

/**
 * กระแสเงินสดรายปี (ดึงเฉพาะแถวที่เลือกตอนกดพิมพ์ ไม่ส่งทุกแถวตอนเปิดแอป)
 * IRR ไม่มีปันผล = T–AS · ปันผลสถานการณ์ 1 = AU–BT · 2 = BV–CU · 3 = CW–DV
 */
const CASHFLOW_SETS = [['base', 'T'], ['div1', 'AU'], ['div2', 'BV'], ['div3', 'CW']];
const CASHFLOW_YEARS = 26;

/** คอลัมน์ตรวจสอบ: แถวที่คอลัมน์ EE = Yes เท่านั้นที่นำไปใช้ในแอป (No หรือว่าง = ไม่ใช้) */
const USE_COLUMN = 'EE';

/**
 * หน้าเว็บเรียก URL นี้ (GET) ได้ JSON กลับไป — ใส่ ?nocache=1 เพื่อบังคับอ่าน Sheet ใหม่
 * ?row=<เลขแถว>&code=<product_code> = กระแสเงินสดของแถวนั้น
 */
function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.row) {
    let out;
    try { out = cashflow_(Number(params.row), params.code || ''); }
    catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
    return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
  }
  let json = params.nocache ? null : readCache_();
  if (!json) {
    try {
      json = JSON.stringify(buildPayload_());
      writeCache_(json);
    } catch (err) {
      json = JSON.stringify({ ok: false, error: String(err && err.message || err) });
    }
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/** แก้ข้อมูลใน Sheet เมื่อไร ล้างแคชทันที หน้าเว็บจะเห็นค่าใหม่ในการเปิดครั้งถัดไป */
function onEdit() {
  clearCache_();
}

/** กด Run ฟังก์ชันนี้ในหน้า Apps Script เพื่อตรวจข้อมูลก่อน Deploy */
function testPayload() {
  const p = buildPayload_();
  if (p.rows.length) Logger.log('กระแสเงินสดแถวแรก: ' + JSON.stringify(cashflow_(p.rows[0][15], p.rows[0][0])));
  Logger.log('จำนวนแถวข้อมูล: ' + p.rows.length);
  Logger.log('คอลัมน์ที่ใช้: ' + JSON.stringify(p.columnsUsed));
  Logger.log('แถวแรก: ' + JSON.stringify(p.rows[0]));
  Logger.log('ขนาดข้อมูล: ' + Math.round(JSON.stringify(p).length / 1024) + ' KB');
  if (p.warnings.length) Logger.log('⚠️ คำเตือน:\n' + p.warnings.join('\n'));
  else Logger.log('✅ ไม่มีคำเตือน');
}

function buildPayload_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('ไม่พบแท็บชื่อ "' + SHEET_NAME + '"');

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const warnings = [];
  const headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0]
    .map(function (h) { return String(h).trim().toLowerCase(); });

  // หาเลขคอลัมน์ของแต่ละช่อง
  const columnsUsed = {};
  const colIndex = {};
  FIELDS.forEach(function (f) {
    let idx = letterToColumn_(f.col);
    if (headers[idx - 1] !== f.header) {
      const found = [];
      headers.forEach(function (h, i) { if (h === f.header) found.push(i + 1); });
      if (found.length === 1) {
        idx = found[0];
      } else {
        warnings.push('คอลัมน์ ' + f.col + ' ไม่ใช่หัว "' + f.header + '"' +
          (found.length ? ' (พบหัวนี้หลายคอลัมน์)' : '') + ' — ยังใช้คอลัมน์ ' + f.col);
      }
    }
    colIndex[f.key] = idx;
    columnsUsed[f.key] = columnToLetter_(idx);
  });

  const n = lastRow - 1;
  if (n < 1) return { ok: true, updated: new Date().toISOString(), rows: [], columnsUsed: columnsUsed, warnings: warnings };

  // อ่านทีละคอลัมน์ (เร็วกว่าอ่านทั้งตารางกว้างถึง EC)
  const data = {};
  FIELDS.forEach(function (f) {
    const c = colIndex[f.key];
    if (c > lastCol) { data[f.key] = null; return; }
    const range = sh.getRange(2, c, n, 1);
    // ข้อความใช้ค่าที่แสดง (กัน "0 - 75" ถูกแปลงเป็นวันที่) ตัวเลขใช้ค่าจริง
    data[f.key] = f.type === 'text' ? range.getDisplayValues() : range.getValues();
  });

  const useCol = letterToColumn_(USE_COLUMN);
  const use = useCol <= lastCol ? sh.getRange(2, useCol, n, 1).getDisplayValues() : [];
  let skipped = 0;

  const rows = [];
  for (let i = 0; i < n; i++) {
    const get = function (k) { return data[k] ? data[k][i][0] : ''; };
    const code = String(get('code')).trim();
    if (!code) continue;
    if (!/^yes$/i.test(String(use[i] ? use[i][0] : '').trim())) { skipped++; continue; }
    const row = [
      code,
      String(get('name')).trim(),
      String(get('gender')).trim(),
      String(get('age')).trim(),
      num_(get('premium')),
      /^y(es)?$/i.test(String(get('dividend')).trim()) ? 1 : 0,
      num_(get('divLow')),
      num_(get('divMid')),
      num_(get('divHigh')),
      num_(get('payment')),
      rate_(get('irr')),
      rate_(get('irrLow')),
      rate_(get('irrMid')),
      rate_(get('irrHigh')),
      String(get('extra')).trim(),
      i + 2,                      // เลขแถวใน Sheet (ใช้ดึงกระแสเงินสดตอนพิมพ์)
      /^yes$/i.test(String(get('compare')).trim()) ? 1 : 0,
      String(get('extra1')).trim(),
      String(get('extra2')).trim(),
    ];
    if (row[4] === null) warnings.push('แถว ' + (i + 2) + ': เบี้ยประกัน (premium) ไม่ใช่ตัวเลข');
    if (row[10] === null) warnings.push('แถว ' + (i + 2) + ': IRR ว่างหรือไม่ใช่ตัวเลข');
    rows.push(row);
  }

  if (skipped) warnings.unshift('ข้ามแถวที่คอลัมน์ ' + USE_COLUMN + ' ไม่ใช่ Yes จำนวน ' + skipped + ' แถว');

  return {
    ok: true,
    updated: new Date().toISOString(),
    // ลำดับข้อมูลในแต่ละแถวของ rows
    fields: ['code', 'name', 'gender', 'age', 'premium', 'dividend', 'divLow', 'divMid', 'divHigh',
             'payment', 'irr', 'irrLow', 'irrMid', 'irrHigh', 'extra', 'row', 'compare', 'extra1', 'extra2'],
    rows: rows,
    columnsUsed: columnsUsed,
    warnings: warnings.slice(0, 50),
  };
}

function cashflow_(row, code) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('ไม่พบแท็บชื่อ "' + SHEET_NAME + '"');
  if (!(row >= 2) || row > sh.getLastRow()) throw new Error('ไม่พบแถวที่ ' + row);
  // กันกรณี Sheet ถูกแก้ระหว่างใช้งาน แถวเลื่อนไปเป็นแบบอื่น
  const actual = String(sh.getRange(row, 1).getDisplayValue()).trim();
  if (code && actual !== code) throw new Error('ข้อมูลใน Sheet เปลี่ยนแล้ว กรุณาเปิดแอปใหม่');
  const out = { ok: true, row: row, code: actual };
  CASHFLOW_SETS.forEach(function (set) {
    const col = letterToColumn_(set[1]);
    // ช่องว่าง = ไม่มีข้อมูลปีนั้น (null) หน้าเว็บจะแสดงเฉพาะช่องที่มีตัวเลข
    out[set[0]] = sh.getRange(row, col, 1, CASHFLOW_YEARS).getValues()[0].map(num_);
    if (set[0] === 'base') out.headers = sh.getRange(1, col, 1, CASHFLOW_YEARS).getDisplayValues()[0];
  });
  return out;
}

/** ตัวเลขทั่วไป: รับทั้งตัวเลขจริงและข้อความอย่าง "1,000,000" */
function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).replace(/[,\s฿บาท]/g, '');
  if (!s) return null;
  const x = Number(s.replace('%', ''));
  return isFinite(x) ? x : null;
}

/** อัตรา (IRR): เก็บเป็นทศนิยม เช่น 0.0151 = 1.51% — รับข้อความ "1.51%" ได้ด้วย ช่องที่ error (#NUM!) = null */
function rate_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).replace(/[,\s]/g, '');
  if (!s || s.charAt(0) === '#') return null;
  const x = Number(s.replace('%', ''));
  if (!isFinite(x)) return null;
  return s.indexOf('%') >= 0 ? x / 100 : x;
}

function letterToColumn_(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
}

function columnToLetter_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function readCache_() {
  const cache = CacheService.getScriptCache();
  const count = Number(cache.get(CACHE_PREFIX + 'n'));
  if (!count) return null;
  const keys = [];
  for (let i = 0; i < count; i++) keys.push(CACHE_PREFIX + i);
  const parts = cache.getAll(keys);
  let out = '';
  for (let i = 0; i < count; i++) {
    const p = parts[CACHE_PREFIX + i];
    if (p == null) return null;
    out += p;
  }
  return out;
}

function writeCache_(json) {
  try {
    const cache = CacheService.getScriptCache();
    const map = {};
    let count = 0;
    for (let i = 0; i < json.length; i += CACHE_CHUNK) map[CACHE_PREFIX + (count++)] = json.slice(i, i + CACHE_CHUNK);
    map[CACHE_PREFIX + 'n'] = String(count);
    cache.putAll(map, CACHE_SECONDS);
  } catch (err) {
    // ข้อมูลใหญ่เกินแคช ไม่เป็นไร อ่านจาก Sheet ตรงทุกครั้งแทน
  }
}

function clearCache_() {
  CacheService.getScriptCache().remove(CACHE_PREFIX + 'n');
}
