# ADR-003: TypeScript end to end

**Status:** Accepted (2026-10-31)

## Context

The platform dashboard has an API, a web UI, workers, a simulator and an optional MCP server.
They all speak about the same domain: targets, findings, exceptions, rollouts, events. If
each part defines those types separately, they drift apart, and the API contract breaks
silently.

## Decision

Write all application code in **TypeScript**: Node.js for the API, workers, simulator and MCP
server, React for the web UI, in one npm-workspaces monorepo. The domain model and its
validation schemas live once in `packages/shared` and are imported everywhere.

## Alternatives considered

- **Go or .NET backend with a TypeScript frontend.** Both are strong for APIs, but the domain
  types would exist twice, with a code generator in between to keep them in sync.
- **Python backend.** Good for scripting and data work, same duplication problem, and a
  weaker story for sharing types with the UI.

## Consequences

- Positive: one language, one toolchain, one test runner; a change to the domain model is
  caught by the compiler in the API and the UI in the same PR.
- Positive: the platform team can move between parts of the codebase without context
  switching.
- Negative: Node's single-threaded model is not ideal for CPU-heavy work; we accept that
  because the heavy work is I/O (calling APIs) and runs in workers.
- Negative: the JavaScript dependency ecosystem needs active hygiene (lockfile, Renovate,
  audit in CI).
