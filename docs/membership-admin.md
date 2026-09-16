# Paid membership administration

Website login remains Cloudflare Access with verified email. D1 `memberships` holds normalized email and paid-through year; `users` preserves the optional Discord ID and all existing preferences. Membership eligibility uses the current calendar year in Europe/Stockholm. Every protected web request and signed Discord command/component checks D1 again. Admin access alone does not imply paid membership.

`ADMIN_EMAILS` is a comma-separated Worker variable of trusted verified email addresses. Multiple administrators are supported; changes require deployment/configuration access. Never accept an admin role or email from a request body/header other than the validated Access JWT. Staging starts with Oliver's existing verified address. No real member is automatically marked paid.

Visit `/spelhyllan/admin/`. Paste up to 100 email addresses (lines, commas or semicolons), choose a year, preview and save. Invalid addresses prevent the whole import; duplicates collapse; existing later years, omitted members and Discord links remain unchanged. The list includes current status and whether Discord is linked. Revocation sets the paid-through year to last year and preserves the profile. `updated_by` and `updated_at` record the latest membership change.

Discord `/groblus registrera` directs the person to the Cloudflare-protected website, where they verify their member email. A paid member creates a one-use linking code in their web profile and submits it through `/groblus koppla`. The link operation rechecks payment atomically. Existing invitation-only accounts are denied until resolved through verified email; no automatic identity merging is performed.

## Deployment and acceptance

- Apply migration `0003_memberships.sql` before deploying the Worker.
- Pass `ADMIN_EMAILS` to `prepare-deploy.mjs`; keep this variable in every subsequent deployment.
- Configure Access to authenticate email with its existing OTP provider without maintaining a second member-email allowlist. Keep Access enabled; do not bypass it. D1 decides paid access. The exact Discord interactions bypass stays unchanged.
- Update the guild command definitions after deployment.
- Verify an admin session in the browser, import preview, invalid input and saved membership readback. Test a second non-admin identity, expiry/revocation and Discord linking with actual users before marking rollout complete.

2026-09-16: migration applied to remote staging, Worker version `7e3183a9-94e5-494f-a0c8-18ab10c05cc3` deployed and guild commands updated. Build/typecheck and 42 tests pass (34 Worker tests plus 8 script tests). Live admin-session verification and Access policy transition are pending.
