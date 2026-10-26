/* Kasvukonto – isiklik investeerimisäpp (Supabase) */
const cfg = window.KASVUKONTO_CONFIG || {};
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const COLORS = ["var(--accent)", "var(--ochre)", "#6A8CAF", "#9B6FA8", "#C0675A", "#5E9C8F", "#8A8F3C", "#A57C5B"];
const SAFE = ["Võlakiri", "Hoius"], DIVERSE = ["ETF", "Fond"];
const S = { holdings: [], prices: {}, txns: [], config: { monthly: 300 } };
let user = null, editingId = null, pendingDelete = null;

const $ = (id) => document.getElementById(id);
const eur = (n, d = 2) => (isFinite(n) ? n.toLocaleString("et-EE", { minimumFractionDigits: d, maximumFractionDigits: d }) + " €" : "–");
const pct = (n, d = 1) => (isFinite(n) ? n.toLocaleString("et-EE", { minimumFractionDigits: d, maximumFractionDigits: d }) + " %" : "–");
const sign = (n) => (n > 0 ? "+" : "");
const up = (t) => String(t || "").trim().toUpperCase();
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
}

/* ---------- andmed ---------- */
const fromRow = (r) => ({
  id: r.id, ticker: r.ticker, symbol: r.symbol, name: r.name, type: r.type,
  qty: +r.qty, avgPrice: +r.avg_price, target: +r.target || 0,
  nominal: r.nominal == null ? null : +r.nominal, rate: r.rate == null ? null : +r.rate, maturity: r.maturity || "",
  manualPrice: r.manual_price == null ? null : +r.manual_price, manualAt: r.manual_price_at,
});
async function loadAll() {
  const [h, t, s, p] = await Promise.all([
    sb.from("holdings").select("*"),
    sb.from("txns").select("*"),
    sb.from("settings").select("*").maybeSingle(),
    sb.from("prices").select("*"),
  ]);
  const err = h.error || t.error || s.error || p.error;
  if (err) return showError("Andmete laadimine ebaõnnestus: " + err.message);
  S.holdings = h.data.map(fromRow);
  S.txns = t.data.map((r) => ({ ...r, amount: +r.amount }));
  if (s.data) S.config.monthly = +s.data.monthly;
  S.prices = {};
  p.data.forEach((r) => (S.prices[r.symbol] = { price: +r.price, at: r.updated_at, source: r.source, native: r.native_price, cur: r.native_currency }));
  render();
}
function showError(msg) { const n = $("db-notice"); n.hidden = false; n.textContent = msg; }

function priceInfo(h) {
  if (h.type === "Hoius") return { price: 1, at: new Date().toISOString(), source: "hoius", has: true };
  const m = S.prices[up(h.symbol || h.ticker)];
  const manual = h.manualPrice != null ? { price: h.manualPrice, at: h.manualAt, source: "käsitsi", has: true } : null;
  if (m && (!manual || new Date(m.at) > new Date(manual.at))) return { ...m, has: true };
  return manual || { price: h.avgPrice, at: null, source: "ostuhind", has: false };
}
function rows() {
  const list = S.holdings.map((h) => {
    const pi = priceInfo(h);
    const value = h.qty * pi.price, cost = h.qty * h.avgPrice;
    return { ...h, price: pi.price, pi, hasPrice: pi.has, value, cost, pl: value - cost };
  });
  const total = list.reduce((a, r) => a + r.value, 0);
  list.forEach((r) => (r.share = total ? r.value / total : 0));
  list.sort((a, b) => b.value - a.value);
  return { list, total, cost: list.reduce((a, r) => a + r.cost, 0) };
}
const stale = (iso) => !iso || Date.now() - new Date(iso).getTime() > 3 * 864e5;
function incomeOf(h) {
  const r = (+h.rate || 0) / 100;
  if (h.type === "Võlakiri") return h.qty * (+h.nominal || h.avgPrice) * r;
  if (h.type === "Hoius") return h.qty * r;
  return 0;
}

/* ---------- joonistamine ---------- */
function render() { renderTop(); renderHoldings(); renderHealth(); renderPlan(); renderCalc(); renderTx(); }

