# ADR-005: Builder Pattern and Symbol Escape Hatch

**Status**: Accepted
**Date**: 2025-10-29
**Supersedes**: ADR-004 (conceptually updated, not replaced)

## Context

The typed router wrappers (from ADR-004) previously exposed an internal `._core` property to allow platform handlers to access the underlying core router. This creates an abstraction leak that:

1. **Exposes implementation details** — Users shouldn't know about dual-router pattern
2. **Breaks type preservation** — Passing wrapper is transparent; core shouldn't be exposed
3. **Creates confusion in documentation** — When and why is `._core` needed?
4. **Complicates mental model** — Users think they have "a router", but actually have a wrapper around a core
5. **Non-standard naming** — Underscore prefix suggests private but is public; doesn't match ecosystem conventions

**Solution: Use the Symbol escape hatch pattern instead of `._core`.**

## Decision

Replace the Proxy pattern with a **builder pattern** that creates a plain JavaScript object forwarding methods to the core router. The router is always materialized (no Proxy in production), and internal core access is provided via `Symbol.for("ws-kit.core")` escape hatch (following React's convention).

### Implementation: Builder Pattern (Plain Object Façade)

```typescript
/**
 * Builder pattern: plain object façade forwarding to core router.
 *
 * In production (NODE_ENV === "production"), this is the only implementation.
 * In development, an optional Proxy wrapper adds runtime assertions (see Appendix B).
 */
export function createRouter<TData = {}>(): Router<TData> {
  const core = new WebSocketRouter<TData>({ validator: zodValidator() });

  // Plain object with explicit forwarding—no Proxy traps needed
  return {
    on<S extends MessageSchema<any, any>>(
      schema: S,
      handler: (ctx: MessageContext<S, TData>) => void,
    ) {
      return core.on(schema, handler as any);
    },

    onOpen(handler: (ctx: OpenContext<TData>) => void) {
      return core.onOpen(handler as any);
    },

    onClose(handler: (ctx: CloseContext<TData>) => void) {
      return core.onClose(handler as any);
    },

    addRoutes(router: Router<any>) {
      return core.addRoutes(router as any);
    },

    use(
      middleware: (ctx: MessageContext<any, TData>, next: () => void) => void,
    ) {
      return core.use(middleware);
    },

    publish(scope: string, message: any) {
      return core.publish(scope, message);
    },

    debug() {
      return core.debug?.() ?? { handlers: [], middleware: [], routes: [] };
    },

    // Escape hatch for advanced introspection (follows React convention)
    [Symbol.for("ws-kit.core")]: core,
  } as Router<TData>;
}
```

**Key Benefits:**

- ✅ **Zero overhead** — Plain object method forwarding, no Proxy traps
- ✅ **Predictable debuggability** — Stack traces are clean, no trap indirection
- ✅ **Simple implementation** — No trap scope concerns, no dynamic property risk
- ✅ **Explicit escape hatch** — `Symbol.for("ws-kit.core")` for advanced introspection
- ✅ **Production-safe** — Always materialized in production, never uses Proxy
- ✅ **Opt-in enhancement** — Development mode can wrap with Proxy for assertions if desired

### Symbol Naming Convention

We use `Symbol.for("ws-kit.core")` following the industry-standard pattern established by React (`Symbol.for("react.element")`). This avoids special characters and is easy to type/search.

```typescript
// ✅ Advanced introspection only (rare; prefer router.debug())
const core = (router as any)[Symbol.for("ws-kit.core")];

// Or via exported constant:
import { CORE_SYMBOL } from "@ws-kit/core";
const core = (router as any)[CORE_SYMBOL];
```

### Symbol Escape Hatch (No `._core` Support)

Only `Symbol.for("ws-kit.core")` is supported. The `._core` property is removed to maintain API cleanliness.

```typescript
// ✅ Access core for advanced introspection
const core = (router as any)[Symbol.for("ws-kit.core")];

// ✅ Or use exported constant to avoid magic strings
import { CORE_SYMBOL } from "@ws-kit/core";
const core = (router as any)[CORE_SYMBOL];
```

**Most code doesn't need core access.** Use `router` directly; handlers accept it transparently. Only introspection use cases need the escape hatch.

### Optional Development-Mode Proxy Enhancement

In development (`NODE_ENV !== "production"`), the builder can be optionally wrapped with a Proxy to add runtime assertions and typo detection. This is an enhancement, not required:

```typescript
if (process.env.NODE_ENV !== "production") {
  const KNOWN = new Set([
    "on",
    "onOpen",
    "onClose",
    "addRoutes",
    "use",
    "publish",
    "debug",
  ]);

  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }

      // Help developers with typos
      if (typeof prop === "string" && !prop.startsWith("_")) {
        const similar = [...KNOWN].filter(
          (k) => levenshteinDistance(k, prop) <= 2,
        );
        if (similar.length > 0) {
          console.warn(
            `Router method "${prop}" not found. Did you mean: ${similar.join(", ")}?`,
          );
        } else {
          throw new Error(
            `Unknown router member "${prop}". ` +
              `Use documented API only (${[...KNOWN].join(", ")}). ` +
              `For raw introspection, use router[Symbol.for("ws-kit.core")].`,
          );
        }
      }

      return Reflect.get(target, prop, receiver);
    },

    ownKeys(target) {
      return Reflect.ownKeys(target).filter(
        (k) => k !== Symbol.for("ws-kit.core"),
      );
    },

    getOwnPropertyDescriptor(target, prop) {
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  }) as Router<TData>;
}
```

**Development Policy:**

- ✅ Proxy active only when `NODE_ENV !== "production"`
- ✅ Assertions help catch typos and unsupported patterns early
- ✅ Typo suggestions reduce friction
- ✅ Dynamic property access rejected with clear error message
- ✅ **Never use bracket access** (`router[prop]`) — always use static method calls

**Production Policy:**

- ✅ No Proxy — materialized builder always
- ✅ Zero introspection overhead
- ✅ Clean stack traces
- ✅ Safe for performance-critical paths

## Router Access Patterns: Safe vs. Unsafe

**Always use static method calls** on the router. Dynamic property access defeats type preservation:

```typescript
const router = createRouter<AppData>();

// ✅ SAFE: Static method calls
router.on(LoginSchema, (ctx) => {
  /* ... */
});
router.use((ctx, next) => {
  /* ... */
});
router.publish("scope", message, {
  /* payload */
});
const debug = router.debug();

// ✅ SAFE: Explicit escape hatch (advanced introspection only)
const core = (router as any)[Symbol.for("ws-kit.core")];

// ❌ UNSAFE: Dynamic property access (may route through Proxy in dev)
const m = "on";
(router as any)[m](schema, handler); // Don't do this

// ❌ UNSAFE: Bracket access with any expression
const methods = Object.keys(router);
for (const method of methods) {
  // This defeats the optimization and might hit Proxy traps
}

// ❌ UNSAFE: `._core` not supported
const core = router._core; // ❌ Property doesn't exist
```

## Platform Handlers: Accept Router Directly

Platform handlers accept the typed router directly without needing to extract `._core`:

```typescript
const { fetch, websocket } = createBunHandler(router, options);
// Just pass the router directly—it's transparent!
```

The handler implementation uses duck-typing to support both typed routers and core routers:

```typescript
export function createBunHandler<TData>(
  router: Router<TData> | WebSocketRouter<TData>,
  options: BunHandlerOptions<TData>,
) {
  // Handler detects typed router via Symbol and extracts core
  const core =
    Symbol.for("ws-kit.core") in Object(router)
      ? (router as any)[Symbol.for("ws-kit.core")]
      : router;
  // ... proceed with core
}
```

## Consequences

### Benefits

✅ **No abstraction leak** - `._core` is not exposed
✅ **Transparent to users** - Builder pattern hides dual-router implementation
✅ **Platform handlers simplified** - Direct router acceptance, no property extraction
✅ **Clear escape hatch** - Symbol.for convention is standard and documented
✅ **Zero production overhead** - Always plain object, never Proxy
✅ **Clean API** - No legacy property clutter

### Trade-offs

⚠️ **Development requires Proxy knowledge** - Optional enhancement requires understanding proxy traps
⚠️ **Symbol syntax is verbose** - `Symbol.for("ws-kit.core")` is longer than `._core`

## Alternatives Considered

### 1. Keep Proxy Pattern Always On

Use a full Proxy wrapper even in production for consistency.

**Why rejected:**

- Proxy performance cost (albeit small) in message dispatch hot path
- Complicates stack traces and debugging
- Unnecessary for type preservation (builder achieves that)
- Standard library pattern (React, Vue) is Symbol escape hatch, not Proxy always-on

### 2. Private Fields (`#core`)

Use TypeScript private fields to hide core access.

**Why rejected:**

- Private fields don't prevent runtime access via reflection
- No escape hatch for advanced introspection
- TypeScript-only solution (doesn't work in JavaScript)
- Doesn't align with React/Vue industry conventions

### 3. Support Both Symbol and `._core` Indefinitely

Continue supporting `._core` as a stable public API.

**Why rejected:**

- Contradicts principle of no abstraction leak
- Non-standard naming doesn't align with React/Vue conventions
- Confuses developers about what's private vs. public

## References

- **ADR-004**: Typed Router Factory Pattern (still valid, updated with builder context)
- **ADR-007**: Export-with-Helpers Pattern (uses this builder approach)
- **Implementation**:
  - `packages/zod/src/router.ts` - Zod typed router builder
  - `packages/valibot/src/router.ts` - Valibot typed router builder
- **Symbol Convention**: See Appendix A for comparison with alternatives

---

## Appendix A: Symbol Naming Comparison

This table compares Symbol-based escape hatches with alternative approaches used across the ecosystem:

| Approach                          | Syntax                           | Pros                                   | Cons                                                                       | Examples                                             |
| --------------------------------- | -------------------------------- | -------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Symbol.for("prefix.name")**     | `obj[Symbol.for("ws-kit.core")]` | ✅ Standard across ecosystem           | ⚠️ Verbose syntax                                                          | React (`Symbol.for("react.element")`), Vue internals |
| **Underscore prefix** (`._core`)  | `obj._core`                      | ✅ Concise                             | ❌ Suggests private but public; not self-documenting; convention confusion | Legacy frameworks                                    |
| **Double underscore** (`.__core`) | `obj.__core`                     | ✅ Stronger convention signal          | ❌ Not standard; transpilers may mangle; JS trend moving away              | Older code                                           |
| **Named Symbol** (`CORE_SYMBOL`)  | `obj[CORE_SYMBOL]`               | ✅ Concise when imported; clear intent | ⚠️ Requires import statement                                               | Node.js utilities                                    |
| **WeakMap**                       | `coreMap.get(obj)`               | ✅ True privacy; no reflection         | ❌ Complex setup; harder to debug; not discoverable                        | Internal libraries                                   |
| **Private fields** (`#core`)      | `obj.#core`                      | ✅ TypeScript strong typing            | ❌ Runtime reflection breaks; no escape hatch                              | Modern frameworks (post-TS5)                         |

### Why `Symbol.for("ws-kit.core")`

**Symbol.for() establishes a global symbol registry** across realms and modules, making it ideal for library escape hatches:

1. **Industry standard pattern** — React (`Symbol.for("react.element")`), Vue (internal symbols), and other major libraries use this
2. **Fully documented** — The pattern is well-understood by advanced developers who need introspection
3. **Self-documenting** — String namespace makes purpose clear: `"ws-kit.core"` unmistakably refers to the core router
4. **Discoverable** — Developers can search for `Symbol.for("ws-kit.core")` in codebase and documentation
5. **Resilient** — Persists across realms, module boundaries, and bundler optimizations
6. **No false positivity** — Typos in property access (e.g., `._core` vs `.core`) are impossible with Symbols
7. **Follows TC39 conventions** — The pattern is recognized in TC39 proposals for well-known symbols

### Using the Escape Hatch

To access the core router for advanced introspection:

```typescript
// Direct Symbol access
const core = (router as any)[Symbol.for("ws-kit.core")];

// Or use exported constant (avoids magic string)
import { CORE_SYMBOL } from "@ws-kit/core";
const core = (router as any)[CORE_SYMBOL];
```
