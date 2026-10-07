---
name: cross-review
description: Independent second-opinion review of a branch by Codex (or a read-only reviewer subagent if Codex is not installed), plus extra tests. The reviewer never edits product code.
---

# cross-review

Goal: a second model reviews the diff and writes additional tests, without changing product code.

Steps:
1. Work must be committed on its own branch. Get the diff: `git diff main...HEAD`.
2. Reviewer, in order of preference:
   - `codex` CLI if `which codex` succeeds: `codex exec --sandbox read-only "<review prompt>"` for the review; a second run may write only `*.test.ts(x)` files.
   - Otherwise spawn a read-only reviewer subagent (Agent tool, `general-purpose`) told: "do not edit any file except new `*.test.ts(x)` files".
3. The prompt must demand findings ranked by severity, each with file:line, a failing scenario and a proposed test. Focus: money path (see money-path-review), auth/RLS, uncertain-outcome handling, secret leakage, mainnet/production flag leaks.
4. Revert any non-test file the reviewer touched (`git checkout -- <file>`).
5. Fix real findings. Maximum 3 review rounds per task. If still open after 3, pick the best option, record why in memory.md (Decisions) and continue.
6. Run the `verify` skill. Added tests must pass.

Roles alternate: if Claude wrote the last task, Codex (or the reviewer agent) writes the next one and Claude reviews it.
