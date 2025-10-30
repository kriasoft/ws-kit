# Architectural Decision Records (ADRs)

> **Purpose:** ADRs document _why_ design decisions were made, not _how_ they work. For implementation details, see the specification files in this directory.

## All ADRs

**Start here:** See the ADR index in [README.md](./README.md#architectural-decision-records-adrs) for a summary table mapping ADRs to impacted specs.

### Complete List (In Order of Relevance)

1. **[ADR-001: MessageContext Conditional Payload Typing](../adr/001-message-context-conditional-payload-typing.md)**
   - **Why:** Enable type-safe `ctx.payload` access (compile-time error when schema omits payload)
   - **Impact:** @schema.md, @validation.md, @test-requirements.md
   - **Status:** ✅ Implemented

2. **[ADR-007: Export-with-Helpers Pattern](../adr/007-export-with-helpers-pattern.md)**
   - **Why:** Single canonical import source (`@ws-kit/zod`, `@ws-kit/valibot`) to prevent dual-package hazards
   - **Impact:** @schema.md, all validator packages
   - **Status:** ✅ Implemented
   - **Supersedes:** ADR-004 (old factory pattern)

3. **[ADR-005: Builder Pattern and Symbol Escape Hatch](../adr/005-builder-pattern-and-symbol-escape-hatch.md)**
   - **Why:** Transparent router type preservation without Proxy overhead
   - **Impact:** @router.md, typed router implementations
   - **Status:** ✅ Implemented
   - **Related:** ADR-004 (conceptually similar approach)

4. **[ADR-008: Middleware Support](../adr/008-middleware-support.md)**
   - **Why:** Enable cross-cutting concerns (auth, logging, rate limiting) without duplication
   - **Impact:** @router.md, @rules.md
   - **Status:** ✅ Implemented

5. **[ADR-009: Error Handling and Lifecycle Hooks](../adr/009-error-handling-and-lifecycle-hooks.md)**
   - **Why:** Type-safe error responses and observability into connection lifecycle
   - **Impact:** @error-handling.md, @router.md, lifecycle integration
   - **Status:** ✅ Implemented

6. **[ADR-010: Throttled Broadcast Pattern](../adr/010-throttled-broadcast-pattern.md)**
   - **Why:** Reduce bandwidth 80-95% for rapid updates (live cursors, presence, frequent state changes)
   - **Impact:** @patterns.md, @broadcasting.md, utility functions in @ws-kit/core
   - **Status:** ✅ Implemented

7. **[ADR-011: Structured Logging Adapter](../adr/011-structured-logging-adapter.md)**
   - **Why:** Enable production logging integration (Winston, Pino, Datadog) without monkeypatching console
   - **Impact:** @router.md (logger config), all logging points in core
   - **Status:** ✅ Implemented

8. **[ADR-006: Multi-Runtime `serve()` with Explicit Selection](../adr/006-multi-runtime-serve-with-explicit-selection.md)**
   - **Why:** Unified serving API across platforms (Bun, Cloudflare, Deno) with explicit runtime selection
   - **Impact:** @router.md#Basic-Setup, platform adapters
   - **Status:** ✅ Implemented

9. **[ADR-002: Typed Client Adapters via Type Overrides](../adr/002-typed-client-adapters.md)**
   - **Why:** Full type inference in client handlers without manual type guards
   - **Impact:** @client.md, client implementations (`/zod/client`, `/valibot/client`)
   - **Status:** ✅ Implemented

10. **[ADR-003: Example Import Strategy with Path Aliases](../adr/003-example-imports.md)**

- **Why:** Production-like imports in development examples without build steps
- **Impact:** Examples, TypeScript/Bun configuration
- **Status:** ✅ Implemented

11. **[ADR-004: Typed Router Factory Pattern](../adr/004-typed-router-factory.md)**

- **Why:** Type preservation through factory functions (predecessor approach)
- **Status:** ⚠️ Superseded by ADR-005 + ADR-007
- **Note:** Kept for historical reference; concepts still valid

## How ADRs Relate to Specs

**ADRs explain the _why_; Specs explain the _what_ and _how_.**

- Use **ADR links** when documenting design rationale or trade-offs
- Use **Spec links** when explaining implementation details or usage patterns
- Reference specific ADRs in spec sections when important for understanding decisions

Example:

```markdown
> For conditional payload typing design rationale, see ADR-001.
> For implementation details, see @schema.md#Conditional-Payload-Typing.
```

## Deprecation and Superseded ADRs

- **ADR-004** is superseded by **ADR-005** (builder pattern) + **ADR-007** (export-with-helpers)
  - Kept in `docs/adr/` for historical context
  - No need to reference in new documentation

## Backwards Compatibility Notes

See individual ADR files for:

- Deprecation timelines
- Migration paths
- Supported patterns and their versions
