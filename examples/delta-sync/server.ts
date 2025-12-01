// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Delta Synchronization Server Example
 *
 * Demonstrates revision-based state sync with operation history.
 * Perfect for collaborative apps where bandwidth matters.
 */

import { serve } from "@ws-kit/bun";
import type { RouterWithExtensions, ServerWebSocket } from "@ws-kit/core";
import { createRouter, message, withZod } from "@ws-kit/zod";
import { RingBuffer } from "./ring-buffer.js";
import {
  JoinMessage,
  LeaveMessage,
  UpdateMessage,
  type Operation,
  type Participant,
} from "./schema.js";

// ============================================================================
// Server State Management
// ============================================================================

interface ServerState {
  rev: number; // Current revision number
  participants: Record<string, Participant>;
}

interface ClientState {
  participantId: string;
  lastSentRev: number; // Last revision sent to this client
  lastHeartbeat: number;
  ws: ServerWebSocket; // WebSocket connection for sending messages
}

type AppData = Record<string, unknown> & {
  clientId: string;
  participantId?: string;
};

class DeltaSyncServer {
  private state: ServerState = {
    rev: 0,
    participants: {},
  };

  // Store last N operations for delta sync
  private operations = new RingBuffer<Operation>(1024);

  // Track connected clients and their sync state
  private clients = new Map<string, ClientState>();
  private connectionIndex = new Map<string, string>();

  /**
   * Initialize router with message handlers
   */
  createRouter(): {
    router: RouterWithExtensions<AppData, object>;
    cleanup: () => void;
  } {
    const router = createRouter<AppData>().plugin(withZod());

    router.on(JoinMessage, async (ctx) => {
      const { participantId, name } = ctx.payload;

      console.log(`[JOIN] ${participantId} (${name})`);

      // Set participantId in connection data for later handlers
      ctx.assignData({ participantId });

      // Create new participant
      const participant: Participant = {
        id: participantId,
        name,
        status: "online",
        lastActive: Date.now(),
      };

      // Record client connection
      this.clients.set(participantId, {
        participantId,
        lastSentRev: 0, // Will get full snapshot
        lastHeartbeat: Date.now(),
        ws: ctx.ws,
      });
      this.connectionIndex.set(ctx.clientId, participantId);

      // Add to state and emit operation
      this.addParticipant(participant);

      // Send full snapshot to new client
      this.sendSnapshot(participantId);

      // Notify other clients of the new participant (optional cast for testing)
      if (ctx.ws) {
        this.broadcastDelta();
      }
    });

    router.on(UpdateMessage, async (ctx) => {
      const { patch, clientReqId } = ctx.payload;
      const participantId = ctx.data?.participantId as string;

      if (!participantId) {
        ctx.error("UNAUTHENTICATED", "No participant ID");
        return;
      }

      console.log(`[UPDATE] ${participantId}:`, patch);

      // Apply update to state
      const updated = this.updateParticipant(participantId, patch, clientReqId);

      if (updated) {
        // Notify all clients (batched)
        this.broadcastDelta();
      }
    });

    router.on(LeaveMessage, async (ctx) => {
      const participantId = ctx.data?.participantId as string;

      if (!participantId) return;

      console.log(`[LEAVE] ${participantId}`);

      // Remove from state
      this.removeParticipant(participantId);
      this.connectionIndex.delete(ctx.clientId);

      // Notify others
      this.broadcastDelta();
    });

    // Heartbeat to detect stale connections
    router.on(message("HEARTBEAT"), async (ctx) => {
      const participantId = ctx.data?.participantId as string | undefined;
      if (participantId) {
        const client = this.clients.get(participantId);
        if (client) {
          client.lastHeartbeat = Date.now();
        }
      }
    });

    router.observe({
      onConnectionClose: (clientId) => {
        const participantId = this.connectionIndex.get(clientId);
        if (!participantId) return;

        console.log(`[CLOSE] ${participantId}`);
        this.clients.delete(participantId);
        this.connectionIndex.delete(clientId);
      },
    });

    // Setup heartbeat with stale connection cleanup
    const heartbeatInterval = setInterval(() => {
      this.cleanupStaleConnections();
    }, 15000); // Check every 15 seconds

    return {
      router,
      cleanup: () => clearInterval(heartbeatInterval),
    };
  }

  // ———————————————————————————————————————————————————————————————————————————
  // State Mutations
  // ———————————————————————————————————————————————————————————————————————————

  private addParticipant(participant: Participant): void {
    this.state.rev++;
    this.state.participants[participant.id] = participant;

    this.operations.push({
      rev: this.state.rev,
      type: "participant.joined",
      payload: participant,
    });
  }

