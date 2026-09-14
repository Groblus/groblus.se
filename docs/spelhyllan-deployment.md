# Separat appdrift: staging och produktion

> Status 2026-09-14: Cloudflare Access-versionen är publicerad i staging och D1-migration 0002 är applicerad. Verklig inloggning och Discord-installation återstår att slutverifiera. Se [acceptanslistan](glantan-acceptance.md).

Den befintliga föreningssajten och dess Netlify-kontaktformulär behåller sin nuvarande drift. Spelhyllan får en separat HTTPS-origin. Appens `/api/*` och `/spelhyllan/*` hanteras av samma Worker och samma D1. Övriga GET/HEAD-sökvägar hänvisas till föreningssajten; andra metoder skickas inte vidare. Lokalkonfigurationen ändras inte.

## Förbered lokal konfiguration

`node worker/scripts/prepare-deploy.mjs staging` eller `production` skriver endast lokala filer under ignorerade `worker/.wrangler/deploy/<miljö>/`. Skriptet kräver följande värden i miljön och avbryter vid saknade eller ogiltiga värden:

- `CLOUDFLARE_ACCOUNT_ID`: verkligt valt konto.
- `GROBLUS_D1_ID`, `GROBLUS_D1_NAME`: redan skapad databas för just denna miljö. Använd olika databaser för staging och produktion.
- `GROBLUS_APP_ORIGIN`: exakt HTTPS-origin för Worker-adressen, utan avslutande snedstreck. Den måste matcha webbläsarens origin, annars nekas webbskrivningar.
- `GROBLUS_SITE_ORIGIN`: befintlig föreningssajts HTTPS-origin, skild från appen.
- `ACCESS_TEAM_DOMAIN`: `https://<team>.cloudflareaccess.com` för konfigurerad Access-organisation.
- `ACCESS_AUD`: Access-applikationens 64 tecken långa audience-värde. Krävs även för staging med `--web-only`.
- `DISCORD_PUBLIC_KEY`, `DISCORD_GUILD_ID`: verklig Discord-apps offentliga verifieringsnyckel och målserver. Använd separat app/testserver för staging om produktionskommandona redan används.

För att verifiera webb och D1 innan Discord-appen är klar kan staging förberedas med `node worker/scripts/prepare-deploy.mjs staging --web-only`. Då utelämnas båda Discord-variablerna även om de finns i miljön; interaktionsendpointen nekar anrop med 401 eftersom verifieringsnyckel saknas. Alla övriga kontroller gäller fortfarande. Flaggan tillåts inte för produktion. När Discord är konfigurerat körs förberedelsen igen utan flaggan och staging publiceras på nytt. Webbtesterna räcker inte för att godkänna hela lösningen; faktisk Discord-installation och synkronisering återstår.

Kör `npm run build` före förberedelsen och förbered igen efter varje frontendändring. Endast Spelhyllans byggda tillgångar och säkerhetsheaders kopieras. Designjämförelser och Netlify-kontaktformuläret kopieras inte. Ingen påhittad databasidentifierare kan användas som produktionsmall. Skriptet lagrar ingen bottoken.

Konfigurationen inkluderar Workers.dev, en D1-bindning och timvis körning av befintlig cleanup kl. 17 minuter över varje timme (UTC). Det rensar utgångna inbjudningskoder, Discord-kopplingar/interaktionskvitton och rate-limitposter. En deployment aktiverar schemat; själva förberedelsen gör det inte. Cloudflare Access hanterar inloggning; appen hash­ar inga lösenord. Ingen uppgradering av abonnemang ingår i skripten.

## Cloudflare Access

Skapa en Self-hosted Access-applikation för appens webb och API. Använd Cloudflares One-time PIN, en uttrycklig Allow-lista med medlemsadresser och en månads applikationssession. En giltig session kräver inte mejlkod vid varje besök. Ta `ACCESS_TEAM_DOMAIN` och `ACCESS_AUD` från denna verkliga konfiguration; använd inga platshållare eller bypass-identiteter.

Discord behöver ett separat, snävare Access-undantag för exakt `/api/discord/interactions`. Endast denna signerade maskinendpoint får Bypass. Skyddet i Worker verifierar fortfarande Discord-signatur, tidsstämpel och server. Verifiera att inga andra API-sökvägar undantas. Se [Cloudflares JWT-validering](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) och [Workers med Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).

