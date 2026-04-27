# Ricky Agent-Assistant Adoption Boundary

## Executive summary

Ricky should not pursue a broad, fuzzy migration toward `agent-assistant`. The right boundary is narrower: keep the workflow-reliability product logic that makes Ricky distinct, adopt shared assistant-runtime primitives only where they are mature enough to reduce duplication without degrading product quality, and extract product-local seams later only after Ricky proves they are generically reusable.

The central boundary decision is:

- Ricky remains the owner of workflow-generation, workflow-validation, workflow-debugging, staged local workflow UX, and workflow-oriented evidence/blocker framing.
- Shared assistant-runtime adoption should begin with seams adjacent to request shaping, execution adapters, and future multi-surface interaction, not with a wholesale rewrite of Ricky's current product core.
- The strongest seam for follow-on evaluation is Ricky's current **handoff normalization + staged execution + blocker/evidence contract**.

## Boundary decision principles

### 1. Product truth beats architectural purity

If a seam is tightly coupled to Ricky's product promise, Ricky should keep owning it until shared adoption is proven not to weaken the user-visible experience.

### 2. Reuse should be real, not rhetorical

A seam only counts as adopted if Ricky uses a real shared package or runtime primitive. Renaming local logic to sound aligned does not count.

### 3. Target architecture is not current implementation

Ricky architecture docs often describe a future or intended composition with `@agent-assistant/*` packages. The boundary must be grounded in the current code/package graph and current proven behavior, not only intended architecture.

### 4. Extraction follows product proof

When Ricky has a mature, typed, well-tested seam that looks reusable, the next step is evaluation and proof, not immediate extraction.

### 5. Shared adoption should reduce product-local burden

The point of adopting a shared runtime primitive is to lower duplication, simplify future surfaces, or improve consistency. If adoption merely adds indirection without reducing product burden, it should wait.

## Seam-by-seam classification table

| Seam | Classification | Why |
|---|---|---|
| CLI / interactive surface | Product-local now | Ricky's onboarding, staged generation/execution messaging, and workflow-product UX are core product behavior. |
| Handoff normalization / turn intake | Extract later after proof, with possible partial shared adoption | This seam is promising for shared reuse, but Ricky currently depends on workflow-specific metadata and local-stage semantics that should be evaluated before extraction. |
| Execution contract and blocker classification | Extract later after proof | The shape is strong and assistant-like, but it is still deeply tied to Ricky's workflow proving-ground contract. |
| Sessions / surfaces | Adopt shared package now for future surfaces, not as a prerequisite to the local CLI | This is a natural shared-runtime area once Ricky expands beyond the local CLI and bounded cloud paths. |
| Memory / policy / proactive behavior | Adopt shared package now only when Ricky actually enables those product behaviors | Ricky should not preemptively add these just to appear agent-assistant-native. |
| Workflow generation / skill loading | Product-local now | This is Ricky's product heart and should remain local while the product shape is still being proven. |

## Product-local now

These areas should remain explicitly Ricky-owned for now.

### CLI / interactive surface

Ricky's current CLI and interactive path are product-defining. They include:

- onboarding and mode selection
- local-first execution path
- staged generate vs execute behavior
- artifact-return UX
- blocker and recovery display

These behaviors are not generic assistant UX. They are Ricky-specific workflow UX. Shared surfaces or sessions may later support richer channels, but the current product contract should remain local.

### Workflow generation / skill loading

Ricky owns:

- spec intake
- pattern selection
- workflow rendering
- skill selection and generation-time application
- validator and proof-loop behavior

These are the strongest differentiators in Ricky's product stack. They should not be prematurely generalized into agent-assistant runtime infrastructure.

### Workflow-oriented evidence and product wording

Ricky's execution evidence, blocker naming, recovery commands, and workflow-oriented output should remain Ricky-local while the product is still establishing its proving-ground contract. Generic assistant runtime packages may later support similar shapes, but Ricky's exact evidence and blocker vocabulary remain part of the product surface today.

## Adopt shared package now

These are the most reasonable near-term areas for real agent-assistant adoption, if the corresponding shared packages are sufficiently mature.

### Sessions / surfaces for future non-CLI interaction

Ricky's docs already position Slack, webhook ingress, and future web/MCP/Claude surfaces as important. Those areas are closer to shared assistant infrastructure than to Ricky-specific workflow logic.

