# DSH Teams Identity And Session Design

## Scope

DT-1-03 adds the local identity authority that consumes the SQLite foundation from DT-1-02. It owns founder bootstrap, administrator-created temporary users, password changes and resets, opaque login sessions, account lifecycle changes, and persistent login throttling. It does not add HTTP routes, SMTP dispatch, audit writes, policy epochs, TOTP, passkeys, or multi-user enablement.

## Chosen Design

`IdentityService` is constructed with an opened DT-1-02 database and a clock. It owns database transactions and exposes application-level operations; later gateway code maps its stable `IdentityError.status` values to HTTP responses. `passwords.mjs` owns scrypt password hashes and SHA-256 digests for opaque secrets. `sessions.mjs` owns random base64url token creation and digest-only session records.

The initial migration already defines the main identity tables. A new `002-identity` migration adds the session's `auth_version` snapshot and restricted flag, plus a `login_rate_limits` table whose key is a SHA-256 digest of the normalized login identifier. No plaintext password, reset token, session token, or email-derived rate-limit key is stored.

## Data Flow

```text
raw password/token -> hash or SHA-256 digest -> SQLite
SQLite credential/session -> status + auth_version checks -> service result
missing login -> dummy scrypt verification -> same invalid-credential result
password/status/role change -> auth_version increment -> existing sessions invalid
```

The service normalizes email by trimming then lowercasing it for lookup while preserving the trimmed input as `email_display`. It accepts only non-empty, structurally valid email values and non-empty password strings. Password hashes use a versioned scrypt serialization with a random salt. Verification rejects an unknown serialized format.

## Identity Operations

- `bootstrapFounder` succeeds only when no users exist. It creates an active admin founder with `must_change_password = false` and an initial principal epoch row.
- `createTemporaryUser` requires an active admin actor. It creates an active user with `must_change_password = true`.
- `authenticate` always performs password verification. It uses a fixed dummy hash when the account is absent, disabled, or unavailable, records failed attempts in SQLite, and returns the same `authentication-invalid` error for every rejected credential.
- Five failed attempts in a fifteen-minute window block further login attempts for fifteen minutes. A successful login clears the stored failure state. The row is keyed by a digest, so service reconstruction and process restart do not reset the limit.
- `changePassword` verifies the existing password, replaces the hash, clears the forced-change state, increments `auth_version`, and invalidates current sessions.
- `beginPasswordReset` creates a short-lived one-time reset token only for an active account. `resetPassword` consumes it once, replaces the hash, increments `auth_version`, and invalidates sessions. The future HTTP layer must return a generic response regardless of account existence.
- `setUserStatus` and `setSystemRole` require an active admin actor. A founder cannot be disabled or demoted. Any effective change increments `auth_version` and invalidates sessions.

## Sessions And Error Semantics

Sessions use a random 32-byte base64url token. Only its SHA-256 digest is stored, along with expiry, restricted state, and the user `auth_version` captured at creation. `assertSession` returns the active principal only when the digest, expiration, user status, and both auth-version values match. Missing, expired, revoked, disabled, or stale sessions produce `IdentityError` with HTTP status `401`. A valid restricted session used for an unrestricted operation produces `403`.

Session rotation validates the old session, revokes it in the same transaction, then creates a new opaque token with the same restricted state and current auth version. Password and account lifecycle changes invalidate all sessions rather than relying solely on the snapshot comparison.

## Tests

Tests use a real temporary SQLite database through `openDatabase`. They cover bootstrap uniqueness and founder immutability, creation of a temporary user, password change and reset, digest-only storage, session rotation and expiry, restricted-session `403`, stale/revoked/disabled-session `401`, non-enumerating failed logins with dummy verification, and durable rate limits. Every production behavior is introduced through a failing focused `node:test` case before its implementation.

## Security Boundaries

This task does not enable a second real user or expose an HTTP endpoint. Its errors contain stable codes and no secret material. Policy resource epochs, audit events, email delivery, and authorization of gateway requests remain owned by DT-1-04 and DT-2-01 onward.
