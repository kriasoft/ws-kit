---
title: "Designing Fair Token Bucket Policies for Real-Time Apps"
summary: "Rate limiting real-time apps is complex. This guide details how to correctly size Token Bucket capacity (bursts) and refill rate (sustained throughput) for chat, gaming, and streaming. Learn to use per-user, per-type, and cost-based policies to ensure fairness and prevent abuse."
author: koistya
sidebar: false
head:
  - - link
    - rel: canonical
      href: https://medium.com/gitconnected/designing-fair-token-bucket-policies-for-real-time-apps-289b00eb4435
---

> Sizing burst capacity and refill rates for chat, gaming, and streaming without starving legitimate users or enabling abuse.

## The Problem With One-Size-Fits-All Rate Limiting

You launch your multiplayer game. The collision detection runs tight — good. Then a speedrunner discovers an exploit: spam move commands fast enough and the server's position updates lag behind optimistic rendering. Your rate limiter catches them at 30 messages, which feels fair. But then legitimate players in heated moments hit the same limit after 20 rapid inputs during a firefight.

You dial the limit down to 15 to catch abuse earlier. Now everyone complains about input lag.

Sound familiar?

The problem isn't that rate limiting is wrong. It's essential for protecting backend resources and ensuring fair access. The problem is that **most policies treat all traffic the same**, missing the fact that different applications have radically different traffic signatures. A chat app needs to tolerate sudden bursts when users paste code blocks. A game needs predictable, high-frequency streams. A video stream needs one massive initial burst, then steady flow.

The token bucket algorithm is elegant enough to handle all three — but only if you size it correctly for your workload. This post shows you how to reason about capacity and refill rate, not as magic numbers, but as levers that directly model your application's behavior. You'll learn to distinguish between legitimate user behavior and abuse, then size your limits accordingly.

## How Token Buckets Work: A Quick Mental Model

Token buckets are simple: tokens refill at a constant rate (`r`), you consume tokens per message, and requests queue when empty. The key parameters are:

- **Refill rate** (`r`): tokens per second — your sustained message rate
- **Burst capacity** (`B_max`): maximum tokens — how many messages you can send instantly

The magic: bursts are allowed without punishing inactive users. This is why token buckets beat leaky buckets for real-time apps.

## Capacity vs. Refill Rate: The Fundamental Trade-Off

These two parameters work together. Sized independently, they create terrible user experiences or dangerous security holes.

### Capacity: Burst Tolerance

**What it controls**: How many tokens a user can consume in a single burst.

**If too low**: Users feel input lag. A gamer can't respond quickly. A chatter can't paste a code block without hitting the limit.

**If too high**: Attackers get a long window to flood before detection kicks in.

**Example comparison** (chat app):

- Capacity 10, Rate 2/sec → allows 10 instant messages, then wait 5s. Feels slow.
- Capacity 100, Rate 2/sec → allows 100 instant messages, then wait 50s. Easy attack vector.
- Capacity 30, Rate 10/sec → allows 30 instant messages, then wait 2s. Good balance.

### Refill Rate: Sustained Throughput

**What it controls**: The long-term average message rate.

**If too low**: Legitimate users feel starved. App feels sluggish.

**If too high**: Abusers run rampant and can saturate the system.

**Example comparison** (gaming):

- Rate 10/sec, Capacity 20 → 10 messages/sec sustained, burst of 20. Too slow for 60 Hz game.
- Rate 100/sec, Capacity 20 → 100 messages/sec sustained, but only 20-token burst. Drops packets on network jitter.
- Rate 60/sec, Capacity 120 → 60 messages/sec sustained, 2-second burst window. Matches 60 Hz tick rate perfectly.

### The Pairing Principle

Set capacity and refill rate together, not independently. A useful formula:

```
recovery_time = capacity / refill_rate
```

If you want users to recover from a full burst in 3 seconds, size it as:

- `refill_rate = 20 tokens/sec` implies `capacity = 60 tokens`
- `refill_rate = 10 tokens/sec` implies `capacity = 30 tokens`

Both allow 3-second recovery, but the first sustains higher throughput while the second is more restrictive. Your choice depends on your app's typical load and abuse patterns.

| Use Case        | Capacity | Rate/sec | Sustained     | Recovery | Outcome                                      |
| --------------- | -------- | -------- | ------------- | -------- | -------------------------------------------- |
| Too Strict      | 10       | 2        | 2 msg/sec     | 5s       | Users churn from input lag                   |
| Chat (Balanced) | 100-200  | 1-2      | 1-2 msg/sec   | 50-200s  | Handles history load without false positives |
| Gaming (30 Hz)  | 10-15    | 35-40    | 35-40 msg/sec | <1s      | Matches game tick rate plus jitter margin    |
| Too Loose       | 500      | 100      | 100 msg/sec   | 5s       | Abusers flood the system                     |

