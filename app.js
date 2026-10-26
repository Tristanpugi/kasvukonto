/* Kasvukonto – isiklik investeerimisäpp (Supabase). Kasum arvutatakse tehingutest keskmise hinna meetodil. */
const cfg = window.KASVUKONTO_CONFIG || {};
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const TYPES = ["ETF", "Aktsia", "Fond", "Pension", "Võlakiri", "Hoius", "Krüpto", "Muu"];
const TYPE_COLOR = { ETF: "#1F6B4F", Aktsia: "#3E6FA3", Fond: "#5E9C8F", Pension: "#C0675A", Võlakiri: "#B07F22", Hoius: "#8A8F3C", Krüpto: "#8E5BA6", Muu: "#7A7F7C" };
const SAFE = ["Võlakiri", "Hoius"], DIVERSE = ["ETF", "Fond", "Pension"];
/* Pensionifondid, mille päevahind (NAV) tuleb Tuleva avalikust API-st. */
const PENSION_FUNDS = [
  { symbol: "EE3600109435", short: "TUK75", name: "Tuleva Maailma Aktsiate Pensionifond", type: "Pension", exchange: "II sammas" },
  { symbol: "EE3600001707", short: "TUV100", name: "Tuleva III Samba Pensionifond", type: "Pension", exchange: "III sammas" },
];
const KIND = { dividend: "Dividend", deposit: "Sissemakse", withdraw: "Väljamakse" };
const S = { holdings: [], trades: [], prices: {}, txns: [], config: { monthly: 300 }, hasTrades: true };
let user = null;

const $ = (id) => document.getElementById(id);
const fmt = (n, d) => (+n).toLocaleString("et-EE", { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = (n, d = 2) => (isFinite(n) ? fmt(n, d) + " €" : "–");
const eur0 = (n) => eur(n, Math.abs(n) >= 1000 ? 0 : 2);
const pct = (n, d = 1) => (isFinite(n) ? fmt(n, d) + " %" : "–");
const sign = (n) => (n > 0.004 ? "+" : n < -0.004 ? "−" : "");
const qtyFmt = (q) => (+q).toLocaleString("et-EE", { maximumFractionDigits: 6 });
const up = (t) => String(t || "").trim().toUpperCase();
const today = () => new Date().toISOString().slice(0, 10);
const dateEt = (d) => new Date(d).toLocaleDateString("et-EE", { day: "numeric", month: "short", year: "numeric" });
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
}

function guessSymbol(t, type) {
  t = up(t);
  if (!t || t.includes(".") || t.includes("-") || t.includes("=") || type === "Pension") return t;
  if (type === "Krüpto") return t + "-EUR";
  if (/1T$/.test(t)) return t + ".TL";
  if (/1R$/.test(t)) return t + ".RG";
  if (/1L$/.test(t)) return t + ".VS";
  if (type === "ETF" || type === "Fond") return t + ".DE";
  return t;
}

/* Dollari kurss (ECB andmed, Frankfurter): mitu eurot 1 $ eest. */
const fxCache = {};
async function usdToEur(date) {
  const key = date || "latest";
  if (fxCache[key]) return fxCache[key];
  const tries = [
    async () => (await (await fetch(`https://api.frankfurter.dev/v2/rate/usd/eur${date ? "?date=" + date : ""}`)).json()).rate,
    async () => (await (await fetch(`https://api.frankfurter.dev/v1/${date || "latest"}?base=USD&symbols=EUR`)).json()).rates.EUR,
    async () => (await (await fetch(`https://api.frankfurter.app/${date || "latest"}?from=USD&to=EUR`)).json()).rates.EUR,
  ];
  for (const t of tries) {
    try { const v = +(await t()); if (v > 0) return (fxCache[key] = v); } catch (_e) { /* järgmine */ }
  }
  return null;
}

/* ---------- andmed ---------- */
const fromRow = (r) => ({
  id: r.id, ticker: r.ticker, symbol: r.symbol, name: r.name, type: r.type,
  legacyQty: +r.qty, legacyAvg: +r.avg_price, target: +r.target || 0,
  nominal: r.nominal == null ? null : +r.nominal, rate: r.rate == null ? null : +r.rate, maturity: r.maturity || "",
  manualPrice: r.manual_price == null ? null : +r.manual_price, manualAt: r.manual_price_at,
});
async function loadAll() {
  const [h, t, s, p, tr] = await Promise.all([
    sb.from("holdings").select("*"),
    sb.from("txns").select("*"),
    sb.from("settings").select("*").maybeSingle(),
    sb.from("prices").select("*"),
    sb.from("trades").select("*").order("date").order("created_at"),
  ]);
  const err = h.error || t.error || s.error || p.error;
  if (err) return toast("Andmete laadimine ebaõnnestus: " + err.message);
  S.hasTrades = !tr.error;
  if (tr.error) toast("Andmebaas vajab uuendust: käivita Supabase'is fail 002_trades.sql (juhend vestluses).");
  S.holdings = h.data.map(fromRow);
  S.trades = (tr.data || []).map((x) => ({ ...x, qty: +x.qty, price: +x.price, fx: +x.fx || 1, fee: +x.fee || 0 }));
  S.txns = t.data.map((r) => ({ ...r, amount: +r.amount }));
  if (s.data) S.config.monthly = +s.data.monthly;
  S.prices = {};
  p.data.forEach((r) => (S.prices[r.symbol] = { price: +r.price, at: r.updated_at, source: r.source, native: r.native_price == null ? null : +r.native_price, cur: r.native_currency }));
render();
  if (openDetailId) { const r = rows().list.find((x) => x.id === openDetailId); if (r && !$("d-view").hidden) fillDetail(r); }
}
let toastT;
function toast(msg) { const n = $("db-notice"); n.textContent = msg; n.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (n.hidden = true), 9000); }

