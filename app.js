/* Kasvukonto – isiklik investeerimisäpp (Supabase) */
const cfg = window.KASVUKONTO_CONFIG || {};
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const TYPES = ["ETF", "Aktsia", "Fond", "Võlakiri", "Hoius", "Krüpto", "Muu"];
const TYPE_COLOR = { ETF: "var(--accent)", Aktsia: "var(--ochre)", Fond: "var(--c6)", "Võlakiri": "var(--c3)", Hoius: "var(--c4)", "Krüpto": "var(--c5)", Muu: "var(--muted)" };
const SAFE = ["Võlakiri", "Hoius"], DIVERSE = ["ETF", "Fond"];
const KIND = { dividend: "Dividend", deposit: "Sissemakse", withdraw: "Väljamakse" };
const TIPS = [
  "Hajuta: üks maailma aktsiaturu ETF sisaldab tuhandeid ettevõtteid, nii et ühe ettevõtte häda ei löö kogu portfelli.",
  "Tasud loevad. 1 % ja 0,2 % aastatasu vahe teeb 30 aastaga välja tuhandeid eurosid.",
  "Investeeri regulaarselt sama summa. Nii ostad odavalt rohkem ja kallilt vähem, ilma õiget hetke ennustamata.",
  "Enne investeerimist hoia 3–6 kuu kulud kõrvale hädaabifondina, et ei peaks langusel müüma.",
  "Eestis kasuta investeerimiskontot: tulumaksu maksad alles siis, kui võtad kasumi kontolt välja.",
  "Turud langevad aeg-ajalt 20–30 %. Ajalooliselt on kõige kallim viga olnud paanikas müümine.",
  "Raha, mida vajad 1–3 aasta jooksul (auto, korter), ei peaks olema aktsiates. Selleks sobivad hoius või võlakirjad.",
  "III sambasse makstud summalt saad tulumaksu tagasi. Kehtivad piirmäärad leiad pensionikeskus.ee lehelt.",
  "Pikaajaline investeerimine on igav ja see on hea märk. Vaata portfelli pigem kord kuus kui iga päev.",
];

const S = { holdings: [], prices: {}, txns: [], config: { monthly: 300 } };
let user = null;
const $ = (id) => document.getElementById(id);
const eur = (n, d = 2) => (isFinite(n) ? n.toLocaleString("et-EE", { minimumFractionDigits: d, maximumFractionDigits: d }) + " €" : "–");
const eur0 = (n) => eur(n, Math.abs(n) >= 1000 ? 0 : 2);
const pct = (n, d = 1) => (isFinite(n) ? n.toLocaleString("et-EE", { minimumFractionDigits: d, maximumFractionDigits: d }) + " %" : "–");
const sign = (n) => (n > 0 ? "+" : n < 0 ? "−" : "");
const up = (t) => String(t || "").trim().toUpperCase();
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
}
function guessSymbol(t, type) {
  t = up(t);
  if (!t || /[.\-=]/.test(t)) return t;
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
    sb.from("holdings").select("*"), sb.from("txns").select("*"),
    sb.from("settings").select("*").maybeSingle(), sb.from("prices").select("*"),
  ]);
  const err = h.error || t.error || s.error || p.error;
  if (err) return showError("Andmete laadimine ebaõnnestus: " + err.message);
  S.holdings = h.data.map(fromRow);
  S.txns = t.data.map((r) => ({ ...r, amount: +r.amount }));
  if (s.data) S.config.monthly = +s.data.monthly;
  S.prices = {};
  p.data.forEach((r) => (S.prices[r.symbol] = { price: +r.price, at: r.updated_at, source: r.source }));
  render();
}
function showError(msg) { const n = $("db-notice"); n.hidden = !msg; n.textContent = msg || ""; }