function renderTop() {
  const { list, total, cost } = rows();
  $("k-value").textContent = eur(total);
  $("k-cost").textContent = eur(cost);
  const pl = total - cost, k = $("k-pl");
  k.textContent = list.length ? `${sign(pl)}${eur(pl)} (${sign(pl)}${pct(cost ? (pl / cost) * 100 : 0)})` : "–";
  k.className = "v " + (pl >= 0 ? "gain" : "loss");
  const y = String(new Date().getFullYear());
  $("k-div").textContent = eur(S.txns.filter((t) => t.kind === "dividend" && String(t.date).startsWith(y)).reduce((a, t) => a + t.amount, 0));
  const dates = list.filter((r) => r.hasPrice && r.type !== "Hoius").map((r) => r.pi.at).filter(Boolean).sort();
  const f = $("freshness");
  if (!list.length) f.textContent = "";
  else if (!dates.length) f.textContent = "Hindu pole veel uuendatud";
  else f.textContent = "Vanim hind: " + new Date(dates[0]).toLocaleString("et-EE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function renderHoldings() {
  const { list, total } = rows();
  const tb = $("h-body"); tb.replaceChildren();
  $("h-empty").hidden = list.length > 0;
  const bar = $("alloc"), lg = $("legend"); bar.replaceChildren(); lg.replaceChildren();
  const byType = {}; list.forEach((r) => (byType[r.type] = (byType[r.type] || 0) + r.value));
  Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([t, v], i) => {
    const c = COLORS[i % COLORS.length];
    bar.append(el("span", { style: `flex:0 0 ${total ? (v / total) * 100 : 0}%;background:${c}`, title: t }));
    lg.append(el("span", {}, el("i", { style: `background:${c}` }), `${t} ${pct(total ? (v / total) * 100 : 0, 0)}`));
  });
  $("alloc-sub").textContent = list.length ? `${list.length} positsiooni` : "";
  list.forEach((r) => {
    const nameCell = el("td", {}, el("div", { class: "tk", text: r.ticker }), el("div", { class: "sub", text: r.name || r.type }));
    if (SAFE.includes(r.type) && (r.rate || r.maturity))
      nameCell.append(el("div", { class: "sub", text: [r.rate ? `${r.type === "Hoius" ? "intress" : "kupong"} ${pct(+r.rate, 2)}` : "", r.maturity ? new Date(r.maturity).toLocaleDateString("et-EE") : ""].filter(Boolean).join(" · ") }));
    const priceCell = el("td", { class: "r num" }, el("div", { text: r.type === "Hoius" ? "–" : eur(r.price) }));
    const meta = el("div", { class: "sub" });
    if (r.type !== "Hoius") {
      if (!r.hasPrice) meta.append(el("span", { class: "chip old", text: "ostuhind" }));
      else meta.append(el("span", { class: "chip" + (stale(r.pi.at) ? " old" : ""), title: r.pi.source || "", text: (r.pi.source === "käsitsi" ? "käsitsi " : "") + new Date(r.pi.at).toLocaleDateString("et-EE", { day: "numeric", month: "numeric" }) }));
    }
    priceCell.append(meta);
    const plCls = r.pl >= 0 ? "gain" : "loss";
    const acts = el("div", { class: "actions" });
    if (r.type !== "Hoius") acts.append(el("button", { class: "btn sm ghost", type: "button", text: "Hind", onclick: () => editPrice(priceCell, r) }));
    acts.append(el("button", { class: "btn sm ghost", type: "button", text: "Muuda", onclick: () => startEdit(r) }));
    acts.append(el("button", { class: "btn sm danger", type: "button", text: pendingDelete === r.id ? "Kinnita" : "Kustuta",
      onclick: () => { if (pendingDelete === r.id) { pendingDelete = null; remove("holdings", r.id); } else { pendingDelete = r.id; renderHoldings(); } } }));
    tb.append(el("tr", {}, nameCell,
      el("td", { class: "r num", text: r.qty.toLocaleString("et-EE", { maximumFractionDigits: 6 }) }),
      el("td", { class: "r num", text: r.type === "Hoius" ? "–" : eur(r.avgPrice) }),
      priceCell,
      el("td", { class: "r num", text: eur(r.value) }),
      el("td", { class: "r num " + plCls }, el("div", { text: sign(r.pl) + eur(r.pl) }), el("div", { class: "sub " + plCls, text: sign(r.pl) + pct(r.cost ? (r.pl / r.cost) * 100 : 0) })),
      el("td", { class: "r num", text: pct(r.share * 100) }),
      el("td", {}, acts)));
  });
}
function editPrice(cell, r) {
  cell.replaceChildren();
  const inp = el("input", { type: "number", step: "any", min: "0", class: "pinput", value: String(r.price), "aria-label": "Uus hind" });
  const ok = el("button", { class: "btn sm", type: "button", text: "OK", onclick: async () => {
    const v = parseFloat(inp.value); if (!(v > 0)) return;
    const { error } = await sb.from("holdings").update({ manual_price: v, manual_price_at: new Date().toISOString() }).eq("id", r.id);
    if (error) return showError("Hinna salvestamine ebaõnnestus: " + error.message);
    loadAll();
  } });
  cell.append(el("div", { class: "actions" }, inp, ok)); inp.focus();
}