/* Positsioon tehingutest, keskmise hinna meetod (nagu maakleritel). Kõik summad eurodes. */
function position(h) {
  const list = S.trades.filter((t) => t.holding_id === h.id);
  if (!S.hasTrades) {
    const q = h.legacyQty || 0;
    return { qty: q, cost: q * (h.legacyAvg || 0), realized: 0, fees: 0, trades: [] };
  }
  let qty = 0, cost = 0, realized = 0, fees = 0;
  for (const t of list) {
    const gross = t.qty * t.price * t.fx;
    fees += t.fee;
    if (t.side === "buy") { qty += t.qty; cost += gross + t.fee; }
    else {
      const avg = qty > 0 ? cost / qty : 0, q = Math.min(t.qty, qty);
      realized += gross - t.fee - avg * q;
      cost -= avg * q; qty -= q;
    }
  }
  if (qty < 1e-9) { qty = 0; cost = 0; }
  return { qty, cost, realized, fees, trades: list };
}
function priceInfo(h, avg) {
  if (h.type === "Hoius") return { price: 1, at: null, source: "hoius", has: true };
  const m = S.prices[up(h.symbol || h.ticker)];
  const manual = h.manualPrice != null ? { price: h.manualPrice, at: h.manualAt, source: "käsitsi", has: true } : null;
  if (m && (!manual || new Date(m.at) > new Date(manual.at))) return { ...m, has: true };
  return manual || { price: avg, at: null, source: "ostuhind", has: false };
}
function divsFor(h) { return S.txns.filter((t) => t.kind === "dividend" && t.ticker && up(t.ticker) === up(h.ticker)).reduce((a, t) => a + t.amount, 0); }
function rows() {
  const all = S.holdings.map((h) => {
    const pos = position(h);
    const avgPrice = pos.qty ? pos.cost / pos.qty : 0;
    const pi = priceInfo(h, avgPrice);
    const value = pos.qty * pi.price;
    return { ...h, ...pos, avgPrice, price: pi.price, pi, value, pl: value - pos.cost };
  });
  const list = all.filter((r) => r.qty > 0);
  const total = list.reduce((a, r) => a + r.value, 0);
  all.forEach((r) => (r.share = total ? r.value / total : 0));
  list.sort((a, b) => b.value - a.value);
  const closed = all.filter((r) => r.qty === 0);
  return {
    list, closed, total,
    cost: list.reduce((a, r) => a + r.cost, 0),
    realized: all.reduce((a, r) => a + r.realized, 0),
  };
}
const stale = (iso) => !iso || Date.now() - new Date(iso).getTime() > 3 * 864e5;
const yearNow = () => String(new Date().getFullYear());

/* ---------- portfell ---------- */
function render() { renderPortfolio(); renderPlan(); renderCalc(); renderTx(); }

function holdingItem(r, onclick) {
  const sub = r.type === "Hoius"
    ? [r.rate ? `${pct(r.rate, 2)} intress` : "Hoius", r.maturity ? "kuni " + new Date(r.maturity).toLocaleDateString("et-EE") : ""].filter(Boolean).join(" · ")
    : r.qty ? `${qtyFmt(r.qty)} tk · ${r.pi.source === "ostuhind" ? "hind puudub" : eur(r.price)}${r.pi.source === "käsitsi" ? " (käsitsi)" : ""}` : "müüdud";
  const plPct = r.cost ? (r.pl / r.cost) * 100 : 0;
  return el("li", {}, el("button", { class: "item", type: "button", onclick },
    el("span", { class: "av", style: `background:${TYPE_COLOR[r.type] || "#888"}`, text: r.ticker.slice(0, 4) }),
    el("span", { class: "it-main" }, el("div", { class: "it-title", text: r.name || r.ticker }), el("div", { class: "it-sub", text: sub })),
    el("span", { class: "it-r" },
      r.qty ? el("div", { class: "it-val", text: eur0(r.value) }) : el("div", { class: "it-val " + (r.realized >= 0 ? "gain" : "loss"), text: sign(r.realized) + eur0(Math.abs(r.realized)) }),
      r.type === "Hoius" ? el("div", { class: "it-pl muted", text: pct(r.share * 100, 0) })
        : r.qty ? el("div", { class: "it-pl " + (r.pl >= 0 ? "gain" : "loss"), text: `${sign(r.pl)}${eur0(Math.abs(r.pl))} · ${sign(plPct)}${pct(Math.abs(plPct))}` })
        : el("div", { class: "it-pl muted", text: "realiseeritud" }))));
}

