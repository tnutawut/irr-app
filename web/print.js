/* IRR Web App — หน้าสรุป A4 สำหรับพิมพ์ / บันทึก PDF
   app.js เรียก IRRPrint.open({ api, row, taxRate }) หลังแสดงผล IRR แล้ว */
(function () {
  "use strict";

  const TAX_CAP = 100000;
  const C = { paid: "#0057A8", got: "#7A930E", line: "#00346A", lo: "#A9C222", mid: "#728C0A", hi: "#475800" };
  const cache = {};

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n) => Math.round(n).toLocaleString("th-TH");
  const pct = (r) => (r == null ? "-" : (r * 100).toFixed(2) + "%");
  const compact = (v) => {
    const a = Math.abs(v), s = v < 0 ? "-" : "";
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (a >= 1e3) return s + Math.round(a / 1e3) + "K";
    return s + Math.round(a);
  };
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
      const h = String((cf.headers && cf.headers[i]) || "").trim();
      out.push({ i, label: h && h.length <= 8 ? h : String(i), v });
    });
    return out;
  }

  /* ─── กราฟกระแสเงินสดรายปี + เส้นยอดสะสม (แกนเดียวกัน หน่วยบาท) ─── */
  function cashflowChart(ys, tall) {
    const W = 680, H = tall ? 330 : 240, L = 46, R = 10, T = 14, B = 26;
    let cum = 0;
    const cums = ys.map((y) => (cum += y.v));
    const vals = ys.map((y) => y.v).concat(cums, [0]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.08 || 1;
    lo -= pad; hi += pad;
    const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
    const band = (W - L - R) / ys.length;
    const bw = Math.min(18, band * 0.62);
    const cx = (k) => L + band * k + band / 2;

    // เส้นแกนตัวเลขแบบปัดเลขกลม
    const step = niceStep((hi - lo) / 5);
    let s = `<svg viewBox="0 0 ${W} ${H}" class="ps-chart" role="img" aria-label="กระแสเงินสดรายปี">`;
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) {
      s += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="${Math.abs(t) < step / 2 ? "zero" : "grid"}"/>`;
      s += `<text x="${L - 6}" y="${y(t) + 3}" class="tk" text-anchor="end">${compact(t)}</text>`;
    }
    ys.forEach((yr, k) => {
      const x = cx(k) - bw / 2, y0 = y(0), y1 = y(yr.v);
      const h = Math.abs(y1 - y0);
      if (h >= 0.5) {
        const r = Math.min(4, h / 2, bw / 2);
        const d = yr.v >= 0
          ? `M${x} ${y0}V${y1 + r}a${r} ${r} 0 0 1 ${r}-${r}h${bw - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}V${y0}Z`
          : `M${x} ${y0}V${y1 - r}a${r} ${r} 0 0 0 ${r} ${r}h${bw - 2 * r}a${r} ${r} 0 0 0 ${r}-${r}V${y0}Z`;
        s += `<path d="${d}" fill="${yr.v >= 0 ? C.got : C.paid}"/>`;
      }
      if (ys.length <= 16 || k % 2 === 0 || k === ys.length - 1) {
        s += `<text x="${cx(k)}" y="${H - 9}" class="tk" text-anchor="middle">${esc(yr.label)}</text>`;
      }
    });
    // เส้นยอดสะสม
    s += `<path d="${cums.map((c, k) => (k ? "L" : "M") + cx(k) + " " + y(c)).join("")}" class="cum"/>`;
    const last = cums.length - 1;
    s += `<circle cx="${cx(last)}" cy="${y(cums[last])}" r="4.5" class="cumdot"/>`;
    // ปีที่คืนทุน (ยอดสะสมกลับมาไม่ติดลบ)
    const be = cums.findIndex((c, k) => k > 0 && c >= 0 && cums.slice(0, k).some((p) => p < 0));
    if (be > 0) {
      s += `<circle cx="${cx(be)}" cy="${y(cums[be])}" r="5" class="bedot"/>`;
      s += `<text x="${cx(be)}" y="${y(cums[be]) - 10}" class="be" text-anchor="${be > ys.length * 0.8 ? "end" : "middle"}" dx="${be > ys.length * 0.8 ? -12 : 0}">คืนทุนปีที่ ${esc(ys[be].label)}</text>`;
    }
    return { svg: s + "</svg>", cums, be };
  }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }

  /* ─── สร้างหน้า A4 ─── */
  function build(row, cf, taxRate) {
    const ys = years(cf);
    const chart = cashflowChart(ys, !row.dividend);
    const net = ys.reduce((a, y) => a + y.v, 0);
    const paid = (Number(row.premium) || 0) * (Number(row.payment) || 0);
    const received = net + paid;
    const taxYear = taxRate > 0 ? Math.min(row.premium, TAX_CAP) * taxRate / 100 : 0;
    const taxTotal = taxYear * (Number(row.payment) || 0);
    const sumOf = (arr) => (arr || []).reduce((a, v) => a + (v == null ? 0 : v), 0);

    const chips = [
      genderTh(row.gender), "อายุ " + ageTxt(row.age) + " ปี", "เบี้ย " + num(row.premium) + " บาท/ปี",
      "ชำระ " + row.payment + " ปี", "ฐานภาษี " + taxRate + "%",
    ];

    let h = `
<svg class="ps-deco" viewBox="0 0 794 1123" preserveAspectRatio="none" aria-hidden="true">
  <path d="M520 92 C 620 88, 680 70, 725 40 S 775 5, 800 -10" stroke="#BED62F" stroke-width="2" opacity=".75"/>
  <path d="M560 104 C 650 100, 705 84, 745 58 S 785 30, 800 22" stroke="#00AEEF" stroke-width="1.5" opacity=".35"/>
</svg>
<header class="ps-hd">
  <div>
    <div class="ps-eb">IRR Summary</div>
    <h1>${esc(row.name || row.code)}</h1>
    <div class="ps-chips">${chips.map((c) => `<span>${esc(c)}</span>`).join("")}</div>
  </div>
  <img src="assets/logo/logo-full.png" alt="Nutawut Tamapon" class="ps-logo">
</header>

<section class="ps-kpis">
  <div class="ps-kpi hl"><div class="l">${row.dividend ? "IRR · ไม่รวมเงินปันผล" : "ผลตอบแทน IRR"}</div><div class="v">${(row.irr * 100).toFixed(2)}<small>%</small></div></div>
  <div class="ps-kpi"><div class="l">เบี้ยที่ชำระรวม</div><div class="v">${num(paid)}<small> บาท</small></div><div class="n">${num(row.premium)} × ${row.payment} ปี</div></div>
  <div class="ps-kpi"><div class="l">รับคืนรวมตลอดสัญญา</div><div class="v">${num(received)}<small> บาท</small></div><div class="n">${row.dividend ? "ไม่รวมเงินปันผล" : "ตามกระแสเงินสด"}</div></div>
  <div class="ps-kpi"><div class="l">ผลตอบแทนสุทธิ</div><div class="v">${net >= 0 ? "+" : ""}${num(net)}<small> บาท</small></div><div class="n">รับคืนรวม − เบี้ยรวม</div></div>
</section>

<section class="ps-card">
  <div class="ps-ch"><h2>กระแสเงินสดรายปี${row.dividend ? " <span>(กรณีไม่มีเงินปันผล)</span>" : ""}</h2>
    <div class="ps-lg"><span><i style="background:${C.paid}"></i>จ่ายเบี้ย</span><span><i style="background:${C.got}"></i>รับคืน</span><span><i class="ln"></i>ยอดสะสม</span></div></div>
  ${chart.svg}
</section>`;

    if (row.dividend) {
      const sc = [
        ["ไม่มีเงินปันผล", row.irr, null, cf.base, C.paid],
        ["สถานการณ์ที่ 1", row.irrLow, row.divLow, cf.div1, C.lo],
        ["สถานการณ์ที่ 2", row.irrMid, row.divMid, cf.div2, C.mid],
        ["สถานการณ์ที่ 3", row.irrHigh, row.divHigh, cf.div3, C.hi],
      ];
      const maxIrr = Math.max(...sc.map((x) => x[1] || 0)) || 1;
      h += `
<section class="ps-card">
  <div class="ps-ch"><h2>ผลตอบแทนตามสถานการณ์เงินปันผล</h2><p>เงินปันผลเป็นผลประโยชน์ที่ไม่รับรองการจ่าย</p></div>
  <div class="ps-sc">${sc.map(([t, irr, d, arr, col]) => `
    <div class="ps-s">
      <div class="t"><i style="background:${col}"></i>${t}</div>
      <div class="v">${pct(irr)}</div>
      <div class="bar"><b style="width:${((irr || 0) / maxIrr) * 100}%;background:${col}"></b></div>
      <div class="n">${d == null ? "&nbsp;" : "เงินปันผล " + num(d) + " บาท"}</div>
      <div class="n">รับคืนรวม ${num(sumOf(arr) + paid)} บาท</div>
    </div>`).join("")}
  </div>
</section>`;
    }

    // ตารางรายปี แบ่ง 2 ฝั่ง
    const half = Math.ceil(ys.length / 2);
    const tbl = (part, offset) => `<table class="ps-tb"><thead><tr><th>ปีที่</th><th>กระแสเงินสด</th><th>ยอดสะสม</th></tr></thead><tbody>${
      part.map((yr, k) => {
        const c = chart.cums[offset + k];
        return `<tr${offset + k === chart.be ? ' class="be"' : ""}><td>${esc(yr.label)}</td><td class="${yr.v < 0 ? "neg" : "pos"}">${yr.v > 0 ? "+" : ""}${num(yr.v)}</td><td class="${c < 0 ? "neg" : "pos"}">${num(c)}</td></tr>`;
      }).join("")}</tbody></table>`;
    h += `
<section class="ps-card">
  <div class="ps-ch"><h2>ตารางกระแสเงินสด${row.dividend ? " <span>(กรณีไม่มีเงินปันผล)</span>" : ""}</h2><p>หน่วย: บาท · ติดลบ = จ่ายเบี้ย · บวก = รับคืน</p></div>
  <div class="ps-tbs">${tbl(ys.slice(0, half), 0)}${tbl(ys.slice(half), half)}</div>
</section>`;

    if (taxRate > 0) {
      h += `<div class="ps-tax">ใช้สิทธิ์ลดหย่อนภาษีได้ประโยชน์ ประหยัดภาษีปีละ <b>${num(taxYear)}</b> บาท ในปีที่ชำระเบี้ยประกัน รวมประโยชน์ทางภาษีตลอดสัญญา <b>${num(taxTotal)}</b> บาท</div>`;
    }

    const today = new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });
    h += `
<footer class="ps-ft">
  <p>${row.dividend ? "เงินปันผลเป็นผลประโยชน์ที่ไม่รับรองการจ่าย ขึ้นอยู่กับผลตอบแทนการลงทุนจริงของบริษัท<br>" : ""}${row.extra ? esc(row.extra) + "<br>" : ""}ผลตอบแทนเป็นการประมาณการเพื่อประกอบการพิจารณาเท่านั้น โปรดศึกษาเอกสารเสนอขายก่อนตัดสินใจ</p>
  <p class="r">จัดทำวันที่ ${today}<br>tnutawut.github.io/irr-app</p>
</footer>`;
    return h;
  }

  /* ─── หน้าต่างดูตัวอย่างก่อนพิมพ์ ─── */
  let lastScale = 0;
  function fit() {
    const ov = $("psOverlay");
    if (!ov || ov.hidden) return;
    const scale = Math.min(1, (window.innerWidth - 24) / 794);
    ov.style.setProperty("--ps-scale", scale);
    // วาดใหม่เมื่อขนาดเปลี่ยน (หมุนจอ) กันตัวหนังสือในกราฟเพี้ยน
    if (lastScale && scale !== lastScale) { const sh = $("psSheet"); sh.innerHTML = sh.innerHTML; }
    lastScale = scale;
  }
  window.addEventListener("resize", fit);

  async function open({ api, row, taxRate }) {
    const cf = await fetchCashflow(api, row);
    const ov = $("psOverlay");
    $("psSheet").innerHTML = build(row, cf, taxRate);
    ov.hidden = false;
    document.body.classList.add("ps-open");
    fit();
    ov.scrollTop = 0;
  }
  function close() {
    $("psOverlay").hidden = true;
    document.body.classList.remove("ps-open");
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("#psClose")) close();
    if (e.target.closest("#psPrint")) {
      const img = $("psSheet").querySelector("img");
      const go = () => window.print();
      if (img && !img.complete) img.onload = go; else go();
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("psOverlay").hidden) close(); });

  window.IRRPrint = { open, close };
})();
