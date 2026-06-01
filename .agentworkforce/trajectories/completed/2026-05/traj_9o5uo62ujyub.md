# Trajectory: Fix publish workflow stale main failure

> **Status:** ✅ Completed
> **Confidence:** 95%
> **Started:** May 7, 2026 at 10:49 AM
> **Completed:** May 7, 2026 at 10:52 AM

---

## Summary

Opened PR #57 to harden publish.yml: require dispatch from current main, serialize publish runs, commit package-lock with version bumps, atomically push the release commit/tag before npm publish, and reconcile package metadata to the already-published 0.1.26. Validated with npm ci, actionlint, and npm test.

**Approach:** Standard approach

---

## Key Decisions

### Push release commit and tag before npm publish
- **Chose:** Push release commit and tag before npm publish
- **Reasoning:** The failed run published npm first, then could not fast-forward main. Pushing the release commit/tag atomically before npm publish makes stale-main failures occur before the irreversible registry publish.

### Updated package-lock without npm install
- **Chose:** Updated package-lock without npm install
- **Reasoning:** npm version 0.1.26 --no-git-tag-version aligned package metadata only; npm ci verified the lockfile remains installable, so npm i was not needed.

---

## Chapters

### 1. Work
*Agent: default*

- Push release commit and tag before npm publish: Push release commit and tag before npm publish
- Updated package-lock without npm install: Updated package-lock without npm install