function renderPortfolio() {
  const { list, closed, total, cost, realized } = rows();
  $("k-value").textContent = eur0(total);
  const pl = total - cost, kp = $("k-pl");
  kp.textContent = list.length ? `${sign(pl)}${eur0(Math.abs(pl))} (${sign(pl)}${pct(cost ? Math.abs(pl / cost) * 100 : 0)}) ${pl >= 0 ? "kasumis" : "kahjumis"}` : "Lisa oma esimene investeering";
  kp.className = "hero-pl " + (!list.length ? "" : pl >= 0 ? "up" : "down");
  $("k-cost").textContent = list.length ? `Investeeritud ${eur0(cost)}` + (Math.abs(realized) > 0.004 ? ` · müükidelt ${sign(realized)}${eur0(Math.abs(realized))}` : "") : "";
  const dates = list.filter((r) => r.pi.source !== "ostuhind" && r.pi.at).map((r) => r.pi.at).sort();
  $("freshness").textContent = dates.length ? "Hinnad " + new Date(dates[0]).toLocaleString("et-EE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

  const byType = {}; list.forEach((r) => (byType[r.type] = (byType[r.type] || 0) + r.value));
  const types = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  $("alloc").replaceChildren(...types.map(([t, v]) => el("span", { style: `flex:${v} 0 0;background:${TYPE_COLOR[t] || "#888"}`, title: t })));
  $("alloc").hidden = !list.length;
  $("legend").textContent = types.map(([t, v]) => `${t} ${pct(total ? (v / total) * 100 : 0, 0)}`).join(" · ");

  $("h-empty").hidden = list.length + closed.length > 0;
  $("h-list").replaceChildren(...list.map((r) => holdingItem(r, () => openDetail(r.id))),
    ...closed.map((r) => holdingItem(r, () => openDetail(r.id))));
  renderAlerts(list);
  renderTips(list);
}

function renderAlerts(list) {
  const box = $("alerts"); box.replaceChildren();
  const items = [];
  list.filter((r) => !DIVERSE.includes(r.type) && !SAFE.includes(r.type) && r.share > 0.25)
    .forEach((r) => items.push(["warn", `${r.ticker} on ${pct(r.share * 100, 0)} sinu portfellist. Kui sellel läheb halvasti, kannatab kogu portfell.`]));
  const cr = list.filter((r) => r.type === "Krüpto").reduce((a, r) => a + r.share, 0);
  if (cr > 0.1) items.push(["warn", `Krüpto on ${pct(cr * 100, 0)} portfellist. See võib lühikese ajaga palju väärtust kaotada.`]);
  const soon = Date.now() + 180 * 864e5;
  list.filter((r) => SAFE.includes(r.type) && r.maturity && new Date(r.maturity).getTime() < soon)
    .forEach((r) => items.push(["info", `${r.name || r.ticker} lõpeb ${new Date(r.maturity).toLocaleDateString("et-EE")}. Mõtle, kuhu see raha edasi läheb.`]));
  const st = list.filter((r) => r.type !== "Hoius" && (r.pi.source === "ostuhind" || stale(r.pi.at)));
  if (st.length) items.push(["info", `${st.map((r) => r.ticker).join(", ")}: hind puudub või on vana. Vajuta üleval ↻ või ava investeering → Muuda andmeid.`]);
  items.slice(0, 3).forEach(([c, t]) => box.append(el("div", { class: "alert " + c, text: t })));
}

function renderTips(list) {
  const total = list.reduce((a, r) => a + r.value, 0);
  const hasDiverse = list.some((r) => DIVERSE.includes(r.type));
  const hasTargets = list.some((r) => r.target > 0);
  const buys = S.trades.filter((t) => t.side === "buy").length;
  const tips = [
    { hot: list.length > 0 && !hasDiverse, t: "Hajuta riski", d: "Üks laia maailma indeksfond (ETF) sisaldab tuhandeid ettevõtteid. Siis ei sõltu sa ühe firma käekäigust." },
    { hot: list.length > 0 && !hasTargets, t: "Pane paika oma jaotus", d: "Otsusta ette, mitu protsenti on aktsiaid, fonde ja võlakirju. Kuuplaan ütleb siis igal kuul, mida osta." },
    { hot: total > 0 && buys < 3, t: "Investeeri regulaarselt", d: "Sama summa iga kuu on lihtsam ja rahulikum kui õige hetke ootamine. Keegi ei tea, kuhu turg homme liigub." },
    { hot: false, t: "Enne investeerimist hädaabiraha", d: "Hoia 3–6 kuu kulud kergesti kättesaadavana, et ei peaks halval hetkel investeeringuid müüma." },
    { hot: false, t: "Raha, mida vajad 5 aasta jooksul, ära pane aktsiatesse", d: "Lühemaks ajaks sobivad paremini hoius või võlakirjad, sest aktsiad võivad vahepeal palju langeda." },
    { hot: false, t: "Jälgi tasusid", d: "1 % aastatasu võtab 30 aastaga umbes neljandiku lõppsummast. Laia indeksfondi tasu on tavaliselt alla 0,3 %." },
    { hot: false, t: "Kasuta investeerimiskontot", d: "Eestis lükkab investeerimiskonto tulumaksu edasi seni, kuni raha kontolt välja võtad." },
    { hot: false, t: "Ära müü paanikas", d: "Langused on normaalsed. Pikaajaline investor, kes jätkab ka languste ajal, on ajalooliselt kõige paremini välja tulnud." },
  ].sort((a, b) => b.hot - a.hot);
  $("tips").replaceChildren(...tips.slice(0, 5).map((x) => el("li", { class: "tip" + (x.hot ? " hot" : "") },
    x.hot ? el("span", { class: "tag", text: "Sinu portfellile" }) : null, el("b", { text: x.t }), el("span", { text: x.d }))));
}

/* ---------- kuuplaan ---------- */
function renderPlan() {
  const { list, total } = rows();
  if (document.activeElement !== $("p-monthly")) $("p-monthly").value = S.config.monthly ?? "";
  const m = Math.max(0, +$("p-monthly").value || 0);
  const tsum = list.reduce((a, r) => a + (+r.target || 0), 0);
  const ts = $("t-sum"); ts.textContent = `Kokku ${fmt(tsum, 0)} %`; ts.className = "pill" + (Math.abs(tsum - 100) > 0.01 ? " off" : "");
  const tl = $("p-targets");
  if (!tl.contains(document.activeElement)) {
    tl.replaceChildren(...list.map((r) => {
      const inp = el("input", { type: "number", inputmode: "decimal", min: "0", max: "100", step: "5", value: r.target ? String(r.target) : "", placeholder: "0", "aria-label": `${r.ticker} sihtosakaal` });
      inp.addEventListener("change", () => saveTarget(r.id, inp.value));
      return el("li", { class: "row-t" }, el("span", { class: "it-main" }, el("div", { class: "it-title", text: r.name || r.ticker }),
        el("div", { class: "it-sub", text: `Praegu ${pct(r.share * 100, 0)}` })), el("label", { class: "money", style: "gap:4px" }, inp, el("span", { style: "font-size:16px", text: "%" })));
    }));
  }
  const after = total + m;
  const def = list.map((r) => Math.max(0, ((+r.target || 0) / (tsum || 1)) * after - r.value));
  const dsum = def.reduce((a, b) => a + b, 0);
  const buys = list.map((r, i) => ({ r, buy: dsum ? (def[i] / dsum) * m : 0 })).filter((x) => x.buy >= 0.5);
  let foot = "";
  if (!list.length) foot = "Lisa kõigepealt investeeringud Portfelli vaates.";
  else if (!tsum) foot = "Pane allpool igale investeeringule soovitud osakaal, siis näed, mida osta.";
  else if (!m) foot = "Sisesta kuusumma.";
  $("p-buys").replaceChildren(...buys.map(({ r, buy }) => {
    const units = r.type !== "Hoius" && r.price ? buy / r.price : null;
    return el("li", {}, el("div", { class: "item", style: "cursor:default" },
      el("span", { class: "av", style: `background:${TYPE_COLOR[r.type] || "#888"}`, text: r.ticker.slice(0, 4) }),
      el("span", { class: "it-main" }, el("div", { class: "it-title", text: r.name || r.ticker }),
        el("div", { class: "it-sub", text: units == null ? "lisa hoiusele" : units < 1 ? `≈ ${fmt(units, 2)} tk (murdosa)` : `≈ ${fmt(Math.floor(units), 0)} tk` })),
      el("span", { class: "it-r" }, el("div", { class: "it-val gain", text: eur(buy, 0) }))));
  }));
  if (!foot && buys.length) foot = "Ostud viivad portfelli soovitud jaotusele lähemale ilma midagi müümata.";
  $("p-foot").textContent = foot;
}
async function saveTarget(id, v) {
  const { error } = await sb.from("holdings").update({ target: v === "" ? 0 : +v }).eq("id", id);
  if (error) return toast("Salvestamine ebaõnnestus: " + error.message);
  const h = S.holdings.find((x) => x.id === id); if (h) h.target = v === "" ? 0 : +v;
  renderPlan(); renderTips(rows().list);
}
let monthlyT;
$("p-monthly").addEventListener("input", () => {
  S.config.monthly = +$("p-monthly").value || 0; renderPlan();
  clearTimeout(monthlyT);
  monthlyT = setTimeout(async () => {
    const { error } = await sb.from("settings").upsert({ user_id: user.id, monthly: S.config.monthly });
    if (error) toast("Kuusumma salvestamine ebaõnnestus: " + error.message);
  }, 800);
});

/* ---------- kasv ---------- */
const touched = {};
function renderCalc() {
  const { total } = rows();
  if (!touched.start) $("c-start").value = Math.round(total);
  if (!touched.monthly) $("c-monthly").value = S.config.monthly ?? 300;
  const P = +$("c-start").value || 0, M = +$("c-monthly").value || 0, R = (+$("c-rate").value || 0) / 100;
  const Y = +$("c-years").value || 20, goal = +$("c-goal").value || 0;
  $("c-monthly-v").textContent = eur(M, 0); $("c-years-v").textContent = Y + " a"; $("c-rate-v").textContent = pct(R * 100, 1);
  const rm = Math.pow(1 + R, 1 / 12) - 1;
  let v = P, paid = P, hit = P >= goal && goal ? 0 : null; const pts = [{ y: 0, v, paid }];
  for (let mth = 1; mth <= 960; mth++) {
    v = v * (1 + rm) + M; paid += M;
    if (goal && hit == null && v >= goal) hit = mth;
    if (mth <= Y * 12 && mth % 12 === 0) pts.push({ y: mth / 12, v, paid });
    if (mth >= Y * 12 && (hit != null || !goal)) break;
  }
  const last = pts[pts.length - 1];
  $("c-when").textContent = `${Y} aasta pärast võiks sul olla`;
  $("c-final").textContent = eur(last.v, 0);
  $("c-split").textContent = `Sisse makstud ${eur(last.paid, 0)} · kasv ${eur(last.v - last.paid, 0)}`;
  const now = new Date();
  $("c-goal-out").textContent = !goal ? "" : hit === 0 ? "🎉 Eesmärk on juba käes."
    : hit ? `${eur(goal, 0)} on käes ${new Date(now.getFullYear(), now.getMonth() + hit).toLocaleDateString("et-EE", { month: "long", year: "numeric" })} (${Math.floor(hit / 12)} a ${hit % 12} k).`
    : "Selle kuumaksega eesmärk 80 aastaga ei täitu.";
  drawChart(pts);
}
function drawChart(pts) {
  const W = 520, H = 170, l = 4, r = 4, t = 14, b = 20, max = Math.max(...pts.map((p) => p.v)) * 1.08 || 1, n = pts[pts.length - 1].y || 1;
  const x = (y) => l + ((W - l - r) * y) / n, yv = (v) => t + (H - t - b) * (1 - v / max);
  const area = (k) => `M${x(0)},${yv(0)} ` + pts.map((p) => `L${x(p.y)},${yv(p[k])}`).join(" ") + ` L${x(n)},${yv(0)} Z`;
  const line = (k) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.y)},${yv(p[k])}`).join(" ");
  const last = pts[pts.length - 1];
  $("chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Kasvu prognoos" style="margin-top:10px">
  <path d="${area("v")}" fill="#7FE0B2" fill-opacity=".22"/><path d="${area("paid")}" fill="#EAF4EE" fill-opacity=".12"/>
  <path d="${line("paid")}" fill="none" stroke="#9FC2B1" stroke-width="1.5" stroke-dasharray="4 4"/>
  <path d="${line("v")}" fill="none" stroke="#7FE0B2" stroke-width="2.5"/>
  <circle cx="${x(last.y)}" cy="${yv(last.v)}" r="5" fill="#7FE0B2"/>
  <text x="${l}" y="${H - 4}">täna</text><text x="${W - r}" y="${H - 4}" text-anchor="end">${n} a</text></svg>`;
}
$("c-start").addEventListener("input", () => { touched.start = 1; renderCalc(); });
$("c-monthly").addEventListener("input", () => { touched.monthly = 1; renderCalc(); });
["c-rate", "c-years", "c-goal"].forEach((id) => $(id).addEventListener("input", renderCalc));

