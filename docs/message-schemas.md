# Message Schemas

Message schemas define the structure and validation for your WebSocket messages. ws-kit provides a simple, type-safe API for creating and using schemas.

## Export-with-Helpers Pattern

Use the **export-with-helpers pattern** to create schemas—no factories, no dual imports:

```typescript
import { z, message } from "@ws-kit/zod";
// or
import { v, message } from "@ws-kit/valibot";

// Create a schema directly with the message() helper
const LoginMessage = message("LOGIN", {
  username: z.string().min(3).max(20),
  password: z.string().min(8),
});

// Use in routers and clients
const router = createRouter();
router.on(LoginMessage, (ctx) => {
  // ✅ ctx.payload.username is typed as string
  // ✅ ctx.payload.password is typed as string
});
```

**Why this pattern:**

- **Single import source** — Import validator and helpers from one place to prevent dual-package hazards
- **No factories** — `message()` is a simple helper, not a factory-returned function
- **Full type inference** — Constrained generics preserve types through handlers
- **Zero setup friction** — Call `message()` directly, no factory call needed

## Creating Message Schemas

### Messages Without Payload

The simplest message type carries only metadata:

```typescript
const PingMessage = message("PING");
const DisconnectMessage = message("DISCONNECT");

// Usage
router.on(PingMessage, (ctx) => {
  // ctx.type === "PING"
  // No payload available
  console.log("Received ping");
});
```

### Messages With Payload

Add validated payloads using your validator:

**Zod:**

```typescript
import { z, message } from "@ws-kit/zod";

const LoginMessage = message("LOGIN", {
  username: z.string().min(3).max(20),
  password: z.string().min(8),
});

const ChatMessage = message("CHAT", {
  roomId: z.string().uuid(),
  text: z.string().max(1000),
  mentions: z.array(z.string()).optional(),
});
```

**Valibot:**

```typescript
import { v, message } from "@ws-kit/valibot";

const LoginMessage = message("LOGIN", {
  username: v.pipe(v.string(), v.minLength(3), v.maxLength(20)),
  password: v.pipe(v.string(), v.minLength(8)),
});

const ChatMessage = message("CHAT", {
  roomId: v.pipe(v.string(), v.uuid()),
  text: v.pipe(v.string(), v.maxLength(1000)),
  mentions: v.optional(v.array(v.string())),
});
```

## Schema Validation Features

### String Validation (Zod v4)

```typescript
const UserMessage = message("USER_UPDATE", {
  // Basic string constraints
  username: z.string().min(3).max(20),

  // Email validation
  email: z.email(),

  // URL validation
  website: z.url().optional(),

  // Regex patterns
  phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/),

  // Enum values
  role: z.enum(["user", "admin", "moderator"]),

  // JWT validation
  token: z.jwt(),
});
```

### Numbers and Dates

```typescript
const DataMessage = message("DATA", {
  // Number validation
  count: z.number().int().positive(),
  price: z.number().multipleOf(0.01),

  // Date handling
  timestamp: z.number(), // Unix timestamp
  createdAt: z.date().optional(),
});
```

### Complex Types

```typescript
const ComplexMessage = message("COMPLEX", {
  // Arrays
  items: z.array(z.string()),
  scores: z.array(z.number()).nonempty(),

  // Objects
  metadata: z.object({
    source: z.string(),
    version: z.number(),
  }),

  // Unions
  value: z.union([z.string(), z.number()]),

  // Records
  tags: z.record(z.string()),
});
```

## Using Schemas in Routers

### Type-Safe Handlers

Handlers automatically receive typed payloads:

```typescript
const JoinRoom = message("JOIN_ROOM", {
  roomId: z.string().uuid(),
  username: z.string(),
});

router.on(JoinRoom, (ctx) => {
  // ✅ ctx.payload.roomId is string
  // ✅ ctx.payload.username is string
  // ✅ ctx.type is "JOIN_ROOM" (literal)
  console.log(`${ctx.payload.username} joined ${ctx.payload.roomId}`);
});
```