function priceInfo(h) {
  if (h.type === "Hoius") return { price: 1, at: new Date().toISOString(), has: true };
  const m = S.prices[up(h.symbol || h.ticker)];
  const manual = h.manualPrice != null ? { price: h.manualPrice, at: h.manualAt, source: "käsitsi", has: true } : null;
  if (m && (!manual || new Date(m.at) > new Date(manual.at))) return { ...m, has: true };
  return manual || { price: h.avgPrice, at: null, has: false };
}
function rows() {
  const list = S.holdings.map((h) => {
    const pi = priceInfo(h), value = h.qty * pi.price, cost = h.qty * h.avgPrice;
    return { ...h, price: pi.price, pi, value, cost, pl: value - cost };
  });
  const total = list.reduce((a, r) => a + r.value, 0);
  list.forEach((r) => (r.share = total ? r.value / total : 0));
  list.sort((a, b) => b.value - a.value);
  return { list, total, cost: list.reduce((a, r) => a + r.cost, 0) };
}
const stale = (iso) => !iso || Date.now() - new Date(iso).getTime() > 3 * 864e5;

/* ---------- joonistamine ---------- */
function render() { renderPortfolio(); renderPlan(); renderCalc(); renderTx(); }

function avatar(r) { return el("span", { class: "av", style: `background:${TYPE_COLOR[r.type] || "var(--muted)"}`, text: (r.ticker || "?").slice(0, 4) }); }

