# Plugin Author Guide

This guide shows how to write plugins for the ws-kit router using the new `definePlugin` helper.

## Quick Start

A plugin is a pure function that takes a router and returns an enhanced router with new APIs:

```typescript
import { definePlugin } from "@ws-kit/core/plugin";
import type { Router } from "@ws-kit/core";

// 1. Define your plugin's API interface
interface MyPluginAPI {
  myMethod(): void;
}

// 2. Use definePlugin to create a type-safe plugin
export const withMyPlugin = definePlugin<any, MyPluginAPI>((router) => ({
  myMethod: () => {
    console.log("My plugin method called");
  },
}));

// 3. Users apply it with .plugin()
const router = createRouter().plugin(withMyPlugin);
router.myMethod(); // TypeScript knows this exists
```

**Key points**:

- `definePlugin<TContext, TPluginApi>` enforces type safety
- Your build function must return an object matching `TPluginApi`
- The plugin automatically merges into the router
- TypeScript verifies completeness at compile-time

## Plugin Patterns

### 1. Simple Plugin (New Methods)

Add new methods to the router:

```typescript
interface AnalyticsAPI {
  analytics: {
    track(event: string, data?: Record<string, any>): void;
  };
}

export const withAnalytics = definePlugin<any, AnalyticsAPI>((router) => ({
  analytics: {
    track: (event, data) => {
      // Implementation
      console.log(`[Analytics] ${event}`, data);
    },
  },
}));

// Usage
const router = createRouter().plugin(withAnalytics);
router.analytics.track("user_login", { userId: "123" });
```

### 2. Fluent Plugin (Methods Return Router)

Make plugin methods chainable:

```typescript
interface QueryBuilderAPI {
  query(type: string): Router<any, any>; // Returns router for chaining
}

export const withQueryBuilder = definePlugin<any, QueryBuilderAPI>(
  (router) => ({
    query: (type: string) => {
      // Do something with type
      console.log(`Query registered for ${type}`);
      // Return router to allow chaining
      return router;
    },
  }),
);

// Usage
const router = createRouter()
  .plugin(withQueryBuilder)
  .query("user")
  .query("post");
```

### 3. Plugin with Context Access

Plugins can read the router to get the route index:

```typescript
import { getRouteIndex } from "@ws-kit/core";

interface SchemaInspectorAPI {
  inspector: {
    listRoutes(): string[];
  };
}

export const withSchemaInspector = definePlugin<any, SchemaInspectorAPI>(
  (router) => {
    const routeIndex = getRouteIndex(router);

    return {
      inspector: {
        listRoutes: () => {
          return routeIndex.list().map((r) => r.type);
        },
      },
    };
  },
);

// Usage
const router = createRouter()
  .plugin(withSchemaInspector)
  .on(MessageType, (ctx) => {});

console.log(router.inspector.listRoutes()); // ["MessageType"]
```

### 4. Plugin with Lifecycle Hooks

Plugins can hook into router lifecycle events:

```typescript
import { ROUTER_IMPL } from "@ws-kit/core/internal";

interface ConnectionMonitorAPI {
  connectionMonitor: {
    getActiveConnections(): number;
  };
}

export const withConnectionMonitor = definePlugin<any, ConnectionMonitorAPI>(
  (router) => {
    let activeConnections = 0;

    // Access internal router to hook lifecycle
    const routerImpl = (router as any)[ROUTER_IMPL];
    if (routerImpl) {
      const lifecycle = routerImpl.getInternalLifecycle();

      lifecycle.onOpen(() => {
        activeConnections++;
      });

      lifecycle.onClose(() => {
        activeConnections--;
      });
    }

    return {
      connectionMonitor: {
        getActiveConnections: () => activeConnections,
      },
    };
  },
);
```

### 5. Plugin with Dependency (Wrapper Pattern)

Make a plugin that depends on another plugin:

```typescript
interface BasePubSubAPI {
  publish(topic: string): Promise<void>;
}

interface AdvancedPubSubAPI {
  publishBatch(topics: string[]): Promise<void>;
}

// Base plugin (simple)
const withBasePubSub = definePlugin<any, BasePubSubAPI>((router) => ({
  publish: async (topic: string) => {
    console.log(`Publishing to ${topic}`);
  },
}));

// Wrapper plugin (depends on base)
export function withAdvancedPubSub(
  basePubSub: typeof withBasePubSub = withBasePubSub,
) {
  return definePlugin<any, AdvancedPubSubAPI>((router) => {
    // Apply base plugin first
    const routerWithBase = basePubSub(router);

    return {
      publishBatch: async (topics: string[]) => {
        // Use the base plugin's publish method
        for (const topic of topics) {
          await (routerWithBase as any).publish(topic);
        }
      },
    };
  });
}

// Usage (base is applied automatically)
const router = createRouter().plugin(withAdvancedPubSub());
await router.publishBatch(["topic1", "topic2"]);
```