## Domain-Specific Policies

Real-time apps have distinct traffic signatures. Understanding yours is the key to sizing limits that work.

### Chat Applications

**Traffic signature**:

- Users type at 0.6-1.1 words per second (roughly one message every 10-20 seconds under normal typing)
- Bursts occur: pasting code snippets, rapid-fire group conversation, media uploads
- False positives hurt engagement; users churn if rate limiting feels excessive
- Initial state: loading message history, fetching member lists, synchronizing presence

**Recommended policy**:

```bash
Capacity: 100-200 messages
Rate: 1-2 messages/sec
Recovery time: 50-200 seconds
```

**Rationale**:

- Refill rate (1-2/sec) covers normal conversation: typical typing pace plus presence updates and typing indicators
- Capacity (100-200) handles the most common legitimate burst: loading message history on channel entry or pasting code snippets
- If a user loads 100 recent messages on entering a channel, they need burst capacity of at least 100
- Recovery time of 50-200 seconds is acceptable — users expect a pause after heavy activity like bulk uploads or rapid pasting
- Real test: User sends 50 fast messages (code paste or rapid conversation), 50-150 tokens remain, wait 25-150s, back to full bucket

**What breaks this**:

- Capacity 10: Users copying code blocks get blocked constantly
- Rate 100/sec: Coordinated spam floods rooms before moderation
- Rate 0.5/sec: Users feel starved in group conversations
- No monitoring: You won't know when the policy is too strict

**Observability**: Alert if more than 5% of users hit rate limits daily. This signals either a too-strict policy or a spam spike.

### Multiplayer Gaming

**Traffic signature**:

- Players send input commands at the **game tick rate** (e.g., 60 Hz = 60 messages/sec per player)
- One limit too low makes the game unplayable; one too high enables desynchronization attacks
- Different message types have different costs: position updates vs. chat messages
- Network jitter causes packet batching; the bucket must absorb temporary spikes

**Recommended policy** (for a 30 Hz server):

```bash
Per-player input (position, rotation):
  Capacity: 10-15 tokens (quick action "combos")
  Rate: 35-40 tokens/sec (30 Hz tick rate + 20% safety margin)

Per-player chat (separate bucket):
  Capacity: 20 messages
  Rate: 5 messages/sec
```

**Rationale**:

- Refill rate must match or exceed the server's tick rate, plus a 20% safety margin for network jitter
- For a 30 Hz server, 35-40 tokens/sec ensures players can send and receive at the game's natural frequency
- Capacity (10-15 tokens) is small because gaming traffic is a continuous stream, not bursty — large bursts often signal abuse (spam scripts)
- Separate buckets prevent chat spam from blocking critical movement commands
- Scenario: Player executes a quick combo (5 actions). Bucket has tokens. Player spams chat. Chat bucket empties, but movement input still flows through

**What breaks this**:

- Single bucket for all messages: Attacker spams chat, blocks position updates, player appears frozen
- Capacity 20: Temporary packet loss makes the game unplayable
- Capacity 500+: Malicious clients send fake position updates, world desynchronizes
- Rate 20/sec: Input lag on 60 Hz server feels terrible

### Streaming (Live Video)

**Traffic signature**:

- Two-phase model: massive initial buffer-fill (0-10 seconds), then steady-state flow at video bitrate
- Phase 1 (buffer-fill): High-speed transfer to fill client buffer (e.g., 10 seconds of content upfront)
- Phase 2 (steady-state): Downloads at bitrate matched to playback speed (with minor pauses to prevent buffer overflow)
- Control plane: Viewers send heartbeats, seek requests, quality changes (low volume); Streamers send metadata updates

**The Critical Buffer-Fill Calculation**:

Streaming policies must explicitly handle the initial massive burst. This is the most commonly missed piece.

```bash
# Example: 1080p stream at 6 Mbps, target 10-second buffer

Video bitrate:       750 KB/sec (6 Mbps = 750 kilobytes/second)
Buffer duration:     10 seconds
Initial burst size:  750 KB/sec × 10 sec = 7,500 KB = 7.5 MB

This is the minimum burst capacity your policy must allow.
```

**Recommended policy** (per-viewer):

