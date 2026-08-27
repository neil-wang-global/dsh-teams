# DSH Teams Implementation Tasking Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved DSH Teams single-tenant identity, authorization, and workspace model through dependency-ordered, independently verifiable work.

**Architecture:** Start with a capability-proof package that determines whether a static in-process Cordis Plugin can cover every relevant DSH data and execution path. Build identity and policy around a SQLite authority only after that proof; if it fails, activate the preplanned sidecar gateway path, and if execution isolation still cannot be proved, use isolated workers or keep the affected capability blocked.

**Tech Stack:** Node.js ESM, Cordis, DSH Web profile, SQLite, SMTP, WebAuthn/TOTP, `node:test`, public npm registry.

## Global Constraints

- Do not modify DSH source under `/Users/neil/.dsh/profiles/web`.
- `dsh-teams` owns accounts, credentials, sessions, MFA, and authorization independently of `dsh-auth-gate`; do not import, migrate, or dual-write that plugin's data.
- DSH raw listener remains loopback-only; an unprotected raw route, HTTP RPC, download, attachment, WebSocket, baseline stream, or incremental stream blocks multi-user mode.
- Unknown DSH endpoints, streams, resources, or execution paths default to blocked or quarantined.
- Do not create or enable a second real user before Gate B passes.
- TOTP and passkeys remain disabled by default and do not block baseline password multi-user enablement; each enabled factor requires Gate C.
- Use opaque login tokens stored as digests, persistent authorization epochs, SQLite transactions, operation journal + saga reconciliation, and response/frame rechecks.
- Use the public npm registry in lockfiles and verification commands: `https://registry.npmjs.org`.
- Preserve MPL-2.0 licensing and existing Commitlint/Lefthook rules.

---

## Planned File Boundaries

| Path | Responsibility | Created by |
|---|---|---|
| `packages/dsh-teams-probe/` | DSH profile inventory, route/stream probe runner, compatibility report, architecture decision. | DT-0-01 to DT-0-04 |
| `packages/dsh-teams-core/` | SQLite repository, identity, policy, epochs, sagas, audit, outbox, security factors. | DT-1-01 to DT-4-02 |
| `packages/dsh-teams-plugin/` | Cordis composition adapter, lifecycle wiring, in-process HTTP/stream interception, compatibility guard. | DT-2-02 to DT-3-05 |
| `apps/dsh-teams-gateway/` | Plugin-managed sidecar HTTP/WebSocket gateway, only activated after an in-process coverage failure. | DT-2-04 |
| `packages/dsh-teams-ui/` | Client Slots for login, bootstrap, admin, member, workspace, and security settings. | DT-3-04, DT-4-02 |
| `tests/fixtures/dsh-profile/` | Versioned profile snapshots and synthetic fixtures used by probe and compatibility tests. | DT-0-02 |
| `docs/compatibility/` | Committed DSH version contracts, coverage reports, and architecture decision records. | DT-0-02 to DT-0-04 |
| `docs/operations/` | Deployment, migration, backup, key rotation, incident, and release runbooks. | DT-1-02, DT-3-03, DT-X-02 |

## Dependency Graph and Gates

```text
DT-0-01 -> DT-0-02 -> DT-0-03 -> DT-0-04 -> Gate A
Gate A -> DT-1-01 -> DT-1-02 -> DT-1-03 -> DT-1-04
Gate A -> DT-2-01 -> DT-2-02 -> DT-2-03 -> DT-2-04
DT-1-04 + DT-2-04 -> DT-3-01 -> DT-3-02 -> DT-3-03 -> DT-3-04 -> DT-3-05 -> Gate B
Gate B -> DT-X-01 + DT-X-02 + DT-X-03
DT-1-03 + DT-3-05 -> DT-4-01 -> DT-4-02 -> Gate C (per enabled factor)
```

