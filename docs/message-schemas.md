# Message Schemas

Message schemas are the foundation of type-safe WebSocket communication in Bun WebSocket Router. They define the structure and validation rules for your messages.

## Factory Pattern (Required)

Starting with v0.4.0, you must use the factory pattern to create message schemas. This ensures proper type inference and fixes discriminated union support:

```typescript
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";

// Create the factory with your validator instance
const { messageSchema, createMessage, ErrorMessage, ErrorCode } =
  createMessageSchema(z);
```

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

  // NEW in Zod v4: Advanced string validators
  jwt: z.jwt(), // JWT token validation
  ipv4: z.ipv4(), // IPv4 address
  ipv6: z.ipv6(), // IPv6 address
  ulid: z.ulid(), // ULID validation
  nanoid: z.nanoid(), // NanoID validation
  datetime: z.iso.datetime(), // ISO datetime string (Zod v4)
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

  // NEW in Zod v4: multipleOf constraint
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

Add custom metadata to messages:

```typescript
const AuthenticatedMessage = messageSchema(
  "AUTHENTICATED_ACTION",
  { action: z.string() },
  {
    // Custom metadata schema
    meta: z.object({
      correlationId: z.uuid(),
      version: z.string(),
    }),
  },
);
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

router.onMessage(UserProfileMessage, (ctx) => {
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
4. **Use Valibot**: For 90% smaller bundles in production
5. **Validate Early**: Let the router validate before your handler runs

## Next Steps

- See [API Reference](/api-reference) for complete schema options
- Check [Examples](/examples) for real-world usage patterns
- Learn about [Advanced Usage](/advanced-usage) for schema composition
