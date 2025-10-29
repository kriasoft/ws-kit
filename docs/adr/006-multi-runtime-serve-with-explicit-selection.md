# ADR-006: Multi-Runtime `serve()` Function with Explicit Runtime Selection

**Status**: Accepted
**Date**: 2025-10-29
**Related**: ADR-005, ADR-007

## Context

Current implementation requires platform-specific imports and handlers:

```typescript
// Before: Bun-specific
import { createBunHandler } from "@ws-kit/bun";
const { fetch, websocket } = createBunHandler(router, options);
Bun.serve({ port: 3000, fetch, websocket });

// Before: Cloudflare-specific
import { createCloudflareDOHandler } from "@ws-kit/cloudflare-do";
const { fetch } = createCloudflareDOHandler(router, options);
export default { fetch };
```

This creates three problems:

1. **Code not portable** — Different imports and handler calls per platform
2. **Monorepo friction** — Teams with multi-target deployments duplicate logic
3. **Testing complexity** — Tests must mock platform-specific APIs

## Decision

Introduce a unified `serve()` function that:

1. **Accepts explicit runtime** — `serve(router, { runtime: "bun", port: 3000 })`
2. **Supports platform entrypoints** — `import { serve } from "@ws-kit/serve/bun"`
3. **Auto-detects in dev only** — Development convenience; production requires explicit selection
4. **Never requires detection overhead** — Production code always knows its target

### Three Approaches at a Glance

| Approach             | Syntax                                      | Dev     | Prod        | Detection        | Tree-shaking |
| -------------------- | ------------------------------------------- | ------- | ----------- | ---------------- | ------------ |
| **Explicit Runtime** | `serve(router, { runtime: "bun" })`         | ✅      | ✅ Required | None             | Good         |
| **Platform Subpath** | `import { serve } from "@ws-kit/serve/bun"` | ✅      | ✅ Optimal  | None             | Excellent    |
| **Auto-detect**      | `serve(router, { port: 3000 })`             | ✅ Auto | ❌ Error    | Capability-based | Fair         |

**Production Policy:** Auto-detection is **disallowed in production**. One of the explicit approaches is required.

### Canonical Production Approach: Platform Entrypoints

**Platform-specific entrypoints are the "one true way" for production deployments.** They provide:

- **Correct semantics**: Platform-specific options and error messages
- **Optimal bundling**: Zero detection logic, excellent tree-shaking
- **Developer clarity**: Import path makes runtime explicit
- **Type safety**: Options narrowed to platform capabilities

The generic `serve(router, { runtime })` approach exists for:

- **Integration tests** spinning up routers under multiple runtimes
- **Framework-agnostic examples** in documentation and benchmarks
- **Monorepo tooling** that auto-targets different platforms
- **Development servers** where runtime is chosen via environment variable or CLI flag

**For production code**: Always use `import { serve } from "@ws-kit/serve/bun"` (or platform-specific variant). Never rely on generic `serve()` with runtime detection in production—it limits type precision and error clarity.

### Implementation: Three Approaches

#### Approach 1: Explicit Runtime (Advanced / Multi-Target)

```typescript
import { serve } from "@ws-kit/serve";

serve(router, {
  port: 3000,
  runtime: "bun", // For multi-target deployments or tests
  authenticate(req) {
    return { userId: "123" };
  },
});
```

**Benefits:**

- ✅ Works for tests, multi-target deployments, CLI tools
- ✅ Environment-variable friendly (`WSKIT_RUNTIME=bun`)
- ✅ Can conditionally select runtime in code

**Best for:** Integration tests, monorepo tooling, dev servers with `--runtime` flag.

#### Approach 2: Platform Entrypoints (Recommended for Production)

```typescript
// ✅ Direct import—zero detection logic, runtime explicit in code
import { serve } from "@ws-kit/serve/bun";

serve(router, {
  port: 3000,
  authenticate(req) {
    return { userId: "123" };
  },
});
```

**Benefits:**

- ✅ **Zero detection logic** — No globals probing, deterministic
- ✅ **Optimal tree-shaking** — Only imports what you use
- ✅ **Type-safe options** — Options narrowed to platform capabilities
- ✅ **Clear error messages** — Platform-specific guidance
- ✅ **Impossible to misconfigure** — Import path makes target explicit

**Best for:** Production deployments (single or multi-target monorepos).

#### Approach 3: Auto-Detection in Development (Convenience)

```typescript
import { serve } from "@ws-kit/serve";

// Auto-detected only in development; explicit required in production
serve(router, { port: 3000 });
```

**Behavior:**

- In development (`NODE_ENV !== "production"`): Detects runtime via capability checks
- In production: Throws error, requires explicit `runtime` option

**Detection via capability checks** (not brand names):

- Bun: `typeof Bun?.serve === "function"`
- Deno: `typeof Deno?.version?.deno === "string"`
- Cloudflare: `typeof WebSocketPair === "function" && !globalThis.process`

