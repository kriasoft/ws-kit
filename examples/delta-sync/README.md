# Delta Synchronization Example

This example demonstrates a production-grade state synchronization pattern for collaborative real-time applications using **revision-based delta sync** similar to operational transformation.

## What is Delta Sync?

Instead of broadcasting the entire application state to every client on each update, delta sync sends only the changes (deltas) that have occurred since the client last received state. This pattern:

- **Reduces bandwidth** by sending only diffs instead of full state
- **Scales efficiently** with many concurrent users
- **Handles reconnections gracefully** by sending snapshots to far-behind clients
- **Optimizes for modern networks** where bandwidth is precious

## Architecture

### State Management

```
Server Canonical State
├── Revision Counter (incremented per operation)
├── Operation History (ring buffer, e.g., last 1024 ops)
└── Current State Snapshot

Client Local State
├── Server State (last known)
├── Pending Operations (optimistically applied)
└── Materialized View (server + pending)
```

### Synchronization Strategies

The example uses two strategies depending on how far behind a client is:

**1. Delta Sync** (client is within buffer range)

- Sends operations that occurred since client's last revision
- Minimal bandwidth, fast processing
- Used when client is only slightly behind

**2. Snapshot Sync** (client is too far behind)

- Sends complete current state snapshot
- Used as fallback when buffer doesn't have enough history
- Prevents massive operation lists on heavy catch-up

## Files

- `schema.ts` - Zod message schemas and types
- `server.ts` - Server implementation with state management
- `client.ts` - Client with optimistic updates
- `ring-buffer.ts` - Operation history buffer (reusable utility)

## Running the Example

```bash
# Install dependencies
bun install

# Run server
bun run server.ts

# Run conformance tests (validates schema and state machine)
bun test conformance.test.ts
```

**Note:** The `client.ts` file contains the `DeltaSyncClient` state management class. See `conformance.test.ts` for integration examples showing how to connect the client to the server.

## Key Patterns

### 1. Revision-Based State

Every state change increments a global revision number:

```typescript
interface ServerState {
  rev: number; // Incremented on each operation
  participants: Record<string, Participant>;
}
```

### 2. Operation History

Operations are stored in a ring buffer with fixed size:

```typescript
interface Operation {
  rev: number; // Revision when this operation was applied
  type: string;
  payload: unknown;
}

// Ring buffer keeps last N operations
const buffer = new RingBuffer<Operation>(1024);
buffer.push(operation);

// Query range of operations
const deltas = buffer.range(fromRev, toRev);
```

### 3. Per-Client Sync State

Track each client's synchronization state:

```typescript
interface ClientState {
  connection: Connection;
  lastSentRev: number; // Last revision sent to this client
  lastHeartbeat: number;
}
```

### 4. Personalized Broadcasts

Each client receives deltas based on their position:

```typescript
for (const client of connections.values()) {
  const state = buildStateForClientRev(client.lastSentRev);
  // state contains either deltas or snapshot
  send(client.connection, state);
}
```

### 5. Optimistic Updates (Client Side)

Apply changes immediately while server processes:

```typescript
// Optimistically update UI
store.update({
  baseRev: serverRev,
  patch: { status: "away" },
  clientReqId: uuid(),
});

// Send to server
socket.send({
  type: "update",
  payload: { status: "away" },
  clientReqId: uuid(),
});

// Server echoes clientReqId when committed
socket.on("sync", (ops) => {
  ackPendingOps(ops); // Remove from pending if matched
  applyPendingOps(); // Rebase remaining
});
```

## Performance Characteristics

- **Memory**: O(buffer_size) - fixed ring buffer, no unbounded growth
- **Per-broadcast**: O(delta_count) - sends only changed operations
- **First-connection**: O(state_size) - sends full snapshot once
- **Reconnection**: O(delta_count) or O(state_size) depending on latency

## Real-World Applications

This pattern powers:

- **Figma** - Real-time multiplayer design
- **Notion** - Collaborative documents
- **Replicache** - Sync framework for web apps
- **Fly.io Party Kit** - WebSocket multiplayer

## Next Steps

1. **Add persistence** - Store operations in database for durability
2. **Add conflict resolution** - Handle concurrent edits
3. **Add presence** - Track who's online, active users
4. **Scale to multiple servers** - Use Redis for PubSub
5. **Implement CRDTs** - For stronger consistency guarantees

## References

- [Operational Transformation](https://en.wikipedia.org/wiki/Operational_transformation)
- [Figma's Multiplayer Technology](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
- [Replicache Documentation](https://doc.replicache.dev/)
