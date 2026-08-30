# RG-03 Manual Browser Validation Evidence

- **Record status:** Approved manual validation evidence preserved.
- **Record date:** 2026-08-30.
- **Gate:** RG-03 Identity.
- **Related implementation:** BCM-WEB-002.
- **Repository baseline:** `b308588b7578f66f00f7eae1a030f1ab59fd534c`.
- **Evidence type:** Manual browser validation; not an automated E2E suite.

## Purpose

This record preserves the approved manual browser validation results for the BCM-WEB-002 Identity flow. It documents observed outcomes without storing credentials, cookie values, session tokens, CSRF tokens, sensitive headers, or screenshots containing sensitive data.

This evidence complements the automated tests and CI used for RG-03. It does not replace them.

## Scope and environment

The validation exercised a local development environment with PostgreSQL, the API, and the Web application running locally over HTTP. Authentication used a synthetic local development user.

The exact validation date, operating system, browser product/version, local ports, and synthetic credential values were not preserved in the approved evidence and are not reconstructed here. `Secure=false` below applies only to the observed local HTTP development cookie; it does not change the production cookie requirements in `docs/SECURITY.md`.

## Validation record

| ID | Validation | Expected result | Observed result | Result |
| --- | --- | --- | --- | --- |
| BR-01 | Open the local Web application without an authenticated session. | Anonymous state routes to `/login`. | The Web displayed the anonymous flow at `/login`. | **PASS** |
| BR-02 | Submit valid credentials for the synthetic local user. | Login completes without exposing credentials and session bootstrap succeeds. | `POST /api/auth/login` returned `204`; the following `GET /api/auth/session` returned `200`. | **PASS** |
| BR-03 | Inspect the Web after login. | The authenticated session is visible to the user. | The Web displayed the authenticated session state. | **PASS** |
| BR-04 | Refresh the authenticated page with browser refresh/F5. | The server-side session remains valid and the authenticated flow is restored. | Refresh preserved the authenticated session. | **PASS** |
| BR-05 | Inspect the development session cookie attributes without copying its value. | The local HTTP cookie uses the reviewed development policy and remains host-only. | `bcm_session` was present with `HttpOnly=true`, `SameSite=Lax`, `Path=/`, host-only scope, and `Secure=false` only for local HTTP. | **PASS** |
| BR-06 | Check browser-visible cookies without recording their contents. | JavaScript cannot read the HttpOnly session cookie. | `document.cookie` did not expose `bcm_session`. | **PASS** |
| BR-07 | Log out through the Web flow. | Logout succeeds, redirects to `/login`, and removes the session cookie. | Logout succeeded, the Web redirected to `/login`, and `bcm_session` disappeared. | **PASS** |
| BR-08 | Refresh after logout and inspect the session request. | The Web stays anonymous and the revoked/absent session is rejected. | Refresh remained at `/login`; `GET /api/auth/session` returned `401`. | **PASS** |
| BR-09 | Stop the local API while the Web remains available. | Backend unavailability is shown as unavailable/retry, not misclassified as anonymous. | The Web entered the unavailable/retry state and did not interpret the API outage as anonymous. | **PASS** |
| BR-10 | Restore the API and use retry. | The flow recovers after backend service is restored. | Retry recovered the flow after the API was restored. | **PASS** |
| BR-11 | Inspect the Identity flow at representative viewport widths. | No evident blocking responsive issue appears in the tested flow. | No evident responsive issue was observed at 320, 375, 768, 1024, or 1440 px. | **PASS** |

## Reproduction checklist for a future review

1. Prepare local PostgreSQL according to `infrastructure/postgres/README.md` using synthetic, local-only secrets.
2. Start the API with the current `@bcm-soft/api` development script and the Web with the current `@bcm-soft/web` development script; use the local URLs emitted by those processes.
3. Provision a synthetic development user through the existing `dev:create-user` flow. Do not record its password or environment values in evidence.
4. Open the local Web application and confirm anonymous navigation to `/login`.
5. Log in with the synthetic user and inspect only request methods, paths, and status codes for the login and session requests.
6. Refresh the page and confirm that the authenticated session is restored.
7. Inspect the `bcm_session` cookie attributes in browser developer tools without viewing, copying, logging, or capturing its value.
8. Confirm only the boolean outcome that `document.cookie` does not contain `bcm_session`; do not copy the full `document.cookie` output.
9. Log out, confirm redirect and cookie removal, refresh, and verify the post-logout session request returns `401`.
10. Stop the local API, confirm unavailable/retry rather than anonymous, restore the API, and retry.
11. Inspect the flow at 320, 375, 768, 1024, and 1440 px and record only observable layout defects or a bounded PASS result.
12. Before preserving new evidence, remove credentials, tokens, cookie values, CSRF values, sensitive headers, connection strings, and screenshots that expose them.

## Security handling

- No cookie value, raw session token, password, CSRF token, HMAC key, credential-bearing database URL, or sensitive header is included.
- Cookie evidence is limited to its non-secret name, attributes, presence/removal, and JavaScript visibility result.
- Request evidence is limited to method, path, and HTTP status.
- No screenshot or browser export is preserved by this record.
- Any future evidence containing a secret must be discarded or redacted before it is versioned.

## Limitations and non-claims

- This is a durable record of a manual validation result, not a rerun performed while writing this document.
- It is not a Playwright or other automated E2E suite and does not establish cross-browser coverage.
- It does not replace unit, integration, security, database, or CI evidence.
- The responsive check was a bounded manual visual inspection at the listed widths; it is not a WCAG audit or accessibility certification.
- The local HTTP cookie observation does not validate production HTTPS, edge, proxy, domain, or deployment configuration.
- This record does not claim production readiness, completed tenancy, or RG-04 approval.

## Traceability

- `roadmap/ROADMAP.md` records BCM-WEB-002 as Completed and RG-03 as **Approved with follow-ups**.
- This record closes only RG03-F005, the durable browser-evidence gap for the already performed manual validation.
- RG03-F004 remains a separate pending pre-production/supply-chain follow-up.
- BCM-TEN-001 and RG-04 remain outside this task.
