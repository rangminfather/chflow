# Quality gates

## Required local check

Run the following before requesting review or deployment:

```bash
npm run check
```

It runs the lint ratchet, unit tests, and TypeScript validation. Production deployment additionally requires `npm run build`, as defined in `AGENTS.md`.

## Lint baseline

The baseline recorded on 2026-07-27 is **0 errors and 128 warnings**. `npm run lint:baseline` rejects any increase in warnings and rejects all errors. The baseline is a temporary ratchet: reduce it when fixing warnings; never increase it to accept new code.

Rule counts below were re-measured on 2026-07-29 at `d0c0457` and sum to exactly 128, matching what `npm run lint:baseline` counts. The previous table summed to 131 and could not be used as a comparison basis; only the counts were corrected — the baseline number stays 128.

| Priority | Rules / current count | Treatment |
| --- | --- | --- |
| P0 | All ESLint errors (0) | Block every change immediately. |
| P1 | `react-hooks/set-state-in-effect` (14), `react-hooks/exhaustive-deps` (7), `jsx-a11y/alt-text` (2) | Fix before touching the affected flow; these can cause stale state, repeated renders, or inaccessible content. |
| P2 | `@typescript-eslint/no-unused-vars` (37), `@typescript-eslint/no-explicit-any` (7) | Remove or type while editing the affected module. Do not introduce new instances. |
| P3 | `@next/next/no-img-element` (42), `react/no-unescaped-entities` (18) | Resolve during screen/component refactors, where the appropriate image or copy treatment can be verified. |
| P4 | `import/no-anonymous-default-export` (1) | Resolve opportunistically; document an intentional exception inline if one is genuinely necessary. |

Total: 14 + 7 + 2 + 37 + 7 + 42 + 18 + 1 = **128**.

### How to re-measure

`npm run lint:baseline` only prints the total. For the per-rule distribution:

```bash
npx eslint . -f json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c={};for(const f of JSON.parse(s))for(const m of f.messages)if(m.severity===1)c[m.ruleId||'(unused-disable-directive)']=(c[m.ruleId||'(unused-disable-directive)']||0)+1;console.table(c)})"
```

To tell new warnings from pre-existing ones, check out the baseline commit in a worktree and run the **same** ESLint against it, then compare by `file :: rule`. Comparing against this table alone is not reliable once the table drifts.

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

## Open lint items (tracked separately from feature work)

These are tracked here instead of being fixed inline, because they change runtime behaviour and need the owning author's judgement. Do not raise the baseline number to accommodate them.

### P1-1 — react-hooks/set-state-in-effect in the automatic attendance screens (new since baseline)

Measured 2026-07-29 by running the same ESLint against the baseline commit `0d0dedf` and against `d0c0457`, then comparing by `file :: rule`:

| Status | Location | Rule |
| --- | --- | --- |
| **new** | `app/attendance/page.tsx:62` | `react-hooks/set-state-in-effect` |
| **new** | `app/attendance/settings/page.tsx:17` | `react-hooks/set-state-in-effect` |
| resolved | `app/install/page.tsx` (page deleted in `b6844af`) | `react-hooks/set-state-in-effect` |

Net effect on P1: 22 → 23 (+1). The other 21 P1 warnings existed at the baseline commit and are unchanged; `react-hooks/exhaustive-deps` did not increase.

Owner: whoever owns the automatic attendance flow. Setting state directly inside an effect can cause an extra render pass or stale state, so this should be reviewed against the intended load sequence rather than silenced.

### P1-2 — this table drifting again

The rule counts above are a snapshot. Re-measure with the command in "How to re-measure" whenever the baseline number changes, and compare against the baseline commit rather than against the table.