/* ---------- tulu ---------- */
function renderTx() {
  const y = yearNow();
  $("y-now").textContent = y; $("y-now2").textContent = y;
  const sum = (k) => S.txns.filter((t) => t.kind === k && String(t.date).startsWith(y)).reduce((a, t) => a + t.amount, 0);
  $("y-div").textContent = eur(sum("dividend"));
  $("y-dep").textContent = eur(sum("deposit") - sum("withdraw"));
  const list = [...S.txns].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  $("t-empty").hidden = list.length > 0;
  $("t-list").replaceChildren(...list.map((t) => el("li", {}, el("button", { class: "item", type: "button", onclick: () => openTx(t) },
    el("span", { class: "av", style: `background:${t.kind === "dividend" ? "#1F6B4F" : t.kind === "deposit" ? "#3E6FA3" : "#B4423A"}`, text: t.kind === "dividend" ? "DIV" : t.kind === "deposit" ? "+" : "−" }),
    el("span", { class: "it-main" }, el("div", { class: "it-title", text: KIND[t.kind] + (t.ticker ? " · " + t.ticker : "") }),
      el("div", { class: "it-sub", text: new Date(t.date).toLocaleDateString("et-EE", { day: "numeric", month: "long", year: "numeric" }) })),
    el("span", { class: "it-r" }, el("div", { class: "it-val " + (t.kind === "withdraw" ? "loss" : t.kind === "dividend" ? "gain" : ""), text: (t.kind === "withdraw" ? "−" : "+") + eur(t.amount) }))))));
  const { cost } = rows();
  const now = new Date(), yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
  const d12 = S.txns.filter((t) => t.kind === "dividend" && t.date >= yearAgo).reduce((a, t) => a + t.amount, 0);
  $("y-yield").textContent = cost && d12 ? `Viimase 12 kuuga said dividende ${eur(d12)}, see on ${pct((d12 / cost) * 100, 2)} investeeritud rahast.` : "";
}