```bash
Initial buffer-fill (first connection or seek):
  Capacity: 7.5 MB (for 10s of 6 Mbps content)
  Rate: 750 KB/sec (6 Mbps)
  Recovery time: ~10 seconds

Steady-state playback (after buffer full):
  Capacity: Bitrate × 2-3 seconds (e.g., 1.5-2.25 MB for 6 Mbps stream)
  Rate: Video bitrate (e.g., 750 KB/sec)

Control plane (heartbeats, seeks, quality changes):
  Capacity: 10 actions
  Rate: 2 actions/sec (separate bucket from data transfer)
```

**Rationale**:

- Burst capacity must be sized to the actual initial buffer-fill requirement, not guessed
- For a 6 Mbps stream with 10-second target buffer, capacity must be **at least 7.5 MB**
- Steady-state capacity slightly larger than refill rate prevents underflow during minor network jitter
- Separate control plane prevents heartbeat timeouts or seek delays from being starved by data transfer
- Recovery time for initial burst is acceptable (users expect a few seconds of buffering on start)

**Calculating for Your Bitrate**:

First, convert Mbps to KB/sec (divide by 8): 6 Mbps → 750 KB/sec. Then multiply by buffer duration.

| Bitrate         | KB/sec | 5s Buffer | 10s Buffer | 15s Buffer |
| --------------- | ------ | --------- | ---------- | ---------- |
| 2.5 Mbps (480p) | 312.5  | 1.56 MB   | 3.125 MB   | 4.7 MB     |
| 5 Mbps (720p)   | 625    | 3.13 MB   | 6.25 MB    | 9.4 MB     |
| 8 Mbps (1080p)  | 1,000  | 5 MB      | 10 MB      | 15 MB      |

**What breaks this**:

- Using a generic 100-token capacity: Can't handle even 5 seconds of buffer-fill at real-world bitrates
- Mixing data and control in one bucket: Heartbeats timeout while buffering, users see "connection lost"
- Heartbeat rate 0.2/sec: Users seeking every few seconds hit the control limit
- Not accounting for buffer-fill: Users experience long startup delays on first play or after seeking

## Layering Limits: Per-User, Per-Route, Cost-Based

A single global limit is a blunt instrument. Production systems need multiple layers of protection.

### The Pyramid of Protection

```bash
Global limit (all users, all messages)
    ↓
Per-IP / Per-Device limit (catch botnets)
    ↓
Per-User Per-Type limit (fairness between users)
    ↓
Per-Route Cost-Based limit (protect expensive operations)
```

**Example: Chat room with 10,000 users**:

```bash
Global: 100,000 messages/sec
Per-IP: 100 messages/sec (catch credential stuffing)
Per-User: 20/sec per message type
Per-Route: TEXT=1 token, ADMIN_COMMAND=10 tokens
```

### Per-User Per-Type (Most Common)

One bucket per (user, message type) pair. Chat messages have a separate quota from presence updates.

```typescript
// Per-user per-type (in-memory adapter shown; swap for Redis/Durable Objects in production)
import { rateLimit, keyPerUserPerType } from "@ws-kit/middleware";
import { memoryRateLimiter } from "@ws-kit/adapters/memory";

const limiter = rateLimit({
  limiter: memoryRateLimiter({
    capacity: 30,
    tokensPerSecond: 10,
  }),
  key: keyPerUserPerType,
});

router.use(limiter);

router.on(ChatSendMessage, (ctx) => {
  ctx.send(ChatSentMessage, { message: ctx.payload.text });
});

router.on(PresenceUpdateMessage, (ctx) => {
  ctx.publish("presence", PresenceChangedMessage, {
    userId: ctx.ws.data?.userId,
  });
});
```

**Why it works**:

- Prevents one chatty user from monopolizing bandwidth and starving others
- Different message types can have different tolerances based on their impact
- Fair: each user gets an independent quota per message type
- Simple to reason about and tune based on real-world usage

### Cost-Based Limiting (Advanced)

Different operations consume different amounts of resources. GitHub and Shopify use this for GraphQL APIs — it's equally powerful for WebSockets.

```typescript
// Single unified rate limiter with custom cost per operation
import { rateLimit } from "@ws-kit/middleware";
import { memoryRateLimiter } from "@ws-kit/adapters/memory";

const limiter = rateLimit({
  limiter: memoryRateLimiter({
    capacity: 200,
    tokensPerSecond: 50,
  }),
  key: (ctx) => {
    const user = ctx.ws.data?.userId ?? "anon";
    return `user:${user}`;
  },
  cost: (ctx) => {
    // All costs must be positive integers
    if (ctx.type === "ChatSend") return 1;
    if (ctx.type === "FileUpload") return 20;
    if (ctx.type === "AdminBan") return 10;
    if (ctx.type === "HistorySearch") return 15;
    return 1; // default
  },
});

router.use(limiter);
```

