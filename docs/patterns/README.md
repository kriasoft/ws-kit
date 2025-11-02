# Application Patterns

These are production patterns for real-time applications using WS-Kit. They are **not core WS-Kit features**, but composable examples that use `router.on()` handlers with ctx methods.

## Patterns

### [State Channels](./state-channels.md)

**Guarantees:** FIFO ordered state updates with client seq tracking and gap detection.

**Use when:** you need reliable state ordering and recovery from temporary disconnects.

**Examples:** [examples/state-channels/](../../examples/state-channels/)

### [Delta Sync](./delta-sync.md)

**Guarantees:** Efficient bandwidth via operation deltas, with fallback snapshots and explicit gap recovery.

**Use when:** state is large and bandwidth matters (collaborative apps, gaming, real-time dashboards).

**Examples:** [examples/delta-sync/](../../examples/delta-sync/)

### [Flow Control](./flow-control.md)

**Guarantees:** Backpressure policies (drop-oldest, drop-new, queue) with retry hints.

**Use when:** client send rate may exceed server processing capacity.

**Examples:** [examples/flow-control/](../../examples/flow-control/)

## Canonical Rules

See [docs/invariants.md](../invariants.md) for:

- Canonical field names (`seq`, `rev`, `resumeFrom`, `policy`, `retryAfterMs`)
- DO / DON'T rules
- Error codes and retry semantics
- Fixture conformance requirements

## Architecture Decision Records

- [ADR-021: Adapter-First Architecture](../adr/021-adapter-first-architecture.md) — foundation for extensible patterns
- (More ADRs coming as patterns evolve)

## Implementing a New Pattern

See [CLAUDE.md](../../CLAUDE.md) under "Implementing Patterns" for a step-by-step checklist.
