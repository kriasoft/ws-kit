# ADR-028: Plugin Architecture - Final Design

**Status**: Accepted
**Date**: 2025-11-13
**References**: ADR-025 (Validator Plugins), ADR-026 (Internal Router Access)

## Context

The router's capability system evolved through several iterations to solve the tension between:

1. **Type-level API gating** — TypeScript should enforce available methods
2. **Runtime capability tracking** — Plugins should declare what they add
3. **Third-party extensibility** — External plugins should work without core changes
4. **Simplicity** — Users shouldn't see complexity flags in their code

Early designs used conditional types gated on a `TCapabilities` flag in the public Router type, which created problems:

- **Open/Closed Violation**: Adding capability required editing the core Router type
- **Weak Third-Party Story**: External plugins couldn't widen types reliably
- **Type-Runtime Sync Issues**: Capability flags in `__caps` weren't verified at compile-time
- **Cognitive Load**: Public API exposed internal implementation details (flags)
- **Performance**: Each capability added O(n) conditional types, degrading IDE performance
- **Safety Illusion**: Casts gave false confidence without enforcement

## Decision

The plugin architecture is split into two independent layers:

### 1. **Core Type Simplification** (Type-Level Only)

The public `Router<TContext, TExtensions>` type is:

- Pure structural composition (no conditionals, no flags)
- Extended via `TExtensions` generic parameter
- Widened naturally by `.plugin()` chaining

**Benefits**:

- ✅ Minimal, clear public API
- ✅ IDE performance (no complex mapped types)
- ✅ Type inference is predictable
- ✅ Hard to misuse (structure enforced by TypeScript)

### 2. **Plugin System** (Type-Safe Plugin Definition)

Plugin authors use `definePlugin<TContext, TPluginApi>()` to:

- Declare the API their plugin provides (`TPluginApi` interface)
- Return an object matching that interface
- Let TypeScript verify completeness at compile-time

**Benefits**:

- ✅ Type safety without casts
- ✅ Clear plugin intent
- ✅ Composable: multiple plugins naturally intersect in type
- ✅ Works across bundle boundaries

### 3. **Runtime Capability Tracking** (Optional, For Feature Detection)

The `PluginHost` class tracks applied plugins:

- `router.pluginHost.hasCapability(name)` — runtime checks
- `router.pluginHost.listCapabilities()` — introspection
- Idempotency: same plugin applied twice is a no-op

**Benefits**:

- ✅ Pragmatic for runtime feature detection
- ✅ Plugins can check dependencies at startup
- ✅ No type-level coupling required
- ✅ Optional (not required for plugin system to work)

### 4. **Optional Semantic Layer** (Documentation Hints, Not Required)

For teams that want semantic capability names at the type level:

```typescript
import type { RouterWithCapabilities } from "@ws-kit/core/plugin";

type AppRouter = RouterWithCapabilities<MyContext, ["validation", "pubsub"]>;
```

- **NOT** required for plugins to work
- **NOT** inferred from `.plugin()` calls (manual annotation only)
- **IS** a clear documentation tool
- **CAN** be augmented by third parties via module augmentation

**Benefits**:

- ✅ Optional power for advanced users
- ✅ IDE autocomplete for capability names
- ✅ Zero cost if unused
- ✅ Extensible via module augmentation

## Architecture

### Core Types

```typescript
// Minimal public router type (no TCapabilities, no conditionals)
export type Router<
  TContext extends ConnectionData = ConnectionData,
  TExtensions extends object = {},
> = RouterCore<TContext> & TExtensions;

// Plugin type (pure function that widens router)
export type Plugin<
  TContext extends ConnectionData = ConnectionData,
  TPluginApi extends object = {},
> = <TCurrentExt extends object>(
  router: Router<TContext, TCurrentExt>,
) => Router<TContext, TCurrentExt & TPluginApi>;
```

### Plugin Definition Helper