### 6. Plugin with Optional Dependency

Check for dependency at runtime:

```typescript
interface MetricsAPI {
  metrics: {
    track(event: string): void;
  };
}

export const withMetrics = definePlugin<any, MetricsAPI>((router) => {
  // Check if pubsub plugin is available
  const hasPubSub = router.pluginHost?.hasCapability("pubsub") ?? false;

  return {
    metrics: {
      track: (event: string) => {
        console.log(`[Metrics] ${event}`);

        // Enhanced behavior if pubsub available
        if (hasPubSub && (router as any).publish) {
          (router as any).publish("metrics", {}, { event });
        }
      },
    },
  };
});

// Usage (works with or without pubsub)
const router = createRouter().plugin(withMetrics).plugin(
  withPubSub({
    /* ... */
  }),
); // Optional
```

### 7. Plugin with Custom Context

Use custom connection data types:

```typescript
interface MyContext {
  userId?: string;
  role?: string;
}

interface RoleBasedAPI {
  requireRole(role: string): Router<MyContext, any>;
}

export const withRoleBasedAccess = definePlugin<MyContext, RoleBasedAPI>(
  (router) => ({
    requireRole: (role: string) => {
      // Middleware that checks ctx.data.role
      router.use(async (ctx: any, next) => {
        if (ctx.data.role !== role) {
          throw new Error(`Required role: ${role}`);
        }
        await next();
      });
      return router;
    },
  }),
);

// Usage
const router = createRouter<MyContext>()
  .plugin(withRoleBasedAccess)
  .requireRole("admin");
```

## Testing Plugins

### Using mockPlugin

Test your code without real plugins:

```typescript
import { mockPlugin } from "@ws-kit/core/testing";

describe("MyFeature", () => {
  it("should work with mock plugins", () => {
    // Create a mock plugin
    const mockPubSub = mockPlugin<any, PubSubAPI>({
      publish: async () => ({ ok: true }),
      topics: { list: () => [], has: () => false },
    });

    // Use it in router
    const router = createRouter().plugin(mockPubSub);

    // Test your code without real pubsub
    expect((router as any).publish).toBeDefined();
  });
});
```

### Testing Plugin Behavior

Test that plugins work correctly together:

```typescript
describe("Plugin composition", () => {
  it("should apply plugins in order", () => {
    const callOrder: string[] = [];

    const plugin1 = definePlugin<any, any>((router) => {
      callOrder.push("plugin1");
      return { p1: true };
    });

    const plugin2 = definePlugin<any, any>((router) => {
      callOrder.push("plugin2");
      return { p2: true };
    });

    createRouter().plugin(plugin1).plugin(plugin2);

    expect(callOrder).toEqual(["plugin1", "plugin2"]);
  });
});
```

## Publishing Your Plugin

### Package Structure

Create a new npm package:

```
my-ws-kit-plugin/
├── src/
│   ├── index.ts          # Main export
│   └── plugin.ts         # Plugin implementation
├── test/
│   └── plugin.test.ts    # Tests
├── package.json
└── README.md
```

### Example package.json

```json
{
  "name": "my-ws-kit-plugin",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "peerDependencies": {
    "@ws-kit/core": "^1.0.0"
  },
  "devDependencies": {
    "@ws-kit/core": "^1.0.0",
    "typescript": "^5.0.0"
  }
}
```

### Example index.ts

```typescript
export { withMyPlugin } from "./plugin.js";
export type { MyPluginAPI } from "./plugin.js";
```

### Example plugin.ts

```typescript
import { definePlugin } from "@ws-kit/core/plugin";
import type { Router } from "@ws-kit/core";

export interface MyPluginAPI {
  myMethod(): void;
}

export const withMyPlugin = definePlugin<any, MyPluginAPI>((router) => ({
  myMethod: () => {
    // Implementation
  },
}));
```

## Module Augmentation (Advanced)

