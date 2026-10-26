/* Kasvukonto – isiklik investeerimisäpp (Supabase) */
const cfg = window.KASVUKONTO_CONFIG || {};
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const TYPES = ["ETF", "Aktsia", "Fond", "Võlakiri", "Hoius", "Krüpto", "Muu"];
const TYPE_COLOR = { ETF: "#1F6B4F", Aktsia: "#3E6FA3", Fond: "#5E9C8F", Võlakiri: "#B07F22", Hoius: "#8A8F3C", Krüpto: "#8E5BA6", Muu: "#7A7F7C" };
const SAFE = ["Võlakiri", "Hoius"], DIVERSE = ["ETF", "Fond"];
const KIND = { dividend: "Dividend", deposit: "Sissemakse", withdraw: "Väljamakse" };
const S = { holdings: [], prices: {}, txns: [], config: { monthly: 300 } };
let user = null;

const $ = (id) => document.getElementById(id);
const fmt = (n, d) => n.toLocaleString("et-EE", { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = (n, d = 2) => (isFinite(n) ? fmt(n, d) + " €" : "–");
const eur0 = (n) => eur(n, Math.abs(n) >= 1000 ? 0 : 2);
const pct = (n, d = 1) => (isFinite(n) ? fmt(n, d) + " %" : "–");
const sign = (n) => (n > 0 ? "+" : n < 0 ? "−" : "");
const up = (t) => String(t || "").trim().toUpperCase();
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

/* Arvab hinnaallika sümboli ära, et kasutaja ei peaks seda teadma. */
function guessSymbol(t, type) {
  t = up(t);
  if (!t || t.includes(".") || t.includes("-") || t.includes("=")) return t;
  if (type === "Krüpto") return t + "-EUR";
  if (/1T$/.test(t)) return t + ".TL";
  if (/1R$/.test(t)) return t + ".RG";
  if (/1L$/.test(t)) return t + ".VS";
  if (type === "ETF" || type === "Fond") return t + ".DE";
  return t;
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
  if (err) return toast("Andmete laadimine ebaõnnestus: " + err.message);
  S.holdings = h.data.map(fromRow);
  S.txns = t.data.map((r) => ({ ...r, amount: +r.amount }));
  if (s.data) S.config.monthly = +s.data.monthly;
  S.prices = {};
  p.data.forEach((r) => (S.prices[r.symbol] = { price: +r.price, at: r.updated_at, source: r.source }));
  render();
}
let toastT;
function toast(msg) { const n = $("db-notice"); n.textContent = msg; n.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (n.hidden = true), 8000); }

function priceInfo(h) {
  if (h.type === "Hoius") return { price: 1, at: null, source: "hoius", has: true };
  const m = S.prices[up(h.symbol || h.ticker)];
  const manual = h.manualPrice != null ? { price: h.manualPrice, at: h.manualAt, source: "käsitsi", has: true } : null;
  if (m && (!manual || new Date(m.at) > new Date(manual.at))) return { ...m, has: true };
  return manual || { price: h.avgPrice, at: null, source: "ostuhind", has: false };
}
function rows() {
  const list = S.holdings.map((h) => {
    const pi = priceInfo(h);
    const value = h.qty * pi.price, cost = h.qty * h.avgPrice;
    return { ...h, price: pi.price, pi, value, cost, pl: value - cost };
  });
  const total = list.reduce((a, r) => a + r.value, 0);
  list.forEach((r) => (r.share = total ? r.value / total : 0));
  list.sort((a, b) => b.value - a.value);
  return { list, total, cost: list.reduce((a, r) => a + r.cost, 0) };
}
const stale = (iso) => !iso || Date.now() - new Date(iso).getTime() > 3 * 864e5;
const yearNow = () => String(new Date().getFullYear());

/* ---------- portfell ---------- */
function render() { renderPortfolio(); renderPlan(); renderCalc(); renderTx(); }

function renderPortfolio() {
  const { list, total, cost } = rows();
  $("k-value").textContent = eur0(total);
  const pl = total - cost, kp = $("k-pl");
  kp.textContent = list.length ? `${sign(pl)}${eur0(Math.abs(pl))} (${sign(pl)}${pct(cost ? Math.abs(pl / cost) * 100 : 0)}) kogu aja jooksul` : "Lisa oma esimene investeering";
  kp.className = "hero-pl " + (!list.length ? "" : pl >= 0 ? "up" : "down");
  $("k-cost").textContent = list.length ? `Sisse pandud ${eur0(cost)}` : "";
  const dates = list.filter((r) => r.pi.source !== "ostuhind" && r.pi.at).map((r) => r.pi.at).sort();
  $("freshness").textContent = dates.length ? "Hinnad " + new Date(dates[0]).toLocaleString("et-EE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

  const byType = {}; list.forEach((r) => (byType[r.type] = (byType[r.type] || 0) + r.value));
  const types = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  $("alloc").replaceChildren(...types.map(([t, v]) => el("span", { style: `flex:${v} 0 0;background:${TYPE_COLOR[t] || "#888"}`, title: t })));
  $("alloc").hidden = !list.length;
  $("legend").textContent = types.map(([t, v]) => `${t} ${pct(total ? (v / total) * 100 : 0, 0)}`).join(" · ");

  const ul = $("h-list"); ul.replaceChildren();
  $("h-empty").hidden = list.length > 0;
  list.forEach((r) => {
    const sub = r.type === "Hoius"
      ? [r.rate ? `${pct(r.rate, 2)} intress` : "Hoius", r.maturity ? "kuni " + new Date(r.maturity).toLocaleDateString("et-EE") : ""].filter(Boolean).join(" · ")
      : `${fmt(r.qty, r.qty % 1 ? 3 : 0)} tk · ${r.pi.source === "ostuhind" ? "hind puudub" : eur(r.price)}${r.pi.source === "käsitsi" ? " (käsitsi)" : ""}`;
    const plPct = r.cost ? (r.pl / r.cost) * 100 : 0;
    ul.append(el("li", {}, el("button", { class: "item", type: "button", onclick: () => openHolding(r) },
      el("span", { class: "av", style: `background:${TYPE_COLOR[r.type] || "#888"}`, text: r.ticker.slice(0, 4) }),
      el("span", { class: "it-main" }, el("div", { class: "it-title", text: r.name || r.ticker }), el("div", { class: "it-sub", text: sub })),
      el("span", { class: "it-r" }, el("div", { class: "it-val", text: eur0(r.value) }),
        r.type === "Hoius" ? el("div", { class: "it-pl muted", text: pct(r.share * 100, 0) })
          : el("div", { class: "it-pl " + (r.pl >= 0 ? "gain" : "loss"), text: `${sign(plPct)}${pct(Math.abs(plPct))}` })))));
  });
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
  if (st.length) items.push(["info", `${st.map((r) => r.ticker).join(", ")}: hind puudub või on vana. Vajuta üleval ↻ või ava investeering ja sisesta hind.`]);
  items.slice(0, 3).forEach(([c, t]) => box.append(el("div", { class: "alert " + c, text: t })));
}

function renderTips(list) {
  const total = list.reduce((a, r) => a + r.value, 0);
  const hasDiverse = list.some((r) => DIVERSE.includes(r.type));
  const hasTargets = list.some((r) => r.target > 0);
  const dep = S.txns.filter((t) => t.kind === "deposit").length;
  const tips = [
    { hot: list.length > 0 && !hasDiverse, t: "Hajuta riski", d: "Üks laia maailma indeksfond (ETF) sisaldab tuhandeid ettevõtteid. Siis ei sõltu sa ühe firma käekäigust." },
    { hot: list.length > 0 && !hasTargets, t: "Pane paika oma jaotus", d: "Otsusta ette, mitu protsenti on aktsiaid, fonde ja võlakirju. Kuuplaan ütleb siis igal kuul, mida osta." },
    { hot: total > 0 && dep < 2, t: "Investeeri regulaarselt", d: "Sama summa iga kuu on lihtsam ja rahulikum kui õige hetke ootamine. Keegi ei tea, kuhu turg homme liigub." },
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

  // sihtjaotuse read (ära joonista üle, kui kasutaja just trükib)
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
  const bl = $("p-buys"); bl.replaceChildren();
  let foot = "";
  if (!list.length) foot = "Lisa kõigepealt investeeringud Portfelli vaates.";
  else if (!tsum) foot = "Pane allpool igale investeeringule soovitud osakaal, siis näed, mida osta.";
  else if (!m) foot = "Sisesta kuusumma.";
  buys.forEach(({ r, buy }) => {
    const units = r.type !== "Hoius" && r.price ? buy / r.price : null;
    bl.append(el("li", {}, el("div", { class: "item", style: "cursor:default" },
      el("span", { class: "av", style: `background:${TYPE_COLOR[r.type] || "#888"}`, text: r.ticker.slice(0, 4) }),
      el("span", { class: "it-main" }, el("div", { class: "it-title", text: r.name || r.ticker }),
        el("div", { class: "it-sub", text: units == null ? "lisa hoiusele" : units < 1 ? `≈ ${fmt(units, 2)} tk (murdosa)` : `≈ ${fmt(Math.floor(units), 0)} tk` })),
      el("span", { class: "it-r" }, el("div", { class: "it-val gain", text: eur(buy, 0) })))));
  });
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
  $("y-yield").textContent = cost && d12 ? `Viimase 12 kuuga said dividende ${eur(d12)}, see on ${pct((d12 / cost) * 100, 2)} sisse pandud rahast.` : "";
}

/* ---------- alumine leht ---------- */
function openSheet(title, formId) {
  $("sheet-title").textContent = title;
  ["h-form", "t-form"].forEach((id) => ($(id).hidden = id !== formId));
  $("sheet").hidden = false;
  document.body.style.overflow = "hidden";
}
function closeSheet() { $("sheet").hidden = true; document.body.style.overflow = ""; }
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeSheet));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });

