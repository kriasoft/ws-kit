/**
 * Cloudflare Worker Entry Point
 *
 * Routes incoming WebSocket upgrade requests to sharded Durable Object instances.
 *
 * Usage:
 * - Deploy both `router.ts` and `server.ts` as a single Cloudflare Worker
 * - `router.ts` is the main fetch handler (entry point)
 * - `server.ts` exports the WebSocketRouter Durable Object class
 *
 * wrangler.toml must include:
 * [[durable_objects.bindings]]
 * name = "ROUTER"
 * class_name = "WebSocketRouter"
 */

import { getShardedStub } from "@ws-kit/cloudflare-do/sharding";

interface Env {
  ROUTER: DurableObjectNamespace;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // Extract room ID from URL query parameter
    const url = new URL(req.url);
    const roomId = url.searchParams.get("room") ?? "general";

    // Get a stable shard for this room
    // Same room always routes to the same DO instance
    const stub = getShardedStub(env, `room:${roomId}`, 10);

    // Forward HTTP upgrade to the sharded DO
    // The DO's fetch handler will upgrade to WebSocket
    return stub.fetch(req);
  },
} satisfies ExportedHandler<Env>;
