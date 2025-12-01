# WS-Kit — Schema-First WebSocket Framework

[![CI](https://github.com/kriasoft/ws-kit/actions/workflows/main.yml/badge.svg)](https://github.com/kriasoft/ws-kit/actions)
[![Coverage](https://codecov.io/gh/kriasoft/ws-kit/branch/main/graph/badge.svg)](https://app.codecov.io/gh/kriasoft/ws-kit)
[![npm](https://img.shields.io/npm/v/@ws-kit/zod.svg)](https://www.npmjs.com/package/@ws-kit/zod)
[![Downloads](https://img.shields.io/npm/dm/@ws-kit/zod.svg)](https://www.npmjs.com/package/@ws-kit/zod)
[![Discord](https://img.shields.io/discord/643523529131950086?label=Discord)](https://discord.gg/aW29wXyb7w)

Define message contracts with Zod or Valibot and get end-to-end TypeScript safety for WebSocket RPC and pub/sub across Bun, Cloudflare, Node.js, and browsers.

Docs → https://kriasoft.com/ws-kit/

## Why WS-Kit

- Type inference from schema to handler, errors, and client calls
- RPC + pub/sub + middleware + lifecycle hooks in one router
- Pluggable validators/adapters (Bun, Cloudflare, Redis, in-memory)
- Test harness with fake connections, clock, and event capture
- Universal client with auto-reconnect, retries, and offline queueing

## Install

```bash
# With Zod on Bun (recommended)
bun add @ws-kit/zod @ws-kit/bun
bun add zod bun @types/bun -D

# Valibot (smaller bundles)
bun add @ws-kit/valibot @ws-kit/bun
bun add valibot bun @types/bun -D
```

## Quick start (server)

```ts
import { z, message, createRouter, withZod } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

const Ping = message("PING", { text: z.string() });
const Pong = message("PONG", { reply: z.string() });

const router = createRouter().plugin(withZod());

router.on(Ping, (ctx) => {
  ctx.send(Pong, { reply: `Got: ${ctx.payload.text}` });
});

serve(router, {
  port: 3000,
  authenticate(req) {
    const token = req.headers.get("authorization");
    return token ? { userId: "u_123" } : undefined;
  },
});
```

## Quick start (client)

```ts
import { rpc, message, wsClient } from "@ws-kit/client/zod";
import { z } from "@ws-kit/zod";

const Hello = rpc("HELLO", { name: z.string() }, "HELLO_OK", {
  text: z.string(),
});
const Broadcast = message("BROADCAST", { data: z.string() });

const client = wsClient({ url: "ws://localhost:3000" });
await client.connect();

const reply = await client.request(Hello, { name: "Ada" });
console.log(reply.payload.text); // typed as string

client.on(Broadcast, (msg) => {
  console.log(msg.payload.data);
});
```

## More

- Docs: https://kriasoft.com/ws-kit/
- Examples: `examples/`
- Packages: `packages/`
- Support: [Discord](https://discord.gg/aW29wXyb7w)

## Backers 💰

<a href="https://reactstarter.com/b/1"><img src="https://reactstarter.com/b/1.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/2"><img src="https://reactstarter.com/b/2.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/3"><img src="https://reactstarter.com/b/3.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/4"><img src="https://reactstarter.com/b/4.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/5"><img src="https://reactstarter.com/b/5.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/6"><img src="https://reactstarter.com/b/6.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/7"><img src="https://reactstarter.com/b/7.png" height="60" /></a>&nbsp;&nbsp;<a href="https://reactstarter.com/b/8"><img src="https://reactstarter.com/b/8.png" height="60" /></a>

## License

MIT
