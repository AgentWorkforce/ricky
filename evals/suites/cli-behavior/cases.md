# CLI Behavior Cases

These cases protect small, deterministic CLI promises. They should stay cheap
enough to run in the default offline eval suite.

## cli.help-surfaces-local-cloud-and-run
Executor: ricky-cli
Kind: regression
Tags: cli, onboarding, local, cloud
Human Review: false

### Message
--help

### Mock
argv: --help

### Deterministic Checks
ok: true
contentIncludes:
- ricky local --spec
- ricky run <artifact>
- ricky status
forbidPhrases:
- TypeError
- ReferenceError
- stack trace
maxToolCalls: 1

### Must
- Show the user the local, Cloud, run, status, and connect surfaces without requiring interactive setup.
- Keep the help output truthful to the implemented CLI commands.

### Must Not
- Print a stack trace or raw implementation failure for help.
- Hide the local/BYOH run path behind Cloud-only language.

## cli.version-prints-package-version
Executor: ricky-cli
Kind: regression
Tags: cli, packaging
Human Review: false

### Message
version

### Mock
argv: version

### Deterministic Checks
ok: true
contentMatches:
- ^ricky 0\.1\.\d+
forbidPhrases:
- TypeError
- ReferenceError
maxToolCalls: 1

### Must
- Print the package version as a short script-friendly value.

### Must Not
- Start the interactive onboarding flow for `version`.

## cli.generation-default-not-execution
Executor: manual
Kind: regression
Tags: cli, onboarding, local
Human Review: true

### Message
A user runs `ricky --mode local --spec "generate a workflow for package checks"` without `--run`.

### Deterministic Checks
maxToolCalls: 0

### Must
- Say generation is the default and execution was not requested.
- Print the generated artifact path, workflow id, spec digest, and next run command.
- Avoid showing execution evidence for a generation-only request.

### Must Not
- Imply the workflow ran automatically.
- Present a generation-only result as execution success.
- Hide the opt-in commands for running the artifact.

## cli.first-run-copy-is-compact-and-truthful
Executor: manual
Kind: capability
Tags: cli, onboarding
Human Review: true

### Message
Render Ricky's first-run CLI onboarding for a new user.

### Deterministic Checks
maxToolCalls: 0

### Must
- Show compact Ricky branding and clear Local / BYOH, Cloud, Both, and Just explore choices.
- End every branch with a concrete next step.
- Advertise only commands that are currently implemented.

### Must Not
- Sound like a launch page or documentation dump.
- Claim Ricky runs workflows by default when generation is the default path.
- Require web or Slack onboarding before CLI use.

## cli.recovery-guidance-no-stack-traces
Executor: manual
Kind: regression
Tags: cli, recovery
Human Review: true

### Message
A user gives Ricky an empty spec or a missing spec file.

### Deterministic Checks
maxToolCalls: 0

### Must
- Return a user-facing failure or guidance message with a real recovery command.
- Distinguish generation failure from execution failure.
- Show stack traces only when verbose diagnostic mode is requested.

### Must Not
- Crash with an uncaught exception in normal mode.
- Suggest commands that do not exist.
- Pretend a missing spec was accepted.

## cli.status-does-not-invent-provider-state
Executor: manual
Kind: regression
Tags: cli, status, cloud
Human Review: true

### Message
Render `ricky status` when no provider checks have proven Google or GitHub are connected.

### Deterministic Checks
maxToolCalls: 0

### Must
- Report unknown or not-connected provider state honestly.
- Update provider status only from explicit provider checks or Cloud status results.
- Give concrete setup guidance for Cloud when relevant.

### Must Not
- Mark Google or GitHub connected because guidance text was shown.
- Invent a provider connection URL or OAuth flow.
- Show empty fields with no recovery guidance when config is missing.
