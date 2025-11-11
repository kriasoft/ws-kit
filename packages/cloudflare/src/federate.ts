// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { DurableObjectNamespace, DurableObjectStub } from "./types.js";

/**
 * Broadcast a message to a set of Durable Object instances (shards).
 *
 * Use this to explicitly coordinate across multiple DO instances. Each DO
 * is isolated by default—this helper provides the bridge for federation.
 *
 * **When to use**:
 * - Multi-DO setups: sharded chat rooms, game sessions per region, etc.
 * - Cross-shard announcements: broadcast to multiple rooms/games
 * - Explicit federation: clear intent in code; prevents accidental cross-shard leaks
 *
 * **When NOT needed**:
 * - Single DO per resource: one DO per room → use router.publish() directly
 * - Local-only broadcasts: use router.publish() for BroadcastChannel messaging
 *
 * **Usage**:
 * ```typescript
 * import { federate } from "@ws-kit/cloudflare";
 *
 * // Broadcast to multiple room shards
 * await federate(env.ROOMS, ["room:1", "room:2", "room:3"], async (room) => {
 *   await room.fetch(new Request("https://internal/announce", {
 *     method: "POST",
 *     body: JSON.stringify({ event: "MAINTENANCE_NOTICE" }),
 *   }));
 * });
 *
 * // Notify all players in multiple game sessions
 * const gameIds = ["game:1", "game:2", "game:3"];
 * await federate(env.GAMES, gameIds, async (game) => {
 *   await game.fetch(new Request("https://internal/game/announce", {
 *     method: "POST",
 *     body: JSON.stringify({ text: "Server will restart in 5 minutes" }),
 *   }));
 * });
 * ```
 *
 * **Error handling**:
 * - Uses `Promise.allSettled()` so one shard failure doesn't block others
 * - Check returned PromiseSettledResult for individual errors
 *
 * **Cost implications**:
 * - Each `fetch()` call counts as a Durable Object request
 * - Suitable for occasional cross-shard coordination
 * - For frequent cross-shard messaging, consider Redis PubSub instead
 *
 * @param namespace - Durable Object namespace binding (e.g., env.ROOMS)
 * @param shardIds - Array of shard identifiers (room IDs, game IDs, etc.)
 * @param action - Async function called with each shard's stub
 *
 * @returns Promise that resolves when all shards have been processed
 *
 * @example
 * // Broadcast to all chat rooms
 * const roomIds = ["general", "announcements", "support"];
 * await federate(env.CHAT_ROOMS, roomIds, async (room) => {
 *   await room.fetch("https://internal/broadcast", {
 *     method: "POST",
 *     body: JSON.stringify({ type: "MAINTENANCE", duration: 300 }),
 *   });
 * });
 */
export async function federate<T extends DurableObjectNamespace>(
  namespace: T,
  shardIds: string[],
  action: (shard: DurableObjectStub) => Promise<void>,
): Promise<PromiseSettledResult<void>[]> {
  const promises = shardIds.map((id) => action(namespace.get(id)));
  return Promise.allSettled(promises);
}

/**
 * Type-safe helper for federating with error handling.
 *
 * This variant collects errors and allows you to decide how to handle failures
 * per shard.
 *
 * **Usage**:
 * ```typescript
 * const results = await federateWithErrors(env.ROOMS, ["room:1", "room:2"], async (room) => {
 *   const res = await room.fetch("https://internal/sync");
 *   if (!res.ok) throw new Error(`Failed: ${res.status}`);
 *   return res.json();
 * });
 *
 * results.forEach((result, index) => {
 *   if (result.status === "rejected") {
 *     console.error(`Shard ${shardIds[index]} failed:`, result.reason);
 *   } else {
 *     console.log(`Shard ${shardIds[index]} succeeded`);
 *   }
 * });
 * ```
 *
 * @param namespace - Durable Object namespace binding
 * @param shardIds - Array of shard identifiers
 * @param action - Async function for each shard
 *
 * @returns Array of PromiseSettledResults with detailed status info
 */
export async function federateWithErrors<T extends DurableObjectNamespace>(
  namespace: T,
  shardIds: string[],
  action: (shard: DurableObjectStub) => Promise<unknown>,
): Promise<PromiseSettledResult<unknown>[]> {
  const promises = shardIds.map((id) => action(namespace.get(id)));
  return Promise.allSettled(promises);
}

/**
 * Broadcast to a subset of shards matching a filter.
 *
 * Useful when shard IDs follow a pattern and you only want to target a subset.
 *
 * **Usage**:
 * ```typescript
 * // Only notify shards in specific regions
 * const regionShards = ["us:room:1", "us:room:2", "eu:room:1"];
 * await federateWithFilter(env.ROOMS, regionShards,
 *   (id) => id.startsWith("us:"),
 *   async (room) => {
 *     // Only US regions
 *   }
 * );
 * ```
 *
 * @param namespace - Durable Object namespace binding
 * @param shardIds - Array of shard identifiers
 * @param filter - Function to test each shard ID
 * @param action - Async function for matching shards
 *
 * @returns Promise that resolves when all matching shards are processed
 */
export async function federateWithFilter<T extends DurableObjectNamespace>(
  namespace: T,
  shardIds: string[],
  filter: (id: string) => boolean,
  action: (shard: DurableObjectStub) => Promise<void>,
): Promise<void> {
  const filteredIds = shardIds.filter(filter);
  await Promise.allSettled(
    filteredIds.map((id) =>
      action(namespace.get(id)).catch((error) => {
        console.error(`[federate] Error in shard ${id}:`, error);
      }),
    ),
  );
}
