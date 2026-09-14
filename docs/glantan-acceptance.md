# Mål och acceptanskriterier — Gläntans anslagstavla

Oliver beställde 2026-09-13 att bevara alla tre designidéer och implementera Gläntans anslagstavla genom hela produkten. Förtydligande: målet omfattar fullt fungerande webbplats, databas och Discord-app, med faktisk verifiering. Subagenter ska använda /caveman i sin kommunikation.

Målet är inte uppnått förrän samtliga nödvändiga kriterier nedan är verifierade. Lokala tester ersätter inte verklig drift eller Discord-installation. Okända eller blockerade kriterier lämnas uttryckligen öppna.

## Design och webb
- [x] Tre ursprungliga HTML-skisser bevarade med tydliga källor och vald riktning.
- [x] Gläntans stil och disposition används genom spel, tider, planer och profil/dialoger. Inloggningen hanteras av Cloudflare Access.
- [x] Verkliga spelrader visar namn, intresserade och oberoende spela/spelleda-val; inga demodata i produktflöden.
- [x] Översiktens datumförslag och vanliga tider kommer från databasen och har relevanta tomlägen.
- [x] Tangentbord, namngivna dialoger, fokus och mobilbredder 320/390 px fungerar utan sidöverströmning.
- [ ] Browserkontroll med Cloudflare Access visar login/logout, sparade intressen/tider efter omladdning och skapande/röst/bekräftelse av datum. Tidigare browserkontroll använde den ersatta autentiseringen.
- [x] Bygge, syntax, typkontroll och relevanta regressionstester passerar. Internt designunderlag publiceras inte.

## Databas och drift
- [ ] En faktisk beständig D1-databas är bunden till webb och Discord med rätt migrationer.
- [ ] HTTPS-webb fungerar med korrekt origin, säkra sessionscookies och privat medlemsåtkomst.
- [ ] Cloudflare Access tillåter endast godkända medlemsadresser; återbesök använder Cloudflares session, utloggning fungerar och behörighetsisolering består. Appen hanterar inga lösenord eller egna sessioner.
- [ ] Kostnad/CPU på avsedd Workers-plan verifierad; ingen betald plan aktiveras utan Olivers godkännande.
- [x] Backup/export och återläsning verifierad på testdata; rensning av utgångna poster har dokumenterad rutin.
- [ ] Befintliga groblus.se och kontaktformulär fortsätter fungera med vald driftlösning.

## Discord i verklig server
- [ ] Groblus Discord-application är installerad med nödvändig minsta åtkomst och /groblus-kommandon registrerade.
- [ ] Publik HTTPS-interaktionsendpoint accepterar Discord PING och avvisar ogiltiga signaturer/server/replay.
- [ ] Verkligt testkonto kan registrera eller koppla profil utan dubbla identiteter.
- [ ] Intresse och veckotid uppdaterade från Discord syns på webben, och webbändring syns i Discord.
- [ ] Webbens datumförslag kan röstas på i Discord och visar samma röst i båda kanalerna.
- [ ] Faktiska svar kommer inom Discord-deadline och är privata enligt kontraktet.

## Leverans
- [x] Källkod och operatörsinstruktioner sparade; Groblus-mappen i Obsidian länkar resultat, designbeslut och verifieringsstatus.
- [ ] Exakt publicerad version och kvarvarande begränsningar dokumenterade. Inget komplett-påstående medan obligatoriska steg återstår.

## Verifierad lokal evidens 2026-09-13

Tre subagenter använde /caveman. Root kontrollerade den riktiga lokala webbappen mot beständig lokal D1. Det befintliga testkontot kunde välja både spela och spelleda för Ars Magica, se sitt visningsnamn och gemensamma tider, spara fredag kväll och läsa samma svar efter omladdning. Nytt förslag med två datum skapades, röstades på och bekräftades via namngiven HTML-dialog. Utloggning och lösenordsinloggning bevarade uppgifterna. Inga riktiga bokningar eller medlemsuppgifter skapades.

Visuell kontroll: desktop, registreringsläge, spelardialog, profil, veckotider och datumdialog. Mobilbredd 320 och 390 px gav scrollWidth lika med viewport efter korrigerad flikbredd. Browserns fellogg var tom. Cinzel och Lato hostas lokalt med SIL OFL-licenser.

Cross-surface-tester använder riktig isolerad D1 och kryptografiskt signerade Discord-anrop genom Worker-rutten: webbkonto/länk, båda riktningarnas intressen/tider/röster och webbens bekräftade datum i Discord. Detta är inte en faktisk guild-installation. Lokal export/återläsning testades separat med syntetiska data. Staging/production-förberedelse och redirect/cleanup har egna regressioner; ingen resurs skapad eller deployad.

## Kvarvarande åtkomstberoenden

Cloudflare-inloggning och Workers/D1-behörigheter verifierade 2026-09-14. Separat EU-D1 `groblus-spelhyllan-staging` har migration 0001. Testwebben är publicerad, se nedan. Discord-applikation, målserver, signeringsnyckel och kommandoinstallation saknas fortfarande. Dessa öppna kriterier blockerar full måluppfyllelse.

Slutlig lokal kontroll: `npm run check` passerade med **29 tester i sex filer**, Eleventy-bygge, JavaScript-syntax och TypeScript. Interna `.superdesign`-filer är uteslutna från bygget.

## Publicerad testmiljö 2026-09-14

