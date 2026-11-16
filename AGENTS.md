# Working in ricky

```sh
npm ci
npm run typecheck
npm run test
npm run build
```

- Use grammar-aware parsers for source/Markdown inspection, not raw substring/regex or LLM detection. Regex insertion is limited to proven unambiguous markers.
- Before workflow work read docs/workflows/WORKFLOW_STANDARDS.md and workflows/shared/WORKFLOW_AUTHORING_RULES.md; generation also reads workflows/meta/spec/generated-workflow-template.md and its task spec.
- Keep deterministic gates and task-appropriate review/fix evidence. Choose reviewers for the task without a mandatory model pair or count; explicit workflow deliverables remain scoped to their task. Commit/push/PR boundaries must be owned by the workflow contract.
- Use the @agent-relay/github-primitive PR step when PR creation is in scope, not gh pr create. Runtime reads and scoped tracked/untracked diff gates remain required.
- Convention-only work stays in declared convention targets; CLAUDE.md remains a symlink. Keep runtime-wrapper, wave and artifact recipes in task-loaded standards; retire generic fixed-model reviewer mandates rather than moving them.

## Agency and guidance

- Act autonomously on routine assigned work; ask forgiveness rather than permission. Preserve explicit production, release and credential gates.
- For guidance, ask the engineering leads, the agent that spawned you, or the layered owner on Agent Relay.
- Only a truly pressing or blocking question goes to `khaliq-gant` or `will-washburn` (CODEOWNERS) on Agent Relay.

## Cross-repo context

- Before and during changes, understand how this repo fits the wider system; consult its repo map and related-repo docs where available.
- Check relevant agents’ summaries on Agent Relay and proactively contact owning agents about dependencies, adjacent changes and work in flight.

## Pull requests (when used)

- Open PRs as ready for review by default. If merging requires Khaliq’s OK, use `merge-train:hold` instead of draft status.
- If you open a PR, immediately subscribe to its feedback through Agent Relay using [this skill](https://github.com/AgentWorkforce/skills/blob/main/skills/subscribing-relay-webhooks-and-writebacks/SKILL.md), and verify subscription readiness.
- Evaluate each review finding. Address applicable feedback and explain declined changes in the thread.
- A PR is not ready while feedback remains unaddressed or merge conflicts remain.
- When ready, alert the CODEOWNERS and the agent that spawned you on Agent Relay.
- Keep related open PRs from going stale: find their authoring agent on Agent Relay and coordinate; if that agent is no longer on the relay, escalate to the CODEOWNERS or the layered owner.
