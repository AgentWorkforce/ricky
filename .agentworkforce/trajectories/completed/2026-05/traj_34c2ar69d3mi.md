# Trajectory: Move workflow PR guidance to skills source

> **Status:** ✅ Completed
> **Confidence:** 95%
> **Started:** May 7, 2026 at 02:11 PM
> **Completed:** May 7, 2026 at 02:13 PM

---

## Summary

Removed the vendored skill edit from Ricky PR #65, updated the source writing-agent-relay-workflows skill in ../skills, bumped prpm.json catalog version to 1.0.1 and writing-agent-relay-workflows to 1.6.2, pushed codex/workflow-pr-boundary-skill, and opened skills PR #29.

**Approach:** Standard approach

---

## Key Decisions

### Move workflow PR guidance to source skills repo
- **Chose:** Move workflow PR guidance to source skills repo
- **Reasoning:** Ricky vendors skills from the skills repository via prpm, so the PR-boundary instruction belongs in ../skills with a prpm.json version bump instead of being hand-edited in Ricky's vendored copy.

---

## Chapters

### 1. Work
*Agent: default*

- Move workflow PR guidance to source skills repo: Move workflow PR guidance to source skills repo

---

## Artifacts

**Commits:** 1f67328
**Files changed:** 1
