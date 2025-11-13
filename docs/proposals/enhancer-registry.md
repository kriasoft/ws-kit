# Proposal: Context Enhancer Registry & Plugin Safety (ADR-024)

## Problem Statement

The current plugin system has three critical interdependent issues that undermine reliability and composability:

1. **Symbol-Based Internals Access**: Plugins access private router state via `(router as any)[ROUTER_IMPL]`, bypassing TypeScript entirely. This creates brittle, version-sensitive dependencies and leads to opaque runtime failures when internals change.

2. **Context Creation Overwriting**: Each plugin (e.g., `withZod`, `withPubSub`) monkey-patches `routerImpl.createContext`, completely replacing the previous implementation. When multiple plugins coexist, only the last one's methods survive—earlier extensions vanish silently.

3. **Silent Validation Skips**: Middleware silently passes unvalidated messages if no schema is registered, violating the fail-fast principle and creating false security in production.

These issues form a **fault network**: symbol access enables unsafe patterns → overwrites become the default composition model → validation silently skips when registration fails.

## Solution: Core-Owned Enhancer Chain + Typed Plugin API

### 1. Typed Plugin API (Replaces Symbol Access)

Export a minimal, typed interface from `@ws-kit/core/internal`:

```typescript
// @ws-kit/core/internal.ts

export interface ContextEnhancer<TContext = unknown> {
  (ctx: MinimalContext<TContext>): void | Promise<void>;
}

export interface RouterPluginAPI<TContext = unknown> {
  /**
   * Read-only view of registered message types and schemas.
   * Populated immediately on router.on() / router.rpc()
   */
  getRouteRegistry(): ReadonlyMap<string, { schema?: unknown }>;

  /**
   * Register a context enhancer. Runs in priority order, then registration order.
   * @param enhancer - Pure function that mutates/extends ctx
   * @param opts.priority - Lower runs first (default 0)
   */
  addContextEnhancer(
    enhancer: ContextEnhancer<TContext>,
    opts?: { priority?: number },
  ): void;

  /**
   * Access lifecycle for error handling, hooks, etc.
   * (Advanced; document sparingly)
   */
  getLifecycle(): {
    handleError(err: unknown, ctx: MinimalContext<TContext>): Promise<void>;
  };
}

/**
 * Get the plugin API for a router. Replaces direct symbol access.
 * @throws If plugin API is not available (version mismatch or bundler issue)
 */
export function getRouterPluginAPI<TContext = unknown>(
  router: Router<TContext, any>,
): RouterPluginAPI<TContext> {
  const impl = (router as any)[ROUTER_IMPL];
  if (!impl) {
    throw new Error(
      "[ws-kit] Router plugin API not available. " +
        "This may indicate a version mismatch or bundler issue.",
    );
  }
  return impl as RouterPluginAPI<TContext>;
}

/**
 * Helper to extract extension by name with type safety
 */
export function getContextExtension<T>(
  ctx: MinimalContext,
  name: string,
): T | undefined {
  return ctx.extensions.get(name) as T | undefined;
}
```

**Benefits**:

- ✅ **Type-safe**: No casting, compile-time checks
- ✅ **Stable contract**: Plugins depend on interface, not full RouterImpl shape
- ✅ **Forwards-compatible**: RouterImpl can evolve without breaking plugins
- ✅ **Testable**: Easy to mock or provide test implementations

---

### 2. Enhancer Chain (Fixes Composition)

Core owns an **array of enhancers**; plugins register, not overwrite.

**In RouterImpl**:

```typescript
interface EnhancerEntry {
  fn: ContextEnhancer;
  priority: number;
  order: number;
}

export class RouterImpl<TContext = unknown> {
  private enhancers: EnhancerEntry[] = [];
  private nextOrder = 0;

  addContextEnhancer(
    enhancer: ContextEnhancer<TContext>,
    opts?: { priority?: number },
  ): void {
    this.enhancers.push({
      fn: enhancer,
      priority: opts?.priority ?? 0,
      order: this.nextOrder++,
    });
  }

  private getSortedEnhancers(): ContextEnhancer<TContext>[] {
    return this.enhancers
      .sort((a, b) => a.priority - b.priority || a.order - b.order)
      .map((e) => e.fn);
  }

  private async createContext(
    ws: WebSocket,
    raw: unknown,
    data?: TContext,
  ): Promise<MinimalContext<TContext>> {
    // Base context
    const ctx: MinimalContext<TContext> = {
      type: (raw as any).type,
      payload: (raw as any).payload,
      ws,
      data: data ?? ({} as TContext),
      extensions: new Map(),
    };

    // Run enhancers in priority order, with conflict detection
    const prevKeys = new Set(Object.keys(ctx));
    for (const enhance of this.getSortedEnhancers()) {
      try {
        await enhance(ctx);
      } catch (err) {
        // Route to lifecycle, fail message (not router)
        await this.lifecycle.handleError(err, ctx);
        throw err;
      }

      // Conflict detection (dev mode only)
      if (process.env.NODE_ENV !== "production") {
        const newKeys = Object.keys(ctx);
        const overwrites = newKeys.filter(
          (k) => prevKeys.has(k) && k !== "extensions",
        );
        if (overwrites.length > 0) {
          console.warn(
            `[ws-kit] Enhancer overwrote ctx properties: ${overwrites.join(", ")}. ` +
              `Consider using ctx.extensions for plugin-specific data.`,
          );
        }
      }
    }

    return ctx;
  }
}
```

**Benefits**:

- ✅ **Composable**: All enhancers run; no overwrites
- ✅ **Predictable**: Sequential order = deterministic behavior
- ✅ **Safe**: Conflict detection in dev mode prevents silent issues
- ✅ **Powerful**: Priorities allow advanced ordering without DAG complexity

---

### 3. Context Stashing (Unifies Namespace)

Add `extensions: Map<string, unknown>` to `MinimalContext`:

```typescript
// @ws-kit/core/types.ts

export interface MinimalContext<TData = unknown> {
  type: string;
  payload: unknown;
  ws: WebSocket;
  data: TData;

  // New: Plugin-safe namespace
  extensions: Map<string, unknown>;
}

// Helper for type-safe access
export function getContextExtension<T>(
  ctx: MinimalContext,
  name: string,
): T | undefined {
  return ctx.extensions.get(name) as T | undefined;
}
```

**Usage in plugins**:

```typescript
internals.addContextEnhancer((ctx) => {
  const zodExt = {
    reply: async (payload) => {
      /* ... */
    },
    send: async (schema, payload) => {
      /* ... */
    },
  };
  ctx.extensions.set("zod", zodExt);
});

internals.addContextEnhancer((ctx) => {
  const zodExt = getContextExtension(ctx, "zod");
  const pubsubExt = {
    publish: (topic, msg) => {
      /* ... */
    },
  };
  ctx.extensions.set("pubsub", pubsubExt);
});
```

**Benefits**:

- ✅ **Collision-proof**: Each plugin has its own namespace
- ✅ **Type-safe**: Helper enforces named access
- ✅ **Composable**: Plugins can read others' extensions
- ✅ **Clean semantics**: Map is idiomatic for registries

---

### 4. Validation Behavior (Explicit, Env-Aware)

The `withZod` plugin gets explicit `missingSchema` control:

```typescript
export interface WithZodOptions {
  validateOutgoing?: boolean;
  missingSchema?: "skip" | "warn" | "error";
}

export function withZod(options?: WithZodOptions) {
  const missingSchema =
    options?.missingSchema ??
    (process.env.NODE_ENV === "production" ? "error" : "warn");

  return definePlugin((router) => {
    const internals = getRouterPluginAPI(router);
    const warnedTypes = new Set<string>();

    router.use(async (ctx, next) => {
      const routeIndex = internals.getRouteRegistry();
      const schemaInfo = routeIndex.get(ctx.type);

      if (!schemaInfo) {
        if (missingSchema === "error") {
          throw new Error(
            `[zod] No schema for message type "${ctx.type}". ` +
              `Register via router.on(message("${ctx.type}", {...}), handler).`,
          );
        }

        if (missingSchema === "warn" && !warnedTypes.has(ctx.type)) {
          warnedTypes.add(ctx.type);
          console.warn(
            `[zod] Skipping validation for unregistered type "${ctx.type}". ` +
              `Consider adding a schema for full safety.`,
          );
        }

        return next();
      }

      // Validate and enrich ctx.payload
      // ...
      await next();
    });

    // Add context enhancements (ctx.send, ctx.reply, etc.)
    internals.addContextEnhancer(
      (ctx) => {
        const zodExt = {
          reply: async (payload) => {
            /* ... */
          },
          send: async (schema, payload) => {
            /* ... */
          },
          progress: async (update) => {
            /* ... */
          },
        };
        ctx.extensions.set("zod", zodExt);

        // Optional: expose directly on ctx (warns if overwrite)
        ctx.send ??= zodExt.send;
        ctx.reply ??= zodExt.reply;
        ctx.progress ??= zodExt.progress;
      },
      { priority: -100 },
    ); // Run first
  });
}
```

**Defaults**:

- **Development**: `"warn"` — nudges developers but doesn't break
- **Production**: `"error"` — fail-fast for safety

**Benefits**:

- ✅ **Safe by default in production**
- ✅ **DX-friendly in development**
- ✅ **Explicit**: User can override if needed
- ✅ **Symmetric**: Applies to both inbound and outbound

---

### 5. Plugin Dependencies (Manual + Light Validation)

**Docs recommendation**: Order plugins manually; advanced users can use `priority`.

```typescript
// Order matters
const router = createRouter()
  .plugin(withZod({ missingSchema: "error" })) // Validation first
  .plugin(mockWithPubSub()) // Depends on Zod
  .plugin(customTelemetryPlugin()); // Optional

// Advanced: use priority
internals.addContextEnhancer(validateFn, { priority: -100 }); // First
internals.addContextEnhancer(enrichFn, { priority: 0 }); // Middle
internals.addContextEnhancer(logFn, { priority: 100 }); // Last
```

**Init-time check** (optional): If a plugin declares `requires`, verify at init:

```typescript
// Future: plugin metadata
definePlugin(
  (router) => {
    /* ... */
  },
  { requires: ["zod"] },
);

// At init, if 'zod' enhancer not registered, throw clear error
```

**Benefits**:

- ✅ **Simple**: No complex DAG machinery
- ✅ **Powerful**: Priorities enable advanced scenarios
- ✅ **Safe**: Docs + validation catch common mistakes

---

### 6. Error Handling (Per-Message, Not Per-Router)

Enhancers run during `createContext()`, which is called per-message.

```typescript
// In RouterImpl.createContext()
for (const enhance of this.getSortedEnhancers()) {
  try {
    await enhance(ctx);
  } catch (err) {
    // Route to lifecycle, fail message, don't crash router
    await this.lifecycle.handleError(err, ctx);
    throw err; // Re-throw for caller handling
  }
}
```

**Semantics**:

- 🛡️ **Router stays alive**: One enhancer error doesn't crash the whole server
- 📊 **Observable**: Error routed to `lifecycle.handleError` for logging, metrics
- 🧪 **Testable**: Easy to inject mock lifecycle or test error paths

---

### 7. Route Index Timing (Explicit)

Routes are populated immediately on `router.on()` / `router.rpc()`.

**For lazy-loaded routes**, call `router.finalizeRoutes()` before `listen()`:

```typescript
const router = createRouter().plugin(withZod({ missingSchema: 'error' }));

// Register all static routes
router.on(PingMessage, ...);
router.on(EchoMessage, ...);

// If routes are lazy-loaded, finalize after all plugins/modules loaded
await router.finalizeRoutes({ strict: true });

// Now safe to listen
router.listen({ port: 3000 });
```