function chipGroup(boxId, options, onPick) {
  const box = $(boxId);
  let value = options[0][0];
  const set = (v) => { value = v; box.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-checked", c.dataset.v === v)); onPick && onPick(v); };
  box.replaceChildren(...options.map(([v, label]) => el("button", { class: "chip", type: "button", role: "radio", "data-v": v, text: label, onclick: () => set(v) })));
  return { get: () => value, set };
}

/* investeering */
let editing = null, delArm = false;
const typePick = chipGroup("h-types", TYPES.map((t) => [t, t]), syncType);
function syncType(t) {
  const bond = t === "Võlakiri", dep = t === "Hoius";
  $("h-extra").hidden = !(bond || dep);
  $("h-rate-lbl").textContent = dep ? "Intress % aastas" : "Kupong % aastas";
  $("h-mat-lbl").textContent = dep ? "Tähtaeg" : "Lunastus";
  $("h-qty-lbl").textContent = dep ? "Summa €" : "Kogus (tk)";
  $("h-ticker-lbl").textContent = dep ? "Lühinimi" : "Sümbol";
  $("h-ticker").placeholder = { ETF: "VWCE", Aktsia: "LHV1T", Fond: "EUNL", Võlakiri: "LHVB070033A", Hoius: "HOIUS", Krüpto: "BTC", Muu: "" }[t] || "";
  $("h-avg-wrap").hidden = dep; $("h-avg").required = !dep;
  $("h-nom-wrap").hidden = !bond; $("h-sym-wrap").hidden = dep; $("h-manual-wrap").hidden = dep;
  $("h-more").hidden = dep;
  $("h-symbol").placeholder = guessSymbol($("h-ticker").value, t) || "arvatakse ise";
}
$("h-ticker").addEventListener("input", () => ($("h-symbol").placeholder = guessSymbol($("h-ticker").value, typePick.get()) || "arvatakse ise"));
function openHolding(r) {
  editing = r || null; delArm = false;
  $("h-form").reset();
  typePick.set(r ? r.type : "ETF");
  if (r) {
    $("h-ticker").value = r.ticker; $("h-name").value = r.name || ""; $("h-qty").value = r.qty; $("h-avg").value = r.avgPrice;
    $("h-rate").value = r.rate ?? ""; $("h-mat").value = r.maturity || ""; $("h-nom").value = r.nominal ?? "";
    $("h-symbol").value = r.symbol || ""; $("h-manual").value = r.manualPrice ?? "";
  }
  syncType(typePick.get());
  $("h-delete").hidden = !r; $("h-delete").textContent = "Kustuta investeering";
  openSheet(r ? (r.name || r.ticker) : "Lisa investeering", "h-form");
  if (!r) setTimeout(() => $("h-ticker").focus(), 50);
}
$("add-holding").addEventListener("click", () => openHolding(null));
$("h-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const type = typePick.get(), ticker = up($("h-ticker").value);
  if (!ticker) return;
  const body = {
    ticker, type, name: $("h-name").value.trim() || null,
    symbol: type === "Hoius" ? null : up($("h-symbol").value) || guessSymbol(ticker, type),
    qty: +$("h-qty").value, avg_price: type === "Hoius" ? 1 : +$("h-avg").value,
    rate: SAFE.includes(type) && $("h-rate").value !== "" ? +$("h-rate").value : null,
    maturity: SAFE.includes(type) && $("h-mat").value ? $("h-mat").value : null,
    nominal: type === "Võlakiri" && $("h-nom").value !== "" ? +$("h-nom").value : null,
  };
  const manual = $("h-manual").value;
  if (type !== "Hoius" && manual !== "" && (!editing || +manual !== editing.manualPrice)) { body.manual_price = +manual; body.manual_price_at = new Date().toISOString(); }
  if (type !== "Hoius" && manual === "" && editing && editing.manualPrice != null) { body.manual_price = null; body.manual_price_at = null; }
  const { error } = editing ? await sb.from("holdings").update(body).eq("id", editing.id) : await sb.from("holdings").insert(body);
  if (error) return toast("Salvestamine ebaõnnestus: " + error.message);
  const isNew = !editing;
  closeSheet(); await loadAll();
  if (isNew && type !== "Hoius") updatePrices(true);
});
$("h-delete").addEventListener("click", async () => {
  if (!delArm) { delArm = true; $("h-delete").textContent = "Vajuta uuesti, et kustutada"; return; }
  const { error } = await sb.from("holdings").delete().eq("id", editing.id);
  if (error) return toast("Kustutamine ebaõnnestus: " + error.message);
  closeSheet(); loadAll();
});

/* kanne */
let editingTx = null, txDelArm = false;
const kindPick = chipGroup("t-kinds", [["dividend", "Dividend"], ["deposit", "Sissemakse"], ["withdraw", "Väljamakse"]]);
function openTx(t) {
  editingTx = t || null; txDelArm = false;
  $("t-form").reset();
  kindPick.set(t ? t.kind : "dividend");
  $("t-date").value = t ? t.date : new Date().toISOString().slice(0, 10);
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
  if (data?.failed?.length && !quiet) toast(`Ei leidnud hinda: ${data.failed.join(", ")}. Ava investeering → Täpsemalt ja kontrolli hinnaallika sümbolit (nt VWCE.DE, LHV1T.TL, BTC-EUR).`);
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
render();
