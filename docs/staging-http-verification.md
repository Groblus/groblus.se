# Staging HTTP verification

Checked 2026-09-14T14:40:19.672Z against https://groblus-spelhyllan-staging.oliver-glant.workers.dev. Real deployed Worker and remote Cloudflare D1; synthetic example.invalid accounts only.

- Unauthenticated /me returns 401
- Registration issues Secure, HttpOnly, SameSite=Strict session
- Wrong password denied
- Cross-origin mutation denied
- Independent play and GM preferences persist together
- Turning off play preserves GM interest
- Weekly availability persists in remote D1
- Other member cannot confirm creator plan
- Plan creation, vote and creator confirmation persist
- Logout revokes session server-side
- Password login reads previously saved remote D1 state
- FAIL: POST /auth/reset: expected 200, got 503; <!DOCTYPE html>
<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->
<!--[if IE 7]>    <html class

This verifies HTTP behavior, not visual browser behavior or live Discord delivery. Test credentials remain in a private temporary file, never in the repository. Synthetic plans are explicitly labeled and are not real activities.

## Blocking runtime finding

The password-reset request failed with HTTP 503. Cloudflare Workers tail recorded `outcome: exceededCpu`, `Worker exceeded CPU time limit.`, and 343 ms CPU for that request. Earlier successful registration and login requests consumed about 401–510 ms CPU. Therefore password flows are not reliable under the current execution limit; successful individual requests do not prove deployment acceptance. Recovery completion, recovery-code reuse rejection, old-password invalidation and password-change session revocation remain unverified in this deployment.

## Operator tooling repair

Live testing exposed that Wrangler remote `d1 execute --file --json` prints upload progress and returns import statistics instead of SQL result rows. Remote invite/recovery commands now use `--command` to obtain the required `created` row, while passing only a code hash in SQL. The raw invitation/recovery code remains private. Four regression checks cover remote command selection, code hashing and JSON parsing. Two earlier attempts created unused invitation hashes; neither code was disclosed or used.
