import { z } from "zod";
import { messageSchema } from "./zod/schema";

// Create schemas using messageSchema
const PingSchema = messageSchema("PING");
const PongSchema = messageSchema("PONG");
const EchoSchema = messageSchema("ECHO", { text: z.string() });

// Try to create discriminated union
try {
  const MessageSchema = z.discriminatedUnion("type", [
    PingSchema,
    PongSchema,
    EchoSchema,
  ]);
  console.log("Success! Discriminated union created");

  // Test that the discriminated union works
  const result = MessageSchema.safeParse({ type: "PING", meta: {} });
  console.log("Parse result:", result.success);
} catch (error) {
  console.error("Failed to create discriminated union:");
  console.error(error instanceof Error ? error.message : String(error));
}

// Let's inspect the shape of a messageSchema
console.log("\nPingSchema shape:", PingSchema.shape);
console.log("\nPingSchema.shape.type:", PingSchema.shape.type);
console.log("\nPingSchema._def:", PingSchema._def);