- **Gate A, implementation-mode decision:** Evidence proves every required route and stream has an unrecoverable in-process authorization adapter and every non-admin execution path is isolated; otherwise select the gateway and/or worker fallback before Phase 1-3 code starts. No second real user or non-founder multi-user data plane is enabled before evidence exists.
- **Gate B, Baseline Multi-user Enablement Gate:** Password authentication, all classified data paths, policy matrix, leak resistance, execution isolation, epochs/revocation, migration/recovery, TLS/origin/Cookie, persistent rate limiting, local secret protections, and backup recovery all pass.
- **Gate C, Factor Production Gate:** Only applies when TOTP or passkey is enabled. The factor's lifecycle, recovery, replay, ceremony, storage, and production checks pass.

## Phase 0: Capability Discovery and Architecture Decision

### DT-0-01: Create the probe package and repeatable test harness

**Depends on:** None  
**Source:** Design sections 3, 4.1, 10, 15.7  
**Files:** Create `packages/dsh-teams-probe/package.json`, `packages/dsh-teams-probe/src/manifest.mjs`, `packages/dsh-teams-probe/src/report.mjs`, `packages/dsh-teams-probe/test/manifest.test.mjs`; modify root `package.json`.  
**Outcome:** A testable, standalone package can parse an expected DSH surface manifest and reject unclassified routes or streams.  
**Completion check:** `npm test --workspace @dsh-teams/probe` passes; a deliberately unclassified fixture fails with the route or stream name.  
**Failure disposition:** Stop before any identity or UI work; repair probe coverage rather than treating an unknown surface as harmless.

- [ ] Add npm workspace scripts for `test`, `test:probe`, `lint:plan`, and `check` without changing the existing hook scripts.
- [ ] Write failing `node:test` cases for accepted categories `public-authenticated`, `workspace-visible-read`, `holder-write`, `owner-write`, `system-admin`, and `blocked`.
- [ ] Implement manifest parsing that rejects duplicate identifiers, omitted classification, and a non-blocked action without a resource scope.
- [ ] Commit the package and passing test evidence with `test(probe): validate compatibility manifest`.

### DT-0-02: Produce a versioned DSH surface inventory

**Depends on:** DT-0-01  
**Source:** Design sections 3, 4.1, 10, 15.7  
**Files:** Create `packages/dsh-teams-probe/src/profile-scan.mjs`, `packages/dsh-teams-probe/src/snapshot.mjs`, `tests/fixtures/dsh-profile/current.json`, `docs/compatibility/dsh-web-current.md`; modify `packages/dsh-teams-probe/test/manifest.test.mjs`.  
**Outcome:** The exact checked DSH Web profile version, service signatures, HTTP methods, download/attachment paths, WS upgrades, baseline/incremental streams, slots, and resource-creating operations are recorded.  
**Completion check:** The scanner produces a canonical JSON snapshot; committed Markdown identifies every discovered surface as covered, blocked, or requiring upstream clarification.  
**Failure disposition:** Missing introspection becomes an explicit blocked entry and creates an upstream-contract candidate, not an implicit allow.

- [ ] Write fixtures for `session.list`, workspace operations, attachment/download, search/export, RPC, and both WebSocket stream modes.
- [ ] Add tests proving snapshot normalization is deterministic and a new discovered endpoint makes the compatibility check fail.
- [ ] Implement profile scanning from an explicit `DSH_PROFILE_DIR`; never hard-code a user's profile path in source.
- [ ] Record the observed profile bundle list, including the fact that `dsh-auth-gate` may be installed but is not used by `dsh-teams`.
- [ ] Commit report and fixtures with `docs(compatibility): inventory DSH authorization surface`.

### DT-0-03: Prove or reject in-process interception coverage