**Why it works**:

- Expensive operations (database queries, external APIs) cost more tokens
- Cheap operations (presence updates, heartbeats) cost less, allowing higher frequency
- Single shared bucket prevents any one operation type from monopolizing quota
- Users have flexibility: spend budget on many cheap operations or a few expensive ones
- Scales better than managing dozens of independent buckets

**Trade-off**: Costs must align with actual resource consumption. Misjudged costs will either starve legitimate users or enable abuse.

### Choosing a Rate Limiter Adapter

Examples above use `memoryRateLimiter`. For production, choose your adapter based on deployment:

| Adapter         | Best For                | Latency |
| --------------- | ----------------------- | ------- |
| In-Memory       | Single server, dev/test | <1ms    |
| Redis           | Distributed fleets      | 2-5ms   |
| Durable Objects | Edge/global             | 10-50ms |

Swap the adapter and the semantics remain identical:

```typescript
import { redisRateLimiter } from "@ws-kit/adapters/redis";
const limiter = rateLimit({
  limiter: redisRateLimiter(redis, { capacity: 30, tokensPerSecond: 10 }),
  key: keyPerUserPerType,
});
```

**Note on imports**: Each adapter is available via a subpath export. Use `@ws-kit/adapters/memory`, `@ws-kit/adapters/redis`, or `@ws-kit/adapters/cloudflare-do` to import only the adapter you need. Importing from `@ws-kit/adapters` directly requires explicit adapter selection via the platform-specific factories.

### How to Calculate Costs

Assigning costs requires understanding what each operation actually costs your backend:

```typescript
// Example cost calculation based on database operations
// All costs must be positive integers (no decimals, no zero/negative values)
const operationCosts = {
  // Simple, in-memory operations (cost = 1)
  PresenceUpdate: 1, // Just update local state
  TypingIndicator: 1, // Ephemeral, instant delivery

  // Database reads (cost = 2-5 depending on complexity)
  MessageGet: 3, // Single document read
  UserProfile: 2, // Cache-friendly read

  // Database writes (cost = 5-10 including indexing)
  MessageSend: 5, // Write + index update
  MessageEdit: 5, // Update + audit log

  // Expensive operations (cost = 20-50 for CPU-intensive work)
  MessageSearch: 20, // Full-text search across millions
  HistoryExport: 50, // Generates file, might send email
  AnalyticsQuery: 30, // Aggregates data across time range
};
```

Start with these simple ratios:

- In-memory operations: 1 token
- Database reads: 2-5 tokens (depends on complexity)
- Database writes: 5-10 tokens (include indexing, replication)
- External API calls: 10-20 tokens (includes latency uncertainty)
- Aggregations/searches: 20-50 tokens (CPU-intensive)

Then validate by measuring actual P95 latencies. If `message.search` takes 100ms and `message.send` takes 10ms, but both cost 5 tokens, you're underweighting search. Increase its cost to 50 tokens.

## Common Mistakes and Red Flags

The most impactful rate-limiting failures in production boil down to three design errors. These are the battle scars from real systems.

### 1. Capacity Way Higher Than Refill Rate (Most Common)

**The Failure Mode**: This is why most rate-limiting deployments fail in their first week.

❌ Bad: Capacity 1000, Rate 10/sec = 100-second burst window.

An attacker (or botnet) exploits the massive window: they send 1000 requests in 10 seconds while your monitoring system is still sleeping. The damage is done before typical monitoring thresholds are breached and alerts fire — by then, the database is already melting.

**Real-world impact**: In early 2023, a major gaming platform experienced a DDoS that succeeded not because attacks were fast, but because their burst window was so large that coordinated spam flooded the system before rate-limit signals propagated to edge nodes.

✅ Fix: Use the formula `capacity ≈ refill_rate * desired_recovery_time`. A 10/sec refill rate with a 3-second recovery window means capacity ≈ 30. An attacker can't get meaningful damage done in 3 seconds.

### 2. Confusing Per-User and Global Limits (Second Most Common)

**The Failure Mode**: Limits work independently instead of layered, creating security gaps or fairness problems.

❌ Bad approach 1: Per-user limit only → one power user or coordinated botnet saturates the server's total capacity.

❌ Bad approach 2: Global limit only → one misbehaving user or network spike blocks all other users. Innocent mobile users in high-latency regions get starved.