function renderHealth() {
  const { list, total, cost } = rows(); const ul = $("hl-list"); ul.replaceChildren();
  const divs = S.txns.filter((t) => t.kind === "dividend").reduce((a, t) => a + t.amount, 0);
  const tr = total - cost + divs, te = $("hl-total");
  te.textContent = list.length ? `${sign(tr)}${eur(tr)} (${sign(tr)}${pct(cost ? (tr / cost) * 100 : 0)})` : "–";
  te.className = "num " + (tr >= 0 ? "gain" : "loss");
  const safe = list.filter((r) => SAFE.includes(r.type)).reduce((a, r) => a + r.value, 0);
  $("hl-safe").textContent = list.length ? pct(total ? (safe / total) * 100 : 0) : "–";
  $("hl-income").textContent = eur(list.reduce((a, r) => a + incomeOf(r), 0));
  if (!list.length) { ul.append(el("li", { class: "info" }, el("span", { text: "Lisa positsioonid, et näha portfelli kontrolli." }))); return; }
  const items = [];
  list.filter((r) => !DIVERSE.includes(r.type) && !SAFE.includes(r.type) && r.share > 0.25)
    .forEach((r) => items.push(["warn", `${r.ticker} moodustab ${pct(r.share * 100, 0)} portfellist. Ühe ettevõtte või vara halb periood mõjutaks siis kogu portfelli tugevalt.`]));
  const stock = list.filter((r) => r.type === "Aktsia").reduce((a, r) => a + r.share, 0);
  if (stock > 0.5) items.push(["info", `Üksikaktsiad on ${pct(stock * 100, 0)} portfellist. Hajutatud ETF-id või fondid vähendavad üksikettevõtte riski.`]);
  if (!list.some((r) => DIVERSE.includes(r.type))) items.push(["info", "Portfellis pole ühtegi ETF-i ega fondi, mis hajutaks raha paljude ettevõtete vahel."]);
  const cr = list.filter((r) => r.type === "Krüpto").reduce((a, r) => a + r.share, 0);
  if (cr > 0.1) items.push(["warn", `Krüpto osakaal on ${pct(cr * 100, 0)}. See vara võib lühikese ajaga kaotada suure osa väärtusest.`]);
  const soon = Date.now() + 180 * 864e5;
  list.filter((r) => SAFE.includes(r.type) && r.maturity && new Date(r.maturity).getTime() < soon)
    .forEach((r) => items.push(["info", `${r.ticker} ${r.type === "Hoius" ? "tähtaeg" : "lunastus"} on ${new Date(r.maturity).toLocaleDateString("et-EE")}. Mõtle, kuhu see raha edasi läheb.`]));
  const st = list.filter((r) => r.type !== "Hoius" && (!r.hasPrice || stale(r.pi.at)));
  if (st.length) items.push(["info", `${st.map((r) => r.ticker).join(", ")} hind on vanem kui 3 päeva või puudub. Kontrolli hinnaallika sümbolit või vajuta "Uuenda hindu".`]);
  const tsum = list.reduce((a, r) => a + (+r.target || 0), 0);
  if (tsum) {
    const d = list.map((r) => ({ t: r.ticker, d: r.share * 100 - ((+r.target || 0) / tsum) * 100 })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
    if (Math.abs(d.d) > 5) items.push(["info", `${d.t} on sihtosakaalust ${d.d > 0 ? "üle" : "all"} ${pct(Math.abs(d.d), 1)} punkti võrra. Kuuplaan suunab uue raha alakaalus positsioonidesse.`]);
  }
  if (!items.some((i) => i[0] === "warn")) items.push(["ok", "Suuri riskikoondumisi ei leitud."]);
  items.forEach(([c, t]) => ul.append(el("li", { class: c }, el("span", { text: t }))));
}

function planRows() {
  const { list, total } = rows(); const m = Math.max(0, +S.config.monthly || 0);
  const tsum = list.reduce((a, r) => a + (+r.target || 0), 0);
  const after = total + m;
  const def = list.map((r) => Math.max(0, ((+r.target || 0) / (tsum || 1)) * after - r.value));
  const dsum = def.reduce((a, b) => a + b, 0);
  return { list, m, tsum, out: list.map((r, i) => {
    const buy = dsum ? (def[i] / dsum) * m : 0;
    return { ...r, buy, units: r.price ? Math.floor((buy / r.price) * 1000) / 1000 : 0, afterShare: after ? (r.value + buy) / after : 0 };
  }) };
}
function renderPlan() {
  const { list, m, tsum, out } = planRows();
  if (document.activeElement !== $("p-monthly")) $("p-monthly").value = S.config.monthly ?? "";
  const w = $("p-warn");
  if (!list.length) { w.hidden = false; w.textContent = "Lisa enne positsioonid ja nende sihtosakaalud."; }
  else if (!tsum) { w.hidden = false; w.textContent = "Sihtosakaalud on määramata. Ava Portfell → Muuda ja pane igale positsioonile sihtosakaal."; }
  else if (Math.abs(tsum - 100) > 0.01) { w.hidden = false; w.textContent = `Sihtosakaalude summa on ${pct(tsum, 0)}. Arvutan proportsionaalselt, aga parem oleks, kui summa oleks 100 %.`; }
  else w.hidden = true;
  const tb = $("p-body"); tb.replaceChildren();
  out.forEach((r) => tb.append(el("tr", {},
    el("td", {}, el("span", { class: "tk", text: r.ticker })),
    el("td", { class: "r num", text: pct(r.share * 100) }),
    el("td", { class: "r num", text: tsum ? pct(((+r.target || 0) / tsum) * 100) : "–" }),
    el("td", { class: "r num", text: pct(r.afterShare * 100) }),
    el("td", { class: "r num " + (r.buy > 0.5 ? "gain" : ""), text: eur(r.buy) }),
    el("td", { class: "r num", text: r.type === "Hoius" ? "–" : r.units ? r.units.toLocaleString("et-EE", { maximumFractionDigits: 3 }) : "–" }))));
  const whole = out.filter((r) => r.buy > 0 && r.price > r.buy && r.type !== "Hoius").map((r) => r.ticker);
  $("p-foot").textContent = m ? `Kokku ${eur(m)}. ` + (whole.length ? `${whole.join(", ")} hind on suurem kui ostusumma; kui maakler murdosi ei luba, koonda see summa järgmisse kuusse.` : "") : "";
}

function renderCalc() {
  const { total } = rows();
  const st = $("c-start"), mo = $("c-monthly");
  if (st.dataset.touched !== "1") st.value = Math.round(total);
  if (mo.dataset.touched !== "1") mo.value = S.config.monthly ?? 300;
  const P = +st.value || 0, M = +mo.value || 0, R = (+$("c-rate").value || 0) / 100;
  const Y = Math.min(60, Math.max(1, +$("c-years").value || 1)), G = (+$("c-grow").value || 0) / 100, goal = +$("c-goal").value || 0;
  const rm = Math.pow(1 + R, 1 / 12) - 1;
  let v = P, paid = P, pay = M, hit = null; const pts = [{ y: 0, v, paid }];
  for (let mth = 1; mth <= Y * 12; mth++) {
    v = v * (1 + rm) + pay; paid += pay;
    if (goal && hit == null && v >= goal) hit = mth;
    if (mth % 12 === 0) { pts.push({ y: mth / 12, v, paid }); pay *= 1 + G; }
  }
  let v2 = v, pay2 = pay, m2 = Y * 12;
  while (goal && hit == null && m2 < 960) { m2++; v2 = v2 * (1 + rm) + pay2; if (v2 >= goal) hit = m2; if (m2 % 12 === 0) pay2 *= 1 + G; }
  $("c-final").textContent = eur(v, 0); $("c-paid").textContent = eur(paid, 0); $("c-gain").textContent = "+" + eur(v - paid, 0);
  const now = new Date();
  $("c-goal-out").textContent = !goal ? "" : P >= goal ? "Eesmärk on juba saavutatud."
    : hit ? `${eur(goal, 0)} on käes umbes ${Math.floor(hit / 12)} a ${hit % 12} k pärast (${new Date(now.getFullYear(), now.getMonth() + hit).toLocaleDateString("et-EE", { month: "long", year: "numeric" })}).`
    : "Nende sisenditega eesmärk 80 aasta jooksul ei täitu.";
  drawChart(pts);
}
function drawChart(pts) {
  const W = 560, H = 260, l = 56, r = 12, t = 12, b = 26, max = Math.max(...pts.map((p) => p.v)) * 1.05 || 1, n = pts[pts.length - 1].y || 1;
  const x = (y) => l + ((W - l - r) * y) / n, yv = (v) => t + (H - t - b) * (1 - v / max);
  const step = Math.pow(10, Math.floor(Math.log10(max / 4)));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => max / s <= 5) || step * 10;
  let g = "";
  for (let v = 0; v <= max; v += nice)
    g += `<line x1="${l}" x2="${W - r}" y1="${yv(v)}" y2="${yv(v)}" stroke="var(--line)"/><text x="${l - 6}" y="${yv(v) + 4}" text-anchor="end">${v >= 1e6 ? (v / 1e6).toLocaleString("et-EE", { maximumFractionDigits: 1 }) + "M" : Math.round(v / 1000) + "k"}</text>`;
  const xs = n <= 8 ? 1 : n <= 16 ? 2 : n <= 40 ? 5 : 10;
  for (let y = 0; y <= n; y += xs) g += `<text x="${x(y)}" y="${H - 6}" text-anchor="middle">${y} a</text>`;
  const area = (k) => `M${x(0)},${yv(0)} ` + pts.map((p) => `L${x(p.y)},${yv(p[k])}`).join(" ") + ` L${x(n)},${yv(0)} Z`;
  const line = (k) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.y)},${yv(p[k])}`).join(" ");
  const last = pts[pts.length - 1];
  $("chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Portfelli kasvu prognoos">${g}
  <path d="${area("v")}" fill="var(--accent)" fill-opacity=".14"/><path d="${area("paid")}" fill="var(--ochre)" fill-opacity=".28"/>
  <path d="${line("paid")}" fill="none" stroke="var(--ochre)" stroke-width="2"/><path d="${line("v")}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
  <circle cx="${x(last.y)}" cy="${yv(last.v)}" r="4" fill="var(--accent)"/></svg>`;
}

