# Ricky Package Split Migration Spec

## 1. Purpose

Define the bounded migration from Ricky's current single-package `src/*` layout to a real workspace-based `packages/*` product repo.

This spec exists because Ricky is now close enough to product use that package boundaries matter for:
- clear ownership
- realistic product assembly
- dependency hygiene
- CLI, local, Cloud, and product-core separation
- future publishing or internal package reuse
- truthful workspace tooling instead of an artificial single-package simplification

## 2. Why this migration is happening now

Ricky was previously kept as a single package to avoid pretending package boundaries existed before real product surfaces were implemented.

That constraint no longer fits the current state.

Ricky now contains real implementation across:
- runtime coordination
- runtime evidence and failure classification
- product spec intake and workflow generation
- product specialists
- CLI and onboarding
- local/BYOH execution
- Cloud auth and API
- analytics
- command-layer entrypoints

The repo now needs package boundaries that reflect the real product shape.

## 3. Tooling decision

Ricky should move to a workspace layout and restore a real workspace lockfile/tooling path.

### 3.1 Required outcomes
- restore workspace-oriented package-manager setup
- restore lockfile support for the chosen workspace manager
- make the repo truthful about being multi-package
- preserve a simple top-level bootstrap path

### 3.2 Minimum required files after migration
- root `package.json`
- workspace config file for the chosen manager
- workspace lockfile
- `packages/*/package.json` files
- updated root README bootstrap instructions
- updated test/typecheck scripts that run across the workspace

### 3.3 Manager policy
This migration must not silently erase workspace-oriented tooling again.
If pnpm/prpm compatibility is needed, the workflow should explicitly restore it and document the exact intended operator path.

## 4. Target package layout

The first split should be product-realistic, not over-fragmented.

```text
packages/
  shared/
  runtime/
  product/
  cloud/
  local/
  cli/
```

### 4.1 Package responsibilities

#### `packages/shared`
Owns shared models and constants used across Ricky.

Contents should absorb:
- `src/shared/constants.ts`
- `src/shared/models/*`

Exports:
- workflow config types
- workflow evidence types
- shared constants

#### `packages/runtime`
Owns execution substrate and runtime diagnostics.

Contents should absorb:
- `src/runtime/local-coordinator.ts`
- `src/runtime/types.ts`
- `src/runtime/evidence/*`
- `src/runtime/failure/*`
- `src/runtime/diagnostics/*`

Exports:
- local coordinator
- runtime evidence capture
- failure classification
- diagnosis engine
- runtime-owned types

Dependencies:
- `@ricky/shared`

#### `packages/product`
Owns Ricky's workflow-native domain logic.

Contents should absorb:
- `src/product/spec-intake/*`
- `src/product/generation/*`
- `src/product/specialists/*`
- `src/analytics/*`

Exports:
- spec intake
- generation pipeline
- debugger specialist
- validator specialist
- analytics

Dependencies:
- `@ricky/shared`
- `@ricky/runtime`

#### `packages/cloud`
Owns Cloud-facing auth and API surfaces.

Contents should absorb:
- `src/cloud/auth/*`
- `src/cloud/api/*`

Exports:
- auth validation and workspace scoping
- provider connect guidance/types
- generate API entry surface

Dependencies:
- `@ricky/shared`
- `@ricky/product`
- `@ricky/runtime` only if actually needed

#### `packages/local`
Owns local/BYOH composition surfaces.

Contents should absorb:
- `src/local/*`

Exports:
- local entrypoint
- request normalization
- proof helpers that remain package-local

Dependencies:
- `@ricky/shared`
- `@ricky/product`
- `@ricky/runtime`

#### `packages/cli`
Owns user-facing command, onboarding, and composed CLI entry surfaces.

Contents should absorb:
- `src/cli/*`
- `src/commands/*`
- `src/entrypoint/*`

Exports / entrypoints:
- interactive CLI
- command surface
- onboarding flow

