# ADR-026: Internal Router Access Patterns for Plugins and Tests

**Status**: Accepted
**Date**: 2025-11-13
**References**: ADR-005 (Symbol Escape Hatch), ADR-025 (Validator Plugins)

## Context

Plugins (`@ws-kit/zod`, `@ws-kit/valibot`, `@ws-kit/pubsub`) and the test harness need internal access to router implementation details to:

1. **Wrap core methods** — Validation plugins need to intercept `createContext` and attach validation logic
2. **Track connections** — Pub/Sub plugin needs to map client IDs to WebSocket send functions
3. **Notify observers** — Test harness needs to access lifecycle hooks and internal event streams

Previously, plugins cast the router to the internal `RouterImpl<any>` class directly:

```typescript
// ❌ Unsafe cast (what we had)
const routerImpl = router as any as RouterImpl<any>;
```

This created several problems:

1. **Tight coupling** — Plugins depend on implementation class, not public contract
2. **No encapsulation** — Implementation details leak into plugin code
3. **Type safety gap** — `as any` casts bypass TypeScript checks
4. **Hard to audit** — No visibility into which internals are accessed where

**Solution: Use a Symbol-based escape hatch (following ADR-005 pattern) for structured internal access.**

## Decision

All internal router access uses the `ROUTER_IMPL` symbol defined in `@ws-kit/core/internal`, a non-public module clearly marked `@internal`.

### Implementation Pattern

**1. Symbol definition** (`packages/core/src/core/symbols.ts`):

```typescript
/**
 * Symbol for accessing the router implementation instance.
 * Used by plugins and test infrastructure to access internal details without
 * depending on implementation classes directly.
 *
 * Not part of public API. Escape hatch for rare cases where internals are needed.
 * @internal
 */
export const ROUTER_IMPL = Symbol("@ws-kit/router-impl");
```

**2. Attach symbol in constructor** (`packages/core/src/core/router.ts`):

```typescript
export class RouterImpl<TContext extends ConnectionData = ConnectionData>
  implements RouterCore<TContext>
{
  constructor(private limitsConfig?: CreateRouterOptions["limits"]) {
    this.limitsManager = new LimitsManager(limitsConfig);
    this.pluginHost = new PluginHost<TContext>(this as any as Router<TContext>);
    // Attach to symbol for internal access escape hatch
    (this as any)[ROUTER_IMPL] = this;
  }
}
```

**3. Export symbol and type** (`packages/core/src/internal.ts`):

```typescript
/**
 * @internal
 * Internal API for plugins and test infrastructure.
 *
 * This module provides escape hatches for accessing router internals without
 * exposing implementation classes in the public API. Plugins and tests should
 * import from this path only.
 */

export { ROUTER_IMPL } from "./core/symbols";
export type { RouterImpl } from "./core/router";
```

**4. Plugin usage** (e.g., `@ws-kit/zod`):

```typescript
import { ROUTER_IMPL } from "@ws-kit/core/internal";

export function withZod(options?: WithZodOptions) {
  return (router) => {
    // Get internal access with proper error handling
    const routerImpl = (router as any)[ROUTER_IMPL];
    if (!routerImpl) {
      throw new Error(
        "withZod requires internal router access (ROUTER_IMPL symbol)",
      );
    }

    // Safe access: routerImpl is now typed as RouterImpl<any>
    const originalCreateContext = routerImpl.createContext.bind(routerImpl);
    // ... rest of plugin logic
  };
}
```

**5. Test harness usage** (`test-harness.ts`):

```typescript
import type { Router } from "@ws-kit/core";
import type { RouterImpl } from "@ws-kit/core/internal";

export function wrapTestRouter<TContext extends ConnectionData>(
  router: Router<TContext>,
): TestRouter<TContext> {
  // Get router implementation for internal access (needed for test adapter setup)
  const impl = (router as any)[ROUTER_IMPL] as RouterImpl<TContext> | undefined;
  if (!impl) {
    throw new Error("Test harness requires internal router access");
  }

  const adapter = new InMemoryPlatformAdapter(impl);
  // ... rest of setup
}
```

## Rationale

### Why Symbol, Not Direct Type Cast?

1. **Visibility** — `ROUTER_IMPL` is explicit; auditors can grep for it and track all access points
2. **Type safety** — Symbol access is type-checked (via `[ROUTER_IMPL]: this` assignment)
3. **Encapsulation** — Symbol is not exported from the main package; only via `@internal` path
4. **Consistency** — Follows ADR-005's symbol escape hatch pattern for established convention

### Why `@ws-kit/core/internal`, Not `@ws-kit/core`?

1. **Signaling** — Filename signals "non-public" without relying on documentation
2. **Discoverability** — Import path `from "@ws-kit/core/internal"` is longer but clearer than `from "@ws-kit/core"`
3. **Future compatibility** — If internals change, we can deprecate the internal path without breaking public API

### Why Throw on Missing Symbol?

If the symbol isn't present, it means:

- Router isn't a real `RouterImpl` instance (already broken)
- Plugin was used with an incompatible router subclass (configuration error)

Early throwing prevents silent failures and makes the error explicit.

## Constraints

1. **Plugins must import from `@ws-kit/core/internal`**, not from `@ws-kit/core` or `@ws-kit/core/core/router`
2. **Test harness is the only user of internal patterns within core** — adapters, lifecycle hooks, event streams
3. **No `RouterImpl` export from `@ws-kit/core` main index** — keeps impl classes fully private
4. **Type imports only for `RouterImpl`** — tests can't `new RouterImpl()` except in unit tests internal to core

## Consequences

### Positive

- ✅ **No surprises** — Plugins explicitly declare internal dependency
- ✅ **Auditability** — All internal access points are findable via grep for `ROUTER_IMPL`
- ✅ **Type safety** — No `as any as RouterImpl` casts in plugins; TypeScript knows the type
- ✅ **Maintainability** — Encapsulation is enforced; impl details can change without breaking public API
- ✅ **Composability** — Plugins stack cleanly without impl leakage

### Negative (Acceptable Trade-offs)

- ⚠️ **Non-zero ceremony** — Plugins need one extra import and error check
- ⚠️ **Slightly verbose** — `(router as any)[ROUTER_IMPL]` is longer than `router._impl`
- ⚠️ **Runtime errors possible** — Missing symbol throws at runtime (same as broken configuration anyway)

## Implementation Checklist

- [x] Add `ROUTER_IMPL` symbol to `core/symbols.ts`
- [x] Attach symbol in `RouterImpl` constructor
- [x] Create `internal.ts` non-public module with exports
- [x] Update all plugins to use `ROUTER_IMPL` instead of type casts
- [x] Update test harness to use `ROUTER_IMPL`
- [x] Update dispatch and test adapter imports to use `@ws-kit/core/internal`
- [x] Remove `RouterImpl` export from main `@ws-kit/core` index
- [x] Document in `docs/specs/test-requirements.md`

## Related Decisions

- **ADR-005**: Symbol Escape Hatch — establishes the pattern we follow
- **ADR-025**: Validator Plugins — plugins that need internal access patterns
- **docs/specs/test-requirements.md**: Testing patterns and best practices
