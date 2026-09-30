# Experiment 003 — two agents use Nexus at the same time

> Superseded by VALIDATION-HTTP.md; fake multi-provider prototype; stdio-era.

**Date:** 2026-09-24  
**Result:** passed on Linux. This uses fake projects and fake service names only.

## Goal

Prove that Nexus can sit between two agents working on two projects at the same time.

## What we tested

```text
Agent 1 → Koupa → Nexus → Koupa Supabase
Agent 2 → Nabdh → Nexus → Nabdh Supabase
```

The test made two temporary Git folders and two agent sessions:

- `agent-1` worked on Koupa.
- `agent-2` worked on Nabdh.

Each agent asked Nexus for Supabase. Nexus returned the correct fake connection for that agent's project. Both agents also asked at the same time.

## Result

**Passed. Fifteen automated checks passed.**

- Agent 1 received `supabase-koupa-dev`.
- Agent 2 received `supabase-nabdh-dev`.
- The two agents did not mix projects during simultaneous requests.
- Agent 1 could not ask for Nabdh's connection.
- A closed agent could not ask for a service again.
- No secret value was returned to either agent.

A separate run with two temporary folders printed:

```text
agent-1 → Koupa → supabase-koupa-dev (secret shown: false)
agent-2 → Nabdh → supabase-nabdh-dev (secret shown: false)
agent-1 asking for Nabdh's connection: blocked
closed agent-1 asking again: blocked
```

## What this proves

The basic idea works in a small local test: the connection comes from the agent's project, not from one shared “current project.”

## What this does not prove

This is not connected to Codex, MCP, Supabase, Clerk, or real credentials. It does not yet store secrets or provide real service actions. It also has not been tested on Windows or macOS.

## Code

The test is in [`prototype/nexus-check/src/main.rs`](../prototype/nexus-check/src/main.rs).
