# Spelhyllan implementation contract

> Status 2026-09-14: Cloudflare Access-versionen är publicerad i staging och D1-migration 0002 är applicerad. Verklig inloggning och Discord-installation återstår att slutverifiera. Se [acceptanslistan](glantan-acceptance.md).

Current decision, 2026-09-14: Cloudflare Access owns website authentication and sessions. Use its standard email code login with a one-month application session to avoid repeated email prompts on ordinary visits. Website use does not require Discord. No application-managed passwords, login sessions or recovery codes. No eBas. Preserve the existing public Eleventy/Netlify site.

Architecture: TypeScript Worker, D1 and same-origin static assets under `/spelhyllan/`. Deployment uses a separate HTTPS origin. Configure `ACCESS_TEAM_DOMAIN` as `https://<team>.cloudflareaccess.com` and `ACCESS_AUD` from the Access application. Validate `Cf-Access-Jwt-Assertion` via Cloudflare's documented jose integration, including signature, issuer, audience and expiry. Never trust an unverified email header. Static Assets routing currently prevents using `ctx.access` through its internal router; documented JWT validation is used instead. Access policy controls the explicit email allowlist. D1 profile provisioning uses the verified email and preserves existing member records.

All browser writes validate origin. API paths below have `/api` prefix. Errors are `{error:string}`; signed-in responses include `{user:{id,displayName,email?,discordLinked,needsDisplayName}}`. First use asks the member for a display name. Logout uses Cloudflare's `/cdn-cgi/access/logout`; legacy `/api/auth/*` routes return 410. No development identity bypass is deployed.

- GET /me -> {user}, 401 without valid Access identity
- PUT /me {displayName} -> {user}
- GET /games -> {games:[{id,name,kind:'rpg'|'boardgame'|'other',playCount,gmCount,wantPlay,wantGm}]} authenticated
- POST /games {name,kind} -> {game:{id,name,kind}}, all association users may add (dedupe normalized names)
- PUT /interests/:gameId {wantPlay:boolean,wantGm:boolean} -> {ok:true}
- GET /availability -> {slots:[{day:0..6,period:'day'|'afternoon'|'evening',preference:'often'|'sometimes'|'rarely'}]}, Mon=0, Sweden local time, missing = unset
- PUT /availability {slots:[...]} -> {ok:true}; replaces own week; day 10-14 afternoon14-18 evening18-22. Unknown is not unavailable.
- GET /plans -> {plans:[{id,title,gameId,gameName,description,creatorId,status:'proposed'|'confirmed',confirmedOptionId:null|string,options:[{id,startsAt,endsAt,yesCount,maybeCount,noCount,myVote:null|'yes'|'maybe'|'no'}]}]}
- POST /plans {title,gameId,description,options:[{startsAt:ISO8601,endsAt:ISO8601}]} -> {id}; 2-5 options, all signed-in users
- PUT /plans/:planId/votes/:optionId {vote:'yes'|'maybe'|'no'|null} -> {ok:true}
- POST /plans/:planId/confirm {optionId} -> {ok:true}, creator only; confirming date is not RSVP
- POST /discord/link-code {} -> {code,expiresAt}; authenticated website user generates short-lived single-use linking code, enters /groblus koppla kod in Discord. Discord users with no web profile can use invite-based /groblus registrera namn inbjudan to create Discord-only profile. Linking an existing Discord-only profile to a web account MUST avoid silent data loss: reject conflicting already-used identity rather than silently merge. A Discord-only profile is not automatically merged with a web profile; review conflicting identities explicitly.


Discord remains signed HTTP interactions at `/api/discord/interactions`; this exact path needs an Access Bypass policy so Discord can reach the Worker. The Worker still requires Discord's Ed25519 signature, fresh timestamp, configured guild and linked or invited member. Never bypass browser API paths. All replies are ephemeral. Website creates and confirms plans; Discord lists and votes on them. No message-content intent or background notifications.

D1: users(id,email nullable unique,display_name,discord_id nullable unique,created_at), games, interests, availability, plans, plan_options, votes, discord_link_codes, invites, interaction receipts and rate limits. Migration 0002 removes users.password_hash, sessions and recovery_codes while preserving profile IDs and preferences. Link and invite codes are single-use/limited-use association-linking data, not website login credentials.

Additional reads:

- GET /games/:id/players -> {players:[{id,displayName,wantPlay,wantGm}]}; no private email addresses.
- GET /games/:id/availability -> {interestedCount,slots:[{day,period,oftenCount,sometimesCount,rarelyCount,unsetCount}]}; missing answers remain unknown.

See [operations](spelhyllan-operations.md), [deployment](spelhyllan-deployment.md) and [Discord setup](discord.md). Local signed fixtures do not prove live Access or Discord installation.
