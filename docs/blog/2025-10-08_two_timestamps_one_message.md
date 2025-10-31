# Two Timestamps, One Message: Why WebSocket Systems Need Both

> **TL;DR**: Using client-provided timestamps (`meta.timestamp`) for server-side logic like rate limiting or message ordering is a silent security bug. Server systems need their own authoritative timestamp (`receivedAt`) captured at ingress.

_This article uses examples from [**WS-Kit**](https://kriasoft.com/ws-kit), a type-safe WebSocket router for Bun and Cloudflare with Zod/Valibot validation, but the timestamp security principles apply to any real-time system._

## The Problem

Picture this: Your real-time chat app is buzzing, the conversation is flying, and dashboards are green. Then out of nowhere a support ticket lands: "User @malicious_user blasted 500 messages in under a second, but your rate limiter never tripped."

You dig into the logs. Sure enough, that client sent 500 messages. But here's the kicker — each message claimed to be sent 5 seconds apart according to its timestamp. Your rate limiter believed the client and let them all through.

Sound far-fetched? It's not. This vulnerability exists in production systems right now.

Here's what a typical WebSocket message looks like:

```json
{
  "type": "CHAT",
  "meta": {
    "timestamp": 1728432000000
  },
  "payload": {
    "text": "Hello!"
  }
}
```

That `1728432000000` value is just an epoch example — milliseconds since 1970, not a prediction from the future.

Quick question: Which timestamp should you use for rate limiting? For ordering messages in your database? For calculating request latency?

If you answered "the one in `meta.timestamp`", you've just introduced a security vulnerability. Let me show you why.

## The Vulnerability

Here's the core issue: client-provided timestamps are **untrusted input**. You wouldn't trust a client to tell you their own user ID or permissions, right? Time is no different.

A malicious (or just buggy) client can:

### 1. Bypass Rate Limits

Watch how a clever attacker can speed-run your spam filter just by lying about time:

```typescript
// ❌ VULNERABLE: Rate limiting using client time
router.on(ChatMessage, (ctx) => {
  const lastMessageTime = cache.get(ctx.ws.data.userId);
  const timeSinceLastMessage = ctx.meta.timestamp - lastMessageTime;

  if (timeSinceLastMessage < 1000) {
    // Reject: too fast
    return;
  }

  // Attacker sends: meta.timestamp = Date.now() + 10000
  // Server thinks 10 seconds passed, allows message through
});
```

### 2. Reorder Messages

What if an attacker could make their messages appear before a moderator's warning? Or insert a message between two existing ones to change the context of a conversation?

It takes nothing more than a forged timestamp.

```typescript
// ❌ VULNERABLE: Ordering by client time
router.on(ChatMessage, async (ctx) => {
  await db.insert({
    roomId: ctx.payload.roomId,
    text: ctx.payload.text,
    receivedAt: ctx.meta.timestamp, // Attacker controls this
  });

  // Attacker sends timestamp from 5 minutes ago
  // Their message appears before recent mod warnings
  // "I didn't see the warning!" becomes a plausible excuse
});
```

### 3. Skew Analytics

Negative latency makes for funny screenshots — right up until it explodes your dashboards.

```typescript
// ❌ VULNERABLE: Latency calculation using client time
router.on(PingMessage, (ctx) => {
  const latency = Date.now() - ctx.meta.timestamp;
  metrics.recordLatency(latency);

  // Client sends timestamp from the future
  // Negative latency crashes your monitoring
});
```

### 4. Clock Drift (Non-Malicious)

Not every problem is malicious. Even well-behaved clients struggle with time, and their clocks tick away from server truth for all sorts of reasons:

- **Timezone chaos**: A traveler brings yesterday's settings into today's room and every message looks stale
- **System clock drift**: Commodity hardware drifts hundreds of milliseconds to a few seconds over days without a sync
- **Mobile devices**: Phones with "Set time automatically" disabled can wander minutes or hours off course
- **Offline gaps**: Disconnected clients queue messages, then reconnect with stale producer timestamps
- **Network latency**: Slow links add seconds between creation and arrival, even when both clocks agree

Think of it like a wristwatch that loses a minute every month — annoying in real life, hazardous in distributed systems. I've chased bugs where a single misconfigured device skewed an entire chat history. They weren't attacking anything — their phone just had the wrong time. These real-world drifts are worth simulating in tests by overriding `Date.now()` or using sinon-style timers to inject skew on demand.

## The Solution: Two Timestamps

The fix is simpler than you might think: **use two different timestamps for two different purposes**.

Think of it like the postal system. When you write a letter, you might write today's date at the top — that's your "producer time." But the post office stamps it with their own date when they receive it — that's their "ingress time." The post office doesn't trust your handwritten date for tracking packages. Neither should your server.

Real-time systems need **two distinct timestamps** with different trust levels:

### 1. Producer Time (`meta.timestamp`)

**What**: When the message was created (client's clock)
**Set by**: Client
**Trust level**: Low (untrusted input)
**Use for**: UI display, optimistic ordering, perceived latency

```typescript
// Client code
client.send(
  ChatMessage,
  { text: "hello" },
  { meta: { timestamp: Date.now() } }, // Producer time
);
```

**Note**: In [WS-Kit](https://github.com/kriasoft/ws-kit), the client SDK auto-adds `meta.timestamp` if you don't provide one. This makes messages self-describing for UI purposes without requiring manual timestamp management.

**Pro Tip:** The normalization step (see `docs/specs/validation.md#normalization-rules`) strips any attempt to inject reserved fields like `receivedAt` or `clientId`. Treat `meta.timestamp` as optional sugar — the server will add what it truly needs.

If a client omits it, the SDK falls back to `Date.now()`. On the server side, keep validating so wild values (hours in the future) trigger the guardrails you saw earlier.

### 2. Server Ingress Time (`ctx.receivedAt`)

**What**: When the server received the message (server's clock)
**Set by**: Server (before parsing)
**Trust level**: High (authoritative)
**Use for**: Rate limiting, ordering, TTL, audits

```typescript
// Server code
router.on(ChatMessage, (ctx) => {
  // ctx.receivedAt captured at message arrival (server clock)
  // ctx.meta.timestamp is client-provided (may be missing/skewed)

  // Use receivedAt for any server logic
  if (ctx.receivedAt - lastMessageTime < 1000) {
    // Rate limit based on server time
  }
});
```

## When to Use Which Timestamp

Here's your cheat sheet:

| Use Case                  | Field            | Why                                     | What Breaks If Wrong           |
| ------------------------- | ---------------- | --------------------------------------- | ------------------------------ |
| Rate limiting             | `ctx.receivedAt` | Server clock prevents manipulation      | Attackers bypass limits        |
| Message ordering (DB)     | `ctx.receivedAt` | Consistent across all clients           | Messages appear out of order   |
| TTL / expiration          | `ctx.receivedAt` | Server decides when things expire       | Items expire at wrong times    |
| Audit logs                | `ctx.receivedAt` | Legal compliance needs server time      | Logs can't be trusted in court |
| Deduplication windows     | `ctx.receivedAt` | Prevents replay attacks                 | Duplicate processing           |
| "Sent 5 minutes ago" (UI) | `meta.timestamp` | Shows user's perceived time             | Confusing UI times             |
| Optimistic UI ordering    | `meta.timestamp` | Smooth UX before server confirms        | Jumpy UI                       |
| Latency display           | Both             | `receivedAt - timestamp` (but validate) | Negative latency, bad metrics  |

**Golden rule**: If it affects **server behavior** (security, data integrity, business logic), use `ctx.receivedAt`. If it affects **UI display** (timestamps shown to users, perceived performance), use `meta.timestamp`.

Martin Kleppmann summed it up neatly in _Designing Data-Intensive Applications_: "Clocks are a poor substitute for causality." Dual timestamps let you model both — the causal order your server can trust, and the narrative order the user expects.

## Correct Implementations

### Rate Limiting

```typescript
// ✅ SECURE: Rate limiting with server time
const rateLimits = new Map<string, number[]>();

router.on(ChatMessage, (ctx) => {
  const userId = ctx.ws.data.userId;
  const timestamps = rateLimits.get(userId) || [];

  // Filter to last 60 seconds using SERVER time
  const recentMessages = timestamps.filter((t) => ctx.receivedAt - t < 60000);

  if (recentMessages.length >= 10) {
    ctx.send(ErrorMessage, {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many messages (10/min limit)",
    });
    return;
  }

  // Record THIS message's server ingress time
  recentMessages.push(ctx.receivedAt);
  rateLimits.set(userId, recentMessages);

  // Process message...
});
```

### Message Ordering

```typescript
// ✅ SECURE: Database ordering by server time
router.on(ChatMessage, async (ctx) => {
  await db.messages.insert({
    roomId: ctx.payload.roomId,
    text: ctx.payload.text,
    userId: ctx.ws.data.userId,

    // Server authoritative ordering
    receivedAt: ctx.receivedAt,

    // Client-provided for UI "sent at" display (optional)
    clientTimestamp: ctx.meta.timestamp,
  });

  // Query always orders by receivedAt (server time)
  const messages = await db.messages
    .where({ roomId: ctx.payload.roomId })
    .orderBy("receivedAt", "desc")
    .limit(50);
});
```

Pair that with storage tuned for temporal queries: index on `(receivedAt DESC, userId)` or `(receivedAt DESC, clientId)` so recent events stream efficiently. UUID v7 connection IDs from `ctx.ws.data.clientId` already encode time bits, and combining them with `receivedAt` keeps hot paths cache-friendly (see `docs/specs/rules.md#performance` for rationale).

### Latency Metrics (Defensive)

Even for latency measurement — where client time seems necessary — you need defensive validation:

```typescript
// ✅ SECURE: Latency with validation
router.on(PingMessage, (ctx) => {
  if (ctx.meta.timestamp) {
    const latency = ctx.receivedAt - ctx.meta.timestamp;

    // Validate reasonable range (prevent future timestamps)
    if (latency >= 0 && latency < 60000) {
      metrics.recordLatency(latency);
    } else {
      // Log suspicious timestamp for investigation
      console.warn(
        `Invalid timestamp from ${ctx.ws.data.clientId}: latency=${latency}ms`,
      );
      metrics.increment("timestamp.invalid_latency");
    }
  }

  // Reply with server time for client-side latency calculation
  ctx.send(PongMessage, {
    serverTime: ctx.receivedAt,
  });
});
```

Why the validation? Without it, a client sending a future timestamp produces **negative latency**, which crashes most monitoring systems. Ask me how I know.

### Broadcasting with Origin Tracking

```typescript
// ✅ SECURE: Broadcasts use server time for persistence, client time for UI
import { z, message, createRouter } from "@ws-kit/zod";
import { publish } from "@ws-kit/zod/publish";

const ChatBroadcast = message("CHAT_BROADCAST", {
  id: z.string(),
  text: z.string(),
});

router.on(ChatMessage, async (ctx) => {
  // Store with server time for authoritative ordering
  const messageId = await db.messages.insert({
    roomId: ctx.payload.roomId,
    text: ctx.payload.text,
    userId: ctx.ws.data.userId,
    receivedAt: ctx.receivedAt, // Server time for ordering
  });

  // Broadcast to room subscribers
  publish(
    ctx.ws,
    `room:${ctx.payload.roomId}`,
    ChatBroadcast,
    { id: messageId, text: ctx.payload.text }, // Payload only
    { origin: "userId" }, // Injects meta.senderId from ws.data.userId
  );

  // publish() auto-injects meta.timestamp (producer time for UI)
  // publish() also validates the message schema before sending
  // Server logic MUST use ctx.receivedAt, not this timestamp
});
```

When you fan out messages, order on `receivedAt` before calling `publish()` so downstream subscribers (AND your analytics pipeline) ingest events in a consistent order — `docs/specs/router.md` calls this out in the context-building phase.

```

## Implementation Notes

### Capture `receivedAt` Early

Timing matters. Capture the timestamp as early as possible — before parsing, before validation, at the moment bytes arrive:

// Capture timestamp at message ingress, BEFORE parsing
const receivedAt = Date.now();

try {
  const parsedMessage = JSON.parse(message);
  // ... validation, normalization, handler dispatch

  const ctx = {
    ws,
    receivedAt, // Authoritative server ingress time
    meta: parsedMessage.meta, // Contains optional client timestamp
    // ...
  };
} catch (error) {
  // Errors don't affect receivedAt accuracy
}
```

Why before parsing? If JSON parsing takes 50ms (it shouldn't, but sometimes it does), you don't want that delay affecting your rate limiter's perception of time. Need more precision? Pair `Date.now()` with `process.hrtime.bigint()` (Bun exposes it too) to capture microsecond deltas without trusting the client's clock.

### Make Client Timestamp Optional

```typescript
// Schema: meta.timestamp is optional
const ChatMessage = messageSchema(
  "CHAT",
  { text: z.string() },
  { timestamp: z.number().optional() }, // Client may omit
);

router.on(ChatMessage, (ctx) => {
  // Server logic uses receivedAt (always present)
  const now = ctx.receivedAt;

  // UI display uses client time if available
  const displayTime = ctx.meta.timestamp ?? ctx.receivedAt;

  // For latency calculation, handle missing timestamp gracefully
  const latency = ctx.meta.timestamp
    ? ctx.receivedAt - ctx.meta.timestamp
    : null;
});
```

**Edge case**: What if a client on a slow mobile network sends a message that takes 10 seconds to arrive? Their `meta.timestamp` will be 10 seconds behind `ctx.receivedAt`. This is expected — network latency is real. Your UI can show "sent 10 seconds ago" while your rate limiter uses the actual arrival time.

Network partitions exaggerate this further: after a flaky connection heals you might see bursts of messages whose producer time lags minutes behind ingress. Use `receivedAt` to anchor deduplication windows — `const cutoff = ctx.receivedAt - 30_000` — so replayed batches still fall inside a predictable server-defined horizon.

```typescript
// Deduplicate messages that reappear within 30 seconds of ingress
const windowStart = ctx.receivedAt - 30_000;
const duplicate = await db.messages.findFirst({
  userId: ctx.ws.data.userId,
  checksum: ctx.meta.correlationId,
  receivedAt: { gte: windowStart },
});

if (duplicate) return; // Ignore replayed payload
```

### Normalize Reserved Keys

This is a critical security boundary. Clients shouldn't be able to spoof server-generated fields.

```typescript
// Security: Strip reserved server-only keys before validation
function normalizeInboundMessage(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;

  const msg = raw as Record<string, unknown>;

  // Ensure meta exists
  if (!msg.meta || typeof msg.meta !== "object") {
    msg.meta = {};
  }

  // Strip reserved keys (clients cannot set these)
  const meta = msg.meta as Record<string, unknown>;
  delete meta.clientId; // Connection identity (server-only)
  delete meta.receivedAt; // Server timestamp (server-only)
  delete meta.senderId; // Origin tracking (server-only, set by publish())

  return msg;
}
```

**Security tip**: In [WS-Kit](https://github.com/kriasoft/ws-kit), this normalization happens automatically before schema validation. If a malicious client tries to send `meta.receivedAt`, it's stripped before your handler sees it. This prevents clients from faking server timestamps.

### Error Handling for Suspicious Timestamps

When you detect timestamp manipulation, how should you respond?

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

const ErrorMessage = message("ERROR", {
  code: z.string(),
  message: z.string(),
});

const router = createRouter();

router.on(ChatMessage, (ctx) => {
  // Check for obviously suspicious timestamps
  if (ctx.meta.timestamp) {
    const drift = ctx.receivedAt - ctx.meta.timestamp;

    if (drift < -5000) {
      // More than 5 seconds in the future = likely manipulation
      ctx.send(ErrorMessage, {
        code: "INVALID_ARGUMENT",
        message: "Invalid timestamp",
      });
      return;
    }

    if (drift > 300000) {
      // More than 5 minutes stale = possible replay attack
      console.warn(`Stale message from ${ctx.ws.data.userId}: ${drift}ms old`);
      // You might allow it but flag for monitoring
    }
  }

  // Process normally...
});
```

Don't reject messages too aggressively — some clock skew is normal. But logging anomalies helps you detect patterns of abuse.

That response code lines up with `docs/specs/error-handling.md`: input validation issues become `INVALID_ARGUMENT` (per ADR-015), leaving business logic free to return domain-specific errors.

## Testing and Monitoring

### Test Clock Skew in Unit Tests

Don't wait for production to discover timestamp issues. Test them.

**Pro Tip:** Fake time deliberately. In Bun or Jest you can `jest.spyOn(Date, "now").mockReturnValue(Date.now() + 5000)` (or use Sinon fake timers) to simulate clients that think it's the future, then verify your safeguards still trip.

```typescript
import { describe, test, expect, beforeEach } from "bun:test";

describe("Rate limiting with clock skew", () => {
  test("rejects messages even if client lies about timestamp", () => {
    const rateLimiter = new RateLimiter();
    const userId = "test-user";

    // Send 10 messages in rapid succession
    for (let i = 0; i < 10; i++) {
      const message = {
        type: "CHAT",
        meta: {
          // Client lies: claims each message is 5 seconds apart
          timestamp: Date.now() + i * 5000,
        },
        payload: { text: `Message ${i}` },
      };

      const ctx = {
        receivedAt: Date.now(), // Server truth: all arrive at once
        meta: message.meta,
        payload: message.payload,
        ws: { data: { userId } },
      };

      // Should reject after rate limit threshold
      const result = rateLimiter.checkLimit(ctx);
      if (i < 10) expect(result).toBe(true);
      else expect(result).toBe(false);
    }
  });

  test("handles missing client timestamp gracefully", () => {
    const ctx = {
      receivedAt: Date.now(),
      meta: {}, // No timestamp from client
      payload: { text: "Hello" },
      ws: { data: { userId: "test" } },
    };

    // Should work fine without client timestamp
    expect(() => handleMessage(ctx)).not.toThrow();
  });
});
```

### Monitor Timestamp Drift

Set up alerts for suspicious patterns:

```typescript
import { metrics } from "./monitoring";

router.on(ChatMessage, (ctx) => {
  if (ctx.meta.timestamp) {
    const drift = ctx.receivedAt - ctx.meta.timestamp;

    // Record drift for monitoring
    metrics.recordTimestampDrift(drift);

    // Alert on suspicious patterns
    if (drift < -1000) {
      // Client timestamp is in the future
      console.warn(`Future timestamp from ${ctx.ws.data.userId}: ${drift}ms`);
      metrics.increment("timestamp.future_dated");
    } else if (drift > 60000) {
      // Message is more than 1 minute old
      console.warn(`Stale timestamp from ${ctx.ws.data.userId}: ${drift}ms`);
      metrics.increment("timestamp.stale");
    }
  }
});
```

**Pro tip**: Pipe `receivedAt - (ctx.meta.timestamp ?? ctx.receivedAt)` into your metrics pipeline. The Android Open Source Project's docs note that devices can drift several seconds between syncs, so alert if your P95 crosses 5000–10000ms, or if future-dated counts spike — it likely means clients lost NTP or users disabled automatic time.

### Performance: UUID v7 + Timestamp Indexing

If you're storing messages in a database, pair server timestamps with UUID v7 for efficient time-ordered queries:

```typescript
import { uuidv7 } from "uuidv7";

router.on(ChatMessage, async (ctx) => {
  // UUID v7 embeds timestamp in the ID itself
  const messageId = uuidv7();

  await db.messages.insert({
    id: messageId, // Contains timestamp in first 48 bits
    roomId: ctx.payload.roomId,
    text: ctx.payload.text,
    receivedAt: ctx.receivedAt, // Separate timestamp for queries
  });

  // Index on (roomId, receivedAt) for fast chronological queries
  // The UUID v7 ID allows efficient sorting without the index
});
```

**Why this matters**: In high-throughput systems, you can query by time range using either the UUID v7 prefix OR the `receivedAt` index. This gives you flexibility without sacrificing performance.

## UI Best Practices

### Display "Sent At" Time

```typescript
// Client receives message
client.on(ChatBroadcast, (msg) => {
  const sentAt = msg.meta.timestamp ? new Date(msg.meta.timestamp) : new Date(); // Fallback to "now" if missing

  ui.renderMessage({
    text: msg.payload.text,
    sentAt: formatRelativeTime(sentAt), // "5 minutes ago"
  });
});
```

```svelte
<!-- Svelte component -->
Sent {formatRelativeTime(message.meta?.timestamp ?? message.receivedAt)}
```

### Optimistic Ordering

```typescript
// Client optimistically orders by local time
const messages = [
  { text: "Hello", timestamp: Date.now() - 5000 },
  { text: "World", timestamp: Date.now() },
];

// Display ordered by client time (smooth UX)
messages.sort((a, b) => a.timestamp - b.timestamp);

// Server re-orders by receivedAt for persistence
// (eventual consistency reconciliation)
```

## Common Mistakes to Avoid

Here are the timestamp bugs I see most often:

### 1. Using client time for expirations

```typescript
// Pitfall: Client controls when things expire
if (Date.now() - ctx.meta.timestamp > TTL) {
  /* ... */
}

// Fix: Server owns TTL windows
if (Date.now() - ctx.receivedAt > TTL) {
  /* ... */
}
```

### 2. Sorting by client time in queries

```typescript
// Pitfall: Messages appear out of order
.orderBy('meta.timestamp')

// Fix: Consistent server-side ordering
.orderBy('receivedAt')
```

### 3. Forgetting to validate latency calculations

```typescript
// Pitfall: Can produce negative numbers
const latency = ctx.receivedAt - ctx.meta.timestamp;

// Fix: Validate range
const latency =
  ctx.meta.timestamp &&
  ctx.receivedAt - ctx.meta.timestamp >= 0 &&
  ctx.receivedAt - ctx.meta.timestamp < 60000
    ? ctx.receivedAt - ctx.meta.timestamp
    : null;
```

### 4. Using client time in audit logs

```typescript
// Pitfall: Unreliable for compliance
auditLog.append({ action: "DELETE", time: ctx.meta.timestamp });

// Fix: Server time is legally defensible
auditLog.append({ action: "DELETE", time: ctx.receivedAt });
```

### 5. Baking client time into IDs

```typescript
// Pitfall: Sortable IDs depend on client honesty
const id = `${ctx.meta.timestamp}-${ctx.ws.data.userId}`;

// Fix: Use server clocks for order, client data for context
const id = `${ctx.receivedAt}-${ctx.ws.data.userId}`; // or UUID v7 + receivedAt
```

**Audit your codebase**: Search for `.timestamp` in your WebSocket handlers. If it's used in any conditional logic (`if`, `while`, comparisons), double-check that it shouldn't be `receivedAt` instead. Grep tricks like `rg "meta\\.timestamp" server/handlers` surface subtle trust bugs fast.

## Key Takeaways

1. **Never trust client time for server logic** — Rate limiting, ordering, TTL, audits must use server time (`ctx.receivedAt`)

2. **Client time is for display only** — "Sent 5 minutes ago" UI labels can use `meta.timestamp`

3. **Capture and label server time early** — Take it at ingress, keep the name (`receivedAt`) consistent everywhere

4. **Make client timestamp optional** — Not all clients need to send it; server provides fallback

5. **Validate when mixing times** — If calculating latency from client time, validate reasonable ranges

6. **Test clock skew scenarios** — Don't wait for production bugs; write tests that simulate malicious and misconfigured clients

7. **Monitor timestamp drift** — Alert on anomalies like future-dated timestamps or extreme staleness

## Beyond WebSockets

This isn't just a WebSocket quirk. The same "trust ingress time, display producer time" pattern shows up anywhere untrusted producers attach clocks to their data:

- **HTTP APIs**: Request timestamps (from client logs) vs. server processing time (from access logs)
- **Event streams**: Event creation time (Kafka message timestamp) vs. ingestion time (when it hit your consumer)
- **IoT systems**: Sensor reading time (from device clock) vs. gateway arrival time (from edge server)
- **Log aggregation**: Application log time (when the log was written) vs. collector receipt time (when it reached your SIEM)
- **Mobile analytics**: Event capture time (on device) vs. batch upload time (when the device synced)

In every case, the pattern is the same: **producer time for user context, ingress time for system decisions**.

## Conclusion

Here's the uncomfortable truth: If your real-time system uses client timestamps for anything beyond UI display, you probably have a security bug. Maybe it hasn't been exploited yet. Maybe your users are honest and their clocks are accurate. But "probably" and "maybe" aren't good security models.

The fix is straightforward: capture server time at ingress (`ctx.receivedAt`), use it for all server logic, and treat client time (`meta.timestamp`) as untrusted UI metadata. Your rate limiter will actually work. Your audit logs will be defensible. Your message ordering will be consistent.

Take 10 minutes today to audit your WebSocket handlers. Search for `.timestamp` or `meta.timestamp` in your codebase. If you see it used in comparisons, rate limiting, expiration logic, or database ordering, you've found a bug worth fixing.

Quick audit question: where does your server still trust client time today, and what breaks if that trust evaporates?

Time is tricky in distributed systems. But with two timestamps — one trusted, one not — you can build systems that are both secure and user-friendly.

## References

- **Clock drift in practice**: Android Open Source Project, ["Time Synchronization"](https://source.android.com/docs/core/connect/time-synchronization) (mobile devices can drift seconds between syncs)
- **Replay attacks**: [OWASP guide](https://owasp.org/www-community/attacks/Replay_Attack)
- **Distributed systems time**: Martin Kleppmann, _Designing Data-Intensive Applications_ (Chapter 8: "The Trouble with Distributed Systems")
- **Vector clocks**: Leslie Lamport, ["Time, Clocks, and the Ordering of Events in a Distributed System"](https://lamport.azurewebsites.net/pubs/time-clocks.pdf) (classic background)

---
