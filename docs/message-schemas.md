# Message Schemas

Message schemas are the foundation of type-safe WebSocket communication in Bun WebSocket Router. They define the structure and validation rules for your messages.

## Creating Message Schemas

### Basic Messages

The simplest schema is a message without a payload:

```typescript
import { messageSchema } from "bun-ws-router";

// Message with just a type
const PingMessage = messageSchema("PING");
const DisconnectMessage = messageSchema("DISCONNECT");
```

### Messages with Payloads

Add validated payloads using Zod or Valibot:

::: code-group

```typescript [Zod]
import { messageSchema } from "bun-ws-router";
import { z } from "zod";

const LoginMessage = messageSchema(
  "LOGIN",
  z.object({
    username: z.string().min(3).max(20),
    password: z.string().min(8),
  }),
);

const ChatMessage = messageSchema(
  "CHAT_MESSAGE",
  z.object({
    text: z.string().max(1000),
    roomId: z.string().uuid(),
    mentions: z.array(z.string()).optional(),
  }),
);
```

```typescript [Valibot]
import { messageSchema } from "bun-ws-router/valibot";
import * as v from "valibot";

const LoginMessage = messageSchema(
  "LOGIN",
  v.object({
    username: v.pipe(v.string(), v.minLength(3), v.maxLength(20)),
    password: v.pipe(v.string(), v.minLength(8)),
  }),
);

const ChatMessage = messageSchema(
  "CHAT_MESSAGE",
  v.object({
    text: v.pipe(v.string(), v.maxLength(1000)),
    roomId: v.pipe(v.string(), v.uuid()),
    mentions: v.optional(v.array(v.string())),
  }),
);
```

:::

## Schema Validation Features

### String Validation

```typescript
const UserMessage = messageSchema(
  "USER_UPDATE",
  z.object({
    // Basic string constraints
    username: z.string().min(3).max(20),

    // Email validation
    email: z.string().email(),

    // URL validation
    website: z.string().url().optional(),

    // Regex patterns
    phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/),

    // Enum values
    role: z.enum(["user", "admin", "moderator"]),
  }),
);
```

### Number Validation

```typescript
const GameMessage = messageSchema(
  "GAME_UPDATE",
  z.object({
    // Integer validation
    score: z.number().int().min(0),

    // Float with precision
    position: z.object({
      x: z.number().finite(),
      y: z.number().finite(),
    }),

    // Range validation
    health: z.number().min(0).max(100),
  }),
);
```

### Complex Types

```typescript
const OrderMessage = messageSchema(
  "CREATE_ORDER",
  z.object({
    // Nested objects
    customer: z.object({
      id: z.string().uuid(),
      name: z.string(),
      email: z.string().email(),
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
      z.object({ type: z.literal("paypal"), email: z.string().email() }),
    ]),

    // Optional with default
    notes: z.string().optional().default(""),
  }),
);
```

## Custom Metadata

Add custom metadata to messages:

```typescript
const AuthenticatedMessage = messageSchema(
  "AUTHENTICATED_ACTION",
  z.object({ action: z.string() }),
  {
    // Custom metadata schema
    meta: z.object({
      correlationId: z.string().uuid(),
      version: z.string(),
    }),
  },
);
```

## Error Messages

Define error message schemas for consistent error handling:

```typescript
import { ErrorCode } from "bun-ws-router";

const ErrorMessage = messageSchema(
  "ERROR",
  z.object({
    code: z.nativeEnum(ErrorCode),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
);

// Use in handlers
ctx.send(ErrorMessage, {
  code: ErrorCode.VALIDATION_ERROR,
  message: "Invalid input",
  details: { field: "email", reason: "Invalid format" },
});
```

## Type Inference

Schemas provide full TypeScript type inference:

```typescript
const UserProfileMessage = messageSchema(
  "USER_PROFILE",
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    age: z.number().int().positive(),
    tags: z.array(z.string()),
  }),
);

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
const DateMessage = messageSchema(
  "SCHEDULE_EVENT",
  z.object({
    // Parse ISO string to Date
    startDate: z
      .string()
      .datetime()
      .transform((str) => new Date(str)),

    // Normalize strings
    title: z.string().transform((str) => str.trim().toLowerCase()),

    // Parse JSON
    metadata: z.string().transform((str) => JSON.parse(str)),
  }),
);
```

## Reusable Schemas

Create reusable schema components:

```typescript
// Common schemas
const UserIdSchema = z.string().uuid();
const TimestampSchema = z.number().int().positive();
const PaginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

// Compose into message schemas
const GetUsersMessage = messageSchema(
  "GET_USERS",
  z.object({
    filters: z
      .object({
        role: z.enum(["user", "admin"]).optional(),
        active: z.boolean().optional(),
      })
      .optional(),
    pagination: PaginationSchema,
  }),
);

const UserEventMessage = messageSchema(
  "USER_EVENT",
  z.object({
    userId: UserIdSchema,
    timestamp: TimestampSchema,
    event: z.string(),
  }),
);
```

## Performance Tips

1. **Cache Schemas**: Define schemas once at module level
2. **Avoid Complex Transforms**: Keep transforms simple for better performance
3. **Use Valibot**: For 90% smaller bundles in production
4. **Validate Early**: Let the router validate before your handler runs

## Next Steps

- See [API Reference](/api-reference) for complete schema options
- Check [Examples](/examples) for real-world usage patterns
- Learn about [Advanced Usage](/advanced-usage) for schema composition