If your plugin provides a capability that users might want to reference by name in the semantic layer:

```typescript
// my-plugin/src/plugin.ts
import { definePlugin } from "@ws-kit/core/plugin";

export interface MyCapabilityAPI {
  myCapability(): void;
}

export const withMyCapability = definePlugin<any, MyCapabilityAPI>(
  (router) => ({
    myCapability: () => {},
  }),
);

// my-plugin/src/augmentation.ts
// Declare module augmentation in a separate file
declare module "@ws-kit/core/plugin" {
  interface RouterCapabilityAPIs<TContext> {
    myCapability: MyCapabilityAPI;
  }
}

// my-plugin/src/index.ts
export { withMyCapability } from "./plugin.js";
export type { MyCapabilityAPI } from "./plugin.js";

// Users can now do:
// import type { RouterWithCapabilities } from "@ws-kit/core/plugin";
// type MyRouter = RouterWithCapabilities<MyContext, ["myCapability"]>;
```

## Best Practices

### 1. Use Meaningful Names

```typescript
// ✅ Good: clear intent
export const withAuthenticationProvider = definePlugin(...);

// ❌ Bad: vague
export const withPlugin = definePlugin(...);
```

### 2. Document Your API

````typescript
/**
 * Metrics tracking plugin.
 *
 * Adds runtime event tracking with optional pubsub broadcast.
 *
 * @example
 * ```typescript
 * const router = createRouter()
 *   .plugin(withMetrics)
 *   .on(Message, (ctx) => {
 *     router.metrics.track("message_received");
 *   });
 * ```
 */
export const withMetrics = definePlugin<any, MetricsAPI>(...);
````

### 3. Handle Errors Gracefully

```typescript
export const withDatabase = definePlugin<any, DatabaseAPI>((router) => {
  const routerImpl = (router as any)[ROUTER_IMPL];
  if (!routerImpl) {
    throw new Error(
      "withDatabase requires internal router access (ROUTER_IMPL symbol)",
    );
  }

  return {
    db: {
      query: async (sql: string) => {
        // Implementation
      },
    },
  };
});
```

### 4. Support Custom Context

```typescript
export const withAuth = definePlugin<
  { userId?: string }, // Custom context
  AuthAPI
>((router) => ({
  // Implementation
}));
```

### 5. Avoid Namespace Collisions

Plugins adding to the same namespace should coordinate:

```typescript
// ✅ Good: namespaced to plugin
export const withMetrics = definePlugin<any, any>((router) => ({
  metrics: {
    /* ... */
  },
}));

// ❌ Bad: top-level method, might collide
export const withMetrics = definePlugin<any, any>((router) => ({
  track: () => {}, // Conflicts with other plugins
}));
```

### 6. Be Idempotent

If your plugin is applied twice, it should work correctly:

```typescript
export const withCache = definePlugin<any, CacheAPI>((router) => {
  // Define cache state outside
  const cache = new Map();

  return {
    cache: {
      get: (key) => cache.get(key),
      set: (key, value) => cache.set(key, value),
    },
  };
});

// Safe to apply twice (same cache reused due to idempotency)
const router = createRouter().plugin(withCache).plugin(withCache); // No-op, same plugin function
```

## Troubleshooting

### TypeScript Errors

**Error: `Property 'method' does not exist`**

- Make sure your build function returns an object matching `TPluginApi`
- Check that all properties in the interface are implemented

**Error: `Plugin overwrites existing router property`**

- Choose a different namespace for your plugin methods
- Use nested objects: `.plugin({ myNamespace: { method: () => {} } })`

### Runtime Issues

**Plugin not being applied**

- Check that `definePlugin` is called with correct type parameters
- Verify the plugin function returns the correct type

**pluginHost.hasCapability() returns false**

- The plugin needs to set `__caps` to be tracked
- Or use runtime checks with optional chaining: `router.publish?.()`

## Examples

See the built-in plugins for real-world examples:

- **Validation**: `packages/zod/src/plugin.ts` (wraps middleware)
- **Pub/Sub**: `packages/pubsub/src/plugin.ts` (hooks lifecycle)
- **Tests**: `packages/core/test/features/plugin-composition.test.ts`

## Further Reading

- [ADR-028: Plugin Architecture](./adr/028-plugin-architecture-final-design.md)
- [Router Specification](./specs/router.md)
- [Plugin API Specification](./specs/router.md#plugins)
