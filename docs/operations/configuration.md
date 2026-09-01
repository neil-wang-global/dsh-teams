# DSH Teams Configuration

`@dsh-teams/core` validates the deployment contract before a DSH Teams service starts. A caller passes an explicit environment object to `loadConfig`; it must not silently substitute browser request headers, the public bind address, or plaintext credentials.

Configuration errors are `ConfigurationError` instances with stable codes and secret-free messages. The startup layer must keep readiness false, log only the code and operator diagnostic, and expose no user-facing configuration detail.

## Required Settings

| Setting | Required value | Purpose |
| --- | --- | --- |
| `DSH_TEAMS_MODE` | `production` or `development` | Selects production-only HTTPS and Cookie constraints. |
| `DSH_TEAMS_CANONICAL_URL` | Absolute origin URL | Trusted site URL for Cookies, email links, and future WebAuthn validation. |
| `DSH_HOME` | Absolute path | Base directory from which the SQLite path is derived as `$DSH_HOME/teams/teams.sqlite3`. |
| `DSH_TEAMS_DSH_BIND` | `127.0.0.1` or `::1` | Raw DSH listener address. Public traffic must never bind directly to a non-loopback address. |
| `DSH_TEAMS_DSH_PORT` | Integer from `1` through `65535` | Raw DSH listener port. |

The canonical URL has no credentials, query, fragment, or path component. Production requires an `https:` URL. An `http:` URL is accepted only for a loopback development URL.

## Session Cookie

`DSH_TEAMS_COOKIE_SECURE` defaults to `true`. The resulting session Cookie is always named `__Host-dsh-teams`, `HttpOnly`, `SameSite=Lax`, and `Path=/`; it does not accept a Domain setting.

Production requires `DSH_TEAMS_COOKIE_SECURE=true`. Development can set it to `false` only when `DSH_TEAMS_ALLOW_INSECURE_COOKIE=true` is also set explicitly. This opt-in is for local development only and must not be copied to deployed configuration.

## SMTP

SMTP is disabled unless `DSH_TEAMS_SMTP_ENABLED=true`. When it is enabled, all of the following values are required:

| Setting | Format |
| --- | --- |
| `DSH_TEAMS_SMTP_HOST` | SMTP hostname |
| `DSH_TEAMS_SMTP_PORT` | Integer from `1` through `65535` |
| `DSH_TEAMS_SMTP_USERNAME` | Deployment account name |
| `DSH_TEAMS_SMTP_PASSWORD_REF` | `env:VARIABLE_NAME` secret reference |
| `DSH_TEAMS_SMTP_FROM` | Sender address or display address |

Do not place an SMTP password in DSH Teams configuration, source files, logs, or diagnostics. The deployment launcher resolves the named environment variable immediately before constructing the SMTP provider; the parsed core configuration retains only the reference.

## Feature Flags

`DSH_TEAMS_FEATURE_TOTP` and `DSH_TEAMS_FEATURE_PASSKEY` both default to `false`. Each accepts only `true` or `false`. Enabling either flag later requires its independent Gate C lifecycle and security evidence; this configuration contract does not enable either feature by default.

## Startup Handling

Run the repository verification before deployment:

```sh
npm run check
```

At startup, reject any configuration error before opening a public listener, initializing persistence, issuing a session, or starting a worker. Report the error code to the operator and keep readiness unavailable until corrected. The later database foundation adds ownership, mode, realpath, symlink, WAL, and backup checks for the derived SQLite path.
