# Operator access hardening — 2026-07-18

## Decision

SEVE is a private, single-operator paper-trading workstation. Signed-out users must not load desk, market, strategy, position, event, or system-health data. Authentication is an access boundary, not merely a switch that enables write controls.

The sole authorized operator identity is `pobrecitopdx@gmail.com`. Authorization continues to depend on immutable Supabase `app_metadata.seve_role=operator`; the email address is only the provisioned login identity and is never sufficient authorization by itself.

## Audit findings

- `signInWithOtp` already used `shouldCreateUser:false`, so arbitrary addresses could not self-register.
- Supabase Auth contained two existing users. Only `pobrecitopdx@gmail.com` had `app_metadata.seve_role=operator`; the older roleless account must be separately revoked and removed after operator approval.
- Twenty dashboard tables still had anonymous/public read policies. The browser therefore exposed substantial desk data without any login even though writes were operator-gated.
- `compile-strategy`, `backtest-strategy`, `push-subscribe`, and the Alpaca-backed `spot` proxy accepted unauthenticated requests. The first could consume the configured model account, the push route wrote through the service role, and the spot route could spend upstream request capacity.
- Default Supabase email delivery is project-rate-limited. Repeated code requests caused the observed `email rate limit exceeded` failure.

## Prepared application boundary

- `app/page.tsx` mounts no data-bearing hook until Auth has restored a session with the operator role.
- The signed-out surface is a dedicated private-operator login wall.
- Password is the normal login. A fixed-account email code remains a recovery/bootstrap path only.
- Once authenticated, the operator can set or rotate a password from the access control.
- Every desk write checks both session presence and operator role in the client; RLS and server checks remain authoritative.
- `compile-strategy`, `backtest-strategy`, `push-subscribe`, and `spot` now validate the Supabase bearer and immutable operator role before doing work.

## Prepared database boundary

Migration `20260719021937_harden_operator_access.sql` removes legacy anonymous/public policies and anonymous privileges from these browser-facing tables:

`accounts`, `daily_bars_hist`, `daily_reports`, `equity_snapshots`, `events`, `forensics_reports`, `foulout_ledger`, `fund_state`, `option_bars`, `option_quotes`, `override_ledger`, `positions`, `signals`, `strategist_config`, `strategists`, `underlying_bars`, `virtual_trades`, `weekly_reports`, `worker_heartbeat`, and `worker_runs`.

Each receives a single authenticated SELECT policy requiring `app_metadata.seve_role=operator`. Existing operator-only write policies remain unchanged. Service-role worker and publisher access remains explicit and unaffected.

## Production sequence

1. Review the preview login wall using the email recovery path.
2. While signed in as the operator, set a unique password of at least 12 characters and verify sign-out/password sign-in.
3. Revoke sessions for and remove the old roleless Auth user (`matt@multifresh.com`). This is a separate destructive production action requiring explicit approval.
4. Apply the private-desk RLS migration and immediately verify signed-out reads fail while operator reads and service-role worker writes remain green.
5. Merge/deploy the application boundary and smoke desktop/mobile login, data loading, close-position, broker reconciliation, and channel controls.
6. Enable leaked-password protection in Supabase Auth.

## Follow-on authentication hardening

Password plus a private RLS boundary fixes the present authorization flaw. The next security increment should be TOTP MFA with an `aal2` requirement on operator RLS/API checks, plus Cloudflare Turnstile on recovery/auth requests. This prevents a public client from using Supabase's email-code endpoint to spam the operator inbox or exhaust the project email quota. If recovery email remains, configure production SMTP rather than relying on the two-emails-per-hour default sender.

## Verification

- `npx tsc --noEmit`
- `npm run operator-selftest` — 39/39
- `npm run build`
- `git diff --check`

No production migration, Auth-user mutation, session revocation, merge, or deployment was performed while preparing this change.