**Depends on:** DT-0-02  
**Source:** Design sections 4.1, 4.2, 10, 15.3, 15.7  
**Files:** Create `packages/dsh-teams-probe/src/in-process-probe.mjs`, `packages/dsh-teams-probe/src/probe-server.mjs`, `packages/dsh-teams-probe/test/in-process-probe.test.mjs`, `docs/compatibility/in-process-coverage.md`.  
**Outcome:** Black-box probes establish whether HTTP RPC, static/download/attachment requests, WS upgrade, baseline stream, and incremental stream all pass through a single non-bypassable adapter.  
**Completion check:** Every inventory entry has a test transcript showing interception and denial; direct raw route attempts are rejected or are classified as an architecture failure.  
**Failure disposition:** Set the decision to `sidecar-required`; do not partially enable in-process multi-user behavior.

- [ ] Write failing probe tests for a route that bypasses an adapter, a duplicated raw route, and an incremental WS frame that is emitted after authorization changes.
- [ ] Implement a temporary Fiber-scoped probe adapter that records only route/method/frame metadata and can deny test traffic.
- [ ] Execute against a disposable DSH profile and store redacted transcripts in `docs/compatibility/in-process-coverage.md`.
- [ ] Commit evidence with `test(probe): prove in-process authorization coverage` or `docs(compatibility): require sidecar gateway`.

### DT-0-04: Prove execution isolation and record the architecture decision

**Depends on:** DT-0-03  
**Source:** Design sections 4.3, 4.4, 15.7, 18  
**Files:** Create `packages/dsh-teams-probe/src/execution-probe.mjs`, `packages/dsh-teams-probe/test/execution-probe.test.mjs`, `docs/compatibility/architecture-decision.md`, `docs/compatibility/upstream-seam-template.md`.  
**Outcome:** A signed-off decision chooses `in-process`, `sidecar`, `isolated-worker`, or `blocked`, based on proven Agent/Tool/filesystem/credential boundaries.  
**Completion check:** Test principals cannot read another workspace's files, use another workspace's credentials, invoke unapproved Host tools, or escape the selected worker boundary. The decision document links every negative result to a fallback or upstream request.  
**Failure disposition:** Select isolated workers if sufficient; otherwise mark non-admin execution blocked and create an upstream request using the template.

- [ ] Write failing isolation tests for cross-workspace file reads, secret reads, Host service use, subagent/fork inheritance, and custom Remote resource creation.
- [ ] Run the same tests against the candidate in-process preset and a per-workspace worker fixture.
- [ ] Write the architecture decision with DSH version, evidence links, selected mode, rejected modes, residual risks, and owner of the next review.
- [ ] Treat Gate A as passed only when an auditor can rerun all probes and reach the same decision.
- [ ] Commit with `docs(architecture): record DSH Teams capability decision`.

## Phase 1: Identity, SQLite, and Baseline Operations

### DT-1-01: Establish the core package and deployment configuration contract

**Depends on:** Gate A  
**Source:** Design sections 4, 6, 7.1, 11, 17  
**Files:** Create `packages/dsh-teams-core/src/config.mjs`, `packages/dsh-teams-core/src/errors.mjs`, `packages/dsh-teams-core/test/config.test.mjs`, `docs/operations/configuration.md`.  
**Outcome:** Canonical URL, DSH mode, SQLite location, deployment secret references, SMTP options, and feature flags are validated before startup.  
**Completion check:** Invalid canonical URL, raw non-loopback bind, missing secret reference, and insecure production Cookie configuration fail startup.  
**Failure disposition:** Process stays unready and exposes only operator diagnostics.

### DT-1-02: Implement secure SQLite schema, migration, and backup foundations

**Depends on:** DT-1-01  
**Source:** Design sections 5, 11, 14, 15.8  
**Files:** Create `packages/dsh-teams-core/src/db/database.mjs`, `packages/dsh-teams-core/src/db/migrations/001-initial.mjs`, `packages/dsh-teams-core/src/db/permissions.mjs`, `packages/dsh-teams-core/test/db.test.mjs`, `docs/operations/backup-and-restore.md`.  
**Outcome:** `$DSH_HOME/teams/teams.sqlite3` is a permissions-checked, WAL-enabled, transactionally migrated authority with recoverable encrypted backups.  
**Completion check:** Migration idempotency, foreign keys, busy handling, mode/owner/realpath rejection, backup restore, and schema integrity tests pass.  
**Failure disposition:** Startup fails closed; no bootstrap or user session starts.