**Real-world impact**: A real-time collaboration platform launched with per-user limits but no global cap. During a product launch event, legitimate traffic from 50,000 concurrent users each hitting their personal limit harmlessly... except in aggregate they exceeded the database's actual throughput. The platform went down not from abuse, but from scale.

✅ Fix: Implement the pyramid structure. Global limits upstream catch coordinated attacks by restricting aggregate capacity across all users and IPs — even if every single user stays within their quota, the sum cannot overwhelm the database. Per-user limits downstream ensure fairness. Both must exist.

### 3. Not Accounting for Network Jitter (Subtle but Frequent)

**The Failure Mode**: Policies work perfectly in the lab but fail mysteriously in production due to real-world network behavior.

❌ Bad: Capacity 5, Rate 10/sec. Looks reasonable on paper: 0.5-second recovery.

On a flaky mobile network, packet loss causes TCP to retransmit and batch messages. The client bursts 5 messages in rapid succession. Bucket emptied. User can't send anything for 0.5 seconds. It feels like input lag.

At scale, 10% of users experience this on Tuesday afternoons when cellular networks are congested. Support tickets flood in. You revert the rollout.

✅ Fix: Add 1-2 seconds of headroom to your capacity parameter — enough to absorb traffic bursts lasting that duration. For a 10/sec rate, use capacity 30-50 (representing 3-5 seconds of refill), not 10. This absorbs temporary network spikes without being a security hole (recovery is still fast: 3-5 seconds).

### Other Considerations

If building cost-based limits (advanced), ensure operation costs match actual resource consumption — misjudged weights starve expensive queries or enable cheap-operation spam. Cost assignment is iterative: start with educated guesses (database reads cost more than presence updates), then continuously validate against actual latencies and user behavior, adjusting weights every few weeks. For multi-phase services, tie buckets to stable identifiers (session or device ID, not just user ID) to avoid losing tokens on login. Finally, always layer limits — global upstream, per-operation downstream — so bugs in one handler don't cascade.

## Testing and Tuning Your Policy

Choosing initial values is only half the battle. The other half is validating them against real-world usage patterns.

### Load Testing Strategy

Before deploying to production, validate your policy with synthetic load:

1. **Baseline test**: Run legitimate usage at 10x typical load. Verify that normal users don't hit limits.
2. **Burst test**: Simulate network jitter by batching messages. Ensure capacity absorbs temporary spikes without false positives.
3. **Abuse test**: Run coordinated spam from multiple IPs/users. Verify that global and per-IP limits catch coordinated attacks before they saturate the system.
4. **Edge case test**: Run mixed workloads (some users light, some heavy). Verify that fair distribution works as expected.

### Monitoring During Rollout

When deploying to production, ramp up gradually:

- **Week 1**: Deploy to 5% of users. Monitor metrics hourly. Look for unexpected spikes in rejected requests.
- **Week 2**: Expand to 25% of users. Watch for patterns (time of day? geographic? user type?).
- **Week 3-4**: Full rollout with continued monitoring.

Track these metrics:

- **Rate limit hit rate** (by message type, user tier): Should be <1% for legitimate traffic
- **Histogram of tokens remaining at rejection**: If users always have 0 tokens, you're too strict. If they have plenty, you're too loose.
- **Time since last refill**: How long do users wait after hitting a limit? Should match your recovery_time.
- **P95 latency of rate limit checks**: Keep <1ms. Slow checks block your event loop.

### Tuning Based on Real Data

After 2-4 weeks of data, adjust:

- **If <0.1% hit the limit**: Your policy is too loose. Users may complain if you see coordinated spam.
- **If 0.1%-1% hit the limit**: Good zone. Some legitimate power users hit it, but most don't.
- **If 1%-5% hit the limit**: Getting strict. Watch user support tickets for complaints about input lag or sluggish feel.
- **If >5% hit the limit**: Too strict. You're harming legitimate users.

Also consider:

- **Seasonal patterns**: Games may be stricter during tournaments. Chat apps during product launches.
- **User cohorts**: Free users might have stricter limits than paid. Mobile users might have more generous limits due to network variance.
- **Abuse trends**: If a particular message type is being attacked, tighten its limit without affecting others.

## Real-World Case Study: RoomChat

**Setup**: Collaborative room editor with real-time cursor positions and code editing. 10,000 concurrent users, averaging 2-3 Mbps egress during peak hours. Launch week: everything seemed fine. Week two: support tickets spiked.

**Initial policy** (launched naively):

```bash
Per-user per-type: capacity 200, rate 100/sec
```