function renderPortfolio() {
  const { list, total, cost } = rows();
  $("k-value").textContent = eur(total);
  const pl = total - cost, k = $("k-pl");
  k.textContent = list.length ? `${sign(pl)}${eur(Math.abs(pl))} (${sign(pl)}${pct(cost ? Math.abs(pl / cost) * 100 : 0)}) kokku` : "Lisa oma esimene investeering";
  k.className = "hero-pl " + (list.length ? (pl >= 0 ? "gain" : "loss") : "");
  $("k-cost").textContent = list.length ? `Sisse pandud ${eur0(cost)}` : "";
  const dates = list.filter((r) => r.pi.has && r.type !== "Hoius").map((r) => r.pi.at).filter(Boolean).sort();
  $("freshness").textContent = dates.length ? "Hinnad " + new Date(dates[0]).toLocaleString("et-EE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

  const bar = $("alloc"); bar.replaceChildren();
  const byType = {}; list.forEach((r) => (byType[r.type] = (byType[r.type] || 0) + r.value));
  const types = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  types.forEach(([t, v]) => bar.append(el("span", { style: `flex:${v};background:${TYPE_COLOR[t]}`, title: t })));
  bar.hidden = !list.length;
  $("legend").textContent = types.map(([t, v]) => `${t} ${pct(total ? (v / total) * 100 : 0, 0)}`).join(" · ");

  const ul = $("h-list"); ul.replaceChildren();
  $("h-empty").hidden = list.length > 0;
  list.forEach((r) => {
    const plPct = r.cost ? (r.pl / r.cost) * 100 : 0;
    const sub = r.type === "Hoius"
      ? [r.rate ? `intress ${pct(r.rate, 2)}` : "hoius", r.maturity ? "kuni " + new Date(r.maturity).toLocaleDateString("et-EE") : ""].filter(Boolean).join(" · ")
      : r.type === "Võlakiri"
      ? [`${fmtQty(r.qty)} tk`, r.rate ? `kupong ${pct(r.rate, 2)}` : "", r.maturity ? new Date(r.maturity).toLocaleDateString("et-EE") : ""].filter(Boolean).join(" · ")
      : `${fmtQty(r.qty)} tk · ${eur(r.price)}`;
    const main = el("span", { class: "row-main" }, el("b", { text: r.name || r.ticker }), el("span", { text: sub }));
    if (r.type !== "Hoius" && (!r.pi.has || stale(r.pi.at))) main.querySelector("b").append(el("span", { class: "stale", title: "Hind on vana või puudub" }));
    const end = el("span", { class: "row-end" }, el("b", { text: eur(r.value) }),
      r.type === "Hoius" ? el("span", { class: "muted", text: pct(r.share * 100, 0) }) : el("span", { class: plPct >= 0 ? "gain" : "loss", text: `${sign(plPct)}${pct(Math.abs(plPct))}` }));
    ul.append(el("li", {}, el("button", { class: "row", type: "button", onclick: () => openHolding(r) }, avatar(r), main, end)));
  });
  renderAlerts(list, total);
}
const fmtQty = (q) => q.toLocaleString("et-EE", { maximumFractionDigits: 4 });

let tipIdx = Math.floor(Date.now() / 864e5) % TIPS.length;
function renderAlerts(list, total) {
  const box = $("alerts"); box.replaceChildren();
  const items = [];
  list.filter((r) => !DIVERSE.includes(r.type) && !SAFE.includes(r.type) && r.share > 0.25)
    .forEach((r) => items.push(["warn", `${r.ticker} on ${pct(r.share * 100, 0)} portfellist. Ühe ettevõtte halb aasta mõjutaks kogu portfelli.`]));
  if (list.length >= 2 && !list.some((r) => DIVERSE.includes(r.type))) items.push(["info", "Sul pole ühtegi ETF-i ega fondi, mis hajutaks raha paljude ettevõtete vahel."]);
  const cr = list.filter((r) => r.type === "Krüpto").reduce((a, r) => a + r.share, 0);
  if (cr > 0.1) items.push(["warn", `Krüpto on ${pct(cr * 100, 0)} portfellist. See võib lühikese ajaga palju väärtust kaotada.`]);
  const soon = Date.now() + 90 * 864e5;
  list.filter((r) => SAFE.includes(r.type) && r.maturity && new Date(r.maturity).getTime() < soon)
    .forEach((r) => items.push(["info", `${r.ticker} ${r.type === "Hoius" ? "tähtaeg" : "lunastus"} on ${new Date(r.maturity).toLocaleDateString("et-EE")}.`]));
  items.slice(0, 3).forEach(([c, t]) => box.append(el("div", { class: "alert " + c }, el("span", { class: "ic", text: "!" }), el("span", { text: t }))));
  if (list.length) box.append(el("div", { class: "alert tip" }, el("span", { class: "ic", text: "✦" }), el("span", { text: TIPS[tipIdx] }),
    el("button", { type: "button", text: "Järgmine", onclick: () => { tipIdx = (tipIdx + 1) % TIPS.length; renderAlerts(list, total); } })));
}

/* ----- kuuplaan ----- */
function planRows() {
  const { list, total } = rows(); const m = Math.max(0, +S.config.monthly || 0);
  const tsum = list.reduce((a, r) => a + (+r.target || 0), 0), after = total + m;
  const def = list.map((r) => Math.max(0, ((+r.target || 0) / (tsum || 1)) * after - r.value));
  const dsum = def.reduce((a, b) => a + b, 0);
  return { list, m, tsum, out: list.map((r, i) => ({ ...r, buy: dsum ? (def[i] / dsum) * m : 0 })) };
}
function renderPlan() {
  const { list, m, tsum, out } = planRows();
  if (document.activeElement !== $("p-monthly")) $("p-monthly").value = S.config.monthly ?? "";
  const buys = $("p-buys"); buys.replaceChildren();
  const foot = $("p-foot");
  if (!list.length) foot.textContent = "Lisa esmalt investeeringud Portfelli vahelehel.";
  else if (!tsum) foot.textContent = "Pane allpool igale investeeringule soovitud osakaal, siis näed siin, mida osta.";
  else {
    out.filter((r) => r.buy >= 0.5).sort((a, b) => b.buy - a.buy).forEach((r) => {
      const units = r.type === "Hoius" ? "" : `≈ ${(Math.floor((r.buy / r.price) * 100) / 100).toLocaleString("et-EE")} tk`;
      buys.append(el("li", {}, el("div", { class: "row static" }, avatar(r), el("span", { class: "row-main" }, el("b", { text: r.name || r.ticker }), el("span", { text: units })), el("span", { class: "row-end" }, el("b", { class: "gain", text: eur(r.buy) })))));
    });
    const tooBig = out.filter((r) => r.buy > 0 && r.type !== "Hoius" && r.price > r.buy).map((r) => r.ticker);
    foot.textContent = m ? (tooBig.length ? `${tooBig.join(", ")} hind on suurem kui ostusumma. Kui maakler murdosi ei luba, kogu see raha järgmiseks kuuks.` : "") : "Sisesta kuusumma.";
  }
  const sumEl = $("t-sum"); sumEl.textContent = list.length ? `Kokku ${pct(tsum, 0)}` : ""; sumEl.className = "pill" + (Math.abs(tsum - 100) > 0.5 ? " warn" : "");
  const tl = $("p-targets");
  if (!tl.contains(document.activeElement)) {
    tl.replaceChildren();
    list.forEach((r) => {
      const inp = el("input", { class: "tgt num", type: "number", inputmode: "decimal", min: "0", max: "100", step: "5", value: r.target ? String(r.target) : "", placeholder: "0", "aria-label": `${r.ticker} soovitud osakaal` });
      inp.addEventListener("change", async () => {
        const v = Math.max(0, Math.min(100, +inp.value || 0));
        const h = S.holdings.find((x) => x.id === r.id); if (h) h.target = v;
        const { error } = await sb.from("holdings").update({ target: v }).eq("id", r.id);
        if (error) showError("Salvestamine ebaõnnestus: " + error.message);
        inp.blur(); renderPlan();
      });
      tl.append(el("li", {}, el("div", { class: "row static" }, avatar(r),
        el("span", { class: "row-main" }, el("b", { text: r.name || r.ticker }), el("span", { text: `praegu ${pct(r.share * 100, 0)}` })),
        el("span", { class: "row-end" }, inp))));
    });
  }
}
let monthlyT;
$("p-monthly").addEventListener("input", () => {
  S.config.monthly = +$("p-monthly").value || 0; renderPlan(); renderCalc();
  clearTimeout(monthlyT);
  monthlyT = setTimeout(async () => {
    const { error } = await sb.from("settings").upsert({ user_id: user.id, monthly: S.config.monthly });
    if (error) showError("Salvestamine ebaõnnestus: " + error.message);
  }, 700);
});

/* ----- kasv ----- */
function renderCalc() {
  const { total } = rows();
  const st = $("c-start"), mo = $("c-monthly");
  if (st.dataset.touched !== "1") st.value = Math.round(total);
  if (mo.dataset.touched !== "1") mo.value = S.config.monthly ?? 300;
  const P = +st.value || 0, M = +mo.value || 0, R = (+$("c-rate").value || 0) / 100, Y = +$("c-years").value || 1, goal = +$("c-goal").value || 0;
  $("c-monthly-v").textContent = eur(M, 0); $("c-years-v").textContent = Y + " a"; $("c-rate-v").textContent = pct(R * 100);
  const rm = Math.pow(1 + R, 1 / 12) - 1;
  let v = P, paid = P, hit = null; const pts = [{ y: 0, v, paid }];
  for (let m = 1; m <= Y * 12; m++) { v = v * (1 + rm) + M; paid += M; if (goal && hit == null && v >= goal) hit = m; if (m % 12 === 0) pts.push({ y: m / 12, v, paid }); }
  let v2 = v, m2 = Y * 12; while (goal && hit == null && m2 < 960) { m2++; v2 = v2 * (1 + rm) + M; if (v2 >= goal) hit = m2; }
  $("c-when").textContent = `${Y} aasta pärast`;
  $("c-final").textContent = eur(v, 0);
  $("c-split").textContent = `Sisse makstud ${eur(paid, 0)} · tootlus +${eur(v - paid, 0)}`;
  const now = new Date();
  $("c-goal-out").textContent = !goal ? "" : P >= goal ? "🎯 Eesmärk on juba käes!"
    : hit ? `🎯 ${eur(goal, 0)} on käes ${new Date(now.getFullYear(), now.getMonth() + hit).toLocaleDateString("et-EE", { month: "long", year: "numeric" })} (${Math.floor(hit / 12)} a ${hit % 12} k pärast).`
    : "Selle kuumaksega eesmärk 80 aasta jooksul ei täitu. Proovi suuremat kuumakset.";
  drawChart(pts);
}
function drawChart(pts) {
  const W = 520, H = 170, l = 4, r = 4, t = 14, b = 20, max = Math.max(...pts.map((p) => p.v)) * 1.08 || 1, n = pts[pts.length - 1].y || 1;
  const x = (y) => l + ((W - l - r) * y) / n, yv = (v) => t + (H - t - b) * (1 - v / max);
  const area = (k) => `M${x(0)},${yv(0)} ` + pts.map((p) => `L${x(p.y)},${yv(p[k])}`).join(" ") + ` L${x(n)},${yv(0)} Z`;
  const line = (k) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.y)},${yv(p[k])}`).join(" ");
  const last = pts[pts.length - 1];
  $("chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Kasvu prognoos" style="margin-top:10px">
  <path d="${area("v")}" fill="#7EE0B2" fill-opacity=".22"/><path d="${area("paid")}" fill="#E9C27A" fill-opacity=".35"/>
  <path d="${line("v")}" fill="none" stroke="#7EE0B2" stroke-width="2.5"/>
  <circle cx="${x(last.y) - 4}" cy="${yv(last.v)}" r="4.5" fill="#7EE0B2"/>
  <text x="${l}" y="${H - 4}">täna</text><text x="${W - r}" y="${H - 4}" text-anchor="end">${n} a</text>
  <text x="${W / 2}" y="${H - 4}" text-anchor="middle"><tspan fill="#E9C27A">■</tspan> sissemaksed   <tspan fill="#7EE0B2">■</tspan> kasv</text></svg>`;
}
["c-start"].forEach((id) => $(id).addEventListener("input", () => { $(id).dataset.touched = "1"; renderCalc(); }));
$("c-monthly").addEventListener("input", () => { $("c-monthly").dataset.touched = "1"; renderCalc(); });
["c-rate", "c-years", "c-goal"].forEach((id) => $(id).addEventListener("input", renderCalc));

