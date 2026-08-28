# DSH Teams Probe TypeScript Migration Design

## Status

Approved for implementation on Issue #5 / PR #6.

## Goal

Replace the DT-0-01 probe package's JavaScript ESM implementation and tests with native TypeScript source while preserving every manifest-validation behavior and avoiding generated build output.

## Decision

Use Node's native TypeScript type stripping to execute `.ts` source and `.test.ts` tests directly. Use the TypeScript compiler only for static validation with `tsc --noEmit`. Do not add `tsx`, a test framework, a runtime transpiler, or a `dist/` build directory.

The project runtime is Node 26.7.0, which supports native execution of erasable TypeScript syntax.

## File Layout

Replace these files; no `.mjs` compatibility copies remain:

- `packages/dsh-teams-probe/src/manifest.ts`
- `packages/dsh-teams-probe/src/report.ts`
- `packages/dsh-teams-probe/test/manifest.test.ts`
- `packages/dsh-teams-probe/tsconfig.json`

Update root `package.json`, `package-lock.json`, and `packages/dsh-teams-probe/package.json` as required for TypeScript tooling and test execution.

## Type System

The probe package uses a local TypeScript configuration with strict checking, no emitted JavaScript, NodeNext module semantics, and TypeScript-extension imports permitted for source that Node executes directly. The root development dependencies provide `typescript`.

The manifest module exposes typed classifications, entry shapes, manifest shapes, and parser results. The report module derives its classification groups from the typed parsed manifest. Runtime validation remains fail-closed because TypeScript types do not validate external inputs.

## Scripts

- Probe `test` runs `node --test test/*.test.ts`.
- Root `lint:plan` runs `tsc --noEmit -p packages/dsh-teams-probe/tsconfig.json`.
- Root `check` runs the type check followed by the probe tests.
- The existing root `prepare` Lefthook command remains unchanged.

## Preserved Behavior

The migration preserves the current DT-0-01 public behavior:

- Accept exactly `public-authenticated`, `workspace-visible-read`, `holder-write`, `owner-write`, `system-admin`, and `blocked` classifications.
- Reject duplicate identifiers, omitted or unknown classifications, and non-blocked entries without a non-empty non-whitespace resource scope.
- Identify the route or stream name in an unclassified-entry error.
- Return a compatibility report grouped by classification.

## Verification

Migration is complete when all source and test files are TypeScript, no probe `.mjs` files remain, and these commands pass:

```sh
npm test --workspace @dsh-teams/probe
npm test
npm run test:probe
npm run lint:plan
npm run check
```

## Scope and Risks

The change is constrained to the probe workspace and root npm tooling. It does not create a DSH plugin, change DSH source, add DSH execution behavior, or alter DT-0-01 authorization semantics. The only runtime dependency is the already-required Node version; TypeScript is development-only and is used solely for type checking.
