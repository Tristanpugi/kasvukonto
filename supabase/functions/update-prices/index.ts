// Kasvukonto hinnauuendus. Tõmbab kõigi portfellides olevate sümbolite viimased hinnad
// Yahoo Finance'ist, teisendab eurodesse ja salvestab tabelisse `prices`.
// Käivitub äpi nupust "Uuenda hindu" ja (soovi korral) ajastatult pg_croniga.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Quote = { price: number; currency: string };

// Eesti pensionifondid (ISIN, nt EE3600109435): päevahind Tuleva avalikust API-st.
async function pensionNav(isin: string): Promise<Quote | null> {
  const start = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
  const res = await fetch(`https://onboarding-service.tuleva.ee/v1/funds/${isin}/nav?startDate=${start}`, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const arr = await res.json();
  const last = Array.isArray(arr) ? arr[arr.length - 1] : null;
  return last && typeof last.value === "number" ? { price: last.value, currency: "EUR" } : null;
}

async function quote(symbol: string): Promise<Quote | null> {
  if (/^EE\d{10}$/.test(symbol)) return pensionNav(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Kasvukonto" } });
  if (!res.ok) return null;
  const json = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (typeof price !== "number") return null;
  let currency: string = meta.currency || "EUR";
  let p = price;
  // Mõned börsid (London) annavad hinna pennides
  if (currency === "GBp" || currency === "GBX") { p = p / 100; currency = "GBP"; }
  return { price: p, currency };
}

const fxCache = new Map<string, number>();
async function toEur(amount: number, currency: string): Promise<number | null> {
  if (currency === "EUR") return amount;
  if (!fxCache.has(currency)) {
    const q = await quote(`EUR${currency}=X`); // mitu `currency` ühe euro eest
    if (!q) return null;
    fxCache.set(currency, q.price);
  }
  return amount / fxCache.get(currency)!;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: rows, error } = await admin.from("holdings").select("ticker, symbol, type");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });

  const symbols = [...new Set(
    (rows ?? []).filter((r) => r.type !== "Hoius").map((r) => (r.symbol || r.ticker || "").trim().toUpperCase()).filter(Boolean),
  )];

  const updated: string[] = [];
  const failed: string[] = [];
  for (const symbol of symbols) {
    try {
      const q = await quote(symbol);
      const eur = q ? await toEur(q.price, q.currency) : null;
      if (!q || eur == null) { failed.push(symbol); continue; }
      await admin.from("prices").upsert({
        symbol, price: eur, currency: "EUR",
        native_price: q.price, native_currency: q.currency,
        updated_at: new Date().toISOString(), source: /^EE\d{10}$/.test(symbol) ? "Tuleva" : "Yahoo Finance",
      });
      updated.push(symbol);
    } catch (_e) {
      failed.push(symbol);
    }
  }
  return new Response(JSON.stringify({ updated, failed }), { headers: { ...cors, "Content-Type": "application/json" } });
});
