---
name: ship
description: Commit, merge to main, push and report Vercel deploy status after verify passes. Never force-pushes, never touches env vars.
---

# ship

1. Run the `verify` skill. On any failure stop and report; no commit.
2. `git status`. Make sure no `.env*` file or key material is staged (`git diff --cached --name-only` may show only `.env.example`).
3. Commit with a short message in the repo's style, ending with the Co-Authored-By line given in the session instructions.
4. On a feature branch: `git checkout main && git merge --no-ff <branch>`; resolve conflicts and re-run verify if the merge was non-trivial.
5. `git push origin main`. Never `--force` or `-f`. If rejected: `git pull --rebase origin main`, re-verify, push again.
6. Deploy status through the Vercel MCP: `list_teams`, `list_projects` (project "hodd"), `list_deployments`, `get_deployment`. Report state (BUILDING/READY/ERROR) and URL. On ERROR read the build logs, fix, repeat. Never read or edit Vercel environment variables.
7. Production keeps `HODD_*_EXECUTION_ENABLED` unset or false. If a deploy would enable them, stop.
8. Update memory.md (status, decisions, todo) and commit it too.