```typescript
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

    // Dev-mode warning for property collisions
    if (process.env?.NODE_ENV !== "production") {
      for (const key of Object.keys(extensions)) {
        if (key in router) {
          console.warn(
            `[definePlugin] Plugin overwrites existing router property: "${key}"`,
          );
        }
      }
    }

    // Merge extensions into router
    return Object.assign(router, extensions) as Router<
      TContext,
      TCurrentExt & TPluginApi
    >;
  };
}
```

### Runtime Capability Tracking

```typescript
export interface PublicPluginHost {
  hasCapability(name: string): boolean;
  listCapabilities(): readonly string[];
}

export class PluginHost<TContext extends ConnectionData> {
  private readonly applied = new WeakSet<Function>();
  private capabilities: Capabilities = {};

  apply<P extends Plugin<TContext, any>>(
    plugin: P,
    capabilityName?: string,
  ): ReturnType<P> {
    if (this.applied.has(plugin)) {
      return this.router as unknown as ReturnType<P>;
    }

    this.applied.add(plugin);
    const result = plugin(this.router);

    // Track capability if provided
    const caps = (result as any).__caps as Capabilities | undefined;
    if (caps) {
      Object.assign(this.capabilities, caps);
    }

    return result as unknown as ReturnType<P>;
  }

  hasCapability(name: string): boolean {
    return this.capabilities[name as keyof Capabilities] === true;
  }

  listCapabilities(): readonly string[] {
    return Object.keys(this.capabilities).filter(
      (k) => this.capabilities[k as keyof Capabilities] === true,
    );
  }
}
```

### Optional Semantic Layer

```typescript
/**
 * Registry of capability names to their APIs.
 * Core capabilities: validation, pubsub
 * Can be augmented by third parties via module augmentation.
 */
export interface RouterCapabilityAPIs<
  TContext extends ConnectionData = ConnectionData,
> {
  validation: ValidationAPI<TContext>;
  pubsub: PubSubAPI<TContext>;
}

// Type-safe capability composition (optional, manual annotation only)
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

## Plugin Author Patterns

### Basic Plugin

```typescript
export const withMetrics = definePlugin<MyContext, MetricsAPI>((router) => ({
  metrics: {
    track(event: string) {
      // implementation
    },
  },
}));

// Usage
const router = createRouter().plugin(withMetrics);
router.metrics.track("event"); // TypeScript infers type
```

### Fluent Plugin (Returns Router for Chaining)

```typescript
export const withValidation = definePlugin<MyContext, ValidationAPI>(
  (router) => ({
    rpc(schema, handler) {
      router.on(schema, handler);
      return router; // Fluent
    },
  }),
);

// Usage
const router = createRouter()
  .plugin(withValidation)
  .rpc(GetUser, (ctx) => {
    // ...
  });
```

### Plugin with Strict Dependency (Wrapper Pattern)

```typescript
export function withAdvancedPubSub(base: typeof withPubSub = withPubSub) {
  return definePlugin<MyContext, AdvancedPubSubAPI>((router) => {
    // Apply base plugin first (enforced composition)
    const routerWithBase = base(router);

    return {
      publishBatch(payloads) {
        // Uses routerWithBase internally
      },
    };
  });
}

// Usage (base applied automatically)
const router = createRouter().plugin(withAdvancedPubSub());
```

### Plugin with Optional Dependency (Runtime Check)

```typescript
export const withMetrics = definePlugin<MyContext, MetricsAPI>((router) => {
  const hasPubSub = router.pluginHost.hasCapability("pubsub");

  return {
    trackEvent(event, meta) {
      recordEvent(event, meta);

      // Enhanced if pubsub available
      if (hasPubSub) {
        router.publish?.("__metrics", MetricsEvent, { event });
      }
    },
  };
});
```

## Export Structure

### Primary Entry Point: `@ws-kit/core`

```typescript
export type Router<TContext, TExtensions> = /* ... */;
export type Plugin<TContext, TPluginApi> = /* ... */;
// (Users rarely import these directly; inferred from .plugin() calls)
```

### Plugin Authoring: `@ws-kit/core/plugin`

```typescript
export { definePlugin } from "./define";
export type { Router, Plugin } from "../core/router";

