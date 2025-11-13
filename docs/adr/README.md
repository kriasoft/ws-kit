# Architectural Decision Records (ADRs)

This directory contains architectural decisions that shaped ws-kit's design. Each ADR documents the problem, decision, and rationale behind major features and patterns.

## Index

| #                                                           | Title                                            | Status         | Impact                                              | Related Spec                                                             |
| ----------------------------------------------------------- | ------------------------------------------------ | -------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| [001](./001-message-context-conditional-payload-typing.md)  | Message Context Conditional Payload Typing       | ✅ Implemented | Core—Type safety for message payloads               | [schema.md](../specs/schema.md)                                          |
| [002](./002-typed-client-adapters.md)                       | Typed Client Adapters via Type Overrides         | ✅ Implemented | Client—Full type inference in browser/Node.js       | [client.md](../specs/client.md)                                          |
| [003](./003-example-imports.md)                             | Example Imports                                  | —              | Documentation                                       | —                                                                        |
| [004](./archive/004-typed-router-factory.md)                | Typed Router Factory                             | —              | Superseded by ADR-007 (archived)                    | —                                                                        |
| [005](./005-builder-pattern-and-symbol-escape-hatch.md)     | Builder Pattern and Symbol Escape Hatch          | —              | Design pattern exploration                          | —                                                                        |
| [006](./006-multi-runtime-serve-with-explicit-selection.md) | Multi-Runtime `serve()` with Explicit Selection  | Accepted       | Server—Cross-platform deployment                    | [router.md](../specs/router.md)                                          |
| [007](./007-export-with-helpers-pattern.md)                 | Export-with-Helpers Pattern                      | Final          | Core—Message and router API                         | [schema.md](../specs/schema.md), [router.md](../specs/router.md)         |
| [008](./008-middleware-support.md)                          | Middleware Support (Global and Per-Route)        | Accepted       | Core—Auth, logging, rate limiting                   | [router.md](../specs/router.md)                                          |
| [009](./009-error-handling-and-lifecycle-hooks.md)          | Error Handling Helpers and Lifecycle Hooks       | Accepted       | Core—Type-safe errors and observability             | [error-handling.md](../specs/error-handling.md)                          |
| [010](./010-throttled-broadcast-pattern.md)                 | Throttled Broadcast Pattern                      | Accepted       | Optimization—Real-time collaboration                | [patterns.md](../specs/patterns.md)                                      |
| [011](./011-structured-logging-adapter.md)                  | Structured Logging Adapter Interface             | Accepted       | Observability—Production logging integration        | —                                                                        |
| [012](./012-rpc-minimal-reliable.md)                        | Minimal Reliable RPC for WebSocket Routing       | ✅ Implemented | RPC—Abort, backpressure, deadlines, one-shot        | [schema.md](../specs/schema.md), [router.md](../specs/router.md)         |
| [013](./013-rpc-reconnect-idempotency.md)                   | RPC Reconnect & Idempotency Policy               | ✅ Implemented | RPC—Client resend, deduplication patterns           | [client.md](../specs/client.md)                                          |
| [014](./014-rpc-dx-safety-improvements.md)                  | RPC DX & Safety Improvements                     | ✅ Implemented | RPC—Auto-correlation, unicast, error codes          | [schema.md](../specs/schema.md), [client.md](../specs/client.md)         |
| [015](./015-unified-rpc-api-design.md)                      | Unified RPC API with Explicit Primitives         | ✅ Implemented | RPC—Schema unification, reply/progress, taxonomy    | [schema.md](../specs/schema.md), [router.md](../specs/router.md)         |
| [016](./016-connection-data-api-naming.md)                  | Connection Data API Naming                       | ✅ Implemented | API—`assignData()` method naming                    | [router.md](../specs/router.md)                                          |
| [017](./017-message-api-parameter-naming.md)                | Message API Parameter Naming                     | ✅ Implemented | API—`payload`, `response`, `meta` terminology       | [schema.md](../specs/schema.md)                                          |
| [018](./018-broadcast-method-naming.md)                     | Broadcast Method Naming                          | ✅ Implemented | API—`publish()` vs `broadcast()` terminology        | [pubsub.md](../specs/pubsub.md)                                          |
| [019](./019-ctx-publish-convenience-method.md)              | Context-Level Publishing (ctx.publish)           | ✅ Implemented | API—`ctx.publish()` for ergonomic handler DX        | [pubsub.md](../specs/pubsub.md)                                          |
| [020](./020-send-method-naming.md)                          | Send Method Naming                               | ✅ Implemented | API—`send()` vs `unicast()` terminology             | [router.md](../specs/router.md)                                          |
| [021](./021-adapter-first-architecture.md)                  | Adapter-First Architecture for Stateful Features | Proposed       | Architecture—Pluggable, portable adapters           | [rate-limiting](../proposals/rate-limiting.md) proposal                  |
| [022](./022-namespace-first-pubsub-api.md)                  | Namespace-First Pub/Sub API                      | **Final**      | Pub/Sub—Subscriptions, broadcasting, extensibility  | [pubsub.md](../specs/pubsub.md)                                          |
| [023](./023-schema-driven-type-inference.md)                | Schema-Driven Type Inference                     | **Accepted**   | Core—Type safety through schema, no router generics | [schema.md](../specs/schema.md), [router.md](../specs/router.md)         |
| [025](./025-validator-plugins-configurable.md)              | Validator Plugins with Configurable Options      | **Accepted**   | Core—Composable, configurable validators            | [router.md](../specs/router.md), [validation.md](../specs/validation.md) |
| [028](./028-plugin-architecture-final-design.md)            | Plugin Architecture - Final Design               | **Accepted**   | Core—Type-safe plugin API, capability tracking      | [router.md](../specs/router.md)                                          |
| [029](./029-context-enhancer-registry-plugin-safety.md)     | Context Enhancer Registry & Plugin Safety        | **Accepted**   | Core—Safe multi-plugin composition, typed API       | [router.md](../specs/router.md)                                          |

## Status Legend

- **✅ Implemented** — Fully built and tested
- **Final** — Finalized design, ready for implementation
- **Accepted** — Decision agreed upon, work in progress or planned
- **—** — Exploratory or superseded (reference only)

## Structure

Each ADR contains: **Context** (problem) → **Decision** (what) → **Rationale** (why) → **Consequences** (trade-offs).

Immutable records of decisions at a point in time. Superseded decisions reference newer ADRs.
