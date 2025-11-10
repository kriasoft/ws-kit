/**
 * Shared types for the dispatch pipeline.
 */

/**
 * Message envelope: transport-layer structure for incoming messages.
 * Contains message type, optional payload, and optional metadata.
 * Parsed from raw JSON frame without validation.
 */
export interface MessageEnvelope {
  type: string;
  payload?: unknown;
  meta?: Record<string, unknown>;
}