/* ---------- alumine leht ---------- */
const PANES = ["h-form", "t-form", "d-view", "r-form"];
function openSheet(title, paneId) {
  $("sheet-title").textContent = title;
  PANES.forEach((id) => ($(id).hidden = id !== paneId));
  $("sheet").hidden = false;
  document.body.style.overflow = "hidden";
  $("sheet").querySelector(".sheet").scrollTop = 0;
}
function closeSheet() { $("sheet").hidden = true; document.body.style.overflow = ""; openDetailId = null; }
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeSheet));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });

function chipGroup(boxId, options, onPick) {
  const box = $(boxId);
  let value = options[0][0];
  const set = (v) => { value = v; box.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-checked", c.dataset.v === v)); onPick && onPick(v); };
  box.replaceChildren(...options.map(([v, label]) => el("button", { class: "chip", type: "button", role: "radio", "data-v": v, text: label, onclick: () => set(v) })));
  return { get: () => value, set };
}

/* ----- tehingu väljad (jagatud uue investeeringu ja tehingu vormi vahel) ----- */
let trType = "ETF", fxManual = false;
const curPick = chipGroup("tr-cur", [["EUR", "€ EUR"], ["USD", "$ USD"]], () => { syncTrade(); if (curPick.get() === "USD" && !fxManual) loadFx(); });
function mountTradeFields(slotId, type) {
  $(slotId).append($("tr-fields"));
  trType = type;
  syncTrade();
}
function syncTrade() {
  const dep = trType === "Hoius", usd = curPick.get() === "USD";
  $("tr-qty-lbl").textContent = dep ? "Summa €" : "Kogus (tk)";
  $("tr-price-row").hidden = dep; $("tr-price").required = !dep;
  $("tr-cur-row").hidden = dep;
  $("tr-usd").hidden = dep || !usd;
  $("tr-price-lbl").textContent = usd ? "Hind 1 tk $" : "Hind 1 tk €";
  tradeTotal();
}
async function loadFx() {
  const date = $("tr-date").value;
  $("tr-fx").placeholder = "laen…";
  const v = await usdToEur(date);
  if (fxManual || curPick.get() !== "USD" || $("tr-date").value !== date) return;
  if (v) $("tr-fx").value = v.toFixed(4); else $("tr-fx").placeholder = "sisesta ise";
  tradeTotal();
}
function tradeValues() {
  const dep = trType === "Hoius", usd = !dep && curPick.get() === "USD";
  const qty = +$("tr-qty").value || 0;
  return {
    date: $("tr-date").value || today(), qty,
    price: dep ? 1 : +$("tr-price").value || 0,
    currency: usd ? "USD" : "EUR", fx: usd ? +$("tr-fx").value || 0 : 1,
    fee: dep ? 0 : +$("tr-fee").value || 0,
  };
}
function tradeTotal() {
  const v = tradeValues(), sell = !$("r-form").hidden && sidePick.get() === "sell";
  const gross = v.qty * v.price * (v.fx || 0);
  $("tr-fx-out").textContent = v.currency === "USD" && v.price && v.fx ? `${fmt(v.price, 2)} $ × ${fmt(v.fx, 4)} = ${eur(v.price * v.fx)} tükk` : "Kurss võetakse Euroopa Keskpangast sinu valitud päeva järgi.";
  $("tr-total").textContent = trType === "Hoius" || !v.qty || !v.price ? "" :
    sell ? `Saad kätte ${eur(gross - v.fee)}${v.fee ? ` (tasu ${eur(v.fee)} maha arvatud)` : ""}` : `Kokku ${eur(gross + v.fee)}${v.fee ? ` (sh tasu ${eur(v.fee)})` : ""}`;
}
$("tr-date").addEventListener("change", () => { fxManual = false; if (curPick.get() === "USD") loadFx(); });
$("tr-fx").addEventListener("input", () => { fxManual = true; tradeTotal(); });
["tr-qty", "tr-price", "tr-fee"].forEach((id) => $(id).addEventListener("input", tradeTotal));
function resetTradeFields(t) {
  $("tr-date").value = t ? t.date : today();
  $("tr-qty").value = t ? t.qty : ""; $("tr-price").value = t ? t.price : ""; $("tr-fee").value = t && t.fee ? t.fee : "";
  $("tr-fx").value = t && t.currency === "USD" ? t.fx : "";
  fxManual = !!(t && t.currency === "USD");
  curPick.set(t ? t.currency : "EUR");
}
async function validTrade() {
  const v = tradeValues();
  if (!(v.qty > 0)) { toast("Sisesta kogus."); return null; }
  if (trType !== "Hoius" && !(v.price > 0)) { toast("Sisesta hind."); return null; }
  if (v.currency === "USD" && !(v.fx > 0)) {
    v.fx = await usdToEur(v.date);
    if (!(v.fx > 0)) { toast("Dollari kurssi ei õnnestunud laadida. Sisesta kurss käsitsi."); return null; }
  }
  return v;
}

/* ----- investeeringu vorm (uus / muuda andmeid) ----- */
let editing = null, delArm = false;
const typePick = chipGroup("h-types", TYPES.map((t) => [t, t]), syncType);
function syncType(t) {
  const bond = t === "Võlakiri", dep = t === "Hoius";
  $("h-extra").hidden = !(bond || dep);
  $("h-rate-lbl").textContent = dep ? "Intress % aastas" : "Kupong % aastas";
  $("h-mat-lbl").textContent = dep ? "Tähtaeg" : "Lunastus";
  $("h-ticker-lbl").textContent = dep ? "Lühinimi" : bond ? "Võlakirja sümbol või nimi" : "Otsi nime või sümboli järgi";
  $("h-ticker").placeholder = dep ? "HOIUS" : bond ? "nt LHVB070033A" : { ETF: "nt Vanguard, VWCE", Aktsia: "nt LHV, Apple, Tesla", Fond: "nt iShares", Krüpto: "nt Bitcoin" }[t] || "nt Vanguard, LHV, Apple";
  $("h-nom-wrap").hidden = !bond; $("h-sym-wrap").hidden = dep; $("h-manual-wrap").hidden = dep;
  $("h-more").hidden = dep;
  $("h-buy-lbl").textContent = dep ? "Sissemakse hoiusele" : "Esimene ost";
  $("h-symbol").placeholder = guessSymbol($("h-ticker").value, t) || "arvatakse ise";
  if (t === "Pension") $("h-ticker").placeholder = "nt Tuleva";
  const pen = t === "Pension" && !editing;
  $("h-pen").hidden = !pen;
  $("h-pen-val").required = pen; $("h-pen-pl").required = pen;
  if (!editing) {
    $("h-buy").hidden = pen;
    if (pen) $("r-slot").append($("tr-fields"));
    else if (!$("h-buy-slot").contains($("tr-fields"))) mountTradeFields("h-buy-slot", t);
    else { trType = t; syncTrade(); }
  }
}
let searchT, searchSeq = 0, picked = null;
function hideResults() { $("h-results").hidden = true; $("h-results").replaceChildren(); }
function showPicked(sym, exch) { const p = $("h-picked"); p.textContent = `✓ ${sym}${exch ? " · " + exch : ""} · hind tuleb automaatselt`; p.hidden = false; }
$("h-ticker").addEventListener("input", () => {
  $("h-symbol").placeholder = guessSymbol($("h-ticker").value, typePick.get()) || "arvatakse ise";
  const q = $("h-ticker").value.trim(), t = typePick.get();
  if (picked && q !== picked.short) { picked = null; $("h-picked").hidden = true; $("h-symbol").value = ""; }
  clearTimeout(searchT);
  if (picked || q.length < 2 || t === "Hoius") { hideResults(); return; }
  searchT = setTimeout(async () => {
    const seq = ++searchSeq;
    const local = t === "Pension" || /tul|pens|samba|tuk|tuv/i.test(q) ? PENSION_FUNDS : [];
    const { data, error } = t === "Pension" ? { data: { results: [] } } : await sb.functions.invoke("search", { body: { q } });
    if (seq !== searchSeq || picked) return;
    const res = local.concat(error ? [] : (data?.results || [])).slice(0, 8);
    if (!res.length) { hideResults(); return; }
    $("h-results").replaceChildren(...res.map((x) => el("li", {}, el("button", { class: "res", type: "button", onclick: () => pickInstrument(x) },
      el("span", { class: "av sm", style: `background:${TYPE_COLOR[x.type] || "#888"}`, text: x.symbol.split(/[.\-]/)[0].slice(0, 4) }),
      el("span", { class: "it-main" }, el("div", { class: "it-title", text: x.name }), el("div", { class: "it-sub", text: `${x.symbol} · ${x.exchange} · ${x.type}` }))))));
    $("h-results").hidden = false;
  }, 300);
});
function pickInstrument(x) {
  const short = x.short || x.symbol.split(/[.\-]/)[0];
  picked = { ...x, short };
  if (TYPES.includes(x.type)) typePick.set(x.type);
  $("h-ticker").value = short; $("h-name").value = x.name; $("h-symbol").value = x.symbol;
  if (/\.(DE|F|AS|PA|MI|TL|RG|VS|HE|BR|MC|VI|LS|IR)$/.test(x.symbol)) curPick.set("EUR");
  else if (!x.symbol.includes(".") && x.type !== "Krüpto") { curPick.set("USD"); }
  hideResults(); showPicked(x.symbol, x.exchange);
  (x.type === "Pension" ? $("h-pen-val") : $("tr-qty")).focus();
}
function openHolding(r) {
  editing = r || null; delArm = false;
  $("h-form").reset();
  picked = null; hideResults(); $("h-picked").hidden = true;
  if (r && r.symbol && r.type !== "Hoius") { picked = { short: r.ticker, symbol: r.symbol }; showPicked(r.symbol, ""); }
  $("h-buy").hidden = !!r;
  if (!r) { resetTradeFields(null); mountTradeFields("h-buy-slot", "ETF"); }
  else $("r-slot").append($("tr-fields")); // peidetud kohustuslikud väljad ei tohi vormi blokeerida
  typePick.set(r ? r.type : "ETF");
  if (r) {
    $("h-ticker").value = r.ticker; $("h-name").value = r.name || "";
    $("h-rate").value = r.rate ?? ""; $("h-mat").value = r.maturity || ""; $("h-nom").value = r.nominal ?? "";
    $("h-symbol").value = r.symbol || ""; $("h-manual").value = r.manualPrice ?? "";
  }
  syncType(typePick.get());
  $("h-ticker").required = true;
  $("h-delete").hidden = !r; $("h-delete").textContent = "Kustuta investeering koos tehingutega";
  $("h-submit").textContent = r ? "Salvesta" : "Lisa investeering";
  openSheet(r ? "Muuda: " + (r.name || r.ticker) : "Lisa investeering", "h-form");
  if (!r) setTimeout(() => $("h-ticker").focus(), 50);
}
$("add-holding").addEventListener("click", () => openHolding(null));
$("h-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!S.hasTrades) return toast("Andmebaas vajab uuendust: käivita Supabase'is fail 002_trades.sql.");
  const type = typePick.get(), ticker = up($("h-ticker").value);
  if (!ticker) return;
  const body = {
    ticker, type, name: $("h-name").value.trim() || null,
    symbol: type === "Hoius" ? null : up($("h-symbol").value) || guessSymbol(ticker, type),
    rate: SAFE.includes(type) && $("h-rate").value !== "" ? +$("h-rate").value : null,
    maturity: SAFE.includes(type) && $("h-mat").value ? $("h-mat").value : null,
    nominal: type === "Võlakiri" && $("h-nom").value !== "" ? +$("h-nom").value : null,
  };
  const manual = $("h-manual").value;
  if (type !== "Hoius" && manual !== "" && (!editing || +manual !== editing.manualPrice)) { body.manual_price = +manual; body.manual_price_at = new Date().toISOString(); }
  if (type !== "Hoius" && manual === "" && editing && editing.manualPrice != null) { body.manual_price = null; body.manual_price_at = null; }

  if (editing) {
    const { error } = await sb.from("holdings").update(body).eq("id", editing.id);
    if (error) return toast("Salvestamine ebaõnnestus: " + error.message);
    const id = editing.id; await loadAll(); openDetail(id); return;
  }
  if (type === "Pension") return addPension(body);
  trType = type;
  const tv = await validTrade(); if (!tv) return;
  body.qty = 0; body.avg_price = 0;
  const { data, error } = await sb.from("holdings").insert(body).select().single();
  if (error) return toast("Salvestamine ebaõnnestus: " + error.message);
  const r2 = await sb.from("trades").insert({ holding_id: data.id, side: "buy", ...tv });
  if (r2.error) { await sb.from("holdings").delete().eq("id", data.id); return toast("Ostu salvestamine ebaõnnestus: " + r2.error.message); }
  closeSheet(); await loadAll();
  if (type !== "Hoius") updatePrices(true);
});
/* Pensionifond: pangast turuväärtus ja kasum → osakute arv päevahinna järgi. */
async function addPension(body) {
  const value = +$("h-pen-val").value, pl = +$("h-pen-pl").value || 0, cost = value - pl;
  if (!(value > 0) || !(cost > 0)) return toast("Sisesta turuväärtus ja kasum nii, nagu pangas näha.");
  const btn = $("h-submit"); btn.disabled = true; btn.textContent = "Otsin päevahinda…";
  try {
    body.qty = 0; body.avg_price = 0;
    const { data, error } = await sb.from("holdings").insert(body).select().single();
    if (error) return toast("Salvestamine ebaõnnestus: " + error.message);
    await sb.functions.invoke("update-prices");
    const pr = body.symbol ? (await sb.from("prices").select("*").eq("symbol", body.symbol).maybeSingle()).data : null;
    const nav = pr ? +pr.price : 0;
    let trade;
    if (nav > 0) {
      const qty = value / nav;
      trade = { holding_id: data.id, side: "buy", date: today(), qty, price: cost / qty, currency: "EUR", fx: 1, fee: 0 };
    } else {
      trade = { holding_id: data.id, side: "buy", date: today(), qty: 1, price: cost, currency: "EUR", fx: 1, fee: 0 };
      await sb.from("holdings").update({ manual_price: value, manual_price_at: new Date().toISOString() }).eq("id", data.id);
      toast("Päevahinda ei leitud, seega salvestasin väärtuse käsitsi. Uuenda seda aeg-ajalt: ava fond → Muuda andmeid.");
    }
    const r2 = await sb.from("trades").insert(trade);
    if (r2.error) { await sb.from("holdings").delete().eq("id", data.id); return toast("Salvestamine ebaõnnestus: " + r2.error.message); }
    closeSheet(); await loadAll();
  } finally { btn.disabled = false; btn.textContent = "Lisa investeering"; }
}
$("h-delete").addEventListener("click", async () => {
  if (!delArm) { delArm = true; $("h-delete").textContent = "Vajuta uuesti, et kustutada"; return; }
  const { error } = await sb.from("holdings").delete().eq("id", editing.id);
  if (error) return toast("Kustutamine ebaõnnestus: " + error.message);
  closeSheet(); loadAll();
});

