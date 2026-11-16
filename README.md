# Ricky

Ricky helps teams define, run and recover agent workflows. It watches long-running work and keeps enough evidence to understand failures and resume safely.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/ricky-logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/ricky-logo-light.png">
    <img src="assets/ricky-logo-light.png" alt="Ricky runner logo" width="180">
  </picture>
</p>


## Get started

npm is the only supported package and script surface. There is no Yarn, pnpm, or other package-manager surface.

```sh
npm install
npm run build
npm start -- --help
```

See the [repository guide](docs/repository-guide.md) for the supported setup, current limitations and technical reference.

<details>
<summary>Development command reference</summary>

- `npm run clean` — Remove generated dist files.
- `npm run bundle` — Bundle the CLI with esbuild.
- `npm run build` — Build the CLI and SDK bundle.
- `npm run typecheck` — Check TypeScript across source, workflows and tests.
- `npm test` — Run the Vitest suite and repository proofs.
- `npm run premerge` — Run typecheck, the full suite and the local auto-fix ladder.
- `npm start` — Run the CLI from source.
- `npm run dev` — Start the development CLI.
- `npm run evals` — Compile and run evaluation definitions.
- `npm run evals:compile` — Compile evaluation definitions.
- `npm run evals:provider` — Build and run provider-backed evaluations.
- `npm run evals:opencode` — Run evaluations through OpenCode.
- `npm run evals:list` — List available evaluations.
- `npm run evals:summary` — Summarize the latest evaluation results.
- `npm run evals:compare` — Compare evaluation result sets.
- `npm run batch` — Run workflow batches.
- `npm run overnight` — Run the overnight workflow queue.
- `npm run prepack` — Build before npm packs or publishes the package.

</details>
