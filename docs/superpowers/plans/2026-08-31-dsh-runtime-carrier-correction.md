# DSH Runtime Carrier Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the DSH 0.1.1-rc.2 carrier inventory and prevent fixture-only evidence from selecting a data-plane architecture.

**Architecture:** Keep the existing disposable adapter harness for unit-level deny behavior, but add an explicit runtime carrier probe for the real HTTP and WebSocket endpoints. The coverage assessment reports `runtime-inventory-required` until a composed runtime registration inventory is captured; a bypass still selects `sidecar-required`.

**Tech Stack:** Node.js built-in `http` and `net`, `node:test`, TypeScript with NodeNext execution.

**Spec:** `docs/superpowers/specs/2026-08-27-dsh-teams-user-authorization-design.md`

## Global Constraints

- Do not hard-code an operator profile path or send credentials, headers, request bodies, or response bodies to the probe transcript.
- Treat `POST /api/<method>`, `/api/events.mux`, and `/api/events.host` as source- and runtime-proven physical carriers for the standard DSH core.
- Do not claim all plugin routes are intercepted until registration-time inventory capture has completed.
- A bypassed route still selects `sidecar-required`; an incomplete registration inventory selects `runtime-inventory-required`.

---

### Task 1: Model The Correct Core Carrier Contract

**Files:**
- Modify: `tests/fixtures/dsh-profile/current.json`
- Modify: `packages/dsh-teams-probe/test/profile-scan.test.ts`
- Modify: `packages/dsh-teams-probe/src/probe-server.ts`

- [x] Write failing expectations for the API prefix and both event upgrade paths.
- [x] Update the profile fixture and disposable route inventory to expose those carriers.
- [x] Run the focused profile and in-process tests.

### Task 2: Distinguish Carrier Proof From Registration Completeness

**Files:**
- Modify: `packages/dsh-teams-probe/src/in-process-probe.ts`
- Modify: `packages/dsh-teams-probe/test/in-process-probe.test.ts`

- [x] Write failing tests for `runtime-inventory-required` and bypass precedence.
- [x] Implement the additional decision state and default incomplete registration scope.
- [x] Run focused coverage tests.

### Task 3: Probe The Live Runtime Without Credentials

**Files:**
- Create: `packages/dsh-teams-probe/src/runtime-carrier-probe.ts`
- Create: `packages/dsh-teams-probe/src/runtime-carrier-cli.ts`
- Create: `packages/dsh-teams-probe/test/runtime-carrier-probe.test.ts`
- Modify: `packages/dsh-teams-probe/package.json`

- [x] Write failing tests for HTTP and WebSocket carrier probes accepting only denial status codes.
- [x] Implement the probe and environment-driven CLI.
- [x] Run it against `http://127.0.0.1:3080` without credentials.

### Task 4: Replace The Stale Architecture Record

**Files:**
- Modify: `docs/compatibility/dsh-web-current.md`
- Modify: `docs/compatibility/in-process-coverage.md`
- Modify: `docs/superpowers/plans/2026-08-27-dsh-teams-implementation-tasking.md`
- Modify: `docs/superpowers/plans/2026-08-31-dsh-teams-in-process-coverage.md`

- [x] Replace missing-carrier claims with the verified contract and runtime probe command.
- [x] Restore DT0-02 and DT0-03 to in-progress pending registration-time inventory capture.
- [ ] Run `npm run check`, inspect the diff, commit, push, and resolve the P1 only after fresh evidence.
