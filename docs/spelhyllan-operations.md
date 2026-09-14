# Spelhyllan — drift och acceptans

> Status 2026-09-14: Cloudflare Access-versionen är publicerad i staging och D1-migration 0002 är applicerad. Verklig inloggning och Discord-installation återstår att slutverifiera. Se [acceptanslistan](glantan-acceptance.md).

## Aktuellt beslut 2026-09-14

Cloudflare Access sköter webbens inloggning och sessioner. Medlemmar ska kunna återkomma utan att öppna mejlen vid varje besök. Konfigurera Cloudflares engångskod och en månads applikationssession i Access; utloggning, ny webbläsare eller utgången session kan kräva en ny kod. Webbens användare behöver inte Discord. Egen lösenordshantering, återställningskoder och sessionslagring är borttagna. Äldre verifieringsrapporter nedan beskriver den ersatta implementationen, inte dagens inloggning.

Åtkomst ges genom Access-applikationens Allow-policy för uttryckligen godkända medlemsadresser. Inga Everyone-regler. Appen verifierar Cloudflares signerade JWT med dess publicerade nycklar och applikationens audience enligt Cloudflares dokumentation. D1 lagrar medlemsprofil och speldata; första verifierade besöket skapar en profil och ber om visningsnamn. Befintlig profil med samma verifierade mejladress behåller sina val.

## Lanseringsgräns

Separat HTTPS-origin och D1 används för appen. Netlify-sajten och kontaktformuläret behåller sin drift. Följ [driftförberedelsen](spelhyllan-deployment.md). Access måste konfigureras och verifieras med verklig webbinloggning innan medlemmar bjuds in. Kod eller konfigurationsfiler bevisar inte att Access-policyn är aktiv. Full acceptans kräver också installerad Discord-app och riktiga interaktioner mot samma databas.

Ingen uppgradering till Workers Paid krävs av den borttagna lösenordshashningen. Inget abonnemang eller kostnadsökning är godkänt genom implementationen.

## Verifiera inför lansering

- En godkänd medlem loggar in via Access, anger visningsnamn och återfår sina val efter omladdning. Ett vanligt återbesök med giltig Access-session kräver inte ny mejlkod.
- Icke godkänd adress nekas. Saknat, förfalskat, utgånget eller felriktat Access-JWT nekas av API:t. Felaktig origin nekas för webbskrivningar.
- Inga lösenordsformulär eller egna inloggningssessioner återstår. Utloggningen går till Cloudflares `/cdn-cgi/access/logout`.
- Spela och spelleda är oberoende val. Veckotider utan svar är okända, inte nej. Sparade värden kvarstår efter omladdning.
- Konkreta datumsvar hålls skilda från vanliga tider. Bara förslagsställaren kan bekräfta datum.
- Andra medlemmar ser visningsnamn och roller, inga privata mejladresser.
- Verkliga Discord-klick sparar intresse, tid och röst som webben läser tillbaka, och omvänt. Signatur, färsk tidsstämpel och rätt server krävs.
- Kontaktformuläret på huvudsajten fungerar fortfarande. Export och återläsning provas i separat databas.

## Lokal körning

```sh
pnpm install --frozen-lockfile
npm --prefix worker ci
npm run build
npm --prefix worker run db:migrate
npm run dev:app
```

Lokal förhandsvisning finns på `http://localhost:8787/spelhyllan/`. Utan giltigt Access-JWT förblir medlems-API:t låst även lokalt. Automatiska integrationstester använder isolerad D1 och signerade testassertioner; produktion innehåller ingen utvecklingsidentitet eller autentiseringsbypass. Prova den riktiga inloggningsupplevelsen på Access-skyddad staging.

## Medlemsadministration och Discord

Lägg till eller ta bort godkända webbmedlemmar i Cloudflare Access. Hantera sessionsåterkallning där, inte med egna sessionskoder. Discord-only-medlemmar kan få en privat inbjudningskod från `node worker/scripts/admin.mjs invite 1`; den är giltig sju dygn. Vid fjärrskrivning krävs `--remote --config <förberedd-konfiguration>`. Webbmedlemmar använder i stället kopplingskod från sin inloggade profil. Koder hör inte hemma i Git eller Obsidian.

Worker rensar utgångna Discord-kopplingskoder, inbjudningar, interaktionskvitton och rate-limitposter. Separat driftkonfiguration schemalägger rensningen timvis. D1-exporter innehåller medlemsdata och ska förvaras privat.

Veckans spelpuls, automatiska mejl/påminnelser, kalenderexport, reservlistor och eBas ingår inte i första versionen.

## Historisk verifiering av ersatt lösenordslösning

## Genomförd lokal verifiering 2026-09-13

- Ren installation av låsta Worker-beroenden lyckades; full `npm audit` gav **0 kända sårbarheter**.
- `npm run check`: Eleventy-build, frontend-syntax, TypeScript och **23 tester i fyra testfiler** passerade.
- Tester använder riktig lokal D1/Workers-runtime: sessionshantering, exakt lösenord, origin, inbjudan vid samtidiga registreringar, återställning, isolering av personliga svar, planbehörighet samt signerade Discord-anrop, återspelning och begränsad requeststorlek. Sex regressioner täcker bland annat samtidiga lösenords-/sessionsändringar.
- Inbyggda webbläsaren: registrering av ett lokalt testkonto, två oberoende intresseroller, sparad lördagstid, nytt förslag med två datum, röst, utloggning/ny inloggning och kvarvarande data verifierades. Speldetaljer visade testspelarens namn och rätt sammanställd tid. Mobilbredd 390 px gav ingen horisontell sidöverströmning.
- Native `window.confirm` låste den inbyggda testfliken. Båda sådana bekräftelser ersattes med fokusstyrd HTML-dialog; senaste frontend-syntax och build passerade. Den nya dialogen och sparat bekräftat datum verifierades därefter visuellt i Safari med samma lokala testkonto. Den gamla inbyggda testflikens blockering hindrade inte slutkontrollen.
- Ingen riktig medlem, molndatabas eller Discord-server användes. Moln-CPU, faktisk Discord-installation och publicerad webb är fortfarande separata acceptanssteg.

## Separat staging och produktion

[Driftförberedelse och återläsning](spelhyllan-deployment.md) beskriver konfigurationsgeneratorn, explicit miljöval för fjärradministration, Netlify-gränsen samt verifierade lokala export-/importsteg. Vid `--remote` kräver adminverktyget nu även `--config` till den förberedda miljöns konfiguration.