**Semantics**:

- ✅ **Immediate**: Most use cases (static routes) work out of the box
- ✅ **Explicit**: Lazy routes opt into finalization
- ✅ **Safe**: Strict mode catches missing schemas before accepting frames

---

## Backwards Compatibility

### v1.x (Current → Next Minor)

- Symbol access (`ROUTER_IMPL`) still works but **warns**:
  ```
  [ws-kit] Direct ROUTER_IMPL access is deprecated.
  Use getRouterPluginAPI(router) instead.
  Symbol access will be removed in v2.0.
  ```
- Auto-bridge: Old plugins still function via shim
- **Migration**: Plugin authors update to `getRouterPluginAPI()`

### v2.0 (Next Major)

- Symbol removed entirely
- Plugins **must** use `getRouterPluginAPI()`
- Clear migration guide provided

**Migration Example**:

```typescript
// OLD (v1.x)
const routerImpl = (router as any)[ROUTER_IMPL];
const originalCreateContext = routerImpl.createContext.bind(routerImpl);

// NEW (v1.x+ / v2.0)
const internals = getRouterPluginAPI(router);
const routeIndex = internals.getRouteRegistry();
internals.addContextEnhancer((ctx) => {
  /* ... */
});
```

---

## Examples

### Single Plugin (withZod)

```typescript
const router = createRouter().plugin(withZod({ missingSchema: "error" }));

router.on(PingMessage, (ctx) => {
  const { reply } = getContextExtension(ctx, "zod") ?? {};
  await reply({ message: "pong" });
});
```

### Multi-Plugin Composition (Zod + PubSub)

```typescript
const router = createRouter()
  .plugin(withZod({ missingSchema: "error" })) // -100 priority
  .plugin(withPubSub({ adapter: redisPubSub() })); // 0 priority

router.on(PostCreated, (ctx) => {
  const { reply } = getContextExtension(ctx, "zod") ?? {};
  const { publish } = getContextExtension(ctx, "pubsub") ?? {};

  await publish("feed", UpdateFeed, { post: ctx.payload });
  await reply({ ok: true });
});
```

### Priority-Based Enhancer (Advanced)

```typescript
const internals = getRouterPluginAPI(router);

// Validation/parsing (runs first)
internals.addContextEnhancer(parsePayload, { priority: -100 });

// Domain logic (runs second)
internals.addContextEnhancer(enrichContext, { priority: 0 });

// Observability (runs last)
internals.addContextEnhancer(addTracing, { priority: 100 });
```

---

## Implementation Roadmap

| Phase     | Task                                                      | Time    |
| --------- | --------------------------------------------------------- | ------- |
| 1         | Create ADR-024 doc + finalize decisions                   | 30m     |
| 2         | Add types: `RouterPluginAPI`, `MinimalContext.extensions` | 20m     |
| 3         | Implement enhancer chain in RouterImpl                    | 40m     |
| 4         | Migrate `withZod` + `withValibot`                         | 40m     |
| 5         | Write multi-plugin composition tests                      | 1h      |
| 6         | Add backwards compat bridge (deprecation warnings)        | 20m     |
| 7         | Update docs: "Plugin Author Guide" + examples             | 30m     |
| **Total** |                                                           | **~4h** |

---

## Rationale

### Why This Approach?

1. **Minimalism**: No DI framework, no DAG engine—just array + Map
2. **Safety**: Typed contract + conflict detection + env-aware defaults
3. **Power**: Priorities + extensions for advanced scenarios
4. **DX**: Flat learning curve; feels familiar (inspired by Fastify, tRPC)
5. **Testability**: Enhancers are pure functions; easy to mock or stub

### Why Not Alternatives?

- **Full DI/Dependency Graph**: Over-engineered; priorities + manual ordering sufficient
- **Plugin `requires[]` declarations**: Keep simple; light validation catches issues at init
- **WeakMap for stashing**: Map is clearer and doesn't constrain key types
- **Hard-coded validation mode**: Env-aware defaults are safer without surprise config

