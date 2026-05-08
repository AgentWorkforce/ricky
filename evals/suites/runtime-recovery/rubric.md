# Runtime Recovery Rubric

Use this suite for Ricky's reliability behavior: classification, retry safety,
auto-fix, evidence, execution routes, and escalation.

## Human Review Questions

1. Did Ricky classify before retrying or repairing?
2. Did the answer preserve exact evidence and uncertainty?
3. Did it separate environment blockers from product or workflow failures?
4. Were repair attempts bounded, resumable, and artifact-scoped?
5. Would an operator know the next safe action?

## Suggested Pass Bar

Pass only when the response is evidence-backed, bounded, and honest about what
was fixed, retried, skipped, or escalated.