### DT-1-03: Implement independent identity, password, session, and bootstrap flows

**Depends on:** DT-1-02  
**Source:** Design sections 5.1, 6, 7.1, 7.2, 9  
**Files:** Create `packages/dsh-teams-core/src/identity/service.mjs`, `packages/dsh-teams-core/src/identity/passwords.mjs`, `packages/dsh-teams-core/src/identity/sessions.mjs`, `packages/dsh-teams-core/test/identity.test.mjs`.  
**Outcome:** Founder bootstrap, admin-created temporary users, forced password change, opaque session rotation, reset, disable/enable, and system role changes work without any `dsh-auth-gate` dependency.  
**Completion check:** Tests verify founder protection, token digest-only storage, restricted session rules, auth_version revocation, dummy KDF behavior, 401/403 semantics, and persistent rate limits.  
**Failure disposition:** No normal session is issued when identity state is incomplete or inconsistent.

### DT-1-04: Add audit and SMTP outbox semantics

**Depends on:** DT-1-03  
**Source:** Design sections 5.4, 6.2, 6.4, 13, 17  
**Files:** Create `packages/dsh-teams-core/src/audit/service.mjs`, `packages/dsh-teams-core/src/mail/outbox.mjs`, `packages/dsh-teams-core/src/mail/smtp.mjs`, `packages/dsh-teams-core/test/audit-mail.test.mjs`.  
**Outcome:** Security mutations write audit and idempotent outbox records in one transaction; SMTP delivery retries without storing passwords in logs or mail.  
**Completion check:** Transaction rollback, duplicate delivery, dead-letter, redaction, canonical URL, and retry tests pass.  
**Failure disposition:** Business mutation remains committed only with a pending outbox record; synchronous SMTP errors never erase audit history.

## Phase 2: Authorization and Entry-Point Enforcement

### DT-2-01: Model policy resources, memberships, holders, and authorization epochs

**Depends on:** DT-1-02  
**Source:** Design sections 5.2, 5.3, 8, 9, 11  
**Files:** Create `packages/dsh-teams-core/src/policy/types.mjs`, `packages/dsh-teams-core/src/policy/service.mjs`, `packages/dsh-teams-core/src/policy/epochs.mjs`, `packages/dsh-teams-core/test/policy.test.mjs`.  
**Outcome:** The core computes visibility/action decisions and durable principal/workspace/session epoch snapshots for every classified action.  
**Completion check:** Cartesian role/relationship/action tests prove deny-by-default, 404 vs 403, guest restrictions, founder takeover, and epoch increments.  
**Failure disposition:** Unclassified action or unmapped resource returns blocked/404 and never reaches DSH.

### DT-2-02: Implement the selected in-process adapter or sidecar boundary

**Depends on:** DT-2-01, Gate A  
**Source:** Design sections 4, 9, 10, 15.2, 15.3  
**Files:** Create either `packages/dsh-teams-plugin/src/index.mjs` and `packages/dsh-teams-plugin/src/http-adapter.mjs`, or `apps/dsh-teams-gateway/src/server.mjs` and `apps/dsh-teams-gateway/src/http-proxy.mjs`; create corresponding tests.  
**Outcome:** Every allowed HTTP/RPC/download/attachment/search/export action runs through `PolicyService` before DSH is called and before bytes are emitted.  
**Completion check:** Direct RPC and binary tests prove 401, 404, 403, child closure checking, and no response bytes after epoch invalidation.  
**Failure disposition:** Coverage regression makes readiness fail and blocks multi-user mode.

### DT-2-03: Implement stream filtering and linearized revocation