/* ----- investeeringu detailvaade ----- */
let openDetailId = null;
function openDetail(id) {
  const r = rows().list.concat(rows().closed).find((x) => x.id === id);
  if (!r) return;
  openDetailId = id;
  fillDetail(r);
  openSheet(r.name || r.ticker, "d-view");
}
function fillDetail(r) {
  const dep = r.type === "Hoius";
  $("d-value").textContent = eur(r.value);
  const plPct = r.cost ? (r.pl / r.cost) * 100 : 0;
  $("d-pl").textContent = dep ? (r.rate ? `${pct(r.rate, 2)} intress aastas` : "") : r.qty ? `${sign(r.pl)}${eur(Math.abs(r.pl))} (${sign(plPct)}${pct(Math.abs(plPct), 2)})` : "Positsioon on müüdud";
  $("d-pl").className = "d-pl " + (dep ? "muted" : r.pl >= 0 ? "gain" : "loss");
  const divs = divsFor(r);
  const st = dep ? [
    ["Summa", eur(r.qty)], ["Tähtaeg", r.maturity ? new Date(r.maturity).toLocaleDateString("et-EE") : "–"],
    ["Intress aastas", r.rate ? eur((r.qty * r.rate) / 100) : "–"], ["Osakaal", pct(r.share * 100)],
  ] : [
    ["Kogus", qtyFmt(r.qty) + " tk"], ["Keskmine ostuhind", eur(r.avgPrice)],
    ["Investeeritud", eur(r.cost)], ["Praegune hind", r.pi.source === "ostuhind" ? "puudub" : eur(r.price)],
    ["Kasum (avatud)", `${sign(r.pl)}${eur(Math.abs(r.pl))}`], ["Müükidelt", `${sign(r.realized)}${eur(Math.abs(r.realized))}`],
    ["Dividendid", eur(divs)], ["Tasud kokku", eur(r.fees)],
  ];
  $("d-stats").replaceChildren(...st.map(([k, v]) => el("div", {}, el("dt", { text: k }), el("dd", { class: "num", text: v }))));
  let src = "";
  if (!dep) {
    if (r.pi.source === "ostuhind") src = "Turuhinda veel pole. Vajuta üleval ↻ või sisesta hind: Muuda andmeid → Täpsemalt.";
    else if (r.pi.source === "käsitsi") src = `Hind sisestatud käsitsi ${new Date(r.pi.at).toLocaleString("et-EE")}.`;
    else {
      const native = r.pi.native && r.pi.cur && r.pi.cur !== "EUR" ? ` (${fmt(r.pi.native, 2)} ${r.pi.cur}, eurodesse teisendatud)` : "";
      src = `Hind ${eur(r.price)}${native} · ${r.symbol} · ${r.pi.source || "Yahoo"} ${new Date(r.pi.at).toLocaleString("et-EE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}. Börsihind võib olla kuni 20 min viivitusega.`;
    }
    const total = r.pl + r.realized + divs;
    if (r.trades.length) src += ` Kogukasum koos müükide ja dividendidega: ${sign(total)}${eur(Math.abs(total))}.`;
  }
  $("d-price").textContent = src;
  $("d-sell").hidden = dep || !r.qty;
  $("d-buy").textContent = dep ? "+ Lisa summat" : "+ Ost";
  $("d-trades-empty").hidden = r.trades.length > 0;
  $("d-trades").replaceChildren(...[...r.trades].reverse().map((t) => el("li", {}, el("button", { class: "item tr", type: "button", onclick: () => openTrade(r, t) },
    el("span", { class: "side " + t.side, text: t.side === "buy" ? (dep ? "+" : "OST") : "MÜÜK" }),
    el("span", { class: "it-main" },
      el("div", { class: "it-title", text: dep ? eur(t.qty) : `${qtyFmt(t.qty)} tk × ${fmt(t.price, 2)} ${t.currency === "USD" ? "$" : "€"}` }),
      el("div", { class: "it-sub", text: [dateEt(t.date), t.currency === "USD" ? `kurss ${fmt(t.fx, 4)}` : "", t.fee ? `tasu ${eur(t.fee)}` : ""].filter(Boolean).join(" · ") })),
    el("span", { class: "it-r" }, el("div", { class: "it-val", text: eur(t.qty * t.price * t.fx + (t.side === "buy" ? t.fee : -t.fee)) }))))));
}
$("d-buy").addEventListener("click", () => { const r = rows().list.concat(rows().closed).find((x) => x.id === openDetailId); if (r) openTrade(r, null, "buy"); });
$("d-sell").addEventListener("click", () => { const r = rows().list.find((x) => x.id === openDetailId); if (r) openTrade(r, null, "sell"); });
$("d-edit").addEventListener("click", () => { const r = rows().list.concat(rows().closed).find((x) => x.id === openDetailId); if (r) openHolding(r); });

