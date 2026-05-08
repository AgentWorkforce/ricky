# Agent Assistant Boundary Cases

These cases come from the Agent Assistant audit, adoption boundary, local
execution contract evaluation, adoption proof, and live proof documents.

## agent-assistant-boundary.real-reuse-not-rhetorical
Executor: manual
Kind: regression
Tags: agent-assistant, boundary
Human Review: true

### Message
Update Ricky docs and code to say it uses Agent Assistant more deeply.

### Deterministic Checks
maxToolCalls: 0

### Must
- Ground claims in real package imports and runtime paths.
- Distinguish current implementation from target architecture.
- Identify which Agent Assistant primitive is actually exercised.

### Must Not
- Rename local code to sound Agent Assistant aligned and count that as adoption.
- Claim broad Agent Assistant native behavior from documentation-only alignment.
- Blur target architecture with landed behavior.

## agent-assistant-boundary.turn-context-preserves-ricky-envelope
Executor: manual
Kind: regression
Tags: agent-assistant, turn-context
Human Review: true

### Message
Evaluate the current Ricky `@agent-assistant/turn-context` adoption.

### Deterministic Checks
maxToolCalls: 0

### Must
- Preserve request id, source metadata, structured spec, invocation root, mode, stage mode, spec path, metadata, and spec text.
- Record compact provenance through generation decisions or coordinator metadata.
- Keep the shared turn context internal to the adapter boundary.

### Must Not
- Move LocalResponse, blocker taxonomy, recovery wording, or execution semantics into the shared turn-context package.
- Drop Ricky-specific workflow metadata during envelope assembly.
- Treat turn context as a product decision engine.

## agent-assistant-boundary.product-core-stays-ricky-owned
Executor: manual
Kind: capability
Tags: agent-assistant, product-core
Human Review: true

### Message
Decide whether workflow generation, validation, debugging, staged CLI UX, and blocker/evidence wording should move into Agent Assistant.

### Deterministic Checks
maxToolCalls: 0

### Must
- Keep product-defining workflow generation, validation, debugging, local UX, and evidence wording Ricky-owned until proof says otherwise.
- Reuse shared runtime primitives where they reduce duplication without weakening Ricky.
- Make extraction follow typed, tested, live product proof.

### Must Not
- Generalize workflow-specific behavior prematurely.
- Adopt moving shared seams merely for architectural purity.
- Lose the precise local-first staged workflow UX.

## agent-assistant-boundary.one-slice-at-a-time
Executor: manual
Kind: capability
Tags: agent-assistant, adoption
Human Review: true

### Message
Plan the next Agent Assistant adoption slice for Ricky.

### Deterministic Checks
maxToolCalls: 0

### Must
- Pick exactly one real shared seam to evaluate or adopt.
- Define a live Ricky product path that will prove the adoption.
- Include regression checks that product messaging, blocker output, and evidence remain truthful.

### Must Not
- Bundle sessions, memory, policy, proactive behavior, and execution extraction into one vague migration.
- Skip the comparison/evaluation step for mature Ricky-local seams.
- Treat adoption as successful without a live product-path proof.

## agent-assistant-boundary.future-surfaces-use-shared-runtime
Executor: manual
Kind: capability
Tags: agent-assistant, surfaces
Human Review: true

### Message
Design future Slack or web support for Ricky using Agent Assistant packages.

### Deterministic Checks
maxToolCalls: 0

### Must
- Prefer shared surfaces, webhook-runtime, sessions, and routing primitives for future non-CLI interaction where mature.
- Keep local CLI behavior product-local unless shared adoption is proven harmless.
- Explain which behavior is future/target architecture versus implemented today.

### Must Not
- Preemptively add memory, policy, or proactive packages without a real Ricky product requirement.
- Let future surface abstractions distort the current CLI contract.
- Duplicate a mature Agent Assistant capability locally without justification.