**Depends on:** DT-2-02  
**Source:** Design sections 9, 10, 15.3, 15.4  
**Files:** Create `packages/dsh-teams-plugin/src/stream-adapter.mjs` or `apps/dsh-teams-gateway/src/stream-proxy.mjs`, `packages/dsh-teams-core/src/policy/suspension.mjs`, and stream race tests.  
**Outcome:** Baseline and incremental streams are filtered server-side; suspension barriers and epoch rereads prevent old-authority frames after commit.  
**Completion check:** Deterministic race tests show disable, password reset, role change, member removal, and Holder transfer stop frames and writes at the authorization commit boundary.  
**Failure disposition:** Disconnect the affected connection and mark the mode unready.

### DT-2-04: Enforce compatibility guard, deployment protection, and worker fallback

**Depends on:** DT-2-02, DT-2-03  
**Source:** Design sections 4.2, 4.3, 10, 15.7, 17  
**Files:** Create `packages/dsh-teams-plugin/src/compatibility-guard.mjs`, `apps/dsh-teams-gateway/src/readiness.mjs`, `apps/dsh-teams-gateway/src/worker-router.mjs` when selected, and deployment tests.  
**Outcome:** DSH upgrades, raw-port exposure, missing route classifications, invalid TLS/origin/Cookie settings, and insufficient execution isolation fail readiness.  
**Completion check:** Snapshot drift, loopback violation, gateway restart, and cross-worker routing tests pass.  
**Failure disposition:** Keep affected endpoint blocked or worker-routed; never silently downgrade to browser-side filtering.

## Phase 3: Workspaces, Migration, UI, and Baseline Enablement

### DT-3-01: Implement managed roots, memberships, Holder lifecycle, and quarantine

**Depends on:** DT-1-04, DT-2-04  
**Source:** Design sections 5.2, 5.3, 8, 12, 15.1, 15.4  
**Files:** Create `packages/dsh-teams-core/src/workspaces/roots.mjs`, `memberships.mjs`, `holders.mjs`, `quarantine.mjs`, and focused tests.  
**Outcome:** Workspace creation/adoption validates realpaths/grants; owner/member/guest and Holder rules remain correct under concurrent changes; unmapped resources remain hidden.  
**Completion check:** Root overlap, symlink escape, grant revoke, sole-owner disable, guest cannot hold, deterministic transfer, and quarantine tests pass.

### DT-3-02: Implement operation journal, sagas, reconciliation, and dissolution restore

**Depends on:** DT-3-01  
**Source:** Design sections 12, 14, 15.5  
**Files:** Create `packages/dsh-teams-core/src/saga/journal.mjs`, `reconcile.mjs`, `workspace-dissolution.mjs`, and crash recovery tests.  
**Outcome:** Cross SQLite/DSH resource operations are idempotent and hidden until finalized; migration and dissolution keep unsafe resources quarantined.  
**Completion check:** Crash injection at every saga boundary, two stable migration watermarks, dissolved-resource isolation, and explicit restore tests pass.

### DT-3-03: Implement founder migration and operational runbooks

**Depends on:** DT-3-02  
**Source:** Design sections 11, 14, 17, 19  
**Files:** Create `packages/dsh-teams-core/src/migration/founder-migration.mjs`, `docs/operations/migration.md`, `docs/operations/incident-response.md`, and migration acceptance tests.  
**Outcome:** Existing workspaces/sessions move to founder under maintenance mode without external-account import or visibility leak.  
**Completion check:** Maintenance blocks writes/connections, migration is reentrant, stable watermark holds, unknown resources stay quarantined, and rollback keeps multi-user mode closed.

### DT-3-04: Build authenticated client UI only after server policy exists

**Depends on:** DT-3-01, DT-3-03  
**Source:** Design sections 4.1, 6, 7, 8, 17  
**Files:** Create `packages/dsh-teams-ui/src/login.mjs`, `bootstrap.mjs`, `admin.mjs`, `workspace-members.mjs`, `security.mjs`, plus Client Slot tests.  
**Outcome:** Bootstrap, login, forced password change, account management, roots, membership, Holder, and diagnostics surfaces call authorized server APIs and reflect restricted state.  
**Completion check:** UI integration tests demonstrate hidden controls are not relied upon for authorization and restricted sessions cannot navigate into protected data.