### Implementation Sketch

```typescript
export async function serve<TData>(
  router: Router<TData>,
  options: ServeOptions<TData> & {
    /**
     * Explicit runtime selection.
     * Default: auto-detect in development; required in production.
     *
     * Platform names:
     * - "bun": Bun runtime
     * - "cloudflare-do": Cloudflare Durable Objects
     * - "deno": Deno runtime
     */
    runtime?: "bun" | "cloudflare-do" | "deno" | "auto";
  } = {},
): Promise<void> {
  const mode = process.env.NODE_ENV ?? "development";
  const envRuntime = process.env.WSKIT_RUNTIME as any;

  // Resolve runtime: explicit option → env var → auto (dev only) or error (prod)
  let target = options.runtime ?? envRuntime;

  if (!target || target === "auto") {
    if (mode === "production") {
      throw new Error(
        "Auto-detection disabled in production. Set options: " +
          'serve(router, { runtime: "bun" | "cloudflare-do" | "deno" }) ' +
          "or WSKIT_RUNTIME environment variable.",
      );
    }
    target = detectRuntimeOrFail();
  }

  // Platform-specific serve function
  switch (target) {
    case "bun":
      const { serve: bunServe } = await import("@ws-kit/serve/bun");
      return bunServe(router, options);
    case "cloudflare-do":
      const { serve: cfServe } = await import("@ws-kit/serve/cloudflare-do");
      return cfServe(router, options);
    case "deno":
      const { serve: denoServe } = await import("@ws-kit/serve/deno");
      return denoServe(router, options);
    default:
      throw new Error(`Unknown runtime: ${target}`);
  }
}

function detectRuntimeOrFail(): "bun" | "cloudflare-do" | "deno" {
  const matches: Array<"bun" | "cloudflare-do" | "deno"> = [];

  // Capability-based probing (not brand names)
  if (typeof (globalThis as any).Bun?.serve === "function") {
    matches.push("bun");
  }
  if (typeof (globalThis as any).Deno?.version?.deno === "string") {
    matches.push("deno");
  }
  const isCF =
    typeof (globalThis as any).WebSocketPair === "function" &&
    !(globalThis as any).process;
  if (isCF) {
    matches.push("cloudflare-do");
  }

  if (matches.length === 1) return matches[0];

  if (matches.length === 0) {
    throw new Error(
      "No runtime detected. Set runtime explicitly: " +
        'serve(router, { runtime: "bun" | "cloudflare-do" | "deno" })',
    );
  }

  throw new Error(
    `Ambiguous environment: detected ${matches.join(" & ")}. ` +
      "Set runtime explicitly to avoid misdetection.",
  );
}
```

### Environment Variable Override

For flexible deployments, support `WSKIT_RUNTIME`:

```bash
# Set default runtime without code changes
WSKIT_RUNTIME=bun node app.js
# or
WSKIT_RUNTIME=cloudflare-do node app.js
```

This allows:

- CI/CD to override runtime without code changes
- Gradual migration between platforms
- Testing against different targets

### Complete Example: All Approaches

```typescript
// Approach 1: Explicit runtime (recommended)
import { serve } from "@ws-kit/serve";
serve(router, { runtime: "bun", port: 3000 });

// Approach 2: Platform entrypoint (optimal for single-target)
import { serve } from "@ws-kit/serve/bun";
serve(router, { port: 3000 });

// Approach 3: Auto-detect in dev, explicit in prod
import { serve } from "@ws-kit/serve";
serve(router, {
  port: 3000,
  runtime: process.env.NODE_ENV === "production" ? "bun" : "auto",
});

// Approach 4: Environment-driven
// Code: serve(router, { port: 3000 });
// Deploy: WSKIT_RUNTIME=bun node app.js
```

## Package Structure

**New `@ws-kit/serve` package:**

```
packages/serve/
├── src/
│   ├── index.ts              # Auto-detect serve() + runtime detection
│   ├── bun.ts                # Bun-specific serve()
│   ├── cloudflare-do.ts      # Cloudflare DO-specific serve()
│   ├── deno.ts               # Deno-specific serve()
│   └── test.ts               # Test helpers (bypass detection)
├── package.json              # Main + subpath exports
└── README.md
```

**package.json exports:**

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./bun": {
      "import": "./dist/bun.js",
      "types": "./dist/bun.d.ts"
    },
    "./cloudflare-do": {
      "import": "./dist/cloudflare-do.js",
      "types": "./dist/cloudflare-do.d.ts"
    },
    "./deno": {
      "import": "./dist/deno.js",
      "types": "./dist/deno.d.ts"
    },
    "./test": {
      "import": "./dist/test.js",
      "types": "./dist/test.d.ts"
    }
  }
}
```

## Test Helpers (No Detection Overhead)

Export test-friendly helpers to bypass detection:

```typescript
// @ws-kit/serve/test
export function createTestServer<TData>(
  router: Router<TData>,
  options: ServeOptions<TData> & {
    runtime: "bun" | "cloudflare-do" | "deno";
  },
): Promise<void> {
  // Bypass detection; use specified runtime directly
  return serve(router, options);
}
```

**Usage in tests:**

```typescript
import { createTestServer } from "@ws-kit/serve/test";

