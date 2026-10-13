/* IRR Web App — ดึงข้อมูลจาก Apps Script แล้วค้นหาแถวที่ตรงเงื่อนไข */
(function () {
  "use strict";

  const CFG = window.IRR_CONFIG || {};
  const API = (CFG.apiUrl || "").trim();
  const STORE_KEY = "irr-data-v1";
  const TAX_CAP = 100000;       // เบี้ยประกันชีวิตลดหย่อนภาษีได้สูงสุด 100,000 บาท/ปี
  const SPLASH_MIN = 2900;      // ความยาวอนิเมชันโลโก้ (มิลลิวินาที)
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const $ = (id) => document.getElementById(id);
  const el = {
    splash: $("splash"), splashLoad: $("splashLoad"), form: $("form"),
    product: $("product"), gender: $("gender"), age: $("age"), premium: $("premium"), tax: $("tax"),
    calc: $("calc"), result: $("result"), err: $("loadErr"), badge: $("mockBadge"), foot: $("foot"),
  };

  let rows = [];

  /* ─── รูปแบบตัวเลข ─── */
  const fmtNum = (n) => Math.round(n).toLocaleString("th-TH");
  const fmtPct = (r) => (r * 100).toFixed(2);
  const GENDER_TH = { male: "ชาย", m: "ชาย", female: "หญิง", f: "หญิง" };
  const genderLabel = (g) => GENDER_TH[String(g).toLowerCase()] || g;
  const ageStart = (a) => { const m = String(a).match(/\d+/); return m ? Number(m[0]) : 0; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ─── แปลงข้อมูลจาก Apps Script (array ต่อแถว) เป็น object ─── */
  function normalize(payload) {
    if (!payload || payload.ok === false || !Array.isArray(payload.rows)) {
      throw new Error((payload && payload.error) || "รูปแบบข้อมูลไม่ถูกต้อง");
    }
    const f = payload.fields;
    return payload.rows.map((r) => {
      const o = {};
      f.forEach((k, i) => { o[k] = r[i]; });
      o.code = String(o.code);
      o.gender = String(o.gender || "");
      o.age = String(o.age || "");
      return o;
    })
      // ข้ามแถวที่ยังกรอกไม่ครบ (เช่น มีแค่ product_code) ไม่ให้เกิดตัวเลือกว่าง
      .filter((o) => o.gender && o.age && o.premium != null);
  }

  /* ─── โหลดข้อมูล: ใช้ข้อมูลที่จำไว้ในเครื่องก่อน (เปิดเร็ว) แล้วโหลดใหม่เบื้องหลัง ─── */
  function readStored() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { return null; }
  }
  function store(payload) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(payload)); } catch (e) { /* เต็ม/โหมดส่วนตัว */ }
  }
  async function fetchRemote(nocache) {
    const url = API + (API.includes("?") ? "&" : "?") + (nocache ? "nocache=1&" : "") + "t=" + Date.now();
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error("เซิร์ฟเวอร์ตอบกลับ " + res.status);
    return res.json();
  }

  async function load() {
    if (!API) {
      el.badge.hidden = false;
      return window.IRR_MOCK;
    }
    const cached = readStored();
    if (cached && cached.ok) {
      // มีข้อมูลเดิม แสดงก่อน แล้วอัปเดตเงียบๆ
      fetchRemote().then((fresh) => {
        if (fresh && fresh.ok) { store(fresh); if (fresh.updated !== cached.updated) applyData(fresh, true); }
      }).catch(() => {});
      return cached;
    }
    const fresh = await fetchRemote();
    store(fresh);
    return fresh;
  }

  /* ─── ตัวเลือกแบบลำดับขั้น ─── */
  function setOptions(select, items, placeholder) {
    select.innerHTML = "";
    const ph = new Option(placeholder, "");
    select.add(ph);
    items.forEach((it) => select.add(new Option(it.label, it.value)));
    select.disabled = items.length === 0;
    // มีตัวเลือกเดียว เลือกให้เลย ลดจำนวนครั้งที่ต้องแตะ
    if (items.length === 1) select.value = items[0].value;
    markFilled(select);
  }
  function lockOptions(select, text) {
    select.innerHTML = "";
    select.add(new Option(text, ""));
    select.disabled = true;
    markFilled(select);
  }
  function markFilled(select) { select.classList.toggle("filled", !!select.value); }

  const uniq = (arr, key) => {
    const seen = new Set(); const out = [];
    arr.forEach((r) => { const k = key(r); if (!seen.has(k)) { seen.add(k); out.push(r); } });
    return out;
  };

  const byProduct = () => rows.filter((r) => r.code === el.product.value);
  const byGender = () => byProduct().filter((r) => r.gender === el.gender.value);
  const byAge = () => byGender().filter((r) => r.age === el.age.value);

  function fillProducts(keep) {
    const items = uniq(rows, (r) => r.code).map((r) => ({ value: r.code, label: r.name || r.code }));
    const prev = keep && el.product.value;
    setOptions(el.product, items, "เลือกแบบประกัน");
    if (prev && items.some((i) => i.value === prev)) el.product.value = prev;
    markFilled(el.product);
    onProduct(keep);
  }
  function onProduct(keep) {
    const prev = keep && el.gender.value;
    if (!el.product.value) { lockOptions(el.gender, "เลือกแบบประกันก่อน"); return onGender(); }
    const items = uniq(byProduct(), (r) => r.gender).map((r) => ({ value: r.gender, label: genderLabel(r.gender) }));
    setOptions(el.gender, items, "เลือกเพศ");
    if (prev && items.some((i) => i.value === prev)) { el.gender.value = prev; markFilled(el.gender); }
    onGender(keep);
  }
  function onGender(keep) {
    const prev = keep && el.age.value;
    if (!el.gender.value) { lockOptions(el.age, "เลือกเพศก่อน"); return onAge(); }
    const items = uniq(byGender(), (r) => r.age)
      .sort((a, b) => ageStart(a.age) - ageStart(b.age))
      .map((r) => ({ value: r.age, label: r.age.replace(/\s*-\s*/, " – ") + " ปี" }));
    setOptions(el.age, items, "เลือกช่วงอายุ");
    if (prev && items.some((i) => i.value === prev)) { el.age.value = prev; markFilled(el.age); }
    onAge(keep);
  }
  function onAge(keep) {
    const prev = keep && el.premium.value;
    if (!el.age.value) { lockOptions(el.premium, "เลือกอายุก่อน"); return update(); }
    const items = uniq(byAge().filter((r) => r.premium != null), (r) => r.premium)
      .sort((a, b) => a.premium - b.premium)
      .map((r) => ({ value: String(r.premium), label: fmtNum(r.premium) + " บาท" }));
    setOptions(el.premium, items, "เลือกเบี้ยประกัน");
    if (prev && items.some((i) => i.value === prev)) { el.premium.value = prev; markFilled(el.premium); }
    update();
  }
  function update() {
    [el.product, el.gender, el.age, el.premium, el.tax].forEach(markFilled);
    el.calc.disabled = !(el.product.value && el.gender.value && el.age.value && el.premium.value && el.tax.value !== "");
  }
  function clearResult() { el.result.hidden = true; el.result.classList.remove("show"); }

  /* ─── คำนวณ/แสดงผล ─── */
  function findRow() {
    const p = Number(el.premium.value);
    return byAge().find((r) => r.premium === p);
  }

  function render() {
    const row = findRow();
    if (!row) return;
    const taxRate = Number(el.tax.value);
    const premium = row.premium;
    const parts = [];

    parts.push(
      '<ul class="res-sum">' +
        "<li>" + esc(row.name || row.code) + "</li>" +
        "<li>" + esc(genderLabel(row.gender)) + "</li>" +
        "<li>อายุ " + esc(row.age.replace(/\s*-\s*/, " – ")) + " ปี</li>" +
        "<li>เบี้ย " + fmtNum(premium) + " บาท</li>" +
        "<li>ฐานภาษี " + taxRate + "%</li>" +
      "</ul>"
    );

    parts.push('<p class="res-label">' + (row.dividend ? "IRR (ไม่รวมเงินปันผล)" : "ผลตอบแทน IRR") + "</p>");
    parts.push(row.irr == null
      ? '<p class="res-irr na">ไม่มีข้อมูล IRR</p>'
      : '<p class="res-irr">' + fmtPct(row.irr) + "<small>%</small></p>");

    if (taxRate > 0) {
      const perYear = Math.min(premium, TAX_CAP) * taxRate / 100;
      const years = Number(row.payment) || 0;
      parts.push(
        '<p class="res-tax">ใช้สิทธิ์ลดหย่อนภาษีได้ประโยชน์ ประหยัดภาษีปีละ <strong>' + fmtNum(perYear) +
        "</strong> บาท ในปีที่ชำระเบี้ยประกัน รวมประโยชน์ทางภาษีตลอดสัญญา <strong>" + fmtNum(perYear * years) + "</strong> บาท</p>"
      );
    }

    if (row.dividend) {
      const sc = [[row.divLow, row.irrLow], [row.divMid, row.irrMid], [row.divHigh, row.irrHigh]];
      parts.push(
        '<ul class="res-div">' +
        sc.map(([d, r], i) =>
          '<li data-n="' + (i + 1) + '">กรณีได้รับเงินปันผลจากการลงทุนสถานการณ์ที่ ' + (i + 1) +
          " เท่ากับ <strong>" + (d == null ? "-" : fmtNum(d)) + "</strong> บาท " +
          '<span class="irr-chip">IRR = ' + (r == null ? "-" : fmtPct(r) + "%") + "</span></li>"
        ).join("") +
        "</ul>"
      );
      parts.push('<p class="res-note">เงินปันผลเป็นผลประโยชน์ที่ไม่รับรองการจ่าย ขึ้นอยู่กับผลตอบแทนการลงทุนจริงของบริษัท</p>');
    }

    if (row.extra) parts.push('<p class="res-extra">' + esc(row.extra) + "</p>");

    el.result.innerHTML = parts.join("");
    el.result.hidden = false;
    el.result.classList.remove("show");
    void el.result.offsetWidth; // เล่นอนิเมชันใหม่ทุกครั้งที่กด
    el.result.classList.add("show");
    requestAnimationFrame(() => el.result.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }));
  }

  function applyData(payload, keep) {
    rows = normalize(payload);
    fillProducts(keep);
    if (keep && !el.result.hidden) { if (findRow()) render(); else clearResult(); }
    const d = payload.updated ? new Date(payload.updated) : null;
    el.foot.textContent = "ข้อมูลอัปเดต " + (d && !isNaN(d) ? d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "-") +
      " · ผลตอบแทนเป็นการประมาณการเพื่อประกอบการพิจารณาเท่านั้น";
  }

  function showError(msg) {
    el.err.hidden = false;
    el.err.innerHTML = "โหลดข้อมูลไม่สำเร็จ: " + esc(msg) + ' <button type="button" id="retry">ลองใหม่</button>';
    $("retry").onclick = () => {
      el.err.hidden = true;
      fetchRemote(true).then((p) => { store(p); applyData(p); }).catch((e) => showError(e.message));
    };
    lockOptions(el.product, "โหลดข้อมูลไม่สำเร็จ");
  }

  /* ─── เหตุการณ์ ─── */
  el.product.addEventListener("change", () => { clearResult(); onProduct(); });
  el.gender.addEventListener("change", () => { clearResult(); onGender(); });
  el.age.addEventListener("change", () => { clearResult(); onAge(); });
  el.premium.addEventListener("change", () => { clearResult(); update(); });
  el.tax.addEventListener("change", () => { update(); if (!el.result.hidden) render(); });
  el.form.addEventListener("submit", (e) => { e.preventDefault(); if (!el.calc.disabled) render(); });

  /* ─── เริ่มทำงาน: อนิเมชันโลโก้ + โหลดข้อมูลไปพร้อมกัน ─── */
  const splashStart = performance.now();
  let splashDone = false;
  function endSplash() {
    if (splashDone) return;
    splashDone = true;
    el.splash.classList.add("out");
    document.body.classList.add("ready");
    setTimeout(() => el.splash.remove(), 900);
  }
  el.splash.addEventListener("click", () => { if (rows.length || !el.err.hidden) endSplash(); });
  const loadingHint = setTimeout(() => el.splashLoad.classList.add("on"), SPLASH_MIN);

  load()
    .then((payload) => applyData(payload))
    .catch((e) => showError(e.message || String(e)))
    .finally(() => {
      clearTimeout(loadingHint);
      const wait = Math.max(0, (reduceMotion ? 600 : SPLASH_MIN) - (performance.now() - splashStart));
      setTimeout(endSplash, wait);
    });
})();
