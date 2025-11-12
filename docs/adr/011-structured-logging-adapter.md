# ADR-011: Structured Logging Adapter Interface

**Status**: Accepted
**Date**: 2025-10-29
**Related**: ADR-009 (error handling), ADR-005 (builder pattern), docs/specs/router.md

## Context

Production deployments require centralized, structured logging for:

1. **Observability** — Understanding what's happening in production
2. **Debugging** — Tracing issues across distributed systems
3. **Analytics** — Tracking metrics and trends
4. **Compliance** — Audit trails and security events

Currently, ws-kit logs only to `console`, which:

- Doesn't integrate with logging services (Datadog, Splunk, etc.)
- Can't filter by log level or category
- Doesn't provide structured format for parsing
- Makes it hard to correlate WebSocket events with other app logs

Applications must either:

1. Monkey-patch `console` methods (fragile, error-prone)
2. Implement ad-hoc logging wrappers (code duplication)
3. Accept console-only logging (unsuitable for production)

## Decision

Introduce **`LoggerAdapter` interface** for pluggable logging:

### Type Signatures

```typescript
/**
 * Structured logger interface for production deployments
 */
export interface LoggerAdapter {
  debug(context: string, message: string, data?: unknown): void;
  info(context: string, message: string, data?: unknown): void;
  warn(context: string, message: string, data?: unknown): void;
  error(context: string, message: string, data?: unknown): void;
}

/**
 * Log context constants for standard categories
 */
export const LOG_CONTEXT = {
  CONNECTION: "connection", // Connection lifecycle
  HEARTBEAT: "heartbeat", // Heartbeat / stale detection
  MESSAGE: "message", // Message routing
  MIDDLEWARE: "middleware", // Middleware execution
  AUTH: "auth", // Authentication
  VALIDATION: "validation", // Schema validation
  ERROR: "error", // Unhandled errors
} as const;

/**
 * Factory for creating custom loggers
 */
export interface LoggerOptions {
  log?: (
    level: "debug" | "info" | "warn" | "error",
    context: string,
    message: string,
    data?: unknown,
  ) => void;
  minLevel?: "debug" | "info" | "warn" | "error";
}

export function createLogger(options?: LoggerOptions): LoggerAdapter;
```

### Router Integration

```typescript
const router = createRouter({
  logger: createLogger({
    minLevel: "info",
    log: (level, context, message, data) => {
      // Send to logging service
      logService.send({ level, context, message, data });
    },
  }),
});
```

### Semantics

- **Interface-based** — Applications can implement custom loggers
- **Context categories** — Standard contexts for filtering/searching
- **Log levels** — Configurable minimum level to reduce noise
- **Optional** — If not provided, defaults to console logging
- **Fire-and-forget** — Logging errors don't interrupt handler execution

## Usage Examples

### Winston Integration

```typescript
import winston from "winston";
import { createRouter } from "@ws-kit/zod";
import type { LoggerAdapter } from "@ws-kit/core";

const winstonLogger = winston.createLogger({
  level: "info",
  transports: [new winston.transports.Console()],
});

const logger: LoggerAdapter = {
  debug: (context, msg, data) =>
    winstonLogger.debug(`[${context}] ${msg}`, data),
  info: (context, msg, data) => winstonLogger.info(`[${context}] ${msg}`, data),
  warn: (context, msg, data) => winstonLogger.warn(`[${context}] ${msg}`, data),
  error: (context, msg, data) =>
    winstonLogger.error(`[${context}] ${msg}`, data),
};

const router = createRouter({ logger });
```

### Datadog Integration

```typescript
import { createRouter } from "@ws-kit/zod";
import { createLogger, LOG_CONTEXT } from "@ws-kit/core";

const logger = createLogger({
  minLevel: "info",
  log: (level, context, message, data) => {
    // Send to Datadog
    datadogClient.log({
      level,
      message,
      tags: [`context:${context}`, "service:websocket"],
      ...data,
    });
  },
});

const router = createRouter({ logger });
```

## Alternatives Considered

### 1. Built-in logging service adapter

- **Pros**: Batteries-included experience
- **Cons**: Ties ws-kit to specific service; maintenance burden
- **Why rejected**: Users have different preferences; interface is simpler

### 2. Custom logger per API call

- **Pros**: Maximum flexibility
- **Cons**: Verbose; users must pass logger everywhere
- **Why rejected**: Router-level config more ergonomic

### 3. Global singleton logger

- **Pros**: Zero config needed
- **Cons**: Not compositional; hard to test; implicit dependencies
- **Why rejected**: Violates explicit dependency principle

## Consequences

### Benefits

1. **Composable** — Works with any logging library (Winston, Pino, Bunyan, custom)
2. **Structured** — Context categories enable filtering/searching
3. **Configurable** — Optional, with sensible defaults (console)
4. **Observable** — Integration with monitoring services
5. **Maintainable** — Single interface, clear semantics
6. **Testable** — Easy to mock in unit tests

### Risks

1. **Not used by default** — Requires explicit configuration
2. **Performance** — Logging overhead not measured; users should profile
3. **Documentation** — Need examples for popular logging libraries
4. **Breaking change** — None; new optional feature

### Trade-offs

- **Loose coupling** — Interface doesn't specify delivery guarantees (fire-and-forget)
- **No async** — Logging is synchronous (prevents blocking handlers)
- **Silent failures** — Logging errors don't propagate (prevents cascading failures)

## Implementation Details

1. **Optional integration** — Part of router constructor options
2. **Default behavior** — Falls back to console if not provided
3. **Standard contexts** — `LOG_CONTEXT` enum for consistency
4. **Log level filtering** — `createLogger()` supports minLevel
5. **Fire-and-forget** — Errors in logger callbacks are caught and logged to console

## Integration Points

Router logs at these contexts (examples):

- **CONNECTION**: `[connection] Client connected` (debug)
- **HEARTBEAT**: `[heartbeat] Timeout for clientId` (warn)
- **MESSAGE**: `[message] Routed to handler` (debug)
- **MIDDLEWARE**: `[middleware] Executing middleware` (debug)
- **AUTH**: `[auth] Authentication failed` (warn)
- **VALIDATION**: `[validation] Schema validation failed` (info)
- **ERROR**: `[error] Unhandled error in handler` (error)

## Testing

- Unit tests for `createLogger()` factory
- Integration tests with mock logger
- Example: Winston/Datadog integrations in documentation
- Performance benchmarks (logging overhead)

## Documentation

- docs/specs/router.md — Logger configuration in router options
- Patterns guide — Example integrations with popular libraries
- Type definitions — Clear interface documentation

## References

- [Winston logging library](https://github.com/winstonjs/winston)
- [Pino logging library](https://getpino.io/)
- [Datadog logging](https://docs.datadoghq.com/)
- [Structured logging best practices](https://kartar.net/2015/12/structured-logging/)

## Related Decisions

- ADR-009: Error handling lifecycle hooks
- ADR-005: Builder pattern for composition
- ADR-007: Export-with-helpers pattern for consistency
