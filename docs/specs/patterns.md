# Architectural Patterns for WebSocket Applications

This specification describes proven architectural patterns for building scalable, maintainable real-time WebSocket applications with ws-kit.

## Overview

WebSocket applications that handle real-time collaboration, presence, or state synchronization benefit from consistent architectural patterns. This document codifies patterns proven in production systems like Figma, Notion, and Fly.io Party Kit.

## Table of Contents

- [Throttled Broadcast Pattern](#throttled-broadcast-pattern)
- [Dual-Store Architecture](#dual-store-architecture)
- [Revision-Based Delta Synchronization](#revision-based-delta-synchronization)
- [Per-Client Personalization](#per-client-personalization)
- [Heartbeat with Stale Connection Cleanup](#heartbeat-with-stale-connection-cleanup)
- [Optimistic Updates with Reconciliation](#optimistic-updates-with-reconciliation)

---

## Throttled Broadcast Pattern

### Problem

Rapid state changes can cause message spam if broadcast immediately. In real-time collaboration (live cursors, presence updates), clients may send many updates per second, flooding the network and overwhelming clients processing messages.

### Solution

Coalesce rapid messages into fewer broadcasts using a throttle window.

```typescript
import { createRouter } from "@ws-kit/zod";
import { createThrottledPublish } from "@ws-kit/core";

const router = createRouter();

// Wrap router.publish with throttle (50ms window)
const throttledPublish = createThrottledPublish(
  router.publish.bind(router),
  50,
);

// Fast updates are batched
throttledPublish("room", { cursor: { x: 10, y: 20 } });
throttledPublish("room", { cursor: { x: 11, y: 21 } });
throttledPublish("room", { cursor: { x: 12, y: 22 } });

// Only sends once after 50ms with batched message
```

### Characteristics

- **Window**: Configurable throttle window (50-100ms typical)
- **Batching**: Multiple messages coalesced into single broadcast
- **Overhead**: Minimal - just a timer and queue
- **Use Cases**: Live cursors, presence, frequent state updates

### Performance Impact

- **Typical bandwidth reduction**: 80-95% fewer messages in rapid update scenarios (actual reduction depends on throttle window, update frequency, and message distribution)
- **Processing reduction**: Clients process fewer messages by similar magnitude
- **Trade-off**: 50-100ms latency for UI updates

---

## Dual-Store Architecture

### Problem

Server applications manage two distinct concerns:

1. **Domain Logic**: Business state (users, data, rules)
2. **Infrastructure**: Connections, subscriptions, routing

Mixing these concerns makes code harder to test and evolve.

### Solution

Separate domain state from connection metadata into two stores.

```typescript
// Domain store: Pure business logic
interface MeetingStore {
  rev: number;
  participants: Record<string, Participant>;
  recordingId?: string;
}

// Connection store: Infrastructure metadata
interface ConnectedClientsStore {
  clients: Record<
    ParticipantId,
    {
      connection: WebSocket;
      lastSentRev: number;
      lastHeartbeat: number;
    }
  >;
}
```

### Benefits

- **Separation of Concerns**: Business logic independent of WebSocket details
- **Testability**: Domain logic testable without WebSocket infrastructure
- **Reusability**: Domain logic usable with different transports
- **Clarity**: Clear boundaries between layers

### Example

```typescript
// Domain: Pure business state
const meetingStore = createMeetingStore();

meetingStore.onStateChange((newState) => {
  // Notify all connected clients
  connectedClientsStore.trigger.broadcastRequired({
    rev: newState.rev,
  });
});

// Infrastructure: Connection management
const connectedClientsStore = createConnectedClientsStore();

connectedClientsStore.onBroadcastRequired(({ rev }) => {
  // Send personalized updates to each client
  for (const client of clients.values()) {
    const state = buildStateForClientRev(client.lastSentRev, rev);
    send(client.connection, state);
    client.lastSentRev = rev;
  }
});
```

---

## Revision-Based Delta Synchronization

### Problem

Broadcasting entire application state to every client on each change:

- Uses excessive bandwidth
- Scales poorly with state size or client count
- Wastes processing on unchanged data

### Solution

Track state revisions and send only deltas (changes) since client's last revision.

```typescript
interface ServerState {
  rev: number; // Incremented per operation
  data: any;
}

interface Operation {
  rev: number;
  type: string;
  payload: unknown;
}

// Ring buffer stores recent operations
const operationBuffer = new RingBuffer<Operation>(1024);

// On state change
function applyOperation(op: Operation) {
  state.rev++;
  operationBuffer.push({ ...op, rev: state.rev });
}

// For each client, decide between delta or snapshot
function buildSync(clientRev: number) {
  // Try delta sync first
  if (canProvideDeltas(clientRev)) {
    return {
      type: "deltas",
      ops: operationBuffer.range(clientRev, currentRev),
    };
  }

  // Fallback to snapshot if client too far behind
  return {
    type: "snapshot",
    state: getCurrentState(),
  };
}
```

### Benefits

- **Bandwidth**: O(delta_count) instead of O(state_size)
- **Scalability**: Handles large states and many clients
- **Memory**: Fixed ring buffer, no unbounded growth
- **Reconnection**: Handles catch-up gracefully

### Trade-offs

- **Complexity**: More code than simple broadcast
- **State**: Requires maintaining operation history
- **Consistency**: Must handle concurrent operations carefully

### References

- [Operational Transformation](https://en.wikipedia.org/wiki/Operational_transformation)
- [Figma's Multiplayer Architecture](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)

---

## Per-Client Personalization

### Problem

Broadcast patterns send the same message to all clients, but each client's needs differ:

- New clients need full state snapshots
- Existing clients only need deltas
- Clients at different network speeds receive same message size

### Solution

Calculate each client's state based on their last received revision.

```typescript
// Track per-client sync state
const clients = new Map<
  ClientId,
  {
    lastSentRev: number;
    connection: WebSocket;
  }
>();

// Broadcast to all (each gets personalized)
function broadcastUpdate() {
  for (const [clientId, client] of clients) {
    const payload = buildStateForClientRev(client.lastSentRev);
    send(client.connection, payload);
    client.lastSentRev = currentRev;
  }
}

// buildStateForClientRev returns:
// - Snapshot if client is new (lastSentRev = 0)
// - Deltas if client is recent (revisions in buffer)
// - Snapshot if client too far behind (revisions expired from buffer)
```

### Benefits

- **Bandwidth Optimal**: Each client gets minimal needed data
- **Fair**: Slower networks naturally receive smaller messages
- **Scalable**: Reduces total network traffic significantly
- **Seamless**: Clients don't need to handle different message types

---

## Heartbeat with Stale Connection Cleanup

### Problem

Network failures, mobile suspensions, and crashes can leave "ghost" connections that:

- Consume server resources
- Prevent cleanup of associated state
- Don't reliably close from server-side

### Solution

Use heartbeat + timeout with automatic stale connection detection.

```typescript
const router = createRouter({
  heartbeat: {
    intervalMs: 30000, // Send ping every 30s
    timeoutMs: 5000, // Close if no pong in 5s
    onStaleConnection: (clientId, ws) => {
      console.log(`Removing stale connection: ${clientId}`);
      // Clean up resources (room state, presence, etc.)
      removeFromRoom(clientId);
      // Connection auto-closes after callback
    },
  },
});
```

### How It Works

1. Server periodically sends ping frames
2. Client automatically responds with pong (built into WebSocket)
3. If pong not received within `timeoutMs`, connection is stale
4. Optional callback allows cleanup before closing
5. Connection is forcibly closed

### Configuration

- **intervalMs**: How often to ping (default: 30000)
  - Higher = less overhead, slower detection
  - Lower = more overhead, faster detection
  - 30s typical for most apps

- **timeoutMs**: How long to wait for pong (default: 5000)
  - Should account for network latency + processing
  - 5s typical, up to 30s for high-latency networks

### Benefits

- **Automatic**: No manual cleanup code needed
- **Reliable**: Works even if client crashes
- **Fast**: Detects issues in seconds
- **Resource-Aware**: Prevents accumulation of dead connections

---

## Optimistic Updates with Reconciliation

### Problem

Network latency means:

- User waits for server round-trip to see changes
- User experience feels sluggish
- High-latency networks become unusable

### Solution

Apply changes immediately on client, track them as "pending", then reconcile with server.

```typescript
// Client side
class AppState {
  serverState: State;
  pendingOps: PendingOp[] = [];

  // User interacts: apply immediately
  updateName(newName: string) {
    const opId = uuid();

    // 1. Apply optimistically to UI
    this.serverState.name = newName;

    // 2. Track as pending
    this.pendingOps.push({
      id: opId,
      type: "updateName",
      payload: newName,
    });

    // 3. Send to server
    socket.send({
      type: "updateName",
      payload: newName,
      opId,
    });
  }

  // Server responds with ack
  handleServerAck(opId: string) {
    // Remove from pending (operation committed)
    this.pendingOps = this.pendingOps.filter((op) => op.id !== opId);
  }

  // Handle concurrent updates from other users
  handleRemoteUpdate(change: Change) {
    // Rebase pending ops over new server state
    const applied = applyServerChange(this.serverState, change);

    // Re-apply pending ops (in case they depend on changed fields)
    for (const pending of this.pendingOps) {
      applyPendingOp(applied, pending);
    }

    this.serverState = applied;
  }

  // UI sees this: server state + pending ops
  getUIState() {
    let state = this.serverState;
    for (const pending of this.pendingOps) {
      state = applyPendingOp(state, pending);
    }
    return state;
  }
}
```

### Reconciliation Strategy

When server confirms an operation:

```typescript
function reconcile(serverOp: ServerOperation) {
  // 1. Update server truth
  this.serverState = applyOp(this.serverState, serverOp);

  // 2. Remove matching pending op
  if (serverOp.clientOpId) {
    this.pendingOps = this.pendingOps.filter(
      (op) => op.id !== serverOp.clientOpId,
    );
  }

  // 3. Rebase remaining pending ops
  for (const pending of this.pendingOps) {
    // Could detect conflicts here
    pending.baseRev = this.serverState.rev;
  }
}
```

### Benefits

- **Instant Feedback**: UI updates immediately
- **Professional UX**: No waiting for network
- **Conflict Handling**: Can detect and resolve issues
- **Graceful**: Pendings preserved across reconnects

### Trade-offs

- **Complexity**: Requires careful state management
- **Conflicts**: Must handle if user edits same field twice
- **Rollback**: Failed ops may need UI correction

---

## Implementation Checklist

When building a WebSocket app with ws-kit:

### Basic Setup

- [ ] Define message schemas with Zod/Valibot
- [ ] Set up router with message handlers
- [ ] Configure heartbeat with `onStaleConnection` callback
- [ ] Implement `onClose` handler for cleanup

### Optimization (if performance matters)

- [ ] Implement throttled broadcast for rapid updates
- [ ] Add operation buffer for delta sync
- [ ] Track per-client sync state (lastSentRev, etc.)
- [ ] Implement delta vs snapshot logic

### State Management

- [ ] Separate domain state from connection metadata
- [ ] Use stores/state management library (XState, Zustand, etc.)
- [ ] Implement selectors for derived state

### Client Side (if interactive)

- [ ] Track pending operations with unique IDs
- [ ] Apply updates optimistically
- [ ] Reconcile with server deltas
- [ ] Handle conflicts and rollbacks

---

## Real-World References

These patterns are proven in:

- **Figma**: Collaborative design tool with thousands of concurrent users
- **Notion**: Real-time collaborative documents
- **Replicache**: Sync framework for web apps
- **Fly.io Party Kit**: Serverless multiplayer
- **hyper-lite Meeting Demo**: Real-time video conference

See `examples/delta-sync/` for a working implementation.

---

## Further Reading

- ADR-008: Middleware Support
- ADR-009: Error Handling and Lifecycle Hooks
- docs/specs/router.md: Router API
- docs/specs/error-handling.md: Error handling patterns
