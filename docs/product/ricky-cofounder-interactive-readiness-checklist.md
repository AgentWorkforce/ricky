# Ricky cofounder interactive readiness checklist

Use this during live cofounder testing of the interactive Ricky CLI. This is tuned to the interactive/local onboarding surface. Keep it to one terminal session and treat every miss as product truth.

## 1. First-run onboarding clarity

Run: `npm start`

- [ ] Banner and welcome copy render cleanly.
- [ ] Welcome says Ricky generates and runs workflow artifacts for the repo.
- [ ] Copy clearly says local generation happens first and execution is a separate opt-in step.
- [ ] Mode selector shows exactly: Local / BYOH, Cloud, Both, Just explore.
- [ ] Selector wording is generation-first, not vague "run everything" language.

## 2. Local mode selection clarity

Choose `1` (Local / BYOH).

- [ ] Output clearly separates **Generate** from **Execute**.
- [ ] It says generate-only returns an artifact path, logs, and warnings.
- [ ] It says `--run` or `ricky run <artifact>` is required for execution.
- [ ] Next steps include inline spec, file spec, stdin, run-existing-artifact, and help.
- [ ] Recovery mentions classified blockers and shell-ready recovery steps.

## 3. Spec handoff works immediately

Run:

```bash
npm start -- --mode local --spec "generate a workflow for package checks"
```

- [ ] Exit code is 0.
- [ ] Output starts with "Local handoff completed."
- [ ] Output says "Generation: ok. Execution: not requested..."
- [ ] Output does not show execution evidence for a generation-only handoff.
- [ ] generation-only must not look like an execution result.

## 4. Generated artifact appears where promised

- [ ] A file exists at the printed `workflows/generated/<name>.ts` path in the caller repo.
- [ ] Printed artifact path matches the file on disk.
- [ ] Output includes `workflow_id` and `spec_digest`.

## 5. Next command points to a real file

- [ ] Ricky prints a real `npx --no-install agent-relay run ...` command for the generated artifact.
- [ ] The printed `ricky run --artifact <path>` / run-artifact guidance points at the same file.
- [ ] Pasting the printed run command either executes or returns a classified blocker, not an untyped crash.

## 6. Execution-vs-generation distinction is understandable

- [ ] `npm start -- help` puts the two-stage generate-vs-execute explanation near the top.
- [ ] Help makes clear that `--spec` alone does not execute.
- [ ] Local mode copy and handoff output use the same generation-first story.
- [ ] Cloud copy says Cloud generation, and notes that this CLI slice does not stream Cloud execution evidence.

## 7. Recovery guidance is truthful when something fails

Try one deliberate failure, for example:

- `npm start -- --mode local --spec "   "`
- `npm start -- --mode local --spec-file ./nope.md`
- `npm start -- --mode local`

Then confirm:

- [ ] Exit code is non-zero.
- [ ] The failure is named clearly.
- [ ] Recovery points to real supported inputs: `--spec`, `--spec-file`, or `--stdin`.
- [ ] Recovery steps are actionable shell commands, not vague prose.

## Ready for a cofounder demo

This surface is ready when sections 1 through 7 pass in one live run without confusing copy, fake execution claims, or unusable recovery guidance.
