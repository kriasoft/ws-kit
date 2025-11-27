# Test Structure

This directory contains cross-package integration and end-to-end tests.

## Directory Layout

- **integration/**: Cross-package integration tests.
  - **client/**: Client SDK integration (auth, queueing, state machine).
  - **types/**: Cross-package type safety tests.
  - **bun/**: Bun adapter + full stack integration.
  - **cloudflare/**: Cloudflare DO + full stack integration.
- **e2e/**: Full end-to-end scenarios.
  - **client-server/**: Real WebSocket client ↔ server flows.
  - **pubsub/**: Multi-client pub/sub flows.
  - **rpc/**: Request/response patterns.
- **benchmarks/**: Performance benchmarks.
- **helpers/**: Shared test utilities.

## Running Tests

- Run all tests: `bun test`
- Run unit tests (packages/): `bun run test:unit`
- Run e2e/integration tests (tests/): `bun run test:e2e`
- Run benchmarks: `bun run test:bench`

## Guidelines

1. **Unit Tests**: Co-locate in `packages/*/src/*.test.ts` next to implementation.
2. **Feature Tests**: Keep in `packages/*/test/features/` for integration scenarios.
3. **Cross-Package**: Place tests involving multiple packages here (`tests/`).

## Dependency Resolution

Tests in this directory import packages (e.g., `import ... from "@ws-kit/core"`) directly from source.

- **Mechanism**: `bunfig.toml` maps `@ws-kit/*` to `packages/*/src`.
- **No package.json needed**: You do **not** need to list these packages in the root `package.json`.
- **Source vs Build**: These tests run against the _source code_ (TypeScript), not the built `dist/` files.
