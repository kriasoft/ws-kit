# Plugin Architecture: Strategic Rationale

**Status**: ✅ Implemented (2025-11-13)

**See Also**:

- [ADR-028: Plugin Architecture - Final Design](../adr/028-plugin-architecture-final-design.md) — Implementation record
- [Plugin Author Guide](../plugin-author-guide.md) — Usage patterns and examples
- Implementation: [commit ea7a80e](https://github.com/kriasoft/ws-kit/commit/ea7a80e3fdfcd19d7b579e885bd9384ee2c90d5b)

---

## Executive Summary

This document captures the strategic and technical rationale for the plugin architecture design. It evaluates three alternative approaches and explains why the selected design was chosen to solve the type system coupling problem.

**Key Insight**: Decouple capability tracking (runtime concern) from API widening (type-level concern).

**Result**:

- Minimal core type (`Router<TContext, TExtensions>`)
- Type-safe plugin definition via `definePlugin()`
- Composable plugins with natural type inference
- Optional semantic layer for teams that want it

For implementation details, refer to ADR-028. For usage patterns, see the Plugin Author Guide.

---

## Problem: Type System Coupling

The router type tries to do two things simultaneously using a single generic parameter `TCapabilities`:

1. **Runtime tracking**: "What capabilities does this router instance have?"
2. **Type-level API**: "What methods are available on this type?"

This coupling is the root cause of complexity and brittleness.

```typescript
// Current design: tightly coupled
export type Router<
  TContext extends ConnectionData = ConnectionData,
  TCapabilities = Record<string, never>,
> = RouterCore<TContext> &
  (TCapabilities extends { validation: true }
    ? ValidationAPI<TContext>
    : Record<string, never>) &
  (TCapabilities extends { pubsub: true }
    ? PubSubAPI<TContext>
    : Record<string, never>);
```

**Problems with this approach:**

- **Open/Closed Violation**: Adding capability requires editing core Router type
- **Weak Third-Party Story**: External plugins can't reliably widen without module augmentation or casts
- **Type-Runtime Sync Issues**: Plugin declares flag in `__caps`, but TypeScript can't verify implementation completeness
- **Cognitive Load**: Flags are a leaky abstraction—users see `TCapabilities` in the public API
- **O(n) Conditionals**: Each new capability adds another conditional, degrading IDE performance
- **Safety Illusion**: Casts (`as Router<TContext, { validation: true }>`) give false confidence; no enforcement of API completeness

---

## Comparison: Evaluating Alternatives

Three different design approaches were evaluated. All agree on core principles but diverge on semantic layer strategy.

### Common Ground

All proposals agree:

1. **Current approach is over-complex** for what it delivers
2. **Flags (`TCapabilities`) shouldn't be part of the public type**
3. **Plugins should widen structurally**, not via conditional type gymnastics
4. **Capability tracking is runtime concern**, not type-level
5. **Third-party plugin story needs improvement**

### The Three Approaches

| Aspect                | Hybrid Registry         | Refined Extensions        | **Final Form** (Selected)            |
| --------------------- | ----------------------- | ------------------------- | ------------------------------------ |
| Core Type Complexity  | High (mapped types)     | Low (pure union)          | **Low (pure union)**                 |
| Third-Party Support   | Medium (augment)        | Medium (definePlugin)     | **Medium (definePlugin + optional)** |
| Type Safety           | Medium (cast-dependent) | High (generic constraint) | **High (generic constraint)**        |
| Semantic Capabilities | Yes                     | No                        | **Optional (separate layer)**        |
| Runtime Tracking      | Via `__caps`            | Via `Set<string>`         | **Via `Set<string>`**                |
| IDE Performance       | Degrades (mapped types) | Excellent                 | **Excellent**                        |
| Principle Alignment   | Medium                  | Good                      | **Excellent**                        |

### Why Final Form Was Selected

The selected design ("Final Form") combines the best of both approaches:

- **Core simplicity** of Refined Extensions (no complex mapped types)
- **Optional power** of Hybrid Registry (semantic layer available if needed)
- **Pragmatic runtime tracking** instead of type-level flags
- **Excellent IDE performance** with predictable type inference
- **Minimal public API** exposing only what's necessary

---

## Recommended Solution: Extensions-Only Core + Optional Registry

This approach combines the best of all proposals: **minimal core, optional power, extensible design**.

### Core Types (Minimal Public API)

```typescript
/**
 * Router type: no TCapabilities, no conditionals, no flags.
 * Pure structural composition: RouterCore + TExtensions.
 */
export type Router<
  TContext extends ConnectionData = ConnectionData,
  TExtensions = {},
> = RouterCore<TContext> & TExtensions;

/**
 * Plugin type: take a Router, return a Router with extended API.
 * Generic is open—third parties can extend freely.
 */
export type Plugin<
  TContext extends ConnectionData = ConnectionData,
  TPluginApi extends object = {},
> = <TCurrentExt extends object>(
  router: Router<TContext, TCurrentExt>,
) => Router<TContext, TCurrentExt & TPluginApi>;
```

### Plugin Helper: Type-Safe Definition

```typescript
/**
 * Helper to define a plugin with compile-time validation.
 * Enforces that the impl function returns the full TPluginApi.
 */
export function definePlugin<
  TContext extends ConnectionData,
  TPluginApi extends object,
>(
  build: (router: Router<TContext, any>) => TPluginApi,
): Plugin<TContext, TPluginApi> {
  return <TCurrentExt extends object>(
    router: Router<TContext, TCurrentExt>,
  ) => {
    const extensions = build(router);
    return { ...router, ...extensions };
  };
}
```

**Why this works:**

- TypeScript enforces that `build()` returns all properties of `TPluginApi`
- No casts; spread syntax allows TS to infer `Router<TContext, TCurrentExt & TPluginApi>` safely
- Composable: each `plugin()` call returns `Router<TContext, TCurrentExt & NewApi>`
- Static safety: mismatches between `build()` return and `TPluginApi` caught at compile-time, not runtime

### Example: Validation Plugin

```typescript
export interface ValidationAPI<
  TContext extends ConnectionData = ConnectionData,
> {
  rpc(
    schema: MessageDescriptor & { response: MessageDescriptor },
    handler: any,
  ): Router<TContext, any>;
}

export const withValidation = definePlugin<any, ValidationAPI<any>>(
  (router) => ({
    rpc(schema, handler) {
      // Implementation: wire middleware, validation, etc.
      router.on(schema, /* wrapped handler */ handler);
      return router;
    },
  }),
);
```

### Example: Pub/Sub Plugin

```typescript
export interface PubSubAPI<TContext extends ConnectionData = ConnectionData> {
  publish(
    topic: string,
    schema: MessageDescriptor,
    payload: unknown,
    opts?: PublishOptions,
  ): Promise<PublishResult>;

  topics: {
    list(): readonly string[];
    has(topic: string): boolean;
  };
}

export const withPubSub = definePlugin<any, PubSubAPI<any>>((router) => {
  const adapter = createPubSubAdapter();

  return {
    async publish(topic, schema, payload, opts) {
      // Implementation
      return { ok: true, capability: "exact", matched: 3 };
    },
    topics: {
      list() {
        return [...adapter.topics()];
      },
      has(topic) {
        return adapter.hasTopic(topic);
      },
    },
  };
});
```

### User-Facing API (Simple & Clear)

```typescript
const router = createRouter<MyContext>()
  .plugin(withValidation) // Router<MyContext, ValidationAPI<MyContext>>
  .plugin(withPubSub); // Router<MyContext, ValidationAPI & PubSubAPI>

// Full API, type-inferred:
router.on(Join, handler);
router.rpc(GetUser, handler);
await router.publish("room:1", Message, { text: "hi" });
```

**Benefits:**

- ✅ No `TCapabilities` in user code
- ✅ No conditional types to understand
- ✅ Type inference is predictable
- ✅ Third-party plugins just implement `definePlugin`

---

## Runtime Capability Tracking (Moved to PluginHost)

Capabilities are runtime-only, tracked in `RouterPluginHost`:

```typescript
/**
 * Public interface for PluginHost: exposes only capability queries.
 * For plugin authors to check dependencies at runtime.
 */
export interface PublicPluginHost {
  /**
   * Check if a capability is available at runtime.
   */
  hasCapability(name: string): boolean;

  /**
   * List all applied capabilities.
   */
  listCapabilities(): readonly string[];
}

/**
 * Internal plugin host (not exposed publicly).
 * Manages plugin application and capability tracking.
 */
export class RouterPluginHost<TContext extends ConnectionData = ConnectionData>
  implements PublicPluginHost
{
  private readonly applied = new WeakSet<Function>();
  private readonly capabilities = new Set<string>();

  constructor(private readonly router: Router<TContext, any>) {}

  /**
   * Apply a plugin with idempotency check.
   * Optionally register a capability name for runtime queries.
   */
  apply<P extends Plugin<TContext, any>>(
    plugin: P,
    capabilityName?: string,
  ): ReturnType<P> {
    if (this.applied.has(plugin)) {
      return this.router as unknown as ReturnType<P>;
    }

    this.applied.add(plugin);
    const result = plugin(this.router);

    if (capabilityName) {
      this.capabilities.add(capabilityName);
    }

    return result as unknown as ReturnType<P>;
  }

  /**
   * Check if a capability is available at runtime.
   */
  hasCapability(name: string): boolean {
    return this.capabilities.has(name);
  }

  /**
   * List all applied capabilities.
   */
  listCapabilities(): readonly string[] {
    return [...this.capabilities];
  }
}
```

**Public PluginHost Access (for plugin authors):**

```typescript
/**
 * Router implementation includes a public pluginHost getter.
 * Exposes only the public interface (hasCapability, listCapabilities).
 */
export class Router<TContext extends ConnectionData, TExtensions> {
  private readonly internalPluginHost: RouterPluginHost<TContext>;

  /**
   * Public access to plugin capability queries.
   * For use in plugins that depend on other plugins.
   */
  get pluginHost(): PublicPluginHost {
    return this.internalPluginHost;
  }
}
```

**Usage in plugins with dependencies:**

```typescript
export const withAdvancedPubSub = definePlugin<any, AdvancedPubSubAPI>(
  (router) => {
    // Simple, direct access to check dependencies
    if (!router.pluginHost.hasCapability("pubsub")) {
      throw new Error(
        "withAdvancedPubSub requires withPubSub() to be applied first",
      );
    }

    return {
      // Advanced methods...
    };
  },
);
```

---

## Plugin Author Patterns: Handling Dependencies

Runtime checks are pragmatic, but plugins often have strict ordering requirements. For enforced composition, use **wrapper plugins** (higher-order plugin functions) to build dependency chains at definition time.

### Pattern: Composable Wrapper Plugins

When your plugin depends on another, export a wrapper that enforces order:

```typescript
/**
 * Base pub/sub plugin (does core work)
 */
export const withPubSub = definePlugin<any, PubSubAPI<any>>((router) => {
  const adapter = createPubSubAdapter();
  return {
    async publish(topic, schema, payload, opts) {
      return { ok: true, capability: "exact", matched: 3 };
    },
    topics: {
      list() {
        return [...adapter.topics()];
      },
      has(topic) {
        return adapter.hasTopic(topic);
      },
    },
  };
});

/**
 * Advanced pub/sub: wraps base, ensures it's applied first
 */
export function withAdvancedPubSub<TContext extends ConnectionData>(
  base: typeof withPubSub = withPubSub,
) {
  return definePlugin<TContext, AdvancedPubSubAPI<TContext>>((router) => {
    // Apply base plugin first (enforced composition)
    const routerWithBase = base(router);

    // Now add advanced features on top
    return {
      async publishBatch(payloads) {
        // Implementation: relies on routerWithBase.publish internally
        return payloads.length;
      },
      async retryFailedPublish(topic, maxAttempts) {
        // Advanced feature, depends on base pub/sub existing
        return true;
      },
    };
  });
}
```

**Usage (enforced order):**

```typescript
const router = createRouter<MyContext>()
  .plugin(withValidation)
  .plugin(withAdvancedPubSub());  // Base is applied automatically

// Or customize base:
.plugin(withAdvancedPubSub(customPubSubPlugin));
```

### Pattern: Optional Dependency with Runtime Fallback

If your plugin can work with _or_ without a dependency, check at runtime:

```typescript
export const withMetrics = definePlugin<any, MetricsAPI<any>>((router) => {
  // Check if pub/sub is available
  const hasPubSub = router.pluginHost.hasCapability("pubsub");

  return {
    trackEvent(event, meta) {
      // Metrics work standalone
      recordEvent(event, meta);

      // But enhanced if pub/sub is available
      if (hasPubSub) {
        router.publish?.("__metrics", MetricsEvent, {
          event,
          timestamp: Date.now(),
          meta,
        });
      }
    },
  };
});
```

### Benefits of Wrapper Pattern

- ✅ **Type-safe composition**: Dependencies resolved at definition time
- ✅ **Hard to misuse**: Forgetting the base plugin is caught at runtime immediately, not silently wrong
- ✅ **Composable chains**: Build complex features incrementally
- ✅ **Self-documenting**: Wrapper signature shows intent

### When to Use

- **Wrapper pattern**: Plugin has strict dependency; order matters
- **Runtime check**: Plugin is optional or works in degraded mode

---

## Optional: Semantic Capability Types (Advanced)

For teams that want type-level capability semantics, add a _separate_ optional helper—not in the core Router type:

```typescript
/**
 * Registry mapping capability names to their APIs (for type-level helpers only).
 * Third-party plugins can augment this via module augmentation.
 */
export interface RouterCapabilityAPIs<
  TContext extends ConnectionData = ConnectionData,
> {
  validation: ValidationAPI<TContext>;
  pubsub: PubSubAPI<TContext>;
  // Third parties augment:
  // metrics: MetricsAPI<TContext>;
  // auth: AuthAPI<TContext>;
}

/**
 * Type alias for "a router with specific named capabilities."
 * Optional helper—users can use directly or ignore.
 */
export type RouterWithCapabilities<
  TContext extends ConnectionData,
  TCapabilities extends readonly (keyof RouterCapabilityAPIs<TContext>)[],
> = Router<
  TContext,
  UnionToIntersection<
    {
      [K in TCapabilities[number]]: RouterCapabilityAPIs<TContext>[K];
    }[TCapabilities[number]]
  >
>;
```

**Usage (optional, for advanced type documentation):**

```typescript
type AppRouter = RouterWithCapabilities<MyContext, ["validation", "pubsub"]>;

const router: AppRouter = createRouter<MyContext>()
  .plugin(withValidation)
  .plugin(withPubSub);
```

**Benefits of this approach:**

- Core Router type stays minimal
- Teams that want semantic types can opt-in
- Third-party plugins augment the registry if desired
- No breaking changes to existing code

---

## Naming Conventions

See code comments and JSDoc in `packages/core/src/plugin/` for naming rationale and conventions used throughout the implementation (TExtensions, TPluginApi, PublicPluginHost, RouterPluginHost, etc.).

---

## Implementation Status

**✅ Fully Implemented** (2025-11-13)

This design has been fully implemented across all 5 phases:

1. ✅ **Phase 1**: Core type simplification (`Router<TContext, TExtensions>`)
2. ✅ **Phase 2**: Plugin migration (`withZod`, `withValibot`, `withPubSub`)
3. ✅ **Phase 3**: Optional semantic layer (`RouterCapabilityAPIs`, `RouterWithCapabilities`)
4. ✅ **Phase 4**: Comprehensive testing (23+ tests, 100% pass rate)
5. ✅ **Phase 5**: Documentation (ADR-028, Plugin Author Guide)

See [ADR-028: Plugin Architecture - Final Design](../adr/028-plugin-architecture-final-design.md) for implementation details and [Plugin Author Guide](../plugin-author-guide.md) for usage.

---

## References

- **Implementation Record**: [ADR-028: Plugin Architecture - Final Design](../adr/028-plugin-architecture-final-design.md)
- **Usage Guide**: [Plugin Author Guide](../plugin-author-guide.md)
- **Source Code**: `packages/core/src/plugin/`
- **Tests**: `packages/core/test/features/plugin-*.test.ts`
- **Built-In Plugins**: `packages/zod/src/plugin.ts`, `packages/pubsub/src/plugin.ts`, `packages/valibot/src/plugin.ts`