- URL: https://groblus-spelhyllan-staging.oliver-glant.workers.dev/spelhyllan/
- Worker-version: `76ac5804-ac38-4cd8-befa-a944c5440024`.
- D1: `c11d6753-9fa2-4fc6-8fd0-1d454ca1df91`, EU-jurisdiktion. Migration och tabeller lästa tillbaka från molnet.
- Bygge och kontroll före publicering: 30 Vitest-tester + 3 CLI-tester passerade; TypeScript och Eleventy passerade.
- Publicerad inloggningssida visuellt granskad i inbyggd browser. `/api/me` ger 401 utan session, `/` hänvisar till `https://groblus.se/`, `/spelhyllan/design/` ger 404.
- Befintliga groblus.se svarar 200 från Netlify och kontaktformuläret finns kvar i levererad HTML. Ingen testsändning till föreningen gjord.
- Timvis cleanup publicerad (`17 * * * *`). Exekvering ska verifieras separat.
- Detta är webbtestmiljö utan aktiverad Discord; full acceptans kvarstår.

### Verkliga flöden och blockerad CPU

HTTP-test verifierade registrering, inloggning, säkra sessionscookies, intresse-/tidslagring, planer, röstning, ägarbehörighet och utloggning. Browser visade sparade data och bevarade nytt Ars Magica-intresse efter omladdning.

Återställning misslyckades med HTTP 503: Workers tail visade `exceededCpu`, 343 ms CPU. Registrering/inloggning tog 401–510 ms i mätningen. Full lösenordsacceptans är därför **inte** uppnådd på gratisplanen. Ingen betald uppgradering gjord. Prisunderlag: https://developers.cloudflare.com/workers/platform/pricing/ (kontrollerat 2026-09-14).

Detaljer: [HTTP-verifiering](staging-http-verification.md), [fjärråterläsning](staging-restore-verification.md). Adminverktygets fjärrresultat korrigerat efter verkligt test.

## Ändrad autentisering 2026-09-14

Oliver förtydligade att smidig återkomst utan mejl varje gång är målet; egna lösenord är inte ett absolut krav. Vald lösning är Cloudflare Access standardinloggning med mejlkod och en månads app-/policysession. Global session står redan på att följa appen. Inga andra identitetstjänster eller betalda Workers-uppgraderingar beställda.

Egen lösenordshantering tas bort, inklusive lösenordshashar, sessions- och återställningstabeller. Cloudflare Access utfärdar identiteten och sköter sessionen. Cloudflares dokumenterade `jose`-integration verifierar deras assertion eftersom `ctx.access` enligt officiella dokument inte vidarebefordras av Workers Static Assets-router. Ingen egen tokenutfärdare eller session byggs.

Testpolicy för den godkända testadressen på `groblus-spelhyllan-staging.oliver-glant.workers.dev` förberedd. Sparandet stoppades av automatisk godkännandegranskning, som kräver explicit godkännande av mottagare, resurs och en månads session. Detta är en konfigurationsgräns, inte slutförd Access-drift. Alla riktiga medlemsadresser behöver senare ingå i Access-policyn.

Tidigare lösenordstester/CPU-fel är historik för den lösning som ersätts. Ny acceptans kräver riktig Access-inloggning, återbesök, utloggning och fortsatt datalagring. Discord behåller separat verifiering av Discords signerade interaktioner; dess endpoint behöver en separat specifik Access-regel utan mänsklig inloggning.

Lokalt Access-byte färdigverifierat: `npm run check` passerar (29 Vitest + 8 CLI = 37 tester), inklusive migrering från tidigare lösenordsdata utan förlust av intressen/tider, Access-assertioner och gemensamma Discord-flöden. Produktionsberoenden: npm audit 0 kända sårbarheter. Detta var lokal kontroll före publiceringen nedan; verklig Access-inloggning återstår att slutverifiera.


### Access aktiverat och publicerat 2026-09-14

Den uttryckligen godkända policyn är nu sparad och kopplad till testmiljön: den godkända testadressen, Allow, en månads applikationssession (policyn ärver applikationens längd). Access-app `b2c75b63-0a07-4839-a9e4-464af9a95488`, policy `dd3124d5-43f1-4665-ab41-117ad3028d94`. Inställningarna lästa tillbaka i Cloudflare-dashboarden.

Access-versionen är publicerad på https://groblus-spelhyllan-staging.oliver-glant.workers.dev/spelhyllan/ med Worker-version `b27cd1d1-f732-4984-9ec2-aa2ebb039341`. Ny D1-säkerhetskopia togs före migration `0002_cloudflare_access.sql`; fjärrkontroll bekräftar att sessions/recovery_codes och users.password_hash är borta. Bygge och deploy dry-run passerade.

Inbyggda webbläsaren visar Cloudflares riktiga inloggning och bekräftar att en kod skickats till Oliver. Kodfältet är lämnat öppet. Fullständig inloggning, profil och sparande efter omladdning väntar fortfarande på Olivers kodinmatning. Oinloggade HTTP-kontroller gav 403; browserflödet nådde korrekt Access-kodformulär. Inget abonnemang uppgraderat. Discord är fortfarande avstängt i staging och verklig installation/synk återstår; hela leveransmålet är inte klart.


### Discord och PR, 2026-09-14

Discord-koden granskad av subagent. Menyetiketter för spel/planer bevarar nu text även när namnet består av Markdowntecken. `npm run check`: 30 Vitest + 8 CLI = 38 tester, bygge och typkontroll passerade. Developer Portal kräver operatörsinloggning innan faktisk app/installation kan färdigställas. Ingen riktig Discord-synk påstås verifierad.
