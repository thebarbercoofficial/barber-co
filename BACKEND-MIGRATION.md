# Backend Migration

Status: prepared, not deployed or switched over.

The frontend remains on GitHub Pages. The existing Vercel backend stays intact
until a replacement has passed live testing. No accounts or bookings have been
copied, removed, or reset.

## Replacement Runtime

The API can now run on any Node 24 host with `npm ci --omit=dev` followed by
`npm start`, or using the included Dockerfile. Set the host's health-check path
to `/healthz`. This is a process liveness check, not database readiness.
Use `/api/health` to verify the database connection and initialization.
The server exposes API routes only, never repository files or environment files.

## Required Access

- A hosting account controlled by the owner. Railway was checked and is signed out.
- The current MongoDB connection string, database name and network access.
  No working database credentials are configured in this checkout.
- A JWT secret of at least 32 characters. Preserving the old secret preserves
  existing session signatures; using a new secret requires everyone to log in again.
- A real email provider API key and verified sender for verification and resets.
  SMS additionally requires the Twilio settings listed in `.env.example`.

Copy secrets through the hosting environment settings, never Git or frontend code.
On 2026-10-30 the owner authorized a fresh start under the Senzen account.
The new BarberCo Free M0 cluster uses the `barber_co` database. Old accounts,
bookings and settings are not migrated. Keep the old backend and database intact.
Do not set demo or unverified-account bypass flags in production.

## Cutover Checklist

1. Retain the old backend/database unchanged; obtain an owner-accessible backup
   if access is recovered. Do not claim that old data has been migrated.
2. Deploy this source to the replacement host with the authorized fresh database.
   Configure bootstrap ADMIN credentials securely before enabling staff access.
3. Test database health, real email verification/reset, customer login, admin/moderator
   permissions, payment receipt viewing, booking conflicts, queue updates and ledger totals.
4. Update `productionApiBase` in `js/shared.js` to the verified HTTPS replacement URL.
   Refresh the shared script cache version in HTML and publish GitHub Pages.
5. Test the public website again from a clean browser and an authenticated staff session.
6. Keep the old Vercel endpoint available for rollback until cutover is confirmed.

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
