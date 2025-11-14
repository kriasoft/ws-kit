# ADR-032: Canonical Imports Design

**Status:** Final
**Date:** 2025-11-14
**References:** ADR-007 (Export-with-Helpers Pattern), ADR-031 (Plugin-Adapter Architecture)

---

## Context

As the plugin ecosystem expanded (`@ws-kit/plugins`, `@ws-kit/pubsub`, `@ws-kit/rate-limit`, `@ws-kit/middleware`), a critical question emerged:

**Where should users import plugins and utilities from?**

### The Challenge

Three import patterns emerged in practice:

```typescript
// Option 1: Direct from source
import { withPubSub } from "@ws-kit/pubsub";
import { rateLimit } from "@ws-kit/rate-limit";
import { useAuth } from "@ws-kit/middleware";

// Option 2: Via validator convenience re-exports (plugins only)
import { withPubSub } from "@ws-kit/zod";
import { withPubSub } from "@ws-kit/valibot";

// Option 3: Via core
import { withMessaging, withRpc } from "@ws-kit/core";
```

This inconsistency created confusion about:

- **Where is the canonical source?** Does middleware come from validators?
- **What gets re-exported?** Is everything available everywhere?
- **Developer friction**: Importing from multiple sources for a single application
- **Future scaling**: Adding new plugins requires changes in multiple packages

### The Real Problem

The root issue wasn't package location but **canonical import identity**. For effective code generation, documentation, and library tooling, we needed clear rules about:

1. **Each plugin has one canonical home**
2. **Convenience re-exports are optional, not authoritative**
3. **Users know exactly where to import from**
4. **Documentation never suggests non-canonical imports**

---

## Decision

### Canonical Import Sources

**Each feature type has one canonical import source. Users MUST always import from canonical sources.**

#### Core Framework Plugins (No Validation)

These go in **`@ws-kit/plugins`**:

```typescript
import { withMessaging } from "@ws-kit/plugins";
import { withRpc } from "@ws-kit/plugins";
```

#### Feature-Specific Plugins

These live in **their own packages**:

```typescript
import { withPubSub, usePubSub } from "@ws-kit/pubsub";
import { withTelemetry, useTelemetry } from "@ws-kit/telemetry"; // Future
import { withCompression, useCompression } from "@ws-kit/compression"; // Future
import { withCaching, useCaching } from "@ws-kit/caching"; // Future
```

#### Middleware & Hooks

These live in **their respective packages**:

```typescript
// Rate limiting (token bucket via middleware)
import {
  rateLimit,
  keyPerUserPerType,
  keyPerUserOrIpPerType,
  perUserKey,
} from "@ws-kit/rate-limit";

// Authentication, logging, metrics, telemetry
import { useAuth, useLogging, useMetrics } from "@ws-kit/middleware";
```

#### Adapters

Backend implementations live in **their adapter packages**:

```typescript
import { memoryPubSub, memoryRateLimiter } from "@ws-kit/memory";
import { redisPubSub, redisRateLimiter } from "@ws-kit/redis";
import { cloudflarePubSub, cloudflareRateLimiter } from "@ws-kit/cloudflare";
```

#### Validator-Provided Helpers

These export from **`@ws-kit/zod`** or **`@ws-kit/valibot`** (whichever you choose):

```typescript
import { z, message, createRouter, withZod } from "@ws-kit/zod";
// or
import { v, message, createRouter, withValibot } from "@ws-kit/valibot";
```

### Convenience Re-exports (Optional)

**Validator packages MAY re-export common plugins and middleware for convenience**, but **only from canonical sources**. **Adapters are NEVER re-exported** — they must always be imported from their adapter packages to ensure explicit intent (development vs production).

**`@ws-kit/zod` re-exports:**

```typescript
// From @ws-kit/plugins
export { withMessaging, withRpc } from "@ws-kit/plugins";

// From @ws-kit/pubsub
export { withPubSub, usePubSub } from "@ws-kit/pubsub";

// Router factory (canonically from core)
export { createRouter } from "@ws-kit/core";
```

**`@ws-kit/valibot` re-exports the same list** (identical to Zod for consistency).

### What Does NOT Get Re-exported

These have no convenience re-exports; users must import from canonical sources:

