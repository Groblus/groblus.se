# Groblus Gamers

Eleventy-webbplatsen för [groblus.se](https://groblus.se), med Spelhyllan under `/spelhyllan/`.

Spelhyllan samlar spelintressen, vanliga veckotider och konkreta datumförslag. Hemsidan använder **mejladress och lösenord**. Discord-appen är en alternativ ingång och kan kopplas frivilligt till ett befintligt webbkonto. Ingen eBas-integration eller Discord-inloggning krävs för hemsidan.

## Lokal utveckling

Kräver aktuell Node.js, pnpm och npm. Kör från repots rot:

```sh
pnpm install --frozen-lockfile
npm --prefix worker ci
npm run build
npm --prefix worker run db:migrate
npm run dev:app
```

Se `worker/package.json` och [driftguiden](docs/spelhyllan-operations.md) för migrations- och kontohantering. Lokal utveckling använder lokal D1; ingen molndatabas behövs. Inbjudningskoder krävs för nya konton.

```sh
npm run check
```

Den gamla statiska sajten kan köras separat med `pnpm start`. Inloggning och datalagring kräver Worker-servern, inte enbart Eleventys server.

## Kod och dokumentation

- `spelhyllan/`: responsiv webbapp, svensk text och inga externa UI-bibliotek.
- `worker/`: Cloudflare Worker, D1-migrationer, autentisering, gemensam data och Discord-interaktioner.
- [API-kontrakt](docs/spelhyllan-contract.md).
- [Discord-app och installation](docs/discord.md).
- [Drift och lansering](docs/spelhyllan-operations.md).

## Driftsättning

Implementationen kan granskas och köras lokalt. Molnresurser, Discord-installation och produktionslansering är separata åtgärder. Enbart en statisk Netlify-deploy aktiverar inte API:t.

Befintligt kontaktformulär använder Netlify Forms. Flytta inte hela sajten till en annan host utan att först lösa detta formulär. En möjlig produktionslösning är att låta huvudsajten ligga kvar och ge Spelhyllan en egen origin där app och API körs tillsammans; alternativt krävs verifierad routing för `/api/*` på samma origin som appen. Tredjepartscookies eller tillåtande CORS ska inte användas som genväg.
