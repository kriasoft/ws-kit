# When to Use `router.on()` vs `router.rpc()`

This guide clarifies the difference between event handlers (`router.on()`) and RPC handlers (`router.rpc()`), and when to choose each.

## Quick Decision Matrix

| Pattern                              | Entry Point        | Guarantees                                   | Example                        |
| ------------------------------------ | ------------------ | -------------------------------------------- | ------------------------------ |
| Fire-and-forget (send once, no wait) | `router.on()`      | None                                         | Publish notification           |
| Pub/Sub (broadcast to subscribers)   | `router.on()`      | None                                         | Room update, channel message   |
| Side effects (logging, analytics)    | `router.on()`      | None                                         | User activity tracking         |
| **Request/Response (client waits)**  | **`router.rpc()`** | **One-shot reply, deadline, correlation**    | **Query, fetch data, auth**    |
| **Long operations with progress**    | **`router.rpc()`** | **Progress updates, cancellation, deadline** | **File upload, batch process** |

## Core Difference: Intent Signaling

At the callsite, the method name tells readers the handler's contract:

```typescript
router.on(UserLoggedIn, handler); // → "This is an event listener"
router.rpc(GetUser, handler); // → "This handler replies"
```

This clarity matters for:

- **Code review** — Reviewers spot the pattern at a glance
- **IDE discoverability** — `.rpc()` appears in autocomplete for request/response
- **Onboarding** — New developers learn the pattern immediately
- **Maintainability** — No need to read handler implementation to understand intent

## Router.on() — Fire-and-Forget & Pub/Sub

Use `router.on()` for handlers that don't need to produce a guaranteed response.

### 1. Fire-and-Forget Notifications

Event triggered, handler executes, no response expected:

```typescript
const UserRegistered = message("USER_REGISTERED", {
  userId: z.string(),
  email: z.string(),
});

router.on(UserRegistered, (ctx) => {
  // Send welcome email (fire-and-forget)
  sendWelcomeEmail(ctx.payload.email);
  // No reply expected
});
```

**Key point**: The client doesn't wait. If the handler fails silently, the client won't know.

### 2. Pub/Sub Broadcasting

Message published to a topic, subscribers receive it (one-to-many):

```typescript
const JoinRoom = message("JOIN_ROOM", { roomId: z.string() });
const RoomUpdate = message("ROOM_UPDATE", {
  roomId: z.string(),
  message: z.string(),
});

router.on(JoinRoom, async (ctx) => {
  const roomId = ctx.payload.roomId;
  await ctx.topics.subscribe(`room:${roomId}`);
  // Broadcast to all room subscribers
  await router.publish(`room:${roomId}`, RoomUpdate, {
    roomId,
    message: `User joined`,
  });
});
```

**Key point**: No response goes back to the publisher. Broadcast is async and best-effort.

### 3. Side Effects (Logging, Analytics)

Handler performs work for observability, not user-facing:

```typescript
const PageViewed = message("PAGE_VIEWED", { url: z.string() });

router.on(PageViewed, (ctx) => {
  // Log analytics event (fire-and-forget)
  analytics.track("page_view", { url: ctx.payload.url });
  // No reply expected
});
```

**Key point**: Handler doesn't need to reply; it's purely for side effects.

### ❌ Common Mistake: Event Handler Replying as if it's RPC

```typescript
// ❌ WRONG: Event handler replying (not guaranteed)
const GetUser = message("GET_USER", { id: z.string() });
const UserResponse = message("USER_RESPONSE", { user: UserSchema });

router.on(GetUser, (ctx) => {
  const user = findUser(ctx.payload.id);
  ctx.send(UserResponse, { user }); // ❌ Looks like reply, but not guaranteed
  // If backpressured or disconnected, response might not reach client
});
```

**Why it's wrong:**

- No correlation tracking — Response might mix with other messages
- No timeout awareness — Client could wait forever
- Not one-shot guarded — Multiple sends could happen
- Misleading at callsite — Readers think it's fire-and-forget, not RPC

---

## Router.rpc() — Request/Response Patterns

Use `router.rpc()` for request/response patterns where the client waits for a guaranteed response.

### 1. Simple Query/Fetch

Client asks for data, handler replies with result:

```typescript
const GetUser = message("GET_USER", { id: z.string() });
const UserResponse = message("USER_RESPONSE", { user: UserSchema });

router.rpc(GetUser, async (ctx) => {
  const user = await db.users.findById(ctx.payload.id);
  if (!user) {
    ctx.error("NOT_FOUND", "User not found");
    return;
  }
  ctx.reply(UserResponse, { user }); // ✅ Terminal, one-shot, guaranteed
});
```

**Guarantees:**

- Exactly one reply (multiple `ctx.reply()` calls are guarded)
- Response correlated to request (automatic ID tracking)
- Client timeout awareness (deadline passed in header)
- Type-safe response schema

### 2. Long-Running Operation with Progress

Handler emits progress updates before terminal reply:

```typescript
const ProcessFile = rpc(
  "PROCESS_FILE",
  { fileUrl: z.string() },
  "PROCESS_RESULT",
  {
    result: z.string(),
  },
);

router.rpc(ProcessFile, async (ctx) => {
  try {
    const file = await downloadFile(ctx.payload.fileUrl);
    const total = file.size;
    let processed = 0;

    for (const chunk of file.chunks) {
      // Progress update (non-terminal)
      ctx.progress({ processed });
      processed += chunk.size;

      // Long operation
      await processChunk(chunk);
    }

    // Terminal reply
    ctx.reply({ result: "success" });
  } catch (err) {
    ctx.error("INTERNAL", err.message);
  }
});
```