Migration `0002_cloudflare_access.sql` tar bort lösenordshashar, egna sessioner och återställningskoder. Exportera befintlig databas före migrationen; återställ inte den äldre autentiseringen i drift. Webbmedlemskap hanteras därefter i Access, Discord-inbjudningar med adminverktyget.

## Explicit operatörskörning

Nedan är verkliga fjärroperationer. Kör dem först när rätt konto, miljö och resurser är godkända och verifierade. Exemplet använder staging; byt varje sökväg till production vid motsvarande produktionskörning. Kommandona körs från `worker/`.

```sh
npx wrangler whoami
npx wrangler d1 migrations list DB --remote --config .wrangler/deploy/staging/wrangler.json
npx wrangler d1 migrations apply DB --remote --config .wrangler/deploy/staging/wrangler.json
npx wrangler deploy --config .wrangler/deploy/staging/wrangler.json
```

För befintlig databas: exportera före migrationsändringar. Exportfilen innehåller föreningsdata och autentiseringshashar; placera den i en privat katalog utanför Git, med begränsad filåtkomst. Ange den katalogens absoluta filväg som `GROBLUS_BACKUP_FILE`.

```sh
umask 077
npx wrangler d1 export DB --remote --config .wrangler/deploy/staging/wrangler.json --output "$GROBLUS_BACKUP_FILE"
```

Återläs aldrig på försök över produktionsdata. För en verklig återläsningsövning behövs en separat tom D1-databas med egen förberedd konfiguration. Importera exporten där med `wrangler d1 execute DB --remote --config <återläsningsdatabasens-konfiguration> --file "$GROBLUS_BACKUP_FILE"` och verifiera relationer och appflöden innan övningsdatabasen tas bort enligt separat beslut.

Adminverktyget kräver explicit konfigurationsfil vid fjärrskrivning och använder bindningen `DB`, så det följer miljöns databasnamn:

```sh
node scripts/admin.mjs invite 1 --remote --config .wrangler/deploy/staging/wrangler.json
```

Detta kommando skapar Discord-inbjudningar och skriver privata koder till operatörens terminal. Dela bara med avsedd person; spara inte koder i Git eller dokumentation.

## Lokal export- och återläsningsverifiering

Från reporoten:

```sh
node worker/scripts/restore-smoke.mjs
```

Skriptet skapar två tillfälliga, isolerade lokala D1-databaser. Det applicerar migrationer, skriver en syntetisk användare med dubbla intresseroller och veckotid, exporterar SQL, importerar i den andra databasen och kontrollerar återlästa värden och frånvaro av föräldralösa intresserader. Allt tas bort efteråt. Utvecklingsdatabasen och fjärrdatabaser berörs inte. Detta verifierades 2026-09-13; det är inte bevis för en återläsning av framtida produktionsdata.

## Verifiera verklig drift

1. Access skyddar `/spelhyllan/` och webb-API:t. Publicerad sida laddar rätt design efter inloggning; API:t nekar saknat eller ogiltigt Access-JWT. Appens startsideslänk öppnar befintliga föreningssajten.
2. Logga in med godkänd testadress genom Access. Kontrollera att icke godkänd adress nekas, att återbesök behåller sessionen och att Cloudflares utloggning fungerar. Felaktig origin ska nekas. Ange visningsnamn vid första besöket.
3. Spara oberoende intresseroller och veckotider; läs tillbaka efter omladdning. Skapa datumförslag, rösta och bekräfta som förslagsställare. En annan person får inte bekräfta.
4. Konfigurera Discords HTTPS-endpoint och kontrollera signerad PING, installera kommandon enligt [Discord-rutinen](discord.md). Verifiera riktiga Discord-klick och att webben visar samma sparade värden, och omvänt. Kontrollera initialt svar inom tre sekunder.
5. Prova sessionsåterkallning via Cloudflare Access. Granska cleanup-körningens logg efter schemat, samt en faktisk separat återläsning före produktionsacceptans.

API-tester, lokala signerade Discord-fixtures och lokal återläsning är utvecklingsevidens. De ersätter inte publicerad webb, fjärr-D1, faktisk Discord-installation eller medlemstest.