### Type Inference

All types are inferred from the schema:

```typescript
const UserUpdate = message("USER_UPDATE", {
  id: z.number(),
  name: z.string(),
  role: z.enum(["user", "admin"]),
});

router.on(UserUpdate, (ctx) => {
  // All fields are fully typed
  const { id, name, role } = ctx.payload;
  console.log(`User ${id}: ${name} (${role})`);
});
```

## Client-Side Validation

Schemas work client-side too—validate before sending:

```typescript
import { z, message } from "@ws-kit/zod";

const LoginMessage = message("LOGIN", {
  username: z.string(),
  password: z.string(),
});

// Validate on client
const data = {
  type: "LOGIN",
  payload: { username: "alice", password: "secret" },
  meta: {},
};
const result = LoginMessage.safeParse(data);

if (result.success) {
  ws.send(JSON.stringify(result.data));
} else {
  console.error("Validation failed:", result.error);
}
```

## Exporting Schemas

Define schemas in a shared file and reuse server + client:

```typescript
// shared/messages.ts
import { z, message } from "@ws-kit/zod";

export const LoginMessage = message("LOGIN", {
  username: z.string(),
  password: z.string(),
});

export const LoginSuccess = message("LOGIN_SUCCESS", {
  userId: z.string(),
});

export const ChatMessage = message("CHAT", {
  text: z.string(),
});
```

**Server:**

```typescript
import { createRouter } from "@ws-kit/zod";
import { LoginMessage, LoginSuccess, ChatMessage } from "./shared/messages";

const router = createRouter();

router.on(LoginMessage, (ctx) => {
  ctx.send(LoginSuccess, { userId: "123" });
});

router.on(ChatMessage, (ctx) => {
  console.log(ctx.payload.text);
});
```

**Client:**

```typescript
import { wsClient } from "@ws-kit/client/zod";
import { LoginMessage, LoginSuccess, ChatMessage } from "./shared/messages";

const client = wsClient({ url: "wss://api.example.com" });

client.on(LoginSuccess, (msg) => {
  console.log(`Logged in as ${msg.payload.userId}`);
});

client.send(LoginMessage, { username: "alice", password: "secret" });
```

## Discriminated Unions

Create unions of schemas for flexible message handling:

```typescript
const PingMsg = message("PING");
const PongMsg = message("PONG", { latency: z.number() });
const ChatMsg = message("CHAT", { text: z.string() });

// Union type
const AnyMessage = z.discriminatedUnion("type", [PingMsg, PongMsg, ChatMsg]);

// Type narrowing works automatically
router.on(PingMsg, (ctx) => {
  console.log("Ping received");
});

router.on(ChatMsg, (ctx) => {
  console.log(`Chat: ${ctx.payload.text}`);
});
```

## Standard Error Messages

All routers include a standard error message:

```typescript
import { message } from "@ws-kit/zod";

// Available in all validators
const errorCode = z.enum([
  "VALIDATION_ERROR",
  "AUTH_ERROR",
  "INTERNAL_ERROR",
  "NOT_FOUND",
  "RATE_LIMIT",
]);

// Usage
router.on(SomeMessage, (ctx) => {
  if (!authorized) {
    ctx.error("AUTH_ERROR", "Not authorized");
  }
});
```

## Import Warnings

⚠️ **Always use the canonical import source:**

```typescript
// ✅ CORRECT
import { z, message } from "@ws-kit/zod";
const LoginMsg = message("LOGIN", { username: z.string() });

// ❌ AVOID (creates dual-package hazard)
import { z } from "zod";
import { message } from "@ws-kit/zod";
// Now z and message use different Zod instances!
```

**Why this matters:** Discriminated unions depend on all schemas using the same validator instance. Mixed imports cause silent type failures.

See ADR-007 for more details on the export-with-helpers pattern.
