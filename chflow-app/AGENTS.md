<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Shared Workspace Rules

This repository is edited by multiple coding agents and humans. Treat the working tree as shared production work.

## Scope Control

- Only edit files that are explicitly required for the current user request.
- Do not refactor, rename, reformat, or "clean up" unrelated files.
- Do not revert, overwrite, or simplify existing work unless the user explicitly asks for that exact reversal.
- If a file has changes you did not make, read it carefully and preserve those changes. Work around them instead of replacing them.
- If the requested task appears to require touching files outside the assigned scope, stop and ask for confirmation before editing.

## Protected Current Features

The following areas contain user-approved behavior and must not be changed unless the user explicitly asks for those exact screens:

- `app/departments/d/[id]/my-class-attendance/page.tsx`
  - Weekly horizontal mobile carousel and responsive desktop grid.
  - My-class-only teacher filtering.
  - Attendance statuses limited to `출석`, `결석`, `출석인정`.
  - Current-week-only editing; past weeks locked as `수정 마감`, future weeks as `예정`.
  - Large text sizing for older teachers.
  - Student gender/school metadata inline with name.
- `app/departments/d/[id]/talent/page.tsx`
  - My-class-only teacher filtering.
  - Weekly card UI modeled after my-class attendance.
  - Attendance auto-linked from my-class attendance.
  - Weekly talent checks: 성경책 지참, 요절암송, 요절암송발표, 대표기도, 전도, 새친구등반, 공과숙제.
  - 기타 entered by teacher with reason and free quantity.
- `app/departments/d/[id]/journal/page.tsx` and `app/globals.css`
  - Journal layout/overflow fixes are intentional and must be preserved.

## Deployment Discipline

- Do not deploy to Vercel unless the user explicitly asks for deployment or the current thread has established deployment as part of the task.
- Before deploying, run `npm run build`.
- When deployment succeeds, report the production URL and deployment id.

## Multi-Agent Coordination

- Prefer a separate git worktree or branch per agent/task.
- Do not edit files owned by another active task.
- Before making changes, inspect `git status --short`.
- After making changes, inspect the diff for only the files in scope.
- If another agent's changes conflict with yours, stop and report the conflict instead of resolving by overwriting.
