# Quality gates

## Required local check

Run the following before requesting review or deployment:

```bash
npm run check
```

It runs the lint ratchet, unit tests, and TypeScript validation. Production deployment additionally requires `npm run build`, as defined in `AGENTS.md`.

## Lint baseline

The baseline recorded on 2026-07-27 is **0 errors and 128 warnings**. `npm run lint:baseline` rejects any increase in warnings and rejects all errors. The baseline is a temporary ratchet: reduce it when fixing warnings; never increase it to accept new code.

| Priority | Rules / current count | Treatment |
| --- | --- | --- |
| P0 | All ESLint errors (0) | Block every change immediately. |
| P1 | `react-hooks/exhaustive-deps` (5), `react-hooks/set-state-in-effect` (13), `jsx-a11y/alt-text` (2) | Fix before touching the affected flow; these can cause stale state, repeated renders, or inaccessible content. |
| P2 | `@typescript-eslint/no-explicit-any` (7), `@typescript-eslint/no-unused-vars` (41) | Remove or type while editing the affected module. Do not introduce new instances. |
| P3 | `@next/next/no-img-element` (43), `react/no-unescaped-entities` (18) | Resolve during screen/component refactors, where the appropriate image or copy treatment can be verified. |
| P4 | Other rule warnings (2) | Resolve opportunistically; document an intentional exception inline if one is genuinely necessary. |

Local investigation files under `_scratch/` and build-time scripts under `scripts/` are excluded from application linting. They remain outside the production bundle and must be reviewed separately when changed.

## Test policy

- Put deterministic business rules in `lib/` and cover them with Vitest `*.test.ts` files.
- Add a regression test when fixing a production bug.
- Add browser tests before changing login, signup, authorization, attendance, notifications, or payment-like irreversible operations.
- Tests must not call production Supabase, storage, Expo, or third-party systems.
- The minimum checks for a release candidate are `npm run check` followed by `npm run build`.

## Gradual delivery automation

The project intentionally starts with checks that do not require an additional paid server or database. A separate Supabase project is added only when database-backed browser tests are needed often enough to justify its maintenance.

### Stage 1 — GitHub Actions checks

For every pull request and protected-branch push, GitHub Actions runs:

1. `npm run lint:baseline`
2. `npm run test:unit`
3. `npm run typecheck`
4. `npm run build`

A failed check blocks merge/deployment review. The checks do not access production Supabase, Storage, Expo, or Play Console.

### Stage 2 — Vercel Preview review

Each branch receives a Vercel Preview URL. Before production deployment, use that URL to manually verify the changed screen on desktop and mobile widths. Preview deployments use the existing web deployment mechanism; no separate WAS is introduced.

### Daily workflow after stages 1–2

```text
change code → push branch → Actions checks → Vercel Preview → manual changed-flow check → merge/push main → production build and deployment
```

If Actions fails, fix the failure before proceeding. If the Preview review finds a behavior issue, fix it on the branch and repeat the same flow. Production deployment remains separate from Preview approval.

### Later stage — isolated Supabase test project

Add a test Supabase project only for repeatable browser tests that need Auth, RPC, Storage, or RLS. It must have separate credentials, test-only accounts/data, and migrations applied before tests. Never point automated tests at production data.