  private updateParticipant(
    participantId: string,
    patch: Record<string, unknown>,
    clientReqId?: string,
  ): boolean {
    const current = this.state.participants[participantId];
    if (!current) return false;

    this.state.rev++;
    this.state.participants[participantId] = {
      ...current,
      ...(Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      ) as Partial<Participant>),
    };

    this.operations.push({
      rev: this.state.rev,
      type: "participant.updated",
      payload: { id: participantId, ...patch },
      clientReqId,
    });

    return true;
  }

  private removeParticipant(participantId: string): void {
    if (!(participantId in this.state.participants)) return;

    this.state.rev++;
    const { [participantId]: _, ...remaining } = this.state.participants;
    this.state.participants = remaining;

    this.operations.push({
      rev: this.state.rev,
      type: "participant.left",
      payload: { id: participantId },
    });
  }

  // ———————————————————————————————————————————————————————————————————————————
  // Synchronization
  // ———————————————————————————————————————————————————————————————————————————

  /**
   * Send full state snapshot to a client
   */
  private sendSnapshot(participantId: string): void {
    const client = this.clients.get(participantId);
    if (!client) return;

    const payload = {
      rev: this.state.rev,
      participants: this.state.participants,
    };

    // Send typed snapshot message via raw WebSocket
    const msg = JSON.stringify({ type: "SYNC.SNAPSHOT", payload });
    client.ws.send(msg);

    // Update last sent revision
    client.lastSentRev = this.state.rev;
  }

  /**
   * Broadcast delta updates to all connected clients
   */
  private broadcastDelta(): void {
    for (const [participantId, client] of this.clients) {
      // Try delta sync first
      if (this.operations.canProvideDeltas(client.lastSentRev)) {
        const ops = this.operations.range(client.lastSentRev, this.state.rev);

        if (ops) {
          // Send delta
          const payload = {
            fromRev: client.lastSentRev,
            toRev: this.state.rev,
            operations: ops,
          };

          const msg = JSON.stringify({ type: "SYNC.DELTAS", payload });
          client.ws.send(msg);

          console.log(
            `[DELTA] Sent ${ops.length} ops to ${participantId} (${client.lastSentRev} → ${this.state.rev})`,
          );

          client.lastSentRev = this.state.rev;
          continue;
        }
      }

      // Client is too far behind - send REVISION_GAP error first
      console.log(
        `[REVISION_GAP] ${participantId} too far behind (${client.lastSentRev} → ${this.state.rev})`,
      );

      const bufferFirstRev = this.operations.firstRev;
      const msg = JSON.stringify({
        type: "REVISION_GAP",
        payload: {
          expectedRev: client.lastSentRev,
          serverRev: this.state.rev,
          bufferFirstRev,
          resumeFrom: this.state.rev,
        },
      });
      client.ws.send(msg);

      // Then send snapshot for recovery
      this.sendSnapshot(participantId);
    }
  }

  /**
   * Remove clients that haven't sent heartbeat recently
   */
  private cleanupStaleConnections(): void {
    const now = Date.now();
    const heartbeatTimeout = 45000; // 45 seconds

    for (const [participantId, client] of this.clients) {
      if (now - client.lastHeartbeat > heartbeatTimeout) {
        console.log(`[STALE] Removing ${participantId} (no heartbeat)`);
        this.removeParticipant(participantId);
        this.clients.delete(participantId);
      }
    }
  }

  // ———————————————————————————————————————————————————————————————————————————
  // Statistics
  // ———————————————————————————————————————————————————————————————————————————

  getStats() {
    return {
      revision: this.state.rev,
      participants: Object.keys(this.state.participants).length,
      connectedClients: this.clients.size,
      operationBufferSize: this.operations.size,
    };
  }
}

// ============================================================================
// Example Usage
// ============================================================================

if (import.meta.main) {
  const server = new DeltaSyncServer();
  const { router, cleanup } = server.createRouter();

  // Log stats periodically
  const statsInterval = setInterval(() => {
    console.log("\n📊 Server Stats:", server.getStats());
  }, 10000);

  // Serve with Bun
  serve(router, {
    port: parseInt(process.env.PORT || "3000"),
    authenticate(): { clientId: string } {
      return { clientId: crypto.randomUUID() };
    },
  }).catch(console.error);

  console.log("✅ Delta sync server initialized");
  console.log("   - Operation buffer size: 1024");
  console.log("   - Heartbeat timeout: 45s");
  console.log("   - Update interval: 10s");

  // Cleanup on exit
  process.on("SIGINT", () => {
    cleanup();
    clearInterval(statsInterval);
    console.log("\n👋 Server shutdown");
    process.exit(0);
  });
}

export { DeltaSyncServer };
