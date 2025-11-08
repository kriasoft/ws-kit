# Bun v1.3.2 Features Relevant to WS-Kit

## WebSocket: `ServerWebSocket.subscriptions` Getter

**Relevance**: Pub/sub debugging and resource management

Access deduplicated list of topics a connection is subscribed to:

```typescript
router.on(someMessage, (ctx) => {
  const topics = ctx.ws.subscriptions; // New getter in v1.3.2
  console.log(`Client subscribed to: ${topics.join(", ")}`);
});
```

Use cases:

- Debug topic subscriptions per connection
- Validate subscription state
- Cleanup and resource tracking

---

## Testing: `onTestFinished` Hook

**Relevance**: Advanced test lifecycle and final cleanup

> **LLM tip**: Use `afterEach` for per-test teardown of objects created in each `it`. Use `onTestFinished` only when you truly need a final, suite-level callback (e.g., leak assertions) and remember it must be registered inside a running test or hook—never at top-level.

New hook executes after all `afterEach` hooks:

```typescript
import { describe, test, afterEach, onTestFinished } from "bun:test";

describe("WebSocket Router", () => {
  afterEach(() => {
    // Per-test cleanup
  });

  onTestFinished(() => {
    // Final cleanup after all tests in suite
    // Perfect for shared resources like mock servers
  });

  test("handler", () => {
    // ...
  });
});
```

Use cases:

- Final teardown of shared test fixtures
- Global mock server cleanup
- Resource allocation tracking

---

## Performance: CPU Profiling with `--cpu-prof`

**Relevance**: Performance bottleneck analysis

Generate Chrome DevTools–compatible profiles:

```bash
bun --cpu-prof run server.ts
bun --cpu-prof --cpu-prof-name=my-profile --cpu-prof-dir=./profiles run server.ts
```

Output: `.cpuprofile` file, inspect in Chrome DevTools (DevTools → Performance → Load)

Use cases:

- Profile broadcast performance
- Identify handler bottlenecks
- Benchmark adapter efficiency

---

## Lockfiles: `configVersion` Stabilization

**Relevance**: Monorepo stability and version control

Lockfiles now track configuration versions, preventing future Bun defaults from breaking builds. Re-run `bun install` after upgrading Bun to stabilize.

Use in CI: Lock Bun version + regenerate lockfile when upgrading.

---

## References

- [Bun v1.3.2 Release Notes](https://bun.com/blog/release-notes/bun-v1.3.2)