```typescript
// ✗ NOT available from @ws-kit/zod or @ws-kit/valibot

// Rate-limiting (middleware, independent of validation choice)
import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit"; // ✓ Must import from @ws-kit/rate-limit

// Other middleware (independent of validation choice)
import { useAuth } from "@ws-kit/middleware"; // ✓ Must import from @ws-kit/middleware
import { useLogging } from "@ws-kit/middleware"; // ✓ Must import from @ws-kit/middleware

// Feature plugin middleware (separate from plugins)
import { usePubSub } from "@ws-kit/pubsub"; // ✓ Must import from @ws-kit/pubsub

// Adapters (always explicit to clarify dev vs prod)
import { memoryPubSub } from "@ws-kit/memory"; // ✓ Must import from @ws-kit/memory
import { redisPubSub } from "@ws-kit/redis"; // ✓ Must import from @ws-kit/redis
import { durableObjectsPubSub } from "@ws-kit/cloudflare"; // ✓ Must import from @ws-kit/cloudflare
```

**Rationale for adapter exclusion**: Adapters implement backend strategies (in-memory, Redis, Cloudflare Durable Objects). Explicitly importing from their packages makes architectural intent clear. Convenience re-exports would obscure this decision, encouraging ambiguous imports like `import { memoryPubSub } from "@ws-kit/zod"` instead of the clear `import { memoryPubSub } from "@ws-kit/memory"`.

### Why This Design?

1. **Single Source of Truth**: Each feature has one canonical home, reducing confusion
2. **Documentation Clarity**: Specs always show canonical imports, no ambiguity
3. **Future-Proof**: New plugins don't require changes to validator packages
4. **Tooling-Friendly**: Code generators and IDE extensions know exactly where to find things
5. **Backwards Compatible**: Convenience re-exports don't break existing code
6. **Scalability**: Middleware, telemetry, compression, and future features have clear homes

---

## Implementation

### Documentation Standards

All specifications and examples MUST follow these rules:

1. **Always show canonical imports first**

   ```typescript
   // ✓ Always canonical
   import { withPubSub } from "@ws-kit/pubsub";
   import { withRateLimit } from "@ws-kit/rate-limit";
   ```

2. **Note convenience re-exports as alternatives** (if relevant)

   ```typescript
   // ✓ Convenience re-export (same as canonical above)
   import { withPubSub } from "@ws-kit/zod";
   ```

3. **Document adapter imports clearly**

   ```typescript
   // For development (in-memory)
   import { memoryPubSub } from "@ws-kit/memory";

   // For production (distributed)
   import { redisPubSub } from "@ws-kit/redis";
   ```

4. **Never suggest non-canonical imports** except when noting re-exports

### Package Structure

Each canonical package exports clearly:

**`@ws-kit/pubsub/package.json` exports field:**

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./adapters": "./dist/adapters.js"
  }
}
```

**`@ws-kit/pubsub/src/index.ts`:**

```typescript
export { withPubSub, usePubSub } from "./plugin.js";
export type { PubSubConfig, PubSubAdapter, PublishResult } from "./types.js";
```

---

## Rationale

### Why Separate Packages for Feature Plugins?

- **Clarity**: Users know exactly where a feature lives
- **Discoverability**: Feature packages appear in package managers under their names
- **Zero Dependency**: Apps not using pub/sub don't install `@ws-kit/pubsub`
- **Evolution**: Features can evolve independently

### Why Convenience Re-exports in Validators?

- **DX**: New developers often start with validators; lower barrier to entry
- **Backward Compat**: Existing code importing from `@ws-kit/zod` keeps working
- **Consistency**: Both validators re-export the same set (no surprises)
- **Composition**: Plugins are library composition concerns; safe to re-export

### Why No Middleware Re-exports?

- **Separate Concern**: Middleware (including rate-limiting) is independent of validation strategy
- **Clarity**: `rateLimit`, `useAuth`, `useLogging` are not validation concepts
- **Future**: New middleware can be added without validator changes
- **Consistency**: Rate-limiting joins other middleware in canonical packages, not validators

### Why No Adapter Re-exports?

- **Explicit Intent**: Importing from adapter packages (`@ws-kit/memory`, `@ws-kit/redis`) makes dev vs prod decision visible
- **Clarity**: Code that says `import { redisPubSub } from "@ws-kit/redis"` is self-documenting
- **Anti-pattern Avoidance**: Prevents confusing imports like `import { redisPubSub } from "@ws-kit/zod"`
- **Architecture**: Adapters are backend implementation details, separate from composition (plugins/middleware)

---

## Examples

### Canonical Imports (Always Correct)

```typescript
// Core + validators (always from these packages)
import { z, message, createRouter, withZod } from "@ws-kit/zod";