---

## Testing Strategy

### Composition Test (Multi-Plugin)

```typescript
it("composes Zod + PubSub without method loss", async () => {
  const router = createRouter().plugin(withZod()).plugin(mockWithPubSub());

  const ctx = createTestContext(router);

  // Both plugins' methods present
  expect(getContextExtension(ctx, "zod")).toBeDefined();
  expect(getContextExtension(ctx, "pubsub")).toBeDefined();
});
```

### Conflict Detection (Dev Mode)

```typescript
it("warns on property overwrites in dev mode", async () => {
  process.env.NODE_ENV = "development";
  const warns = [];
  console.warn = (...args) => warns.push(args[0]);

  const internals = getRouterPluginAPI(router);
  internals.addContextEnhancer((ctx) => {
    ctx.send = async () => {};
  });
  internals.addContextEnhancer((ctx) => {
    ctx.send = async () => {};
  });

  createTestContext(router);
  expect(warns.some((w) => w.includes("overwrote"))).toBe(true);
});
```

### Priority Ordering

```typescript
it("respects enhancer priority", async () => {
  const order = [];
  const internals = getRouterPluginAPI(router);

  internals.addContextEnhancer(() => order.push("low"), { priority: 0 });
  internals.addContextEnhancer(() => order.push("high"), { priority: -100 });

  createTestContext(router);
  expect(order).toEqual(["high", "low"]);
});
```

### Error Routing

```typescript
it("routes enhancer errors to lifecycle.handleError", async () => {
  const errors: any[] = [];
  const router = createRouter();
  router.on("lifecycle:error", (err) => errors.push(err));

  const internals = getRouterPluginAPI(router);
  internals.addContextEnhancer(() => {
    throw new Error("Enhancement failed");
  });

  expect(() => createTestContext(router)).toThrow();
  expect(errors.length).toBeGreaterThan(0);
});
```

---

## Migration Path for Existing Plugins

### `@ws-kit/zod` (and similar validators)

**Before**:

```typescript
const routerImpl = (router as any)[ROUTER_IMPL];
const originalCreateContext = routerImpl.createContext.bind(routerImpl);
routerImpl.createContext = async (...args) => {
  const ctx = await originalCreateContext(...args);
  ctx.send = async (schema, payload) => {
    /* ... */
  };
  return ctx;
};
```

**After**:

```typescript
const internals = getRouterPluginAPI(router);
internals.addContextEnhancer(
  (ctx) => {
    ctx.extensions.set("zod", {
      send: async (schema, payload) => {
        /* ... */
      },
    });
  },
  { priority: -100 },
);
```

**Benefits for plugin authors**:

- ✅ No casting or symbol dependencies
- ✅ Type-safe (TS checks method signatures)
- ✅ Composable (doesn't break other plugins)
- ✅ Testable (pure functions)

---

## Future Considerations

1. **Plugin Metadata**: Optional `requires: ['zod']` for explicit deps
2. **Lifecycle Hooks**: `onEnhancerRegistered`, `onContextCreated` for observability
3. **Performance Monitoring**: Built-in timing for enhancer chains
4. **Plugin Registry**: Central place to discover/validate community plugins

These are out of scope for this proposal but enabled by the architecture.

---

## Open Questions / Decisions Checklist

- [x] Enhancer conflicts: Warn on direct overwrites, require Map for stashing
- [x] Plugin ordering: Manual + optional priority, no DAG
- [x] Context stashing: Core-provided Map, not ad-hoc `__wskit`
- [x] Validation defaults: Env-aware ("warn" dev, "error" prod)
- [x] Backwards compat: v1.x warns, v2.0 breaks
- [x] Enhancer errors: Per-message fail via lifecycle, not per-router crash
- [x] Route index timing: Immediate populate, optional finalization
- [x] PubSub migration: Use same enhancer pattern (separate PR)

---

**Status**: Ready for implementation (Phase 1: Types → Phase 7: Docs)