function renderTx() {
  const tb = $("t-body"); tb.replaceChildren();
  const list = [...S.txns].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  $("t-empty").hidden = list.length > 0;
  const KIND = { dividend: "Dividend", deposit: "Sissemakse", withdraw: "Väljamakse" };
  list.forEach((t) => {
    const del = el("button", { class: "btn sm danger", type: "button", text: pendingDelete === t.id ? "Kinnita" : "Kustuta",
      onclick: () => { if (pendingDelete === t.id) { pendingDelete = null; remove("txns", t.id); } else { pendingDelete = t.id; renderTx(); } } });
    tb.append(el("tr", {},
      el("td", { class: "num", text: new Date(t.date).toLocaleDateString("et-EE") }),
      el("td", { text: KIND[t.kind] || t.kind }),
      el("td", { class: "tk", text: t.ticker || "" }),
      el("td", { class: "r num " + (t.kind === "withdraw" ? "loss" : t.kind === "dividend" ? "gain" : ""), text: (t.kind === "withdraw" ? "−" : "") + eur(t.amount) }),
      el("td", { class: "sub", text: t.note || "" }),
      el("td", {}, el("div", { class: "actions" }, del))));
  });
  const yrs = {};
  list.forEach((t) => { const y = String(t.date).slice(0, 4); yrs[y] = yrs[y] || { dividend: 0, deposit: 0, withdraw: 0 }; yrs[y][t.kind] += t.amount; });
  const yb = $("y-body"); yb.replaceChildren();
  Object.keys(yrs).sort().reverse().forEach((y) => {
    const o = yrs[y];
    yb.append(el("tr", {}, el("td", { class: "num", text: y }), el("td", { class: "r num gain", text: eur(o.dividend) }), el("td", { class: "r num", text: eur(o.deposit) }), el("td", { class: "r num", text: eur(o.withdraw) }), el("td", { class: "r num", text: eur(o.deposit - o.withdraw) })));
  });
  if (!Object.keys(yrs).length) yb.append(el("tr", {}, el("td", { colspan: "5", class: "sub", text: "Kokkuvõte ilmub pärast esimest kannet." })));
  const { cost } = rows();
  const now = new Date(), yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
  const d12 = S.txns.filter((t) => t.kind === "dividend" && t.date >= yearAgo).reduce((a, t) => a + t.amount, 0);
  $("y-yield").textContent = cost && d12 ? `Viimase 12 kuu dividendid ${eur(d12)}, mis on ${pct((d12 / cost) * 100, 2)} investeeritud summast.` : "";
}