**Why this choice**: Backend could handle ~100k msg/sec aggregate. With 10k users, averaging 10 msg/sec each felt reasonable. The team picked 100/sec as a "burst allowance" without much thought — it came from dividing remaining capacity by active users at a single snapshot.

**Week 1-2: The Discovery Phase**

Support tickets: "Rate limit? I just pasted a code snippet" and "My cursor keeps disappearing."

First instinct: check if it's users on weird network conditions or if everyone's being blocked equally.

```
Oct 15 — rate_limit_hit_total: 2.3% of active users hitting limits
Oct 16 — pulled message breakdown: TEXT_MESSAGE 12% of hits, CODE_PASTE 31%, CURSOR_POSITION 89%
Oct 17 — chart of hits by time of day: spiky, not uniform (but no clear pattern yet)
```

Initial hypothesis: "Bucket's too small, users are naturally bursty." Increased capacity to 500 and shipped it midweek, fingers crossed.

**Week 2-3: The False Start**

Capacity 500 helped... sort of. Some metrics improved dramatically, others barely moved:

```
CURSOR_POSITION hits: 89% → 47% (huge win, network jitter absorbed)
TEXT_MESSAGE hits: 12% → 9% (minor improvement)
CODE_PASTE hits: 31% → 19% (only 12-point drop, still high)
```

But in the support channel: "I pasted a 50-line snippet and got rate limited." Still happening at 19% — not acceptable.

Plus, during testing, one engineer noticed: if you rapidly paste 5 code blocks, the server logs don't show 5 separate CODE_PASTE messages arriving. They show 3 or 4, sometimes out of order. TCP batching on 4G was real.

**Root cause discovery** (messy, took longer than expected):

One engineer pulled wire timings from production—looking at actual message arrival patterns. First observation: code pastes weren't evenly spaced. A user would send one paste, and the server would receive it as 2-3 fragmented TCP packets within 50ms. The token bucket saw each fragment as a separate message.

Hypothesis: "Network batching is compressing things." But how much?

Checked message sizes: text messages averaged 80 bytes, code pastes 2-4 KB. On a congested 4G network, the TCP stack groups multiple frames together. A single logical "paste code block" operation becomes 3-4 physical packets arriving in rapid succession.

More investigation: ran a load test with intentional packet loss. At 5% loss, CODE_PASTE hit rate jumped from 19% to 34%. At 15% loss (simulating congested networks), it hit 41%.

Additionally discovered during an unrelated audit: `10k users × 100/sec = 1M msg/sec theoretical capacity`. Reality check against database: the backend maxed out around 150k/sec sustained load. We were giving users a budget that the infrastructure couldn't actually handle.

**Week 3-4: Iterating (with setbacks)**

Strategy 1: Separate buckets by message type, uniform token cost.

```bash
TEXT_MESSAGE: capacity 50, rate 20/sec
CODE_PASTE: capacity 80, rate 8/sec
CURSOR_POSITION: capacity 300, rate 100/sec
```

Deployed. After 2 days, CODE_PASTE hits were down to 15% — progress but still unacceptable. Cursor felt smooth. Text felt fine. But code paste users were still complaining.

Late-week realization (and this was annoying): the issue wasn't rate — it was _capacity_. Users could hit their CODE_PASTE bucket almost immediately during packet batching. Once empty, they had to wait 10 seconds for recovery. That felt broken.

Strategy 2: Different approach. Maybe code pastes cost more than text messages because they're actually more expensive on the backend.

Measured actual server resource consumption:

- TEXT_MESSAGE: ~0.5ms processing
- CODE_PASTE: 2.5-4ms processing (syntax highlighting, diff calculation, conflict detection)
- CURSOR_POSITION: ~0.1ms processing

Cost weighting: code paste takes 5-8x longer. So cost them more tokens.

**Final tuned policy** (end of week 4):

```bash
Global: 80,000 msg/sec (150k/sec max minus headroom, with some buffer for spikes)

Per-user per-type:
  TEXT_MESSAGE: capacity 50, rate 20/sec (1 token each)
  CODE_PASTE: capacity 100, rate 3/sec (5 tokens each; accounts for actual backend overhead)
  CURSOR_POSITION: capacity 500, rate 100/sec (0.5 tokens; cheap)
```

**Rollout** (week 5, then week 6):

Friday deploy: Canary to 5% of traffic. Monitored hourly over the weekend — hit rate hovered around 1.6-1.9%. Not perfect, but better than 2.3%.

Monday morning: Expanded to 30% (skipped the "25%" step; ops team wanted to move faster). Hit rate climbed to 2.1% during peak hours. Huh. Global limit + network spike during Monday morning activity. Pulled the release back to 5% after 4 hours.