Dependencies:
- `@ricky/local`
- `@ricky/cloud`
- `@ricky/product`
- `@ricky/runtime` where required

## 5. Explicit non-goals

This migration should NOT:
- introduce publishing complexity for external npm release unless explicitly needed
- split into too many tiny packages
- rewrite product behavior unrelated to packaging
- change proven runtime/product logic except where imports/entrypoints require it
- mix in Wave 6 surface work
- silently drop test coverage

## 6. Naming and package identity

Recommended internal package names:
- `@ricky/shared`
- `@ricky/runtime`
- `@ricky/product`
- `@ricky/cloud`
- `@ricky/local`
- `@ricky/cli`

Root package remains private and acts as workspace orchestrator.

## 7. Migration rules

### 7.1 Preserve working behavior
The migration is only successful if current user-visible behavior still works after the split.

### 7.2 Prefer move-and-rewire, not rewrite
Use the existing implementations as source of truth.
Do not opportunistically redesign business logic while moving files.

### 7.3 Keep import boundaries truthful
- shared owns cross-cutting types/constants
- runtime does not depend on CLI
- product does not depend on CLI
- cloud/local/cli compose lower layers rather than inverting ownership

### 7.4 Tests move with owned code
Existing tests should move into the package that owns the code under test unless there is a strong reason to keep root-level integration tests.

### 7.5 Root-level smoke coverage is allowed
A small root-level smoke or workspace integration test layer is acceptable if it proves composed behavior across packages.

## 8. Required root workspace shape after migration

Root should provide:
- workspace install/bootstrap
- workspace-wide typecheck
- workspace-wide test
- CLI start command

Minimum root scripts should include something equivalent to:
- `install`
- `typecheck`
- `test`
- `start`
- `batch`
- `overnight`

`batch` and `overnight` may remain root-owned because workflows are repo-program assets.

## 9. Required validation and proof gates

The implementation workflow for this migration must prove:
1. every target package has a `package.json`
2. workspace install succeeds truthfully
3. workspace typecheck succeeds
4. workspace tests succeed
5. CLI start path still resolves correctly
6. no imports still point at the old `src/*` layout in ways that break package boundaries
7. README/bootstrap docs match the actual package-manager/workspace setup
8. lockfile and workspace config are restored intentionally

## 10. Required review questions

Reviewers must explicitly answer:
1. Are package boundaries coherent and dependency directions sane?
2. Was workspace tooling restored truthfully?
3. Did the migration preserve current product behavior?
4. Are root scripts still convenient for next-week product usage?
5. Did the workflow avoid mixing unrelated feature work into the package split?

## 11. Recommended implementation sequence

1. Read current root package/tooling/docs
2. Plan target package boundaries and workspace files
3. Add workspace configuration
4. Create package manifests
5. Move shared package first
6. Move runtime package
7. Move product package
8. Move cloud/local/cli composition packages
9. Repair imports/tsconfig/test config
10. Restore workspace lockfile/tooling
11. Run install, typecheck, tests
12. Final review and signoff

## 12. Expected deliverables

At minimum, the migration workflow should produce:
- workspace config file(s)
- restored workspace lockfile
- `packages/shared/*`
- `packages/runtime/*`
- `packages/product/*`
- `packages/cloud/*`
- `packages/local/*`
- `packages/cli/*`
- updated root `package.json`
- updated root `README.md`
- updated TS/test configuration if needed
- proof artifacts showing workspace validation passed

## 13. Commit boundary

This should be landed as a deliberate repo-structure change, not buried inside unrelated work.

Suggested commit scope:
- `refactor(workspace): split Ricky into packages`

## 14. Decision

Ricky should stop pretending single-package is the target shape.

The next packaging move is to migrate Ricky into a real workspace-based `packages/*` repo with restored workspace lockfile/tooling, while preserving the currently proven product behavior and validation bar.