/* ---------- vormid ---------- */
function syncType() {
  const t = $("h-type").value, bond = t === "Võlakiri", dep = t === "Hoius";
  $("h-extra").hidden = !(bond || dep); $("h-nom-wrap").hidden = !bond;
  $("h-rate-lbl").textContent = dep ? "Intress % aastas" : "Kupong % aastas";
  $("h-mat-lbl").textContent = dep ? "Tähtaeg" : "Lunastus";
  $("h-qty-lbl").textContent = dep ? "Summa €" : "Kogus";
  $("h-avg-wrap").hidden = dep; $("h-avg").required = !dep;
  $("h-sym-wrap").hidden = dep;
}
$("h-type").addEventListener("change", syncType);
function startEdit(r) {
  editingId = r.id; $("h-form-title").textContent = "Muuda: " + r.ticker; $("h-submit").textContent = "Salvesta"; $("h-cancel").hidden = false;
  $("h-ticker").value = r.ticker; $("h-symbol").value = r.symbol || ""; $("h-name").value = r.name || ""; $("h-type").value = r.type || "ETF";
  $("h-qty").value = r.qty; $("h-avg").value = r.avgPrice; $("h-target").value = r.target || "";
  $("h-nom").value = r.nominal ?? ""; $("h-rate").value = r.rate ?? ""; $("h-mat").value = r.maturity || "";
  syncType(); $("h-form").scrollIntoView({ behavior: "smooth", block: "center" }); $("h-qty").focus();
}
function resetForm() {
  editingId = null; $("h-form").reset(); $("h-form-title").textContent = "Lisa positsioon"; $("h-submit").textContent = "Lisa"; $("h-cancel").hidden = true; syncType();
}
$("h-cancel").addEventListener("click", resetForm);
$("h-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ticker = up($("h-ticker").value); if (!ticker) return;
  const type = $("h-type").value;
  const body = {
    ticker, symbol: up($("h-symbol").value) || null, name: $("h-name").value.trim(), type,
    qty: +$("h-qty").value, avg_price: type === "Hoius" ? 1 : +$("h-avg").value,
    target: $("h-target").value === "" ? 0 : +$("h-target").value,
    rate: SAFE.includes(type) && $("h-rate").value !== "" ? +$("h-rate").value : null,
    maturity: SAFE.includes(type) && $("h-mat").value ? $("h-mat").value : null,
    nominal: type === "Võlakiri" && $("h-nom").value !== "" ? +$("h-nom").value : null,
  };
  const q = editingId ? sb.from("holdings").update(body).eq("id", editingId) : sb.from("holdings").insert(body);
  const { error } = await q;
  if (error) return showError("Salvestamine ebaõnnestus: " + error.message);
  resetForm(); await loadAll();
  if (!editingId && body.symbol !== null) updatePrices(true);
});
$("t-date").value = new Date().toISOString().slice(0, 10);
$("t-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = { date: $("t-date").value, kind: $("t-kind").value, ticker: up($("t-ticker").value) || null, amount: +$("t-amount").value, note: $("t-note").value.trim() || null };
  if (!(body.amount > 0)) return;
  const { error } = await sb.from("txns").insert(body);
  if (error) return showError("Salvestamine ebaõnnestus: " + error.message);
  $("t-amount").value = ""; $("t-note").value = ""; loadAll();
});
$("p-monthly").addEventListener("input", () => { S.config.monthly = +$("p-monthly").value || 0; renderPlan(); renderCalc(); });
$("p-save").addEventListener("click", async () => {
  const { error } = await sb.from("settings").upsert({ user_id: user.id, monthly: +$("p-monthly").value || 0 });
  if (error) return showError("Salvestamine ebaõnnestus: " + error.message);
  $("p-save").textContent = "Salvestatud"; setTimeout(() => ($("p-save").textContent = "Salvesta summa"), 1500);
});
["c-start", "c-monthly"].forEach((id) => $(id).addEventListener("input", () => { $(id).dataset.touched = "1"; renderCalc(); }));
["c-rate", "c-years", "c-grow", "c-goal"].forEach((id) => $(id).addEventListener("input", renderCalc));

