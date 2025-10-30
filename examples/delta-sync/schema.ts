import { z, message } from "@ws-kit/zod";

/**
 * Message schemas for delta synchronization protocol
 */

// ============================================================================
// Data Models
// ============================================================================

export const ParticipantSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["online", "away", "offline"]),
  lastActive: z.number(),
});

export type Participant = z.infer<typeof ParticipantSchema>;

export const RevisionSchema = z.number().int().nonnegative();
export type Revision = z.infer<typeof RevisionSchema>;

// ============================================================================
// Server → Client Messages
// ============================================================================

/**
 * Snapshot sync: Send full state when client is too far behind
 */
export const SnapshotSyncMessage = message(
  "SYNC.SNAPSHOT",
  {
    rev: RevisionSchema,
    participants: z.record(z.string(), ParticipantSchema),
  },
  {
    // Extended meta for debugging
    timestamp: z.number().optional(),
  },
);

/**
 * Operation: A single state change that can be stored and replayed
 */
export const OperationSchema = z.object({
  rev: RevisionSchema,
  type: z.enum([
    "participant.joined",
    "participant.left",
    "participant.updated",
  ]),
  payload: z.unknown(),
  // Server echoes this if operation came from client
  clientReqId: z.string().optional(),
});

export type Operation = z.infer<typeof OperationSchema>;

/**
 * Delta sync: Send only operations since client's last revision
 */
export const DeltaSyncMessage = message(
  "SYNC.DELTAS",
  {
    fromRev: RevisionSchema,
    toRev: RevisionSchema,
    operations: z.array(OperationSchema),
  },
  {
    timestamp: z.number().optional(),
  },
);

// ============================================================================
// Client → Server Messages
// ============================================================================

/**
 * Join the meeting and receive state updates
 */
export const JoinMessage = message("JOIN", {
  participantId: z.string(),
  name: z.string(),
});

/**
 * Update participant state (e.g., status change, name update)
 */
export const UpdateMessage = message("UPDATE", {
  patch: ParticipantSchema.partial(),
  baseRev: RevisionSchema.optional(), // For conflict detection
  clientReqId: z.string(), // Client tracks this for optimistic updates
});

/**
 * Leave the meeting
 */
export const LeaveMessage = message("LEAVE");

/**
 * Heartbeat to keep connection alive
 */
export const HeartbeatMessage = message("HEARTBEAT");

// ============================================================================
// Type Exports
// ============================================================================

export type SnapshotSync = z.infer<typeof SnapshotSyncMessage>;
export type DeltaSync = z.infer<typeof DeltaSyncMessage>;
export type ServerMessage = SnapshotSync | DeltaSync;

export type JoinPayload = z.infer<typeof JoinMessage>;
export type UpdatePayload = z.infer<typeof UpdateMessage>;
export type ClientMessage = JoinPayload | UpdatePayload;