Mid-week investigation: realized the global 80k limit was too tight for genuine peaks. Bumped to 95k. Re-deployed to 30%. Steadier at 1.3-1.7%.

Friday: Full rollout to 100%. First week: 1.4%, 1.8%, 1.1%, 1.9%, 1.5% day-to-day. Not the clean 0.8-1.2% range. More like 1-2%, with occasional spikes to 2.1% during product launch days or when heavy European users come online.

Current state (2 months later): still hovering around 1.3% average, with weeks ranging 0.9%-2.2% depending on user activity patterns.

**What we learned from actual data**:

1. **Initial assumptions were confidently wrong**. Dividing backend capacity by user count sounds logical; it's still wrong. Real traffic doesn't distribute evenly. One 10,000-user instance isn't the same as ten 1,000-user instances.

2. **Network batching isn't a theoretical problem**. It shows up in production the moment users are on congested networks. Staging with 500 synthetic users showed 0.2% hit rate. Real-world 10k users on 4G networks: 2.3%. The difference is TCP's Nagle algorithm and network variance, not your code.

3. **Metrics lie until you understand them**. "CODE_PASTE 31% hit rate" sounds bad. But investigation revealed: CODE_PASTE messages were 25x larger than TEXT, and they triggered 5-8x more backend work. A hit rate of 31% on expensive operations might be more acceptable than 12% on cheap ones. You need to measure resource cost, not just message count.

4. **Rollouts reveal what testing missed**. The Friday canary revealed the baseline. Monday's 2.1% spike (hitting the global limit) told us the 80k value was optimistic. Without real traffic, you can't tune effectively.

5. **Tuning isn't a one-time event**. Two months in, we're still between 0.9%-2.2% depending on the week. That's not failure; that's normal. The policy absorbs user behavior variation and network conditions without catastrophic failures. We adjust the global limit once every 2-3 weeks if we see consistent drift, but the per-user per-type strategy handles most variance automatically.

**Current monitoring setup**:

- Alert if >3% of users hit rate limits in an hour (sudden policy drift or attack)
- Track global limit rejection rate separately; if >0.5% of requests hit it, check for DDoS or planned load spike
- Weekly histogram of per-type hit rates; CODE_PASTE at 1-2% is expected, TEXT at >1% means investigation
- Correlate with customer support tickets; if code-heavy teams complain about "lags," the policy might be too strict

**Lessons learned** (revised after production experience):

1. **Assumptions require validation**. The textbook formula (capacity × refill_rate = recovery_time) is useful for thinking but meaningless without real traffic data. Always A/B test in canary before rolling out.

2. **Cost-based limiting works, but requires measurement**. You can't eyeball token costs. Measure actual backend latency per operation. CODE_PASTE costing 5 tokens wasn't a guess; it came from production profiling.

3. **Network jitter is your biggest wildcard**. All your lab testing happens on stable networks. Production users on 4G, airplane WiFi, and congested corporate networks behave differently. Add 20-30% headroom to burst capacity; it's not a waste, it's insurance.

4. **Global limits are the safety net you hope never activates**. During normal operation, they shouldn't be hit. When they are (coordinated spam, load spike), that's the only thing standing between your backend and meltdown. Don't skimp on them.

5. **Tuning is iterative forever**. There's no "final policy." Seasonal patterns (back-to-school, holidays, product launches) mean you'll adjust limits 4-6 times per year. Build monitoring that makes adjustments quick and low-risk.

## Implementation Checklist

- [ ] Analyze your application's traffic signature (chat? gaming? streaming?)
- [ ] Define capacity and rate for each message type or operation
- [ ] Document reasoning for chosen numbers (recovery time, user behavior, abuse scenarios)
- [ ] Implement observability: log when limits are hit, by whom, how often
- [ ] Test with synthetic load: simulate network jitter, bursts, and coordinated spam
- [ ] Monitor in production for 2 weeks before declaring success
- [ ] Review every 3 months: are users complaining? Is abuse rising? Adjust as needed.
- [ ] Set up alerts for anomalies (sudden spike in limit hits, unusual patterns)
- [ ] Use separate buckets for different message types (or cost-weight a single bucket)

**Key metrics to track**:

```bash
rate_limit_exceeded_total (counter)
  Break down by message type and user cohort

rate_limit_bucket_tokens (gauge)
  Distribution of remaining tokens at time of rejection

rate_limit_check_latency (histogram)
  Cost of checking limits (target: <1ms)
```