**Guarantees:**

- Progress updates are non-terminal (client waits for reply)
- Terminal reply is one-shot guarded
- Client can see progress and abort if needed

### 3. Authentication / Verification

Handler validates credentials, replies with result:

```typescript
const Login = rpc(
  "LOGIN",
  { email: z.string(), password: z.string() },
  "LOGIN_RESPONSE",
  {
    token: z.string(),
    userId: z.string(),
  },
);

router.rpc(Login, async (ctx) => {
  const user = await verifyCredentials(ctx.payload);
  if (!user) {
    ctx.error("UNAUTHENTICATED", "Invalid credentials");
    return;
  }
  const token = generateToken(user.id);
  ctx.reply({ token, userId: user.id });
});
```

**Guarantees:**

- One-shot reply (no duplicate tokens issued)
- Request deadline (prevents hanging auth requests)
- Correlation tracked (prevents token mixup)

### ✅ RPC Context Methods

When registered with `router.rpc()`, handlers have access to additional methods:

```typescript
ctx.reply(data); // Terminal reply (one-shot, schema-enforced)
ctx.progress(data); // Progress update (non-terminal, optional)
ctx.abortSignal; // AbortSignal fires on client cancel/disconnect
ctx.onCancel(callback); // Callback on cancellation
ctx.deadline; // Request deadline (epoch ms)
ctx.timeRemaining(); // ms until deadline
```

All RPC context methods (`reply()`, `progress()`, `error()`) are always available when using `router.rpc()` — they are guaranteed to exist.

---

## Migration Path: From `on()` with `send()` to `rpc()`

If you have an event handler using `ctx.send()` for a response-like pattern, consider migrating to `rpc()`:

### Before (Event Handler):

```typescript
const GetStatus = message("GET_STATUS", {
  status: z.enum(["active", "idle"]),
});
const StatusResponse = message("STATUS_RESPONSE", {
  status: z.enum(["active", "idle"]),
});

router.on(GetStatus, (ctx) => {
  const status = getSystemStatus();
  ctx.send(StatusResponse, { status }); // ❌ Not RPC semantics
});
```

### After (RPC Handler):

```typescript
const GetStatus = message("GET_STATUS", {});
const StatusResponse = message("STATUS_RESPONSE", {
  status: z.enum(["active", "idle"]),
});

router.rpc(GetStatus, (ctx) => {
  const status = getSystemStatus();
  ctx.reply(StatusResponse, { status }); // ✅ RPC semantics, guaranteed
});
```

**Benefits:**

- Clear intent at callsite (`router.rpc()` vs `router.on()`)
- One-shot guarantee (no duplicate status replies)
- Correlation tracking (response matched to request)
- Timeout awareness (client doesn't wait forever)

---

## Type Safety: What Context Methods are Available?

TypeScript enforces which methods are available based on the handler type:

```typescript
// Event handler: NO reply/progress methods
router.on(UserLoggedIn, (ctx) => {
  ctx.reply?.(Message, { ... });      // ❌ Type error (method is never)
  ctx.progress?.(Message, { ... });   // ❌ Type error (method is never)
  ctx.send(Message, { ... }); // ✅ Available
  ctx.publish(topic, ...);   // ✅ Available
});

// RPC handler: YES reply/progress methods
router.rpc(GetUser, (ctx) => {
  ctx.reply(Message, { ... });      // ✅ Available
  ctx.progress(Message, { ... });   // ✅ Available
  ctx.send(Message, { ... }); // ✅ Available (for side effects)
  ctx.publish(topic, ...);   // ✅ Available (for side effects)
});
```

This type narrowing happens **at compile-time**, catching mistakes before runtime.

---

## Dev-Mode Warnings

If you use `ctx.send()` in an event handler where `router.rpc()` would be more appropriate:

```typescript
// ❌ Using event handler for request/response pattern
const GetUser = message("GET_USER", { id: z.string() });
const UserResponse = message("USER_RESPONSE", { user: UserSchema });

router.on(GetUser, (ctx) => {
  const user = findUser(ctx.payload.id);
  // This works, but loses RPC guarantees (correlation, one-shot, deadline)
  ctx.send(UserResponse, { user });
});
```

If you need request/response semantics, use `rpc()` instead:

```typescript
// ✅ RPC for request/response pattern
const GetUser = rpc("GET_USER", { id: z.string() }, "USER_RESPONSE", {
  user: UserSchema,
});

router.rpc(GetUser, (ctx) => {
  const user = findUser(ctx.payload.id);
  ctx.reply({ user }); // One-shot, correlated, with deadline
});
```

---

## Summary: Simple Rules

1. **If the handler produces a response**, use `router.rpc()`
   - Client waits for reply
   - One-shot guarantee needed
   - Correlation tracking required
   - Deadline/timeout needed

2. **If the handler is fire-and-forget**, use `router.on()`
   - No response expected
   - Multiple recipients (broadcast)
   - Side effects (logging, analytics)
   - Fire-and-forget notifications

3. **At the callsite**, the method name signals the intent
   - `router.on()` = event listener
   - `router.rpc()` = request/response

4. **TypeScript type-narrowing** enforces correct usage
   - `ctx.reply()` only available in RPC handlers
   - Compile-time errors catch mistakes early

---

## See Also

- [ADR-015: Unified RPC API Design](../adr/015-unified-rpc-api-design.md) — Design rationale
- [docs/specs/router.md](../specs/router.md) — API reference
- [docs/guides/rpc-troubleshooting.md](./rpc-troubleshooting.md) — Common RPC issues and fixes
