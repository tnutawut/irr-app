/* IRR Web App — "One Page" สรุปแบบประกัน A4 สำหรับนำเสนอ / พิมพ์ / บันทึก PDF
   app.js เรียก IRRPrint.open({ api, row, taxRate }) หลังแสดงผล IRR แล้ว */
(function () {
  "use strict";

  const TAX_CAP = 100000;
  const C = { base: "#00346A", lo: "#A9C222", mid: "#728C0A", hi: "#475800" };
  const LIB = {
    canvas: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
    pdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  };
  const cache = {};
  let current = null;      // { row, cf, taxRate, html, pdf: Promise<Blob> }

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n) => Math.round(n).toLocaleString("th-TH");
  const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + num(Math.abs(n));
  const pct = (r) => (r == null ? "-" : (r * 100).toFixed(2) + "%");
  const genderTh = (g) => ({ male: "ชาย", m: "ชาย", female: "หญิง", f: "หญิง" }[String(g).toLowerCase()] || g);
  const ageTxt = (a) => String(a).replace(/\s*-\s*/, "–");

  /* ─── ดึงกระแสเงินสดของแถวที่เลือก ─── */
  async function fetchCashflow(api, row) {
    const key = row.row + "|" + row.code;
    if (cache[key]) return cache[key];
    const url = api + (api.includes("?") ? "&" : "?") + "row=" + row.row + "&code=" + encodeURIComponent(row.code) + "&t=" + Date.now();
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error("เซิร์ฟเวอร์ตอบกลับ " + res.status);
    const data = await res.json();
    if (!data || !data.ok) throw new Error((data && data.error) || "ไม่พบข้อมูลกระแสเงินสด");
    if (!Array.isArray(data.base)) throw new Error("Apps Script ยังเป็นเวอร์ชันเก่า (ยังไม่มีข้อมูลกระแสเงินสด)");
    return (cache[key] = data);
  }

  /* เก็บเฉพาะปีที่มีตัวเลข (ช่องว่างใน Sheet = ไม่มีปีนั้น) */
  function years(cf) {
    const out = [];
    cf.base.forEach((v, i) => {
      if (v == null) return;
      // หัวคอลัมน์ใน Sheet เช่น "ปีที่ 3" → แสดงเลข 3 (ไม่มีหัว = ลำดับคอลัมน์)
      const m = String((cf.headers && cf.headers[i]) || "").match(/\d+/);
      out.push({ i, label: m ? m[0] : String(i), v });
    });
    return out;
  }

  /* ─── บันไดกระแสเงินสด: รวมปีติดกันที่ยอดเท่ากันเป็นขั้นเดียว ไต่ขึ้นตามปี ─── */
  function staircase(ys, dividend) {
    const groups = [];
    ys.forEach((y, k) => {
      const g = groups[groups.length - 1];
      const isLast = k === ys.length - 1;
      if (g && !g.last && !isLast && Math.round(g.v) === Math.round(y.v)) { g.to = y.label; g.n++; }
      else groups.push({ from: y.label, to: y.label, v: y.v, n: 1, last: isLast });
    });

    const n = groups.length;
    const W = 678, H = dividend ? (ys.length > 18 ? 214 : 236) : 292;
    const weights = groups.map((g) => (g.last ? 1.55 : 1));
    const unit = W / weights.reduce((a, b) => a + b, 0);
    const dLast = Math.min(dividend ? 108 : 132, unit * 1.55 - 10);
    const d = Math.max(54, Math.min(dividend ? 72 : 88, unit - 12));
    // ป้ายปีอยู่แถบล่าง · ขั้นบันไดสูงขึ้นตามปี · วงกลมเกาะบนยอดขั้น
    const strip = 20;
    const liftMin = d * 0.5 + 6, liftMax = H - strip - dLast * 0.55 - (dividend ? 18 : 6);
    const step = n > 1 ? (liftMax - liftMin) / (n - 1) : 0;

    let x = 0, html = "";
    groups.forEach((g, k) => {
      const w = unit * weights[k];
      const lift = liftMin + k * step;                          // ความสูงของขั้น
      const size = g.last ? dLast : d;
      const pos = g.v >= 0;
      const fs = g.last ? Math.min(22, size * 0.17) : Math.min(15, size * 0.19);
      const yrs = g.n > 1 ? `ปีที่ ${g.from}–${g.to}` : `ปีที่ ${g.from}`;
      const sub = g.last ? "เงินครบกำหนด" : g.n > 1 ? "ต่อปี" : pos ? "รับคืน" : "ชำระเบี้ย";
      html += `
      <div class="st-col${g.last ? " last" : ""}" style="left:${x}px;width:${w}px">
        <div class="st-step" style="height:${lift}px;bottom:${strip}px"></div>
        <div class="st-yr">${yrs}</div>
        <div class="st-dot ${pos ? "pos" : "neg"}" style="width:${size}px;height:${size}px;bottom:${strip + lift - size * 0.45}px">
          <b style="font-size:${fs}px">${signed(g.v)}</b><i>${sub}</i>
        </div>
        ${g.last && dividend ? `<div class="st-plus" style="bottom:${strip + lift + size * 0.55 + 4}px">(และโอกาสรับเงินปันผล)</div>` : ""}
      </div>`;
      x += w;
    });
    return `<div class="st" style="height:${H}px">${html}</div>`;
  }

  /* ─── สร้าง One Page ─── */
  function build(row, cf, taxRate) {
    const ys = years(cf);
    const net = ys.reduce((a, y) => a + y.v, 0);
    const paid = (Number(row.premium) || 0) * (Number(row.payment) || 0);
    const received = net + paid;
    const gainPct = paid ? (net / paid) * 100 : 0;
    const taxYear = taxRate > 0 ? Math.min(row.premium, TAX_CAP) * taxRate / 100 : 0;
    const taxTotal = taxYear * (Number(row.payment) || 0);
    const sumOf = (arr) => (arr || []).reduce((a, v) => a + (v == null ? 0 : v), 0);
    const last = ys[ys.length - 1];

    let cum = 0;
    const cums = ys.map((y) => (cum += y.v));
    const be = cums.findIndex((c, k) => k > 0 && c >= 0 && cums.slice(0, k).some((p) => p < 0));

    const chips = [
      genderTh(row.gender), "อายุ " + ageTxt(row.age) + " ปี", "เบี้ย " + num(row.premium) + " บาท/ปี",
      "ชำระเบี้ย " + row.payment + " ปี", "ฐานภาษี " + taxRate + "%",
    ];
    const hiReceived = row.dividend ? sumOf(cf.div3) + paid : 0;

    let h = `
<svg class="ps-deco" viewBox="0 0 794 1123" preserveAspectRatio="none" aria-hidden="true">
  <path d="M520 92 C 620 88, 680 70, 725 40 S 775 5, 800 -10" stroke="#BED62F" stroke-width="2" opacity=".75"/>
  <path d="M560 104 C 650 100, 705 84, 745 58 S 785 30, 800 22" stroke="#00AEEF" stroke-width="1.5" opacity=".35"/>
</svg>
<header class="ps-hd">
  <div>
    <div class="ps-eb">One Page · สรุปผลประโยชน์</div>
    <h1>${esc(row.name || row.code)}</h1>
    <p class="ps-tag">ชำระเบี้ยเพียง <b>${row.payment} ปี</b> รับเงินคืนรวม <b class="g">${num(received)} บาท</b>${row.dividend ? " และโอกาสรับเงินปันผลเพิ่ม" : ""}</p>
    <div class="ps-chips">${chips.map((c) => `<span>${esc(c)}</span>`).join("")}</div>
  </div>
  <img src="assets/logo/logo-full.png" alt="Nutawut Tamapon" class="ps-logo">
</header>

<section class="ps-hero">
  <div class="ps-irr">
    <div class="l">ผลตอบแทน IRR${row.dividend ? " (ไม่รวมปันผล)" : ""}</div>
    <div class="v">${(row.irr * 100).toFixed(2)}<small>%</small></div>
    <div class="n">${row.dividend && row.irrHigh != null ? `สูงสุด <b>${pct(row.irrHigh)}</b> กรณีปันผลสูง` : "ต่อปี ตลอดสัญญา"}</div>
  </div>
  <div class="ps-flow">
    <div><div class="l">จ่ายเบี้ยรวม</div><div class="v neg">${num(paid)}</div><div class="n">${num(row.premium)} × ${row.payment} ปี</div></div>
    <div class="arrow" aria-hidden="true"><svg viewBox="0 0 40 20"><path d="M2 10h32M26 3l8 7-8 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <div><div class="l">รับคืนรวม</div><div class="v pos">${num(received)}</div><div class="n">${row.dividend ? "ไม่รวมเงินปันผล" : "ตลอดสัญญา"}</div></div>
    <div class="gain">กำไร ${signed(net)} บาท <span>(${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(1)}% ของเบี้ยรวม)</span></div>
  </div>
  <div class="ps-side">
    ${taxRate > 0 ? `<div class="l">ประหยัดภาษีรวม</div><div class="v">${num(taxTotal)}<small> บาท</small></div><div class="n">ปีละ ${num(taxYear)} บาท × ${row.payment} ปี</div>` : ""}
    ${be > 0 ? `<div class="be${taxRate > 0 ? " sm" : ""}"><span>คืนทุน</span> ปีที่ ${esc(ys[be].label)}</div>` : ""}
    ${row.dividend && hiReceived ? `<div class="n">กรณีปันผลสูง รับรวม <b>${num(hiReceived)}</b> บาท</div>` : ""}
  </div>
</section>

<section class="ps-card">
  <div class="ps-ch"><h2>เส้นทางเงินของคุณ ปีต่อปี</h2>
    <div class="ps-lg"><span><i class="neg"></i>ชำระเบี้ย</span><span><i class="pos"></i>รับเงินคืน</span></div></div>
  ${staircase(ys, row.dividend)}
</section>`;

    if (row.dividend) {
      const sc = [
        ["ไม่มีเงินปันผล", row.irr, null, cf.base, C.base],
        ["ปันผลกรณีต่ำ", row.irrLow, row.divLow, cf.div1, C.lo],
        ["ปันผลกรณีกลาง", row.irrMid, row.divMid, cf.div2, C.mid],
        ["ปันผลกรณีสูง", row.irrHigh, row.divHigh, cf.div3, C.hi],
      ];
      const maxIrr = Math.max(...sc.map((x) => x[1] || 0)) || 1;
      h += `
<section class="ps-card">
  <div class="ps-ch"><h2>โอกาสรับผลตอบแทนเพิ่มจากเงินปันผล</h2><p>เงินปันผลเป็นผลประโยชน์ที่ไม่รับรองการจ่าย</p></div>
  <div class="ps-sc">${sc.map(([t, irr, dv, arr, col]) => `
    <div class="ps-s">
      <div class="t"><i style="background:${col}"></i>${t}</div>
      <div class="v">${pct(irr)}</div>
      <div class="bar"><b style="width:${((irr || 0) / maxIrr) * 100}%;background:${col}"></b></div>
      <div class="n">${dv == null ? "&nbsp;" : "เงินปันผล <b>" + num(dv) + "</b> บาท"}</div>
      <div class="n">รับคืนรวม <b>${num(sumOf(arr) + paid)}</b> บาท</div>
    </div>`).join("")}
  </div>
</section>`;
    }

    // ตารางรายปี แบ่ง 2 ฝั่ง: ลบ = น้ำเงินเข้ม · บวก = เขียว · ยอดสะสม = ดำ · เงินครบกำหนด = เขียวตัวหนา
    const half = Math.ceil(ys.length / 2);
    const tbl = (part, offset) => `<table class="ps-tb"><thead><tr><th>ปีที่</th><th>กระแสเงินสด</th><th>ยอดสะสม</th></tr></thead><tbody>${
      part.map((yr, k) => {
        const isLast = offset + k === ys.length - 1;
        return `<tr${isLast ? ' class="mat"' : ""}><td>${esc(yr.label)}</td><td class="${yr.v < 0 ? "neg" : "pos"}">${signed(yr.v)}</td><td class="cum">${num(cums[offset + k])}</td></tr>`;
      }).join("")}</tbody></table>`;
    h += `
<section class="ps-card">
  <div class="ps-ch"><h2>ตารางกระแสเงินสด${row.dividend ? " <span>(กรณีไม่มีเงินปันผล)</span>" : ""}</h2><p>หน่วย: บาท · <b class="neg">−</b> ชำระเบี้ย · <b class="pos">+</b> รับเงินคืน · ปีที่ ${esc(last.label)} = เงินครบกำหนด</p></div>
  <div class="ps-tbs${ys.length > 18 ? " dense" : ""}">${tbl(ys.slice(0, half), 0)}${tbl(ys.slice(half), half)}</div>
</section>`;

    if (taxRate > 0) {
      h += `<div class="ps-tax">ใช้สิทธิ์ลดหย่อนภาษีได้ประโยชน์ ประหยัดภาษีปีละ <b>${num(taxYear)}</b> บาท ในปีที่ชำระเบี้ยประกัน รวมประโยชน์ทางภาษีตลอดสัญญา <b>${num(taxTotal)}</b> บาท</div>`;
    }

    const perks = [row.extra1, row.extra2].filter((t) => t);
    if (perks.length) h += `<div class="ps-perk">${perks.map((t) => `<p>${esc(t)}</p>`).join("")}</div>`;

    const today = new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });
    h += `
<footer class="ps-ft">
  <p>${row.dividend ? "เงินปันผลเป็นผลประโยชน์ที่ไม่รับรองการจ่าย ขึ้นอยู่กับผลตอบแทนการลงทุนจริงของบริษัท<br>" : ""}${row.extra ? esc(row.extra) + "<br>" : ""}ผลตอบแทนเป็นการประมาณการเพื่อประกอบการพิจารณาเท่านั้น โปรดศึกษาเอกสารเสนอขายก่อนตัดสินใจ</p>
  <p class="r">จัดทำวันที่ ${today}<br>Nutawut Tamapon</p>
</footer>`;
    return h;
  }

  /* ─── บันทึก PDF (สร้างไฟล์ A4 เอง ใช้ได้เหมือนกันทุกเครื่อง: iPhone / iPad / Windows / Mac) ─── */
  const loaded = {};
  function loadScript(src) {
    return (loaded[src] = loaded[src] || new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("โหลดตัวสร้าง PDF ไม่สำเร็จ (ตรวจสอบอินเทอร์เน็ต)"));
      document.head.appendChild(s);
    }));
  }
  async function makePdf(html) {
    await Promise.all([loadScript(LIB.canvas), loadScript(LIB.pdf)]);
    await document.fonts.ready;
    // วาดจากสำเนาขนาดจริง (ไม่ย่อ) ที่ซ่อนไว้นอกจอ
    const box = document.createElement("div");
    box.style.cssText = "position:absolute;left:-10000px;top:0;width:794px;height:1123px;overflow:hidden";
    box.innerHTML = `<article class="ps ps--pdf">${html}</article>`;
    document.body.appendChild(box);
    try {
      await Promise.all([...box.querySelectorAll("img")].map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
      const canvas = await window.html2canvas(box.firstElementChild, { scale: 2.5, backgroundColor: "#ffffff", useCORS: true, logging: false, width: 794, height: 1123, windowWidth: 1200 });
      const pdf = new window.jspdf.jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297);
      return pdf.output("blob");
    } finally {
      box.remove();
    }
  }
  function fileName(row) {
    const clean = (s) => String(s).replace(/[^\w฀-๿.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    return `OnePage-${clean(row.name || row.code)}-${clean(genderTh(row.gender))}-${row.premium}.pdf`;
  }
  async function savePdf() {
    const btn = $("psPdf");
    const label = btn.firstChild.textContent;
    btn.disabled = true;
    btn.firstChild.textContent = "กำลังสร้าง PDF…";
    try {
      const blob = await current.pdf;
      const name = fileName(current.row);
      const file = new File([blob], name, { type: "application/pdf" });
      // iPhone / iPad: เปิดเมนูแชร์ (บันทึกลงไฟล์ / ส่ง LINE / พิมพ์)
      if (navigator.maxTouchPoints > 0 && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); return; }
        catch (e) { if (e && e.name === "AbortError") return; }
      }
      // คอมพิวเตอร์: ดาวน์โหลดไฟล์
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      alert(e.message || "สร้าง PDF ไม่สำเร็จ");
    } finally {
      btn.disabled = false;
      btn.firstChild.textContent = label;
    }
  }

  /* ─── หน้าต่างดูตัวอย่าง ─── */
  let lastScale = 0;
  function fit() {
    const ov = $("psOverlay");
    if (!ov || ov.hidden) return;
    const scale = Math.min(1, (window.innerWidth - 24) / 794);
    ov.style.setProperty("--ps-scale", scale);
    // วาดใหม่เมื่อขนาดเปลี่ยน (หมุนจอ) กันตัวหนังสือเพี้ยน
    if (lastScale && scale !== lastScale) { const sh = $("psSheet"); sh.innerHTML = sh.innerHTML; }
    lastScale = scale;
  }
  window.addEventListener("resize", fit);

  async function open({ api, row, taxRate }) {
    const cf = await fetchCashflow(api, row);
    const html = build(row, cf, taxRate);
    const ov = $("psOverlay");
    $("psSheet").innerHTML = html;
    ov.hidden = false;
    document.body.classList.add("ps-open");
    fit();
    ov.scrollTop = 0;
    // เริ่มสร้าง PDF รอไว้เลย กดปุ่มแล้วได้ไฟล์ทันที (iPhone ต้องเปิดเมนูแชร์ทันทีหลังกด)
    current = { row, html, pdf: makePdf(html) };
    current.pdf.catch(() => {});
  }
  function close() {
    $("psOverlay").hidden = true;
    document.body.classList.remove("ps-open");
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("#psClose")) close();
    if (e.target.closest("#psPdf") && current) savePdf();
    if (e.target.closest("#psPrint")) {
      const img = $("psSheet").querySelector("img");
      const go = () => window.print();
      if (img && !img.complete) img.onload = go; else go();
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("psOverlay").hidden) close(); });

  window.IRRPrint = { open, close };
})();