// Core plugins
import { withMessaging, withRpc } from "@ws-kit/plugins";

// Feature plugins
import { withPubSub } from "@ws-kit/pubsub";

// Middleware (rate-limit is middleware, not plugin)
import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";
import { useAuth } from "@ws-kit/middleware";

// Adapters (always explicit: dev vs prod)
import { memoryPubSub } from "@ws-kit/memory";
import { redisPubSub } from "@ws-kit/redis";
```

### Convenience Re-exports (Valid but Secondary)

```typescript
// Plugins available via validator, but middleware and adapters are always canonical
import { withMessaging, withRpc, withPubSub, createRouter } from "@ws-kit/zod";

// Middleware MUST be imported from their packages (not re-exported)
import { rateLimit, keyPerUserPerType } from "@ws-kit/rate-limit";

// Adapters MUST be imported from their packages (not re-exported)
import { memoryPubSub } from "@ws-kit/memory";
import { redisPubSub } from "@ws-kit/redis";
```

### What Breaks

```typescript
// ✗ Rate-limiting NOT re-exported from validators
import { rateLimit } from "@ws-kit/zod"; // ERROR
import { keyPerUserPerType } from "@ws-kit/valibot"; // ERROR

// ✗ Other middleware NOT re-exported from validators
import { useAuth } from "@ws-kit/zod"; // ERROR

// ✗ Adapters NEVER re-exported from validators or plugins
import { memoryPubSub } from "@ws-kit/zod"; // ERROR
import { redisPubSub } from "@ws-kit/plugins"; // ERROR
import { redisPubSub } from "@ws-kit/zod"; // ERROR
```

---

## Documentation Updates

### Affected Files

1. **CLAUDE.md** — Quick Start example uses correct imports
2. **docs/specs/schema.md** — Canonical imports section references this ADR
3. **docs/specs/README.md** — Import quick reference updated
4. **docs/specs/plugins.md** — All examples use canonical sources
5. **docs/specs/adapters.md** — Adapter imports clearly documented
6. **All examples/** — Example code follows canonical patterns

### Documentation Format

Each spec that shows imports includes a reference:

```markdown
## Canonical Imports

See [ADR-032](../adr/032-canonical-imports-design.md) for complete rules.

Always import plugins from their canonical sources:

- Core plugins: `@ws-kit/plugins`
- Feature plugins: Their feature packages (`@ws-kit/pubsub`, etc.)
- Adapters: Adapter packages (`@ws-kit/memory`, `@ws-kit/redis`, etc.)
```

---

## Migration Path

### For Existing Code

No changes required. Convenience re-exports remain stable:

```typescript
// Old code still works
import { withPubSub } from "@ws-kit/zod";

// New code uses canonical
import { withPubSub } from "@ws-kit/pubsub";

// Both import the same thing, so both are valid
```

### For New Documentation

All new examples and specs use canonical imports exclusively.

### For Linting (Future)

Tools can enforce canonical imports via:

```typescript
// ESLint rule (future)
rules: {
  "@ws-kit/canonical-imports": "warn"
}
```

---

## Consequences

### Positive

1. ✓ Clear, single import source per feature
2. ✓ Documentation is unambiguous
3. ✓ Better DX through consistency
4. ✓ Easier for tooling and code generation
5. ✓ Future features have clear homes

### Neutral

1. ~ Convenience re-exports remain (optional, not required)
2. ~ Existing code continues to work unchanged
3. ~ No runtime impact (purely organizational)

### Minimal

1. - Documentation needs updates (one-time cost)
2. - Future contributors need to know canonical sources (documented in CLAUDE.md)

---

## References

- [ADR-007](./007-export-with-helpers-pattern.md) — Export-with-Helpers Pattern (validator + helpers from one source)
- [ADR-028](./028-plugin-architecture-final-design.md) — Plugin Architecture
- [ADR-031](./031-plugin-adapter-architecture.md) — Plugin-Adapter Split
- [docs/specs/plugins.md](../specs/plugins.md) — Plugin system reference
- [docs/specs/adapters.md](../specs/adapters.md) — Adapter documentation
