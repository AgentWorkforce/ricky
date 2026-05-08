# Generation Quality Rubric

Use this suite for workflow generation, skill matching, tool/model selection,
pattern choice, optional LLM refinement, and proof quality.

## Human Review Questions

1. Is the workflow Relay-native and specific to the user intent?
2. Are skill and tool decisions grounded in explicit evidence?
3. Are validation gates behavior-grounded and repo-aware?
4. Does optional refinement preserve the workflow graph and bounded scope?
5. Does the response avoid overstating what generation-time skills prove?

## Suggested Pass Bar

Pass only when the generated workflow is reviewable, auditable, and has proof
steps tied to the requested behavior.
