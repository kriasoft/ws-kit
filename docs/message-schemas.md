# Message Schemas

Message schemas are the foundation of type-safe WebSocket communication in Bun WebSocket Router. They define the structure and validation rules for your messages.

## Factory Pattern (Required)

**Required since v0.4.0** to fix discriminated union support. The factory pattern ensures proper type inference and prevents dual package hazard:

```typescript
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";

// Create the factory with your validator instance
const { messageSchema, createMessage, ErrorMessage, ErrorCode } =
  createMessageSchema(z);
```

::: warning MIGRATION
The old direct `messageSchema` export from root package is **deprecated** and will be removed in v1.0. Update imports to use factory pattern as shown above.
:::

## Creating Message Schemas

### Basic Messages

The simplest schema is a message without a payload:

```typescript
// After creating the factory as shown above
const PingMessage = messageSchema("PING");
const DisconnectMessage = messageSchema("DISCONNECT");
```

### Messages with Payloads

Add validated payloads using Zod or Valibot:

::: code-group

```typescript [Zod]
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";

const { messageSchema } = createMessageSchema(z);

const LoginMessage = messageSchema("LOGIN", {
  username: z.string().min(3).max(20),
  password: z.string().min(8),
});

const ChatMessage = messageSchema("CHAT_MESSAGE", {
  text: z.string().max(1000),
  roomId: z.uuid(),
  mentions: z.array(z.string()).optional(),
});
```

```typescript [Valibot]
import * as v from "valibot";
import { createMessageSchema } from "bun-ws-router/valibot";

const { messageSchema } = createMessageSchema(v);

const LoginMessage = messageSchema("LOGIN", {
  username: v.pipe(v.string(), v.minLength(3), v.maxLength(20)),
  password: v.pipe(v.string(), v.minLength(8)),
});

const ChatMessage = messageSchema("CHAT_MESSAGE", {
  text: v.pipe(v.string(), v.maxLength(1000)),
  roomId: v.pipe(v.string(), v.uuid()),
  mentions: v.optional(v.array(v.string())),
});
```

:::

## Schema Validation Features

### String Validation (Zod v4 Features)

```typescript
const UserMessage = messageSchema("USER_UPDATE", {
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

  // Advanced string validators
  jwt: z.jwt(), // JWT token validation
  ipv4: z.ipv4(), // IPv4 address
  ipv6: z.ipv6(), // IPv6 address
  ulid: z.ulid(), // ULID validation
  nanoid: z.nanoid(), // NanoID validation
  datetime: z.iso.datetime(), // ISO datetime string
});
```

### Number Validation

```typescript
const GameMessage = messageSchema("GAME_UPDATE", {
  // Integer validation
  score: z.number().int().min(0),

  // Float with precision
  position: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
  }),

  // Range validation
  health: z.number().min(0).max(100),

  // Multiple of constraint
  price: z.number().multipleOf(0.01), // For currency
  quantity: z.number().int().multipleOf(5), // Must be multiple of 5
});
```

### Complex Types

```typescript
const OrderMessage = messageSchema("CREATE_ORDER", {
  // Nested objects
  customer: z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.email(),
  }),

  // Arrays with validation
  items: z
    .array(
      z.object({
        productId: z.string(),
        quantity: z.number().int().positive(),
        price: z.number().positive(),
      }),
    )
    .min(1)
    .max(50),

  // Union types
  payment: z.union([
    z.object({ type: z.literal("card"), last4: z.string() }),
    z.object({ type: z.literal("paypal"), email: z.email() }),
  ]),

  // Optional with default
  notes: z.string().optional().default(""),
});
```

## Custom Metadata

Add custom metadata to messages by providing a third parameter (a direct object, not wrapped):

```typescript
const AuthenticatedMessage = messageSchema(
  "AUTHENTICATED_ACTION",
  { action: z.string() },
  {
    // Defining base fields makes them required (overrides optional defaults)
    correlationId: z.uuid(), // Now required (was optional in base)
    version: z.string(), // Custom field
  },
);

// Resulting meta type:
// {
//   timestamp?: number,     // Still optional (auto-added by ctx.send()/publish())
//   correlationId: string,  // Required (redefined above)
//   version: string,        // Required custom field
// }
```

## Strict Schema Enforcement

::: warning SECURITY REQUIREMENT
All schemas are **strict by default** - they reject unknown keys at all levels (root, meta, payload). This is a security feature and cannot be disabled.
:::

### Why Strict Schemas Matter

**Security Benefits:**

1. **DoS Prevention**: Prevents attackers from sending unbounded unknown fields that could exhaust server memory
2. **Contract Enforcement**: Handlers trust schema validation; unknown keys violate this security contract
3. **Wire Cleanliness**: Catches client bugs early (e.g., sending `payload` when schema expects none)
4. **Type Safety**: Ensures runtime data exactly matches TypeScript types

**Example Attack Vector (Prevented by Strict Mode):**

```typescript
// ❌ Without strict mode, attacker could send:
{
  type: "CHAT_MESSAGE",
  payload: { text: "hi" },
  extraField1: "x".repeat(1000000),  // 1MB of garbage
  extraField2: "y".repeat(1000000),  // 1MB of garbage
  // ... exhaust memory
}

// ✅ With strict mode (enforced), validation rejects this immediately
// Error: Unknown keys not allowed: extraField1, extraField2
```

**Client-Server Symmetry:**

Strict schemas work on both client and server, catching mistakes before they reach production:

```typescript
// Client tries to send invalid message
const msg = createMessage(ChatMessage, {
  text: "hello",
  typo: "oops", // ❌ Validation fails client-side
});

if (!msg.success) {
  // Caught before sending to server
  console.error("Validation failed:", msg.error);
}
```

