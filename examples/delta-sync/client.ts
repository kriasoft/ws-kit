/**
 * Delta Synchronization Client Example
 *
 * Demonstrates client-side state management with:
 * - Optimistic updates (instant UI feedback)
 * - Pending operation tracking
 * - Server reconciliation
 */

import type { Participant, Operation, Revision } from "./schema";
import { SnapshotSyncMessage, DeltaSyncMessage } from "./schema";

// ============================================================================
// Client State Management
// ============================================================================

interface PendingOperation {
  clientReqId: string;
  baseRev: Revision;
  type: string;
  payload: unknown;
}

interface ClientState {
  // Server truth
  serverRev: number;
  participants: Record<string, Participant>;

  // Local optimistic state
  pendingOps: PendingOperation[];
}

class DeltaSyncClient {
  private state: ClientState = {
    serverRev: 0,
    participants: {},
    pendingOps: [],
  };

  private participantId: string;

  constructor(participantId: string) {
    this.participantId = participantId;
  }

  /**
   * Get current materialized view (server state + pending ops applied)
   */
  getMaterializedParticipants(): Record<string, Participant> {
    return this.applyPendingOps(this.state.participants, this.state.pendingOps);
  }

  /**
   * Get current revision
   */
  getCurrentRev(): Revision {
    return this.state.serverRev;
  }

  /**
   * Handle snapshot from server (client was too far behind for deltas)
   */
  handleSnapshot(
    payload: {
      rev: Revision;
      participants: Record<string, Participant>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } & Record<string, any>,
  ): void {
    console.log(`[CLIENT] Received snapshot (rev ${payload.rev})`);

    // Server is source of truth, clear pending ops and rebuild from scratch
    this.state.serverRev = payload.rev;
    this.state.participants = payload.participants;
    this.state.pendingOps = []; // Snapshot invalidates all pending

    this.logState();
  }

  /**
   * Handle delta updates from server
   */
  handleDeltas(
    payload: {
      fromRev: Revision;
      toRev: Revision;
      operations: Operation[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } & Record<string, any>,
  ): void {
    console.log(
      `[CLIENT] Received ${payload.operations.length} deltas (${payload.fromRev} → ${payload.toRev})`,
    );

    // Apply server operations
    for (const op of payload.operations) {
      if (op.type === "participant.joined") {
        const p = op.payload as Participant;
        this.state.participants[p.id] = p;
      } else if (op.type === "participant.updated") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { id, ...patch } = op.payload as any;
        const current = this.state.participants[id];
        if (current) {
          this.state.participants[id] = { ...current, ...patch };
        }
      } else if (op.type === "participant.left") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { id } = op.payload as any;
        const { [id]: _, ...remaining } = this.state.participants;
        this.state.participants = remaining;
      }

      // Ack pending ops if this operation came from us
      if (op.clientReqId) {
        this.ackPendingOp(op.clientReqId);
      }
    }

    this.state.serverRev = payload.toRev;

    // Rebase pending ops on new server state
    this.rebasePendingOps();

    this.logState();
  }

  /**
   * Send optimistic update
   *
   * @returns clientReqId that server will echo back
   */
  sendOptimisticUpdate(patch: Partial<Participant>): string {
    const clientReqId = crypto.randomUUID();

    console.log(`[CLIENT] Sending update: ${clientReqId}`);

    // Apply optimistically to UI immediately
    const current = this.state.participants[this.participantId];
    if (current) {
      this.state.participants[this.participantId] = {
        ...current,
        ...patch,
      };
    }

    // Track as pending
    this.state.pendingOps.push({
      clientReqId,
      baseRev: this.state.serverRev,
      type: "update",
      payload: patch,
    });

    this.logState();

    return clientReqId;
  }

  // ———————————————————————————————————————————————————————————————————————————
  // Private Methods
  // ———————————————————————————————————————————————————————————————————————————

  /**
   * Remove acknowledged pending operation
   */
  private ackPendingOp(clientReqId: string): void {
    const index = this.state.pendingOps.findIndex(
      (op) => op.clientReqId === clientReqId,
    );

    if (index >= 0) {
      console.log(`[CLIENT] Acked pending op: ${clientReqId}`);
      this.state.pendingOps.splice(index, 1);
    }
  }

  /**
   * Rebase pending ops on new server state
   *
   * This ensures pending ops are still valid after server updates.
   * In a real app, might also detect conflicts here.
   */
  private rebasePendingOps(): void {
    // In this simple example, pending ops are stateless patches
    // In more complex apps, might need to detect conflicts or merge

    for (const pending of this.state.pendingOps) {
      // Could validate patch still makes sense after server updates
      // For now, just track that base changed
      pending.baseRev = this.state.serverRev;
    }
  }

  /**
   * Apply pending ops to base state (creates materialized view)
   */
  private applyPendingOps(
    baseParticipants: Record<string, Participant>,
    pending: PendingOperation[],
  ): Record<string, Participant> {
    const result = { ...baseParticipants };

    for (const op of pending) {
      if (op.type === "update" && this.participantId in result) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const patch = op.payload as any;
        result[this.participantId] = {
          ...result[this.participantId],
          ...patch,
        };
      }
    }

    return result;
  }

  /**
   * Log current state for debugging
   */
  private logState(): void {
    const materialized = this.getMaterializedParticipants();
    const self = materialized[this.participantId];

    console.log(`
  Server Rev: ${this.state.serverRev}
  Pending: ${this.state.pendingOps.length}
  Self: ${JSON.stringify(self, null, 2)}
    `);
  }
}

// ============================================================================
// Example Usage
// ============================================================================

if (import.meta.main) {
  const client = new DeltaSyncClient("user-123");

  console.log("=".repeat(60));
  console.log("📱 Client: Receiving snapshot");
  console.log("=".repeat(60));

  // Simulate server sending snapshot
  client.handleSnapshot({
    rev: 3,
    participants: {
      "user-123": {
        id: "user-123",
        name: "Alice",
        status: "online",
        lastActive: Date.now(),
      },
      "user-456": {
        id: "user-456",
        name: "Bob",
        status: "online",
        lastActive: Date.now(),
      },
    },
  });

  console.log("\n" + "=".repeat(60));
  console.log("🚀 Client: Sending optimistic update");
  console.log("=".repeat(60));

  // Client makes update
  const reqId = client.sendOptimisticUpdate({ status: "away" });

  console.log("\n" + "=".repeat(60));
  console.log("📡 Client: Receiving server deltas with ack");
  console.log("=".repeat(60));

  // Simulate server sending deltas with our ack
  client.handleDeltas({
    fromRev: 3,
    toRev: 5,
    operations: [
      {
        rev: 4,
        type: "participant.updated",
        payload: { id: "user-456", status: "away" },
      },
      {
        rev: 5,
        type: "participant.updated",
        payload: { id: "user-123", status: "away" },
        clientReqId: reqId, // Server echoes our request ID
      },
    ],
  });

  console.log("\n" + "=".repeat(60));
  console.log("✨ Final State:");
  console.log("=".repeat(60));
  console.log(JSON.stringify(client.getMaterializedParticipants(), null, 2));
}

export { DeltaSyncClient };
