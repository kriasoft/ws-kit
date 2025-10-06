// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Example demonstrating typed WebSocket client usage with Zod schemas.
 *
 * This example shows:
 * - Full type inference in message handlers
 * - Payload conditional typing (with/without payload)
 * - Extended meta field support
 * - Request/response patterns
 *
 * @see specs/adrs.md#ADR-002 - Type override implementation
 * @see specs/client.md - Full client API
 */

import { z } from "zod";
import { createMessageSchema } from "../zod/index.js";
import { createClient } from "../zod/client.js";

// Create schema factory
const { messageSchema } = createMessageSchema(z);

// Define message schemas
const Hello = messageSchema("HELLO", { name: z.string() });
const HelloOk = messageSchema("HELLO_OK", { text: z.string() });
const Logout = messageSchema("LOGOUT"); // No payload
const LogoutOk = messageSchema("LOGOUT_OK"); // No payload
const ChatMessage = messageSchema(
  "CHAT",
  { text: z.string() },
  { roomId: z.string() }, // Required extended meta
);

// Create typed client
const client = createClient({
  url: "wss://api.example.com",
  autoConnect: true,
  reconnect: { enabled: true },
});

// ============================================================================
// Type-Safe Message Handlers
// ============================================================================

// ✅ Handler receives fully typed message
client.on(HelloOk, (msg) => {
  // msg.type is "HELLO_OK" (literal type)
  console.log(`Type: ${msg.type}`);

  // msg.payload is { text: string }
  console.log(`Text: ${msg.payload.text.toUpperCase()}`);

  // msg.meta has timestamp and correlationId
  if (msg.meta.timestamp) {
    console.log(`Received at: ${new Date(msg.meta.timestamp).toISOString()}`);
  }
});

// ✅ No-payload schema - handler has no payload access
client.on(Logout, (msg) => {
  console.log(`User logged out: ${msg.type}`);

  // msg.payload does not exist (compile error if accessed)
});

// ✅ Extended meta - required field enforced
client.on(ChatMessage, (msg) => {
  // msg.meta.roomId is string (required field)
  console.log(`Message in room ${msg.meta.roomId}: ${msg.payload.text}`);
});

// ============================================================================
// Type-Safe Sending
// ============================================================================

async function sendExamples() {
  await client.connect();

  // ✅ Send with payload (payload required)
  client.send(Hello, { name: "Alice" });

  // ❌ Compile error - payload required but missing
  // client.send(Hello); // Type error!

  // ✅ Send without payload (payload omitted)
  client.send(Logout);

  // ❌ Compile error - payload should not be provided
  // client.send(Logout, {}); // Type error!

  // ✅ Send with extended meta
  client.send(
    ChatMessage,
    { text: "Hello everyone!" },
    { meta: { roomId: "general" } },
  );

  // ❌ Compile error - opts.meta.roomId is required
  // client.send(ChatMessage, { text: "Hello" }); // Type error: meta.roomId is required
}

// ============================================================================
// Type-Safe Request/Response
// ============================================================================

async function requestExamples() {
  await client.connect();

  // ✅ Request with typed reply (with payload)
  const reply = await client.request(Hello, { name: "Bob" }, HelloOk, {
    timeoutMs: 5000,
  });

  // reply is fully typed: { type: "HELLO_OK", meta: {...}, payload: { text: string } }
  console.log(`Server replied: ${reply.payload.text}`);

  // ✅ Request without payload (no-payload schema)
  const logoutReply = await client.request(Logout, LogoutOk, {
    timeoutMs: 5000,
  });

  // logoutReply is typed: { type: "LOGOUT_OK", meta: {...} }
  console.log(`Logged out at: ${logoutReply.type}`);

  // ❌ Compile error - no-payload schema doesn't accept payload parameter
  // const invalidReply = await client.request(Logout, {}, LogoutOk, { timeoutMs: 5000 });

  // ✅ Request with AbortSignal
  const controller = new AbortController();

  const promise = client.request(Hello, { name: "Charlie" }, HelloOk, {
    signal: controller.signal,
  });

  // Cancel if needed
  // controller.abort();

  try {
    const result = await promise;
    console.log(result.payload.text);
  } catch (err) {
    console.error("Request failed:", err);
  }
}

// ============================================================================
// Generic Client (Fallback - No Type Inference)
// ============================================================================

// For comparison: generic client requires manual type assertions
import { createClient as createGenericClient } from "../client/index.js";
import type { InferMessage } from "../zod/types.js";

const genericClient = createGenericClient({ url: "wss://api.example.com" });

genericClient.on(HelloOk, (msg) => {
  // ⚠️ msg is unknown - requires manual type assertion
  const typed = msg as InferMessage<typeof HelloOk>;
  console.log(typed.payload.text);
});

// ============================================================================
// Run Examples (Type Demonstration Only)
// ============================================================================

// Note: These functions are for demonstrating compile-time type safety.
// They won't run successfully without a real WebSocket server.
// Uncomment to test with a live server:

// sendExamples().catch(console.error);
// requestExamples().catch(console.error);