/* ----- tulu ----- */
function renderTx() {
  const y = String(new Date().getFullYear());
  $("y-now").textContent = y; $("y-now2").textContent = y;
  const ty = S.txns.filter((t) => String(t.date).startsWith(y));
  $("y-div").textContent = eur(ty.filter((t) => t.kind === "dividend").reduce((a, t) => a + t.amount, 0));
  $("y-dep").textContent = eur(ty.reduce((a, t) => a + (t.kind === "deposit" ? t.amount : t.kind === "withdraw" ? -t.amount : 0), 0));
  const ul = $("t-list"); ul.replaceChildren();
  const list = [...S.txns].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  $("t-empty").hidden = list.length > 0;
  list.forEach((t) => {
    const col = t.kind === "dividend" ? "var(--accent)" : t.kind === "deposit" ? "var(--c3)" : "var(--loss)";
    ul.append(el("li", {}, el("button", { class: "row", type: "button", onclick: () => openTx(t) },
      el("span", { class: "av", style: `background:${col}`, text: t.kind === "dividend" ? "DIV" : t.kind === "deposit" ? "+" : "−" }),
      el("span", { class: "row-main" }, el("b", { text: KIND[t.kind] + (t.ticker ? " · " + t.ticker : "") }), el("span", { text: new Date(t.date).toLocaleDateString("et-EE", { day: "numeric", month: "long", year: "numeric" }) })),
      el("span", { class: "row-end" }, el("b", { class: t.kind === "dividend" ? "gain" : t.kind === "withdraw" ? "loss" : "", text: (t.kind === "withdraw" ? "−" : "+") + eur(t.amount) })))));
  });
  const { cost } = rows();
  const now = new Date(), yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
  const d12 = S.txns.filter((t) => t.kind === "dividend" && t.date >= yearAgo).reduce((a, t) => a + t.amount, 0);
  $("y-yield").textContent = cost && d12 ? `Viimase 12 kuu dividendid moodustavad ${pct((d12 / cost) * 100, 2)} sinu investeeritud summast.` : "";
}