## Reserved Meta Fields

The following meta fields are **reserved for security** and cannot be defined in schemas or sent by clients:

- **`clientId`** - Connection identity (UUID v7, auto-generated during WebSocket upgrade)
  - Access via `ctx.ws.data.clientId` (not `ctx.meta.clientId`)
  - Router strips this from client messages before validation (security boundary)

- **`receivedAt`** - Server receive timestamp (milliseconds since epoch, `Date.now()`)
  - Access via `ctx.receivedAt` (not `ctx.meta.receivedAt`)
  - Captured before parsing, authoritative for all server-side logic

### Why Reserved?

1. **Connection identity belongs to transport layer** (not message payload)
   - Prevents wire bloat (no need to send UUID in every message)
   - Eliminates spoofing vectors (client cannot set connection identity)

2. **Preserves client-side validation symmetry**
   - Schemas work on both client and server
   - Clients can validate messages they send

3. **Security boundary via normalization**
   - Router strips reserved keys before validation
   - Handlers never receive un-normalized, spoofed data

This is a security boundary that prevents client spoofing of server-controlled fields.

### Schema Enforcement

Extended meta schemas MUST NOT define reserved keys. The router throws at schema creation:

```typescript
// ❌ This throws immediately (caught at design time)
const BadSchema = messageSchema(
  "BAD",
  { text: z.string() },
  { clientId: z.string() }, // Error: Reserved meta keys not allowed: clientId
);

// ✅ Correct access in handlers
router.on(GoodSchema, (ctx) => {
  const id = ctx.ws.data.clientId; // ✅ Connection identity
  const time = ctx.receivedAt; // ✅ Server timestamp (authoritative)
});
```

## Error Messages

The factory provides built-in error handling utilities:

```typescript
// ErrorMessage and ErrorCode are provided by the factory
const { ErrorMessage, ErrorCode } = createMessageSchema(z);

// Use in handlers
ctx.send(ErrorMessage, {
  code: "VALIDATION_FAILED",
  message: "Invalid input",
  context: { field: "email", reason: "Invalid format" },
});

// Available error codes:
// - INVALID_MESSAGE_FORMAT
// - VALIDATION_FAILED
// - UNSUPPORTED_MESSAGE_TYPE
// - AUTHENTICATION_FAILED
// - AUTHORIZATION_FAILED
// - RESOURCE_NOT_FOUND
// - RATE_LIMIT_EXCEEDED
// - INTERNAL_SERVER_ERROR
```

## Type Inference

Schemas provide full TypeScript type inference:

```typescript
const UserProfileMessage = messageSchema("USER_PROFILE", {
  id: z.uuid(),
  name: z.string(),
  age: z.number().int().positive(),
  tags: z.array(z.string()),
});

// Type is automatically inferred
type UserProfile = z.infer<typeof UserProfileMessage.schema>;
// {
//   id: string;
//   name: string;
//   age: number;
//   tags: string[];
// }

router.on(UserProfileMessage, (ctx) => {
  // ctx.payload is fully typed as UserProfile
  console.log(ctx.payload.name); // string
  console.log(ctx.payload.age); // number
});
```

## Validation Transforms

Transform data during validation:

```typescript
const DateMessage = messageSchema("SCHEDULE_EVENT", {
  // Parse ISO string to Date
  startDate: z
    .string()
    .datetime()
    .transform((str) => new Date(str)),

  // Normalize strings
  title: z.string().transform((str) => str.trim().toLowerCase()),

  // Parse JSON
  metadata: z.string().transform((str) => JSON.parse(str)),
});
```

## Discriminated Unions (NEW)

With the factory pattern, discriminated unions now work correctly:

```typescript
const PingSchema = messageSchema("PING");
const PongSchema = messageSchema("PONG");
const EchoSchema = messageSchema("ECHO", { text: z.string() });

// This works perfectly with the factory pattern!
const MessageUnion = z.discriminatedUnion("type", [
  PingSchema,
  PongSchema,
  EchoSchema,
]);

// Type inference works correctly
type Message = z.infer<typeof MessageUnion>;
```

## Reusable Schemas

Create reusable schema components:

```typescript
// Common schemas
const UserIdSchema = z.uuid();
const TimestampSchema = z.number().int().positive();
const PaginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

// Compose into message schemas
const GetUsersMessage = messageSchema("GET_USERS", {
  filters: z
    .object({
      role: z.enum(["user", "admin"]).optional(),
      active: z.boolean().optional(),
    })
    .optional(),
  pagination: PaginationSchema,
});

const UserEventMessage = messageSchema("USER_EVENT", {
  userId: UserIdSchema,
  timestamp: TimestampSchema,
  event: z.string(),
});
```

## Singleton Pattern (Recommended)

For applications, we recommend creating a singleton factory:

```typescript
// schemas/factory.ts
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";

export const { messageSchema, createMessage, ErrorMessage, ErrorCode } =
  createMessageSchema(z);

// schemas/messages.ts
import { z } from "zod";
import { messageSchema } from "./factory";

export const LoginMessage = messageSchema("LOGIN", {
  username: z.string(),
  password: z.string(),
});
```

## Performance Tips

1. **Use Factory Pattern**: Required for proper type inference and discriminated unions
2. **Cache Schemas**: Define schemas once at module level
3. **Avoid Complex Transforms**: Keep transforms simple for better performance
4. **Use Valibot**: For 60-80% smaller bundles in production
5. **Validate Early**: Let the router validate before your handler runs
