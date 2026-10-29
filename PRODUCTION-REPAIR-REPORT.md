# Production Repair Report

Release: production-20261029. Date: 2026-10-29.

## Scope And Evidence

This release repairs application behavior; it does not manufacture payment accounts, email credentials, or SMS delivery. Automated integration tests use the actual API handlers and browser pages with an isolated database and mocked external delivery transports. They do not send messages to real customers or insert production bookings. Deployment checks are reported separately below.

## Repairs

| Tester issue | Repair | Verification |
| --- | --- | --- |
| Slow response/loading | Removed artificial navigation delay; lazy-loaded QR image processing; removed receipt blobs from polling payloads; parallelized initial dashboard requests; stopped re-hashing seeded passwords on every cold start. | Syntax, API and browser suites pass. These changes do not eliminate network latency or serverless cold starts. |
| Collected revenue differs | Dashboard and reports use the paid ledger; all-time and selected-period totals are labeled separately; historical demo entries are excluded from real collections. | PHP 400 fixture reconciles to PHP 250 online plus PHP 150 walk-in, including daily and per-barber sums. Repeated completion cannot change paid timestamps or count twice. |
| Payment proof missing | Staff fetch proof on demand through an authenticated endpoint; responsive receipt dialog displays and downloads the stored image; receipt bytes are validated on upload. | Customer/anonymous access denied; desktop/mobile image rendering and downloaded bytes checked. |
| Dashboard values stale | Incremental five-second polling plus focus/visibility refresh updates bookings, collections, queue, previews and charts without replacing draft forms. Errors are shown explicitly. | Browser tests mutate the API data and assert changed values while preserving unsaved input at 1440px and 390px. |
| Logbook values stale | Incremental counters/rows, fresh non-cached responses, focus refresh, and removal of the old 250-ticket truncation. | Waiting, serving and completed updates checked in both browser sizes. |
| Repeated serving/payment actions | Server-enforced state transitions, optimistic updates and an exclusive queue-start lease prevent concurrent staff calls from starting two customers. Completed/cancelled records cannot reopen. | Concurrent requests produce one success and one conflict; repeated completion leaves the original paid timestamp unchanged. |
| Email verification | Single-use, hashed six-digit codes expire after ten minutes; five wrong guesses invalidate the code; new customers receive no login token until verification. | Correct, wrong, expired, exhausted and replayed codes tested. Missing provider returns an honest 503 rather than pretending an email was sent. |
| Forgot password | Email-code reset changes the password hash and invalidates previous sessions; request responses avoid revealing account existence. | API checks plus actual mobile forgot-password form, reset and new-password login. |
| Production rather than demo | Production overrides old demo settings and rejects attempts to enable demo payments. Actual wallet configuration and receipt upload remain required. | Production-mode settings and booking checks; old demo records are not converted into money. |
| Appointment notifications | Acceptance, cancellation, rescheduling and account-linked queue turns create private in-app notifications; verified email and verified, opted-in phone channels use Resend/Twilio. Admin sees channel errors and can retry failed channels. | Successful and rejected provider responses, retry deduplication, privacy and turn SMS adapter tested. Provider acceptance is not labeled delivery. |
| Confirm password | Registration requires matching confirmation and a minimum eight-character password. | API and mobile form checks. |
| Mobile terms alignment | Fixed-size checkbox aligned beside wrapping text; mobile registration no longer starts with an oversized illustration. | 390px browser assertions and screenshot inspection. |
| Phone/email login confusion | Switching method clears password; browser and API validate the selected identifier mode. | Email cannot be submitted as a phone identifier; password clearing tested. |
| Login spam | Persistent five-attempt lockout starts at five minutes, escalates to ten/twenty/forty/sixty minutes, and is shared across a user's phone/email identifiers. | Five-minute and ten-minute escalation and cross-identifier bypass tests. This is an account lockout, not comprehensive bot/DDoS protection. |
| Age policy | Valid calendar birth date required for new registration; server restricts online wallet booking to adults under shop policy. Walk-ins remain available without an account. | Under-18 booking denied, name-only walk-in accepted. Birth dates are self-declared, not identity/KYC verification. |
| Customer entering admin | Server validates roles for privileged data/actions; staff pages stay hidden until the current session is checked; forged local roles cannot grant access; customer redirects cannot target admin. Removed browser-embedded staff passwords and email-based promotion. | Anonymous/customer/invalid-token requests denied; forged-local-admin browser test redirects to home. |
| Past dates and double booking | Calendar, opening hours, closed days and conflicting barber slots are checked on the server, including staff rescheduling. | Past, closed, holiday, duplicate slot and booking hold concurrency tests. |
| Mobile password-reset dialog | Centered, height-constrained, independently scrollable dialog. | Previously failing mobile confirm click now completes the reset flow. |

