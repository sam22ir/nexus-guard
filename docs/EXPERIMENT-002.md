# Experiment 002 — read two real local folders

> Superseded by VALIDATION-HTTP.md; fake multi-provider prototype; stdio-era.

**Date:** 2026-09-24  
**Result:** passed on Linux. This is still a small test, not the finished app.

## What happened

The test created two temporary folders on this computer, made each one a Git project, and placed a small `.nexus/project.json` file in each folder. The folders were called **Koupa** and **Nabdh**. Their Supabase, Convex, Clerk, and Sentry names were all fake; no real account or network service was used.

Nexus read the folder, checked its saved project choice against its Git address and project file, and returned only the services approved for that folder.

## What we checked

- The two folders keep separate service lists, including when checked at the same time.
- Opening a subfolder still identifies the correct project.
- Changing the Git address after registration blocks the folder rather than switching it to another project.
- A project file that names the wrong project, changes a service, or cannot be read as valid JSON is blocked.
- An unregistered folder is not guessed.
- A request aimed at the other project's fake Supabase service is blocked **before** the fake service step runs.

All **11 automated checks** passed. A separate demonstration also read two newly created temporary folders and printed the correct fake service names for each.

## Limits

The known projects and their fake service names are still written in the test program. Registration is not saved after the program closes. We have not connected Codex or a real provider, tested real credentials, or tested Windows and macOS. The test cannot see commands run outside Nexus.

## Repeat the checks

From the repository root:

```sh
cargo test --manifest-path prototype/nexus-check/Cargo.toml
```

The program can also read two Git folders with the fake addresses `https://example.test/koupa.git` and `https://example.test/nabdh.git`:

```sh
cargo run --manifest-path prototype/nexus-check/Cargo.toml -- /path/to/koupa /path/to/nabdh
```

See [`prototype/nexus-check/src/main.rs`](../prototype/nexus-check/src/main.rs).
