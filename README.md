# Kasvukonto

Isiklik investeerimisäpp: aktsiad, ETF-id, fondid, võlakirjad, hoiused ja krüpto ühes vaates.

- **Portfell**: väärtus, kasum/kahjum, jaotus ja portfelli tervisekontroll
- **Kuuplaan**: kuhu igakuine summa panna, et jõuda sihtosakaaludeni
- **Liitintress**: kasvuprognoos ja eesmärgi kalkulaator
- **Dividendid ja sissemaksed**: kanded ja aastate kokkuvõte
- **Reaalajas hinnad**: serveri funktsioon tõmbab hinnad Yahoo Finance'ist ja teisendab eurodesse

Tehnika: üks staatiline leht (`index.html`, `app.js`) + Supabase (sisselogimine e-posti lingiga, andmebaas, hinnafunktsioon). Ehitusetappi pole vaja.

## Seadistamine

### 1. Supabase
1. Loo [supabase.com](https://supabase.com)-is uus projekt (nt `kasvukonto`, regioon Frankfurt).
2. **SQL Editor** → kleebi `supabase/schema.sql` sisu → Run.
3. **Project Settings → API**: kopeeri *Project URL* ja *anon public* võti faili `config.js`.
4. **Authentication → URL Configuration**: pane *Site URL* väärtuseks äpi aadress (nt `https://kasvukonto.ee`) ja lisa *Redirect URLs* alla ka testaadress.

### 2. Hinnafunktsioon
Supabase CLI-ga projekti kaustas:
```bash
supabase login
supabase link --project-ref yvwqikzzfqxoavbaqmpv
supabase functions deploy update-prices --no-verify-jwt
```
Äpis nupp **Uuenda hindu** kutsub selle välja.

### 3. Automaatne hinnauuendus (valikuline)
**Database → Extensions**: lülita sisse `pg_cron` ja `pg_net`. Siis SQL Editoris:
```sql
select cron.schedule('kasvukonto-hinnad', '*/30 7-21 * * 1-5', $$
  select net.http_post(
    url := 'https://yvwqikzzfqxoavbaqmpv.supabase.co/functions/v1/update-prices',
    headers := '{"Authorization": "Bearer sb_publishable_A7OUEIta4yE3JRYOxkutyQ_DRCJaHwN", "apikey": "sb_publishable_A7OUEIta4yE3JRYOxkutyQ_DRCJaHwN"}'::jsonb
  );
$$);
```
See uuendab hindu tööpäeviti iga 30 minuti järel (UTC 7–21).

### 4. Majutus ja domeen
Kõige lihtsam on [Vercel](https://vercel.com) või [Netlify](https://netlify.com): *Import project* → vali GitHubi repo `kasvukonto` → Deploy (seadeid pole vaja). Domeeni (nt `kasvukonto.ee`) lisad sama teenuse *Domains* menüüst.

Testimiseks soovitan eraldi testharu (`test`), mis avaldub eelvaate-aadressile, enne kui muudatused päris äppi lähevad.

## Hinnaallika sümbolid
| Vara | Näide |
|---|---|
| Xetra ETF | `VWCE.DE`, `SXR8.DE` |
| Tallinna börs | `LHV1T.TL`, `TKM1T.TL` |
| USA aktsia | `AAPL` (teisendatakse eurodesse) |
| Krüpto | `BTC-EUR` |

Võlakirjade (eriti Balti võlakirjade) hinda Yahoo tavaliselt ei tea; nende ja hoiuste puhul sisesta hind käsitsi või jäta ostuhinnaks.

*Kasvukonto on arvutus- ja jälgimisvahend, mitte investeerimisnõuanne.*
