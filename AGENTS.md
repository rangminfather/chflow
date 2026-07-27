# Repository-wide agent rules

Before reviewing release readiness, deployment state, or a dirty working tree:

1. Read `CLAUDE.md` and `RELEASE_STATUS.md`.
2. Inspect the actual diff and the recorded deployment evidence.
3. Never label a change as unfinished, unrelated, or owned by another agent solely from its path or `git status`.
4. Distinguish these states explicitly:
   - completed and committed;
   - completed/deployed but not yet committed;
   - verified work in progress;
   - unknown and requiring confirmation.
5. Do not use `git add -A` in this shared workspace. Stage only the reviewed files for one logical change.
6. Keep nested/local projects and binary output folders out of the main release unless the user explicitly places them in scope.

Update `RELEASE_STATUS.md` whenever a production deployment, database migration, EAS build, or store submission changes the recorded state.
