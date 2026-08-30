# DSH Teams Probe TypeScript Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DT-0-01 probe workspace's JavaScript ESM source and tests with native TypeScript while retaining the complete fail-closed manifest contract.

**Architecture:** Node runs erasable TypeScript syntax directly for probe tests. TypeScript provides strict static validation through `tsc --noEmit`; it produces no build output and requires no runtime transpiler. Source modules use explicit `.ts` imports so Node resolves the same files that the compiler validates.

**Tech Stack:** Node.js 26 native TypeScript type stripping, TypeScript compiler, npm workspaces, `node:test`.

## Global Constraints

- Do not modify DSH source or add a DSH plugin, gateway, identity capability, or UI.
- Do not retain any probe `.mjs` source or test file.
- Do not add `tsx`, a test framework, a runtime transpiler, a `dist/` directory, or emitted JavaScript.
- Keep TypeScript tooling development-only; the only new packages are `typescript` and `@types/node`.
- Preserve the six accepted classifications and all current fail-closed validation behavior.
- Preserve MPL-2.0 file headers and the root Lefthook `prepare` script.
- Use strict type checking and ensure every verification command exits successfully.

---

## Planned File Structure

| Path | Action | Responsibility |
| --- | --- | --- |
| `package.json` | Modify | Add TypeScript and point `lint:plan` at the probe compiler config. |
| `package-lock.json` | Modify | Lock TypeScript, Node type declarations, and workspace metadata. |
| `packages/dsh-teams-probe/package.json` | Modify | Run `.test.ts` files with Node. |
| `packages/dsh-teams-probe/tsconfig.json` | Create | Strict no-emit NodeNext compiler configuration. |
| `packages/dsh-teams-probe/src/manifest.ts` | Create | Typed manifest contract and fail-closed runtime parser. |
| `packages/dsh-teams-probe/src/report.ts` | Create | Typed compatibility report generator. |
| `packages/dsh-teams-probe/test/manifest.test.ts` | Create | Node test matrix using TypeScript imports. |
| `packages/dsh-teams-probe/**/*.mjs` | Delete | Remove all JavaScript ESM probe files. |

### Task 1: Migrate the Probe Workspace to Native TypeScript

**Files:**
- Create: `packages/dsh-teams-probe/tsconfig.json`
- Create: `packages/dsh-teams-probe/src/manifest.ts`
- Create: `packages/dsh-teams-probe/src/report.ts`
- Create: `packages/dsh-teams-probe/test/manifest.test.ts`
- Delete: `packages/dsh-teams-probe/src/manifest.mjs`
- Delete: `packages/dsh-teams-probe/src/report.mjs`
- Delete: `packages/dsh-teams-probe/test/manifest.test.mjs`
- Modify: `package.json`, `package-lock.json`, `packages/dsh-teams-probe/package.json`

**Interfaces:**
- Produces `ActionClassification`, `ManifestEntry`, `SurfaceManifest`, `ParsedManifest`, `parseManifest(input: unknown): ParsedManifest`, and `createCompatibilityReport(input: unknown): CompatibilityReport`.
- Retains the public `ACTION_CLASSIFICATIONS` collection with exactly six values.

- [ ] **Step 1: Convert the test module before production modules**

Rename `manifest.test.mjs` to `manifest.test.ts` and change imports to:

```ts
import { ACTION_CLASSIFICATIONS, parseManifest } from '../src/manifest.ts'
import { createCompatibilityReport } from '../src/report.ts'
```

Add explicit TypeScript types to the test helper:

```ts
function manifestEntry(
  id: string,
  classification: ActionClassification,
  resourceScope = 'workspace',
): ManifestEntry {
  // preserve the current blocked/non-blocked fixture shape
}
```

- [ ] **Step 2: Prove the TypeScript test is red before implementation exists**

Run: `node --test packages/dsh-teams-probe/test/manifest.test.ts`

Expected: failure that identifies the missing `../src/manifest.ts` module.

- [ ] **Step 3: Add TypeScript configuration and the minimal typed implementation**

Create `packages/dsh-teams-probe/tsconfig.json`:

```json
{
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": true,
    "strict": true,
    "target": "ES2024",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Port the current parser and report behavior to `.ts`, adding exported discriminated types for classifications and manifest entries. Keep the runtime `unknown` input checks, duplicate-identifier check, required classification check, known-classification check, and trimmed resource-scope check. Import `./manifest.ts` from `report.ts`.

- [ ] **Step 4: Configure npm tooling**

Run `npm install --save-dev typescript @types/node`. Update probe `test` to `node --test test/*.test.ts`. Update root `lint:plan` to:

```json
"lint:plan": "tsc --noEmit -p packages/dsh-teams-probe/tsconfig.json"
```

Keep root `test`, `test:probe`, `check`, and `prepare` semantics unchanged except that `check` now invokes the TypeScript type check.

- [ ] **Step 5: Delete JavaScript ESM files and verify green**

Remove all three probe `.mjs` files. Run:

```sh
npm test --workspace @dsh-teams/probe
npm test
npm run test:probe
npm run lint:plan
npm run check
find packages/dsh-teams-probe -name '*.mjs' -print
```

Expected: all npm commands pass; the final `find` command prints no paths.

- [ ] **Step 6: Commit and update the existing PR branch**

```sh
git add package.json package-lock.json packages/dsh-teams-probe
git commit -m "refactor(probe): migrate manifest checks to TypeScript" \
  -m "Replace native JavaScript probe modules and tests with typed sources.
Preserve fail-closed manifest validation and direct Node test execution."
git push
```

## Plan Self-Review

- Spec coverage: Task 1 covers deletion of every probe `.mjs` file, strict no-emit configuration, Node native TypeScript execution, type checking, and all preserved runtime behavior.
- Placeholder scan: no unassigned behavior, file path, command, or verification criterion remains.
- Type consistency: exported type names, `parseManifest`, `createCompatibilityReport`, and the classification collection are defined before test use.
