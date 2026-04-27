# Ricky cofounder interactive readiness checklist

Use this during live cofounder testing of the interactive Ricky CLI. This is tuned to the interactive/local onboarding surface. Keep it to one terminal session and treat every miss as product truth.

## 1. First-run onboarding clarity

Run: `npm start`

- [ ] Banner and welcome copy render cleanly.
- [ ] Welcome says Ricky **generates** workflow artifacts — not "generates and runs."
- [ ] Copy says running is a separate, opt-in step (--run or `ricky run`).
- [ ] The default flow is described as: spec in → artifact written to disk → next command printed.
- [ ] Mode selector shows exactly: Local / BYOH, Cloud, Both, Just explore.
- [ ] Selector labels say "generate workflow artifacts" — not "run" or "execute."

## 2. Local mode selection clarity

Choose `1` (Local / BYOH).

- [ ] Output has two clearly labeled sections: **Generation (default)** and **Execution (opt-in only)**.
- [ ] Generation section says artifact is written to workflows/generated/ and nothing is executed.
- [ ] Execution section says --run or `ricky run` is required.
- [ ] Next steps list includes: generate only, generate + run, from file, from stdin, run existing, CLI help.
- [ ] No line implies execution happens automatically.

## 3. Spec handoff works immediately

Run:

```bash
npm start -- --mode local --spec "generate a workflow for package checks"
```

- [ ] Exit code is 0.
- [ ] Output says "Generation: ok — artifact written to disk."
- [ ] Output says "Execution: not requested."
- [ ] No execution evidence is shown for a generation-only handoff.
- [ ] generation-only must not look like an execution result.

## 4. Generated artifact appears where promised

- [ ] A file exists at the printed `workflows/generated/<name>.ts` path in the caller repo.
- [ ] Printed artifact path matches the file on disk.
- [ ] Output includes `workflow_id` and `spec_digest`.

## 5. Next command points to a real file

- [ ] Ricky prints "To execute this artifact: npx --no-install agent-relay run ..." with the real path.
- [ ] The printed "Or with linked CLI:" line points at the same file.
- [ ] Pasting the printed run command either executes or returns a classified blocker, not an untyped crash.

## 6. Execution-vs-generation distinction is understandable

- [ ] `npm start -- help` opens with "workflow artifact generation" — not "workflow generation and execution."
- [ ] Help labels two stages: generate (default, nothing executed) and execute (opt-in only).
- [ ] "What you get back" section clearly separates without-run output from with-run output.
- [ ] Cloud section says "generated artifact from AgentWorkforce Cloud" and notes no execution streaming.

## 7. Recovery guidance is truthful when something fails

Try one deliberate failure, for example:

- `npm start -- --mode local --spec "   "`
- `npm start -- --mode local --spec-file ./nope.md`
- `npm start -- --mode local`

Then confirm:

- [ ] Exit code is non-zero (or, for no-spec, guidance is printed with exit 0).
- [ ] The failure is named: "Generation: failed" or "No spec provided."
- [ ] Recovery distinguishes generation failure from execution failure.
- [ ] Recovery steps are real shell commands you can paste, not vague prose.
- [ ] Recovery mentions --spec, --spec-file, or --stdin as the supported inputs.

## Ready for a cofounder demo

This surface is ready when sections 1 through 7 pass in one live run without confusing copy, fake execution claims, or unusable recovery guidance.