/* ----- tehingu vorm ----- */
let tradeCtx = null, trDelArm = false;
const sidePick = chipGroup("r-side", [["buy", "Ost"], ["sell", "Müük"]], () => tradeTotal());
function openTrade(r, t, side) {
  tradeCtx = { r, t }; trDelArm = false;
  resetTradeFields(t);
  if (!t && r.trades.length) { const last = r.trades[r.trades.length - 1]; curPick.set(last.currency); }
  sidePick.set(t ? t.side : side || "buy");
  $("r-side").hidden = r.type === "Hoius";
  mountTradeFields("r-slot", r.type);
  $("r-delete").hidden = !t; $("r-delete").textContent = "Kustuta tehing";
  openSheet(`${t ? "Muuda tehingut" : sidePick.get() === "sell" ? "Müük" : r.type === "Hoius" ? "Lisa summat" : "Ost"} · ${r.ticker}`, "r-form");
  openDetailId = r.id;
  if (!t) setTimeout(() => $("tr-qty").focus(), 50);
}
$("r-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { r, t } = tradeCtx;
  trType = r.type;
  const v = await validTrade(); if (!v) return;
  const side = r.type === "Hoius" ? "buy" : sidePick.get();
  if (side === "sell") {
    const others = r.trades.filter((x) => !t || x.id !== t.id);
    const have = others.reduce((a, x) => a + (x.side === "buy" ? x.qty : -x.qty), 0);
    if (v.qty > have + 1e-9) return toast(`Sul on ainult ${qtyFmt(have)} tk, rohkem müüa ei saa.`);
  }
  const body = { holding_id: r.id, side, ...v };
  const { error } = t ? await sb.from("trades").update(body).eq("id", t.id) : await sb.from("trades").insert(body);
  if (error) return toast("Salvestamine ebaõnnestus: " + error.message);
  await loadAll(); openDetail(r.id);
});
$("r-delete").addEventListener("click", async () => {
  if (!trDelArm) { trDelArm = true; $("r-delete").textContent = "Vajuta uuesti, et kustutada"; return; }
  const { r, t } = tradeCtx;
  const { error } = await sb.from("trades").delete().eq("id", t.id);
  if (error) return toast("Kustutamine ebaõnnestus: " + error.message);
  await loadAll(); openDetail(r.id);
});