async function remove(table, id) {
  const { error } = await sb.from(table).delete().eq("id", id);
  if (error) return showError("Kustutamine ebaõnnestus: " + error.message);
  loadAll();
}

async function updatePrices(quiet) {
  const b = $("refresh"); b.disabled = true; b.textContent = "Uuendan…";
  const { data, error } = await sb.functions.invoke("update-prices");
  b.disabled = false; b.textContent = "Uuenda hindu";
  if (error) { if (!quiet) showError("Hindade uuendamine ebaõnnestus. Kontrolli, et serveri funktsioon on paigaldatud."); return; }
  if (data?.failed?.length && !quiet) showError(`Ei leidnud hinda: ${data.failed.join(", ")}. Kontrolli hinnaallika sümbolit (nt VWCE.DE, LHV1T.TL, BTC-EUR).`);
  else $("db-notice").hidden = true;
  loadAll();
}
$("refresh").addEventListener("click", () => updatePrices(false));

/* ---------- vahelehed ---------- */
function showTab(name) {
  document.querySelectorAll("nav.tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === name));
  document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
  history.replaceState(null, "", "#" + name);
}
document.querySelectorAll("nav.tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
{ const h = location.hash.slice(1); if (["portfell", "plaan", "kalkulaator", "tulu"].includes(h)) showTab(h); }

/* ---------- sisselogimine ---------- */
$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("auth-email").value.trim(); if (!email) return;
  $("auth-btn").disabled = true;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  $("auth-btn").disabled = false;
  $("auth-msg").textContent = error ? "Lingi saatmine ebaõnnestus: " + error.message : `Saatsime sisselogimislingi aadressile ${email}. Ava see samas seadmes.`;
});
$("logout").addEventListener("click", () => sb.auth.signOut());

function setUser(u) {
  user = u;
  $("auth-form").hidden = !!u; $("app").hidden = !u; $("app-head").hidden = !u;
  if (u) { $("who").textContent = u.email; loadAll(); }
}
sb.auth.onAuthStateChange((_ev, session) => setUser(session?.user || null));
sb.auth.getSession().then(({ data }) => setUser(data.session?.user || null));
syncType(); render();