As Ricky expands beyond the local CLI, it should prefer real shared runtime packages for:

- surface abstraction
- webhook/runtime ingress handling
- session/thread lifecycle support
- cross-surface routing glue

This adoption should support future Ricky interaction modes, not distort the current local CLI contract.

### Memory / policy / proactive behavior when product-enabled

Ricky currently does not prove deep memory, policy, or proactive behavior in the product path. If and when those capabilities become real Ricky product requirements, the default should be to reuse shared assistant-runtime primitives rather than inventing Ricky-specific versions.

The key condition is timing: adopt them when Ricky truly needs them, not before.

## Extract later after proof

These seams are promising, but should not yet be treated as immediately shareable.

### Handoff normalization / turn intake

Ricky's `normalizeRequest()` layer already does important work:

- multi-source intake
- invocation-root propagation
- artifact-path handling
- staged local execution hints
- local/cloud routing shape

This is near the assistant-runtime boundary, but it also carries Ricky-specific workflow semantics. The right next step is not immediate extraction. The right next step is an explicit comparison against existing or planned `agent-assistant` request/turn-context seams.

### Execution contract and blocker classification

Ricky now has a strong local contract around:

- generation stage
- execution stage
- classified blockers
- actionable recovery steps
- execution evidence
- exit-code semantics

This is one of the most mature seams in the product and a strong candidate for future shared influence. But it remains tied to Ricky's workflow proving-ground behavior. Extraction should follow explicit evaluation, not precede it.

### Diagnostic engine pattern

Ricky's runtime diagnostics behave like a reusable primitive, and the architecture docs already frame them that way. But the product currently proves that value inside Ricky first. Shared runtime adoption should begin only after deciding whether the current typed blocker/unblocker shape is general enough beyond Ricky's workflow domain.

## Risks of premature adoption

### 1. Weakening the local-first product path

If Ricky forces too much shared runtime abstraction into the local CLI path too early, it risks losing the precise staged workflow UX it has only recently made truthful.

### 2. Architectural theater

Ricky can easily drift into saying it uses agent-assistant more deeply than it really does. That creates confusion, weakens review quality, and makes future cleanup harder.

### 3. Extracting workflow-specific behavior too early

Ricky's staged execution and blocker/evidence model may *look* generic, but much of its current strength comes from being specialized to workflow authoring and execution. Premature generalization could erase that clarity.

### 4. Adopting moving targets

If a shared `agent-assistant` seam is still in flux, Ricky should not become the proving ground for unstable infrastructure unless that is explicitly the goal of the work.

## Recommended implementation order

### 1. Evaluate the strongest current seam

Start with Ricky's handoff normalization + staged execution + blocker/evidence contract.

This should be the subject of the next explicit evaluation slice because it is:

- already real
- strongly typed
- product-important
- adjacent to assistant-runtime concerns
- mature enough to compare against shared abstractions

### 2. Choose one real shared adoption slice

After that evaluation, adopt exactly one real shared seam, most likely one of:

- request/turn envelope alignment
- execution-adapter / harness boundary
- future surfaces/session integration

Do not broaden scope beyond one real adoption slice at a time.

### 3. Prove adoption on a live Ricky product path

Any chosen adoption slice must be proven on a real Ricky path:

- spec handoff
- generation and/or execution
- blocker or evidence output
- truthful product messaging preserved

### 4. Revisit extraction only after live proof

If the adopted slice genuinely reduces duplication and preserves product quality, then broader extraction/adoption can be considered. Otherwise, the boundary should hold.

## Recommended next issue mapping

This boundary suggests the follow-on sequence should be:

1. **#12** evaluate Ricky local execution contract for agent-assistant reuse
2. **#11** adopt the first real agent-assistant runtime slice in Ricky
3. **#13** prove the adoption on a live product path

That order is better than jumping straight into implementation because it keeps reuse grounded in product truth.

## Final verdict

Ricky should behave like a workflow-reliability product that uses assistant-runtime infrastructure where it genuinely helps, not like a generic assistant product wearing workflow branding.

So the correct adoption boundary today is:

- **keep Ricky-specific workflow product logic local now**
- **adopt shared assistant-runtime packages first in non-core or clearly reusable seams**
- **evaluate and extract the staged handoff/execution contract only after proof**

That keeps Ricky honest, keeps product quality protected, and creates a sane path toward deeper agent-assistant adoption without fake integration theater.
