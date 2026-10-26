// Kasvukonto väärtpaberite otsing: nime või sümboli järgi Yahoo Finance'ist.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const TYPE: Record<string, string> = {
  EQUITY: "Aktsia", ETF: "ETF", MUTUALFUND: "Fond", CRYPTOCURRENCY: "Krüpto", BOND: "Võlakiri",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let q = new URL(req.url).searchParams.get("q") || "";
  if (!q && req.method === "POST") { try { q = (await req.json()).q || ""; } catch (_e) { /* tühi */ } }
  q = q.trim().slice(0, 60);
  if (q.length < 2) return new Response(JSON.stringify({ results: [] }), { headers: { ...cors, "Content-Type": "application/json" } });

  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0&enableFuzzyQuery=true`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Kasvukonto" } });
    const json = await res.json();
    const results = (json?.quotes ?? [])
      .filter((x: any) => x.symbol && TYPE[x.quoteType])
      .map((x: any) => ({
        symbol: String(x.symbol),
        name: x.longname || x.shortname || x.symbol,
        type: TYPE[x.quoteType],
        exchange: x.exchDisp || x.exchange || "",
      }));
    return new Response(JSON.stringify({ results }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (_e) {
    return new Response(JSON.stringify({ results: [], error: "search_failed" }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