## Putting It Into Practice

Token bucket rate limiting is deceptively simple: add tokens, consume tokens, reject when empty. But designing fair policies that protect your backend without starving users requires understanding the trade-offs between capacity, refill rate, buckets, and costs.

### The Three-Phase Deployment Strategy

**Phase 1: Design (1-2 weeks)**

- Analyze your app's traffic signature using real production logs
- Calculate baseline rates from P95 user behavior
- Choose strategy: single bucket, per-user per-type, or cost-based
- Build a simple rate limit simulator to test policies without deploying

**Phase 2: Testing (1 week)**

- Run load tests at 5x and 10x typical peak load
- Simulate network jitter and packet batching
- Run abuse scenarios: coordinated spam, individual floods, mixed workloads
- Document what settings work and what breaks

**Phase 3: Gradual Rollout (4 weeks)**

- Week 1: Deploy to 5% of users (or one region)
- Week 2: Expand to 25% as you build confidence
- Week 3-4: Roll out to 100% with continued monitoring
- Keep tuning decisions lightweight — you can adjust rates without redeploying

### Common Implementation Patterns

(Examples use `memoryRateLimiter` — swap for `redisRateLimiter` or `durableObjectRateLimiter` per deployment.)

**Pattern 1: Per-User Limits Only**

Simple, good for early-stage apps. Protects against individual users monopolizing resources but doesn't prevent coordinated attacks.

```typescript
// Per-user rate limit
import { rateLimit } from "@ws-kit/middleware";
import { memoryRateLimiter } from "@ws-kit/adapters/memory";

const limiter = rateLimit({
  limiter: memoryRateLimiter({
    capacity: 100,
    tokensPerSecond: 20,
  }),
  key: (ctx) => {
    const user = ctx.ws.data?.userId ?? "anon";
    return `user:${user}`;
  },
});

router.use(limiter);
```

**Pattern 2: Tiered by Message Type**

Better for apps with mixed message costs. Text chat gets higher limits than expensive operations.

```typescript
// Define different limits per operation type
import { rateLimit } from "@ws-kit/middleware";
import { memoryRateLimiter } from "@ws-kit/adapters/memory";

const chatLimiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 50, tokensPerSecond: 20 }),
  key: (ctx) => `user:${ctx.ws.data?.userId ?? "anon"}`,
});

const uploadLimiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 5, tokensPerSecond: 1 }),
  key: (ctx) => `user:${ctx.ws.data?.userId ?? "anon"}`,
});

const searchLimiter = rateLimit({
  limiter: memoryRateLimiter({ capacity: 10, tokensPerSecond: 2 }),
  key: (ctx) => `user:${ctx.ws.data?.userId ?? "anon"}`,
});

// Register each limiter with its specific message type
router.use(ChatSendMessage, chatLimiter);
router.use(FileUploadMessage, uploadLimiter);
router.use(SearchHistoryMessage, searchLimiter);
```

**Pattern 3: Cost-Based (Most Sophisticated)**

Single bucket per user, costs scale with operation impact. Best for mature apps where you've measured actual costs.

**Selecting Your Pattern:**

- **Early stage**: Start with Pattern 1 (per-user only)
- **Multiple message types**: Graduate to Pattern 2 (per-type limits)
- **Mature, complex API**: Pattern 3 (cost-based) provides the most control

### Quick Start

1. Analyze your app's traffic signature (chat? gaming? streaming?)
2. Pick initial capacity and rate from the domain-specific recommendations above
3. Choose your strategy: simple per-user, per-type, or cost-based
4. Deploy to a small cohort and monitor for 2 weeks
5. Tune based on real-world feedback: Are users complaining? Is abuse rising?

The case study shows that one generic policy rarely survives contact with production. But by reasoning about capacity and refill rate as levers that model your workload, you move from reactive firefighting to proactive, confident tuning.

Fair rate limiting isn't about saying "no" more often. It's about saying "yes" predictably, protecting the system when necessary, and building a platform where both legitimate users and your backend infrastructure can thrive. When done right, users won't notice the limit is there — they'll just experience a fast, fair, and stable service.

---

## Further Reading

- Token bucket algorithm ([Wikipedia](https://en.wikipedia.org/wiki/Token_bucket))
- Rate limiting patterns ([Discord Developer Docs](https://discord.com/developers/docs/topics/rate-limits))
- Cost-based rate limiting ([Shopify Engineering](https://shopify.engineering/rate-limiting-graphql-apis-calculating-query-complexity))
- Rate limiting in WS-Kit ([Guide](../guides/rate-limiting))