it("handles messages", async () => {
  const router = createRouter();
  await createTestServer(router, { runtime: "bun", port: 3001 });
  // Test your handlers
});
```

## Production Policy (NODE_ENV === "production")

**In production, auto-detection is explicitly disallowed. One approach is required:**

### Required: Choose One Approach

1. **Explicit `runtime` option** (simple, code-clear):

   ```typescript
   serve(router, { runtime: "bun", port: 3000 });
   ```

2. **Platform subpath import** (optimal for single-target deployments):

   ```typescript
   import { serve } from "@ws-kit/serve/bun";
   serve(router, { port: 3000 });
   ```

3. **Environment variable** (flexible, CI/CD-friendly):
   ```bash
   # Code
   serve(router, { port: 3000 });
   # Deploy
   WSKIT_RUNTIME=bun node app.js
   ```

### What's Disallowed

- ❌ Auto-detection: Throws immediate error with clear guidance
- ❌ No runtime specified and not in dev: Throws immediate error

### Error Messages Guide Users

```
Error: Auto-detection disabled in production. Set options:
serve(router, { runtime: "bun" | "cloudflare-do" | "deno" })
or WSKIT_RUNTIME environment variable.
```

### Benefits of Production Requirement

- ✅ **Deterministic**: Deployment target is explicit in code or configuration
- ✅ **Zero overhead**: No detection logic runs; direct handler import
- ✅ **Fail-fast**: Misconfiguration caught immediately with clear error
- ✅ **Auditable**: Git diff or environment config shows runtime choice

## Backwards Compatibility

Direct platform handler imports still work:

```typescript
// ✅ Still supported (v1.2+) - for advanced use cases
import { createBunHandler } from "@ws-kit/bun";
const { fetch, websocket } = createBunHandler(router, options);
Bun.serve({ port: 3000, fetch, websocket });
```

**Recommended approach:** Use `serve()` for simplicity and portability. Direct handler access remains for users needing full control over `Bun.serve()` configuration or custom routing logic.

## Consequences

### Benefits

✅ **Single API across platforms** — Same `serve()` function for Bun, Cloudflare, Deno
✅ **Portable code** — Examples and docs work across runtimes without modification
✅ **Production-safe** — Explicit runtime selection prevents silent misconfiguration
✅ **Development convenience** — Auto-detection in dev mode
✅ **Environment flexibility** — `WSKIT_RUNTIME` for CI/CD
✅ **No overhead in production** — Zero detection logic, direct handler import
✅ **Backwards compatible** — Direct handler imports still work

### Trade-offs

⚠️ **Production requires explicit selection** — One extra parameter in production code
⚠️ **Three approaches exist** — Developers must choose which fits their workflow
⚠️ **Environment variable adds complexity** — Increases deployment configuration surface

## Alternatives Considered

### 1. Always Auto-Detect (With Better Error Messages)

Detect runtime on every invocation, with clear error messages.

**Why rejected:**

- Detection overhead on every `serve()` call
- Can be ambiguous (Deno + Bun compatibility shims)
- Production code should be explicit about target
- Industry standard (Node frameworks) require explicit configuration

### 2. Require Platform-Specific Imports Always

No generic `serve()` function; only `import { serve } from "@ws-kit/serve/bun"`.

**Why rejected:**

- Less convenient for development
- Monorepos need conditional imports based on target
- Removes opportunity for environment-variable flexibility
- Doesn't match developer expectations (other frameworks have generic entry points)

### 3. Config File (wskit.config.json)

Use a configuration file to specify runtime.

**Why rejected:**

- Adds configuration file maintenance burden
- Less flexible than environment variables or code
- Harder to test different runtimes in same codebase
- Doesn't match modern JavaScript ecosystem patterns

## References

- **ADR-005**: Builder Pattern and Symbol Escape Hatch (context for transparent router)
- **ADR-007**: Export-with-Helpers Pattern (uses new serve() function)
- **Implementation**:
  - `packages/serve/src/index.ts` — Auto-detect serve()
  - `packages/serve/src/bun.ts` — Bun runtime integration
  - `packages/serve/src/cloudflare-do.ts` — Cloudflare integration
  - `packages/serve/src/deno.ts` — Deno runtime integration
- **Examples**:
  - `examples/quick-start/bun.ts` — Bun with explicit runtime
  - `examples/quick-start/entrypoint.ts` — Platform subpath approach