## Test Commands

- `npm test`: booking hold concurrency, analytics, analytics API and payment settings.
- `npm run check`: API and key browser JavaScript syntax.
- `npm run test:production`: 18 production-mode API/browser scenario groups; no production writes or real messages.
- `npm run test:public`: responsive home queue and Facebook link/contrast.
- `npm run test:phone`: identifier normalization, login and registration compatibility regressions.
- `npm run test:booking`: customer booking, uploaded receipt, staff review and acceptance.
- `npm run test:ui`: staff dashboards, charts, restrictions and responsive layouts.

Legacy compatibility suites explicitly enable test-only demo/unverified flags. The production suite does not. Do not enable `ALLOW_UNVERIFIED_ACCOUNTS` or `ALLOW_DEMO_PAYMENTS` in production.

## External Dependencies And Limits

1. Email requires `RESEND_API_KEY` and `EMAIL_FROM` on a verified sending domain. Email verification proves mailbox control, not that an address belongs specifically to Google. Registration/reset must not claim success when delivery is unconfigured.
2. SMS requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, and `TWILIO_VERIFY_SERVICE_SID` for phone verification. Consent and a verified destination are required. Name-only anonymous walk-ins cannot receive SMS; they can use the queue/TV display. No carrier-delivery webhook or automatic scheduled retry is claimed; staff can retry failures.
3. Real GCash/Maya recipient details and a valid QR must be configured by the shop administrator. QR validation checks format/payment structure, not legal ownership. No real transfer or payment-provider settlement was tested. Staff must inspect receipts before accepting payments.
4. Under-18 handling is a shop booking policy, not a claim that all GCash users must be adults. This release does not implement a minor-only PHP 100 online reservation route; younger customers use walk-ins or a responsible adult's booking.
5. Existing unverified accounts can verify from their profile. New accounts must verify before login. An administrator should review old customer data and role assignments; this release does not certify historical records as accurate.

## Deployment

Application commit: `7a778e3b5ffd1bc93a512d496e7a9a52de0fb747`.

- GitHub Pages deployment succeeded: https://github.com/thebarbercoofficial/barber-co/actions/runs/40889110515
- Vercel commit status: success, "Deployment has completed".
- Published site: https://thebarbercoofficial.github.io/barber-co/
- Published API: https://barber-co-seven.vercel.app/api
- All seven listed test commands passed. Additional syntax checks covered every JavaScript file under `api`, `lib`, and `js`; `git diff --check` passed.
- `node tests/published-smoke.test.js` passed against the public URLs: the release asset version is present, registration fits at 1440px/390px, anonymous staff-page access redirects to login, and analytics/appointments/queue/notifications/private-receipt endpoints all return 401 without credentials.
- Observed read-only API request durations in that smoke run were 282-809 ms. These are individual measurements, not a before/after benchmark or latency guarantee.

### Confirmed Live Blockers

The deployed `/auth/capabilities` returned `email: false`, `sms: false`, and `verificationRequired: true`. Therefore real email verification/reset and SMS delivery are **not operational**. Strict new registration correctly refuses to create an account while email delivery is unavailable. No provider keys were found in this project's local environment; an external service account, verified sender and server credentials cannot be fabricated by code.

The deployed settings contain **no GCash/Maya recipient number or QR image**. The payment mode is `live`, and demo mode is disabled. Online booking correctly cannot proceed until the administrator supplies real wallet details in Shop Settings. No real receipt/transfer was created to conceal this missing configuration.

**Conclusion:** application repairs are deployed and the listed automated checks pass. This is not a claim that every production dependency is ready. Real end-to-end email/SMS delivery, wallet payment and a live customer booking acceptance remain unproven until those external dependencies are configured. Isolated integration tests prove the application flows, not those external services.