/* ---------- alumine leht ---------- */
let sheetMode = null, editing = null, pendingDel = false;
function openSheet(mode, title) {
  sheetMode = mode; pendingDel = false;
  $("sheet-title").textContent = title;
  $("h-form").hidden = mode !== "holding"; $("t-form").hidden = mode !== "tx";
  $("sheet").hidden = false; document.body.style.overflow = "hidden";
}
function closeSheet() { $("sheet").hidden = true; document.body.style.overflow = ""; editing = null; }
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeSheet));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });

function chips(container, values, labels, current, onPick) {
  container.replaceChildren();
  values.forEach((v, i) => container.append(el("button", { type: "button", class: "chip", role: "radio", "aria-checked": String(v === current), text: labels[i],
    onclick: () => { container.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-checked", "false")); container.children[i].setAttribute("aria-checked", "true"); onPick(v); } })));
}

let hType = "ETF";
function syncType() {
  const bond = hType === "Võlakiri", dep = hType === "Hoius";
  $("h-extra").hidden = !(bond || dep);
  $("h-rate-lbl").textContent = dep ? "Intress % aastas" : "Kupong % aastas";
  $("h-mat-lbl").textContent = dep ? "Tähtaeg" : "Lunastus";
  $("h-qty-lbl").textContent = dep ? "Summa €" : "Kogus";
  $("h-ticker-lbl").textContent = dep ? "Pank või nimetus" : "Sümbol";
  $("h-ticker").placeholder = dep ? "LHV hoius" : hType === "Krüpto" ? "BTC" : hType === "Aktsia" ? "LHV1T" : "VWCE";
  $("h-avg-wrap").hidden = dep; $("h-avg").required = !dep;
  $("h-sym-wrap").hidden = dep; $("h-manual-wrap").hidden = dep; $("h-nom-wrap").hidden = !bond;
  $("h-symbol").placeholder = guessSymbol($("h-ticker").value || $("h-ticker").placeholder, hType);
}
$("h-ticker").addEventListener("input", syncType);

function openHolding(r) {
  editing = r || null;
  $("h-form").reset();
  hType = r ? r.type : "ETF";
  chips($("h-types"), TYPES, TYPES, hType, (v) => { hType = v; syncType(); });
  if (r) {
    $("h-ticker").value = r.type === "Hoius" ? r.ticker : r.ticker; $("h-name").value = r.name || "";
    $("h-qty").value = r.qty; $("h-avg").value = r.avgPrice; $("h-rate").value = r.rate ?? ""; $("h-mat").value = r.maturity || "";
    $("h-symbol").value = r.symbol || ""; $("h-nom").value = r.nominal ?? ""; $("h-manual").value = r.manualPrice ?? "";
  }
  $("h-more").open = false;
  $("h-delete").hidden = !r; $("h-delete").textContent = "Kustuta investeering";
  syncType();
  openSheet("holding", r ? (r.name || r.ticker) : "Lisa investeering");
  if (!r) setTimeout(() => $("h-ticker").focus(), 50);
}
$("add-holding").addEventListener("click", () => openHolding(null));
$("h-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ticker = hType === "Hoius" ? $("h-ticker").value.trim() : up($("h-ticker").value); if (!ticker) return;
  const body = {
    ticker, name: $("h-name").value.trim() || null, type: hType,
    symbol: hType === "Hoius" ? null : up($("h-symbol").value) || guessSymbol(ticker, hType),
    qty: +$("h-qty").value, avg_price: hType === "Hoius" ? 1 : +$("h-avg").value,
    rate: SAFE.includes(hType) && $("h-rate").value !== "" ? +$("h-rate").value : null,
    maturity: SAFE.includes(hType) && $("h-mat").value ? $("h-mat").value : null,
    nominal: hType === "Võlakiri" && $("h-nom").value !== "" ? +$("h-nom").value : null,
  };
  const manual = $("h-manual").value;
  if (hType !== "Hoius" && manual !== "" && (!editing || +manual !== editing.manualPrice)) { body.manual_price = +manual; body.manual_price_at = new Date().toISOString(); }
  if (manual === "" && editing?.manualPrice != null) { body.manual_price = null; body.manual_price_at = null; }
  $("h-submit").disabled = true;
  const { error } = editing ? await sb.from("holdings").update(body).eq("id", editing.id) : await sb.from("holdings").insert(body);
  $("h-submit").disabled = false;
  if (error) return showError("Salvestamine ebaõnnestus: " + error.message);
  const isNew = !editing;
  closeSheet(); await loadAll();
  if (isNew && hType !== "Hoius") updatePrices(true);
});
$("h-delete").addEventListener("click", async () => {
  if (!pendingDel) { pendingDel = true; $("h-delete").textContent = "Vajuta uuesti, et kustutada"; return; }
  const { error } = await sb.from("holdings").delete().eq("id", editing.id);
  if (error) return showError("Kustutamine ebaõnnestus: " + error.message);
  closeSheet(); loadAll();
});

let tKind = "dividend";
function openTx(t) {
  editing = t || null;
  $("t-form").reset();
  tKind = t ? t.kind : "dividend";
  chips($("t-kinds"), ["dividend", "deposit", "withdraw"], ["Dividend", "Sissemakse", "Väljamakse"], tKind, (v) => (tKind = v));
  $("t-date").value = t ? t.date : new Date().toISOString().slice(0, 10);
  if (t) { $("t-amount").value = t.amount; $("t-ticker").value = t.ticker || ""; }
  $("t-delete").hidden = !t; $("t-delete").textContent = "Kustuta kanne";
  openSheet("tx", t ? KIND[t.kind] : "Lisa kanne");
  if (!t) setTimeout(() => $("t-amount").focus(), 50);
}
$("add-tx").addEventListener("click", () => openTx(null));
$("t-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = { date: $("t-date").value, kind: tKind, ticker: up($("t-ticker").value) || null, amount: +$("t-amount").value };
  if (!(body.amount > 0)) return;
  const { error } = editing ? await sb.from("txns").update(body).eq("id", editing.id) : await sb.from("txns").insert(body);
  if (error) return showError("Salvestamine ebaõnnestus: " + error.message);
  closeSheet(); loadAll();
});
$("t-delete").addEventListener("click", async () => {
  if (!pendingDel) { pendingDel = true; $("t-delete").textContent = "Vajuta uuesti, et kustutada"; return; }
  const { error } = await sb.from("txns").delete().eq("id", editing.id);
  if (error) return showError("Kustutamine ebaõnnestus: " + error.message);
  closeSheet(); loadAll();
});

/* ---------- hinnad ---------- */
async function updatePrices(quiet) {
  const b = $("refresh"); b.classList.add("spin"); b.disabled = true;
  const { data, error } = await sb.functions.invoke("update-prices");
  b.classList.remove("spin"); b.disabled = false;
  if (error) { if (!quiet) showError("Hindade uuendamine ebaõnnestus. Proovi hetke pärast uuesti."); return; }
  if (data?.failed?.length && !quiet) showError(`Ei leidnud hinda: ${data.failed.join(", ")}. Ava investeering → Täpsemalt ja kontrolli hinnaallika sümbolit.`);
  else showError("");
  loadAll();
}
$("refresh").addEventListener("click", () => updatePrices(false));

/* ---------- vahelehed ---------- */
function showTab(name) {
  document.querySelectorAll(".tabbar button").forEach((b) => (b.dataset.tab === name ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  document.querySelectorAll("[data-view]").forEach((v) => (v.hidden = v.dataset.view !== name));
  history.replaceState(null, "", "#" + name); window.scrollTo(0, 0);
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

let loadedFor = null;
function setUser(u) {
  user = u;
  $("auth-form").hidden = !!u; $("app").hidden = !u; $("app-head").hidden = !u; $("tabbar").hidden = !u;
  if (u && loadedFor !== u.id) { loadedFor = u.id; loadAll().then(() => updatePrices(true)); }
  if (!u) loadedFor = null;
}
sb.auth.onAuthStateChange((_ev, session) => setUser(session?.user || null));
sb.auth.getSession().then(({ data }) => setUser(data.session?.user || null));
render();
