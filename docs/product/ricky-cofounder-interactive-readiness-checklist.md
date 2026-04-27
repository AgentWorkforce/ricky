# Ricky cofounder interactive readiness checklist

A short, test-session-oriented checklist for live cofounder testing of the
interactive Ricky CLI (local/BYOH onboarding through generation, optional
execution, and recovery). Walk it top to bottom in one terminal session and
record any "no" answers as product truth, not impressions.

This is tuned to the **interactive/local onboarding** surface that exists
today. Anything outside this list is out of scope for this readiness pass.

## Pre-flight

- [ ] Working directory is the caller repo you want artifacts to land in
      (Ricky writes to `workflows/generated/` in the **invocation root**, not
      in `packages/cli/`).
- [ ] `npm install` has run cleanly so `node_modules/.bin/agent-relay` exists
      (required for `--run` execution; not required for generation-only).
- [ ] `.ricky/config.json` is removed or untouched if you want to exercise
      the genuine first-run path.
- [ ] Terminal is a real TTY (first-run prompts gate on TTY; non-TTY falls
      through to the non-interactive setup error message).

## 1. First-run onboarding clarity

Run: `npm start`

- [ ] Banner renders (full or compact based on terminal width). Compact
      variant should mention "ricky · workflow reliability for AgentWorkforce".
