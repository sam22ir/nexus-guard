# Experiment 001 — keep two projects separate

> Superseded by VALIDATION-HTTP.md; fake multi-provider prototype; stdio-era.

**Date:** 2026-09-24  
**Purpose:** Try the smallest version of the main idea without using real accounts.

## What we made

We made a small local test with two fake projects:

- **Koupa** → fake Supabase target `supabase-koupa-dev`
- **Nabdh** → fake Supabase target `supabase-nabdh-dev`

Each fake project also has fake Convex, Clerk, and Sentry targets. No real account, password, or secret is used.

## What the test checks

1. Koupa receives only Koupa's targets.
2. Nabdh receives only Nabdh's targets.
3. A request for the other project's Supabase target is blocked.
4. If the project name and Git address disagree, Nexus does not guess; it blocks the request.

## Result

**Passed.** Five small tests passed:

- Koupa stays separate from Nabdh.
- Nabdh stays separate from Koupa.
- A matching target is allowed.
- A wrong target is blocked.
- A conflicting project identity is blocked.

## What this does not prove

This is only a safe paper test inside the computer. It does not yet connect to Codex, Supabase, Convex, Clerk, or Sentry. It also does not stop a normal command that completely bypasses Nexus.

## Code

The test is in [`prototype/nexus-check`](../prototype/nexus-check/).
