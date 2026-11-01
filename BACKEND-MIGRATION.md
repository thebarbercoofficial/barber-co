# Backend Migration

Status: Render backend deployed and public frontend switched on 2026-11-01.

The frontend remains on GitHub Pages and now uses the Render API. The previous
Vercel backend and database are intact for rollback. Existing accounts and
bookings were not migrated. New customer email verification and password reset
were tested end to end against Render. The shop still needs real payment details
and actual barber profiles before online bookings can be accepted.

## Replacement Runtime

The API can now run on any Node 24 host with `npm ci --omit=dev` followed by
`npm start`, or using the included Dockerfile. Set the host's health-check path
to `/healthz`. This is a process liveness check, not database readiness.
Use `/api/health` to verify the database connection and initialization.
The server exposes API routes only, never repository files or environment files.

## Current Operations

- Render Free (Singapore) runs the API; MongoDB Atlas Free M0 (Hong Kong) stores data.
- Gmail API uses send-only OAuth credentials configured in Render. Google shows
  the OAuth app as In production, but it is not Google-verified. SMS is not configured.
- The new database seeds five services but has no barber profiles yet. Until a
  real GCash/Maya destination is configured, online bookings use clearly labeled
  non-payable demo methods so the booking and staff-review workflow can be tested.
  Demo bookings are excluded from collected revenue. The admin can switch to real
  payments only after configuring a valid number or QR and confirming its recipient.
- Existing customers must register again because old accounts were not migrated.
- Render Free may sleep while idle and has no production performance guarantee.

Copy secrets through the hosting environment settings, never Git or frontend code.
On 2026-10-30 the owner authorized a fresh start under the Senzen account.
The new BarberCo Free M0 cluster uses the `barber_co` database. Old accounts,
bookings and settings are not migrated. Keep the old backend and database intact.
Do not enable unverified-account bypasses in production. Demo payments must remain
clearly labeled and may not be presented as real or collected revenue.

## Cutover And Remaining Setup

1. Done: deploy the replacement backend with the authorized fresh database and admin.
2. Done: test email verification, password reset, customer login, health, and anonymous
   admin denial against Render.
3. Done: set `productionApiBase` in `js/shared.js` to Render, refresh the shared script
   cache key, and publish the GitHub Pages frontend (commit 93a9d4a).
4. Pending: configure real GCash/Maya details and add the actual barber roster in Admin.
5. Pending: test a real booking, payment-proof review, staff approval, queue transitions,
   and revenue reconciliation using owner-provided payment/staff configuration.
6. Keep the old Vercel endpoint and database intact for rollback until migration is accepted.

Portable-server tests cover routing, health checks, query strings, CORS preflight
through the actual handler, and denying access to private repository files.
They do not prove database connectivity, email delivery, or successful deployment.

## Gmail API Sender Option

Render Free blocks SMTP ports, so Gmail uses the HTTPS Gmail API instead.
Set `EMAIL_PROVIDER=gmail`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
`GMAIL_REFRESH_TOKEN`, and `GMAIL_SENDER` in the backend environment only.
The sender must be the Gmail account that authorized the token. The mailer asks
for `gmail.send` only, not permission to read the inbox. Resend remains the
default when `EMAIL_PROVIDER` is not `gmail`.

The Windows operator utility `node scripts/authorize-gmail.js` loads the
DPAPI-encrypted OAuth client from `%LOCALAPPDATA%\BarberCo\Secrets`, starts a
one-time loopback callback, and prints the Google consent URL. It validates
OAuth state and PKCE, then encrypts the refresh-token configuration as
`gmail-sender-senzen.xml` in the same directory. No token is printed.
The operator must review and grant Google's consent themselves.

Do not call a Testing-mode OAuth setup production-ready: Google can expire
its refresh tokens after seven days. Resolve publishing requirements before
launch, and test actual inbox delivery, verification and password resets after
configuring the hosted environment. Adapter unit tests mock Google and cannot
prove real delivery. Gmail is subject to account sending limits.