- [ ] Welcome copy reads: "Welcome to Ricky! Let's get you set up." followed
      by the line that explicitly distinguishes generation from execution
      ("Today, locally, Ricky generates a workflow artifact into your repo.
      Executing it is a separate, opt-in step…").
- [ ] Mode selector lists exactly four options: Local / BYOH, Cloud, Both,
      Just explore. Default `[1]`.
- [ ] No copy claims execution depth that is not implemented (no "proactive
      failure notifications", no auto-validation that hasn't been proven, no
      "ricky generate" CLI subcommand).

## 2. Local mode selection clarity

Choose `1` (Local / BYOH).

- [ ] Output explicitly names two stages: **Generate** (default) and
      **Execute** (opt-in via `--run` or `ricky run <artifact>`).
- [ ] The "Next steps" block lists at least: inline generate, generate + run,
      file, stdin, run-existing-artifact, help, and Cloud guidance.
- [ ] Spec handoff section appears with the labeled flag forms.
- [ ] Recovery section appears and includes the classified blocker codes
      (MISSING_BINARY, MISSING_ENV_VAR, INVALID_ARTIFACT, CREDENTIALS_REJECTED,
      NETWORK_UNREACHABLE, UNSUPPORTED_RUNTIME) — no vague "rerun later" copy.
- [ ] `.ricky/config.json` is written with `mode: "local"`,
      `firstRunComplete: true`.

## 3. Spec handoff works immediately

Run, in the same terminal:

```
npm start -- --mode local --spec "generate a workflow for package checks"
```

- [ ] Process exits 0.
- [ ] Output begins with "Local handoff completed."
- [ ] Output then shows "Generation: ok. Execution: not requested
      (pass --run or use `ricky run <artifact>` to execute)."
- [ ] `stage: generate` and `status: ok` appear.
- [ ] Output does **not** include `--- execution ---`, `outcome_summary:`,
      or any `blocker_code:` line — generation-only must not look like an
      execution result.

Repeat with `--spec-file ./some-spec.md` and `printf "..." | npm start --
--mode local --stdin`. Same shape, same exit code.

## 4. Generated artifact appears where promised

After step 3:

- [ ] An artifact at `workflows/generated/<name>.ts` exists in the **caller
      repo** you launched from (not under `packages/cli/`).
- [ ] The artifact path printed under "Artifact:" matches the file on disk.
- [ ] `workflow_id` and `spec_digest` are printed for the generated artifact.
- [ ] Re-running the same spec produces a deterministic `spec_digest`.

## 5. Next command points to a real file

- [ ] The "Next: Run the generated workflow locally:" line ends with the
      exact path that exists on disk.
- [ ] The command takes the form
      `npx --no-install agent-relay run workflows/generated/<file>.ts`.
- [ ] Copying that line and pasting it into the same shell either
      executes the workflow or surfaces a classified blocker (no silent
      crash, no untyped stack trace).
- [ ] The `Run mode:` line shows `ricky run --artifact <path>` pointing at
      the same file.

## 6. Execution-vs-generation distinction is understandable

- [ ] In help (`npm start -- help`): the "Two distinct stages" block is at
      the top. The reader can tell, without running anything, that
      `--spec` alone does not execute.
- [ ] In local mode result copy: the numbered "1. Generate / 2. Execute"
      block is present and explicit about `--run` opt-in.
- [ ] In CLI output for a successful generate-only handoff: the line
      "Execution: not requested" is present.
- [ ] In CLI output for a successful generate + `--run`: the line
      "Execution: success." is present alongside the `--- execution ---`
      block with `outcome_summary`, `stdout_path`, `stderr_path`.
- [ ] On `--run` failure: output reads "Local handoff failed." plus
      "Stage that failed: execute (status: blocker)" and a populated
      `blocker_code`/`blocker_message`/`Recovery:` step list.

## 7. Recovery guidance is truthful when something fails

Force a failure deliberately. Examples:

- Empty inline spec: `npm start -- --mode local --spec "   "`
- Missing spec file: `npm start -- --mode local --spec-file ./nope.md`
- `--mode local` with no spec at all: `npm start -- --mode local`
- `--run` against a workspace without `agent-relay` linked.

For each:

- [ ] Exit code is non-zero (1 for input/CLI blockers, 2 for execute-stage
      blockers when using `--run`).
- [ ] The output names the failure category (CLI input blocker, generate
      stage error, execute stage blocker, Cloud generation failure).
- [ ] Recovery steps are actionable command lines, not aspirational prose.
      Each step should be runnable as-is from a shell.
- [ ] When the local runtime is missing, the classified blocker shows
      `MISSING_BINARY` and the recovery list starts with `npm install`.
- [ ] When the spec is too vague, generation surfaces `clarify` routing
      with a concrete follow-up the user can rephrase from.
- [ ] No copy says "rerun later" or otherwise punts on a fixable failure.

## 8. Cloud mode messaging is honest

Run: `npm start -- --mode cloud` (no provider connected)

- [ ] Copy lists exactly what Cloud does today: hand generation requests to
      AgentWorkforce Cloud, return generated artifacts and any results the
      Cloud generate endpoint returns.
- [ ] Copy explicitly notes that this CLI slice does not stream Cloud
      execution evidence.
- [ ] Provider connect commands are correct: `npx agent-relay cloud connect
      google` for Google; GitHub via the Cloud dashboard / Nango flow.
- [ ] Cloud + spec handoff combination is rejected with a clear message
      ("Cloud mode does not accept CLI spec handoff in this local slice…").

## 9. Returning user compact path

Re-run `npm start` with `.ricky/config.json` already present from step 2.

- [ ] No banner by default.
- [ ] Compact header reads `ricky · local mode · ready` (or the equivalent
      cloud / both header).
- [ ] Returning welcome line: "Ricky is ready. Continue locally, connect
      Cloud, or hand over the next workflow spec."
- [ ] Suggested next action points at a real local handoff command form,
      not an unimplemented subcommand.

## 10. Live-test signal capture

Before closing the session, capture for the readout:

- [ ] Time from `npm start` to first artifact path printed (target: under
      the cofounder's patience threshold for a single spec).
- [ ] Any copy that the cofounder paused on or asked for clarification on —
      that copy is the next tightening target.
- [ ] Any failure where the printed recovery step did not actually unblock
      them on first try — those are the next concrete-recovery targets.
- [ ] Any place Ricky implied execution had occurred when only generation
      had occurred (or vice versa) — that is a regression of the
      generation-vs-execution distinction.

## What "ready" means for this checklist

All boxes in sections 1–7 pass on a clean clone, and sections 8–10 are
captured as artifacts of the test session. Anything in sections 1–7 that
fails is a P1 against the interactive surface and should block further
cofounder-facing demos until it is fixed and re-tested.