### DT-3-05: Run baseline multi-user security and release gate

**Depends on:** DT-3-04  
**Source:** Design sections 15, 16 Phase 3, 19  
**Files:** Create `tests/e2e/baseline-multi-user.test.mjs`, `docs/operations/baseline-gate.md`, `docs/compatibility/baseline-gate-report.md`.  
**Outcome:** Gate B has reproducible evidence across policy, API, leaks, streams, execution isolation, migration, storage, backup, and deployment checks.  
**Completion check:** A clean environment passes all gate checks; one intentionally failed probe prevents second-user enablement.  
**Failure disposition:** Keep `site_state.multi_user_enabled=false` and record the failed task ID.

## Phase 4: Optional Security Factors

### DT-4-01: Implement TOTP, recovery codes, and factor policy

**Depends on:** DT-1-03, DT-3-05  
**Source:** Design section 7.3, 15.6, 19  
**Files:** Create `packages/dsh-teams-core/src/factors/totp.mjs`, `recovery-codes.mjs`, `factor-policy.mjs`, and tests.  
**Outcome:** Password-plus-one available factor policy supports encrypted TOTP, single-use recovery, replay prevention, recent-auth, and safe global disable semantics.  
**Completion check:** Factor lifecycle, time-window, replay, recovery-restricted session, reset, last-factor removal, and global-toggle tests pass.

### DT-4-02: Implement passkey ceremony, factor UI, and Gate C evidence

**Depends on:** DT-4-01  
**Source:** Design section 7.4, 15.6, 19  
**Files:** Create `packages/dsh-teams-core/src/factors/passkeys.mjs`, `packages/dsh-teams-ui/src/passkeys.mjs`, `tests/e2e/factor-gate.test.mjs`, `docs/operations/factor-gate.md`.  
**Outcome:** WebAuthn is a password second factor with canonical origin/RP ID, single-use ceremonies, credential counter handling, and explicit enablement gate.  
**Completion check:** Registration/assertion, origin/RP mismatch, counter/backup flag, replace/remove, disabled-factor fallback, and production configuration checks pass.  
**Failure disposition:** Keep the relevant factor flag false; baseline password multi-user operation is unaffected.

## Cross-Cutting Tasks

### DT-X-01: Maintain contract and security regression suites

**Depends on:** DT-0-02 through DT-4-02 as applicable  
**Outcome:** Any DSH profile drift, new API/stream, policy bypass, data leak, epoch race, or execution escape fails CI/readiness before user exposure.  
**Completion check:** Every task adds a focused test and each gate's report links to exact command output.

### DT-X-02: Maintain operational readiness and disaster recovery evidence

**Depends on:** DT-1-02 through DT-3-05  
**Outcome:** Operators can deploy, rotate keys, recover backups, inspect blocked sagas, audit security events, and prove raw DSH is loopback-only.  
**Completion check:** Quarterly recovery drill and release checklist are recorded without secrets.

### DT-X-03: Create execution Issues only when task prerequisites are satisfied

**Depends on:** This tasking plan  
**Outcome:** GitHub execution Issues reference one or more ready `DT-*` IDs, include their exact completion checks, and do not create parallel work that assumes an unproven architecture.  
**Completion check:** Each new execution Issue links back to this document and its dependency status.

## Plan Maintenance Rules

- Update a task's `complete` state only after its completion check is recorded in the same pull request or linked execution Issue.
- Change the chosen architecture only by updating `docs/compatibility/architecture-decision.md` with fresh Phase 0 evidence.
- If DSH changes, rerun DT-0-02 through DT-0-04 before continuing work that depends on the changed surface.
- Do not close Gate B or Gate C by management exception; a failed check leaves the corresponding feature disabled.
