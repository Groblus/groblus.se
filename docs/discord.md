# Spelhyllan i Discord

Status, 2026-09-14: Discord implementation passes local tests. No Discord application has been created or installed and no commands have been registered. The shared Worker and D1 are deployed in web-only staging. Developer Portal is waiting for the operator to sign in; live Discord acceptance remains open.

## Member experience

All responses are ephemeral (visible only to the invoking member). No channel message history is read.

- `/groblus registrera namn inbjudan`: create a Discord-only profile using an administrator-issued invite. No website account required.
- `/groblus koppla kod`: attach Discord to an existing website profile using a short-lived, single-use code from the signed-in website. Website login uses Cloudflare Access; Discord login is not required.
- `/groblus profil`: pick a game; independently toggle “Vill spela” and “Vill spelleda”. Add a game with a native modal. View interested members by display name and aggregate common times. The catalogue and member lists are paginated.
- `/groblus tider`: choose weekday, time and how often you are available. Changes affect only the chosen slot. Times are Swedish local time: 10–14, 14–18, 18–22. “Ej angivet” removes a preference; it does not mean unavailable.
- `/groblus planer`: browse concrete proposals and vote yes/maybe/no for each option. The same D1 records are used by the website. Creating and confirming plans currently uses the website.

Do not create a Discord-only profile first if you already have a web profile: use `koppla`. Existing conflicting profiles are rejected rather than silently merged or discarding interests. Administrator-assisted, explicitly reviewed identity recovery/merge is needed for duplicates; automated merging and automatically converting a Discord-only account to a web profile are not implemented.

## Operator setup (requires separately approved real resources)

1. Create a Discord application in the Developer Portal, with Guild Install enabled. Retain the application ID and public verification key.
2. Configure Worker `DISCORD_PUBLIC_KEY` (public Ed25519 hex key) and `DISCORD_GUILD_ID` (Groblus server ID). Apply D1 migrations. Website and Discord must bind the same database.
3. Deploy a reachable HTTPS Worker and set its Interactions Endpoint URL to `https://<same-app-host>/api/discord/interactions`. Configure an Access Bypass application/policy for this exact path only, so Discord can reach it without a browser session. Do not bypass other `/api` routes. The Worker continues to verify Discord signatures and guild membership. Discord sends a signed PING challenge. An invalid signature must return 401.
4. Install to the Groblus server with the **applications.commands** OAuth2 scope only. No bot guild permission or message-content intent is needed for HTTP interactions, private native components and modals. This implementation does not maintain a Gateway connection or read messages.
5. In a secure shell environment, provide `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`, and `DISCORD_BOT_TOKEN`. The token is used only by the one-time registration script, not by the Worker; do not commit it or put it in command arguments. Print the registration payload with `node scripts/discord-commands.mjs`. Only `node scripts/discord-commands.mjs --register` makes a remote write. It upserts `/groblus` without replacing unrelated guild commands.
6. In the real guild, test registration with a test invite, then interests and one weekly slot. Verify the website sees these values. For a separate web test user, create a linking code and run `koppla`; confirm one identity, single-use rejection, and conflicting-profile rejection. Create a web proposal and verify Discord voting reaches the web. Production acceptance is incomplete until this is done.

The Bot Token authenticates command registration via Discord's application endpoint; it does not imply adding the `bot` OAuth scope or requesting intents. If the organization's installation policy needs a bot user, use zero guild permissions and leave all privileged intents disabled.

## Security and operational boundaries

The endpoint verifies Ed25519 over the raw timestamp + body, rejects timestamps outside five minutes, restricts non-PING interactions to the configured guild and authenticated member, and records interaction IDs in D1 to reject replay. Receipts expire after ten minutes. Every data operation resolves the user's identity from the signed Discord member ID; no client-supplied profile ID is trusted. Link codes and invites are hashed SHA-256, checked for expiry, and consumed transactionally. Replies disable mentions and contain aggregate interest/vote counts, only display names and aggregate counts, never other users' email addresses or Discord IDs.

No ephemeral webhook follow-up token is stored. Current operations reply synchronously, so deployed D1 latency must be validated against Discord's initial response deadline (three seconds). No background notifications, calendar integration or shared event publishing are implemented.

Official references checked 2026-09-13:

- [Receiving and responding to interactions](https://docs.discord.com/developers/interactions/receiving-and-responding): signatures, response types, ephemeral messages and deadlines.
- [Component reference](https://docs.discord.com/developers/components/reference): buttons, selects and modal inputs.
- [Application commands](https://docs.discord.com/developers/interactions/application-commands): guild registration and application command scopes.