// Optional semantic layer
export type {
  RouterCapabilityAPIs,
  RouterWithCapabilities,
} from "./capabilities";
```

### Test Utilities: `@ws-kit/core/testing`

```typescript
export { mockPlugin } from "./plugin";
export type { Plugin } from "../core/router";
```

### Built-In Plugins: `@ws-kit/zod`, `@ws-kit/valibot`, `@ws-kit/pubsub`

```typescript
// Each exports its API interface and plugin function
export interface ValidationAPI<TContext> {
  /* ... */
}
export const withValidation: Plugin<any, ValidationAPI<any>>;

export interface PubSubAPI<TContext> {
  /* ... */
}
export const withPubSub: Plugin<any, PubSubAPI<any>>;
```

## Tradeoffs & Decisions

### Why Structural Composition Over Conditional Types?

| Aspect                  | Structural      | Conditional            |
| ----------------------- | --------------- | ---------------------- |
| **Complexity**          | Low             | High                   |
| **IDE Performance**     | Excellent       | Degraded               |
| **Type Clarity**        | Clear           | Opaque                 |
| **Third-Party Support** | Easy            | Requires Augmentation  |
| **Scalability**         | O(1) per plugin | O(n) with plugin count |

**Decision**: Structural composition is simpler, faster, and easier to extend.

### Why Runtime-Only Capability Checks?

| Aspect                        | Type-Level | Runtime-Only |
| ----------------------------- | ---------- | ------------ |
| **Compile-Time Checking**     | Yes        | No           |
| **Public API Complexity**     | Higher     | Lower        |
| **Third-Party Extensibility** | Harder     | Easier       |
| **Pragmatism**                | Less       | More         |

**Decision**: Runtime checks are sufficient; plugins validate at startup.

### Why Optional Semantic Layer?

The core system works without it, but some teams want:

- Capability names at the type level (IDE hints)
- Self-documenting function signatures
- Zero runtime cost (compile-time only)

**Decision**: Opt-in via `RouterWithCapabilities` type alias.

## Implementation Checklist

- ✅ **Phase 1**: Core type simplification (Router<TContext, TExtensions>, definePlugin)
- ✅ **Phase 2**: Built-in plugins migrated (withZod, withValibot, withPubSub use definePlugin)
- ✅ **Phase 3**: Optional semantic layer (RouterCapabilityAPIs, RouterWithCapabilities)
- ✅ **Phase 4**: Comprehensive tests (type tests, runtime composition, dependency patterns)
- ✅ **Phase 5**: Documentation (this ADR, plugin author guide, examples)

## References

- ADR-025: Validator Plugins (definePlugin origin)
- ADR-026: Internal Router Access Patterns (ROUTER_IMPL symbol for plugins)
- ADR-005: Builder Pattern and Symbol Escape Hatch (symbol pattern foundation)
- docs/specs/router.md: Plugin API specification
- packages/core/src/plugin/: Core plugin infrastructure
- packages/\*/src/plugin.ts: Built-in plugin implementations (examples)
- packages/core/test/features/plugin-composition.test.ts: Runtime tests
- packages/core/test/types/plugin-capability-gating.test.ts: Type tests

## Future Considerations

1. **Plugin Registry** — Could add optional registry for discovery (NPM package search)
2. **Plugin Hooks** — onPluginApply, onPluginError for introspection
3. **Dependency Declarations** — Plugins could declare dependencies explicitly
4. **Conflict Resolution** — Framework-level strategies for namespace collisions
5. **Plugin Validation** — Lint rules to catch common plugin mistakes

These are future enhancements; the current design is sufficient for production use.