/* ----- dividend / sissemakse ----- */
let editingTx = null, txDelArm = false;
const kindPick = chipGroup("t-kinds", [["dividend", "Dividend"], ["deposit", "Sissemakse"], ["withdraw", "Väljamakse"]]);
function openTx(t) {
  editingTx = t || null; txDelArm = false;
  $("t-form").reset();
  kindPick.set(t ? t.kind : "dividend");
  $("t-date").value = t ? t.date : today();
  if (t) { $("t-amount").value = t.amount; $("t-ticker").value = t.ticker || ""; }
  $("t-delete").hidden = !t; $("t-delete").textContent = "Kustuta kanne";
  openSheet(t ? KIND[t.kind] : "Uus kanne", "t-form");
}
$("add-tx").addEventListener("click", () => openTx(null));
$("t-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = { kind: kindPick.get(), amount: +$("t-amount").value, date: $("t-date").value, ticker: up($("t-ticker").value) || null };
  if (!(body.amount > 0)) return;
  const { error } = editingTx ? await sb.from("txns").update(body).eq("id", editingTx.id) : await sb.from("txns").insert(body);
  if (error) return toast("Salvestamine ebaõnnestus: " + error.message);
  closeSheet(); loadAll();
});
$("t-delete").addEventListener("click", async () => {
  if (!txDelArm) { txDelArm = true; $("t-delete").textContent = "Vajuta uuesti, et kustutada"; return; }
  const { error } = await sb.from("txns").delete().eq("id", editingTx.id);
  if (error) return toast("Kustutamine ebaõnnestus: " + error.message);
  closeSheet(); loadAll();
});

/* ---------- hinnad ---------- */
async function updatePrices(quiet) {
  const b = $("refresh"); b.classList.add("spin"); b.disabled = true;
  const { data, error } = await sb.functions.invoke("update-prices");
  b.classList.remove("spin"); b.disabled = false;
  if (error) { if (!quiet) toast("Hindade uuendamine ebaõnnestus. Proovi hiljem uuesti."); return; }
  if (data?.failed?.length && !quiet) toast(`Ei leidnud hinda: ${data.failed.join(", ")}. Ava investeering → Muuda andmeid → Täpsemalt ja kontrolli hinnaallika sümbolit.`);
  loadAll();
}
$("refresh").addEventListener("click", () => updatePrices(false));

/* ---------- vahelehed ---------- */
function showTab(name) {
  document.querySelectorAll(".tabbar button").forEach((b) => (b.dataset.tab === name ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  document.querySelectorAll("[data-view]").forEach((v) => (v.hidden = v.dataset.view !== name));
  history.replaceState(null, "", "#" + name);
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tabbar button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
{ const h = location.hash.slice(1); if (["portfell", "plaan", "kasv", "tulu"].includes(h)) showTab(h); }

/* ---------- sisselogimine ---------- */
$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("auth-email").value.trim(); if (!email) return;
  $("auth-btn").disabled = true;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  $("auth-btn").disabled = false;
  $("auth-msg").textContent = error ? "Lingi saatmine ebaõnnestus: " + error.message : `Link on teel aadressile ${email}. Ava see samas seadmes.`;
});
$("logout").addEventListener("click", () => sb.auth.signOut());

function setUser(u) {
  user = u;
  $("auth-form").hidden = !!u; $("app").hidden = !u; $("app-head").hidden = !u; $("tabbar").hidden = !u;
  if (u) loadAll();
}
sb.auth.onAuthStateChange((_ev, session) => setUser(session?.user || null));
sb.auth.getSession().then(({ data }) => setUser(data.session?.user || null));
$("r-slot").append($("tr-fields"));
render();
