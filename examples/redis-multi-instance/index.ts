// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Multi-Instance Chat with Redis PubSub
 *
 * This example demonstrates using @ws-kit/redis-pubsub to enable cross-instance
 * communication in a Bun cluster deployment.
 *
 * To run multiple instances:
 * 1. Start Redis: docker run -d -p 6379:6379 redis:latest
 * 2. Terminal 1: bun run examples/redis-multi-instance/index.ts
 * 3. Terminal 2: INSTANCE_ID=2 bun run examples/redis-multi-instance/index.ts
 * 4. Connect with: ws://localhost:3000 and ws://localhost:3001
 *
 * Messages from one instance will be visible to all connected clients across all instances.
 */

import { createBunHandler } from "@ws-kit/bun";
import { createRedisPubSub } from "@ws-kit/redis-pubsub";
import { createRouter, message, z } from "@ws-kit/zod";

// Configuration
const INSTANCE_ID = process.env.INSTANCE_ID || "1";
const PORT = parseInt(process.env.PORT || "3000") + (parseInt(INSTANCE_ID) - 1);
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

console.log(`🚀 Starting instance #${INSTANCE_ID} on port ${PORT}`);
console.log(`📡 Using Redis: ${REDIS_URL}`);

// Create validator and message schemas
const JoinMessage = message("JOIN", {
  username: z.string(),
});

const ChatMessage = message("CHAT", {
  username: z.string(),
  text: z.string(),
  timestamp: z.number(),
});

const LeaveMessage = message("LEAVE", {
  username: z.string(),
});

// Schemas for internal event broadcasting
const UserJoinedEvent = message("USER_JOINED", {
  username: z.string(),
  instance: z.string(),
  timestamp: z.number(),
});

const UserLeftEvent = message("USER_LEFT", {
  username: z.string(),
  instance: z.string(),
  timestamp: z.number(),
});

const ChatMessageEvent = message("MESSAGE", {
  username: z.string(),
  text: z.string(),
  instance: z.string(),
  timestamp: z.number(),
});

// Type definitions for Redis messages
// ChatMessageEvent now defined via message schema above

interface UserEvent {
  type: "USER_JOINED" | "USER_LEFT";
  username: string;
  timestamp: number;
  instance: string;
}

// Type definitions for WebSocket data
type WebSocketData = { clientId: string } & Record<string, unknown>;

// Track connected users in this instance
const connectedUsers = new Map<
  string,
  { username: string; clientId: string }
>();

// Create router with Redis PubSub for cross-instance communication
const pubsub = createRedisPubSub({
  url: REDIS_URL,
  namespace: `chat:app:${INSTANCE_ID}`,
  onConnect: () => {
    console.log("✅ Connected to Redis");
  },
  onError: (err) => {
    console.error("❌ Redis error:", err.message);
  },
  onDisconnect: () => {
    console.log("⚠️  Disconnected from Redis (reconnecting...)");
  },
});

const router = createRouter<WebSocketData>({
  pubsub,
});

router.onClose((ctx) => {
  const clientId = ctx.ws.data.clientId;

  const user = connectedUsers.get(clientId);
  if (user) {
    connectedUsers.delete(clientId);

    // Broadcast leave message
    router.publish("chat:users", UserLeftEvent, {
      username: user.username,
      timestamp: Date.now(),
      instance: INSTANCE_ID,
    });

    console.log(`👋 ${user.username} left (instance #${INSTANCE_ID})`);
  }
});

// Join handler - new user connects
router.on(JoinMessage, (ctx) => {
  const clientId = ctx.ws.data.clientId;

  const { username } = ctx.payload; // ✅ Fully typed, no assertion needed

  connectedUsers.set(clientId, { username, clientId });

  console.log(`👤 ${username} joined (instance #${INSTANCE_ID})`);

  // Broadcast to all instances
  router.publish("chat:users", UserJoinedEvent, {
    username,
    timestamp: Date.now(),
    instance: INSTANCE_ID,
  });

  // Send welcome message
  ctx.send(ChatMessage, {
    username: "System",
    text: `Welcome ${username}! You're connected to instance #${INSTANCE_ID}. Messages will be shared across all instances.`,
    timestamp: Date.now(),
  });
});

// Chat message handler
router.on(ChatMessage, async (ctx) => {
  const clientId = ctx.ws.data.clientId;

  const user = connectedUsers.get(clientId);
  if (!user) return;

  const { text } = ctx.payload; // ✅ Fully typed, no assertion needed
  console.log(`💬 [${user.username}]: ${text}`);

  // Broadcast to all instances
  await router.publish("chat:messages", ChatMessageEvent, {
    username: user.username,
    text,
    timestamp: Date.now(),
    instance: INSTANCE_ID,
  });
});

// Subscribe to messages from other instances
pubsub.subscribe("chat:messages", (message: unknown) => {
  // Messages from other instances are received here
  // In a real app, you might forward these to all connected clients
  // For now, just log them (actual forwarding would require client list)
  const msg = message as Record<string, unknown>;
  console.log(
    `📨 From instance #${msg.instance}: ${msg.username}: ${msg.text}`,
  );
});

// Subscribe to user presence updates
pubsub.subscribe("chat:users", (message: unknown) => {
  const event = message as UserEvent;

  if (event.type === "USER_JOINED") {
    console.log(`  📢 ${event.username} joined on instance #${event.instance}`);
  } else if (event.type === "USER_LEFT") {
    console.log(`  📢 ${event.username} left from instance #${event.instance}`);
  }
});

// Create handler with authentication for client ID initialization
const { fetch: handleWebSocket, websocket } = createBunHandler(router, {
  authenticate() {
    // Generate unique client ID for this connection
    return { clientId: crypto.randomUUID() };
  },
});

// Serve HTTP + WebSocket
const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      return handleWebSocket(req, server);
    }

    // HTTP endpoints
    if (url.pathname === "/") {
      return new Response(getHtmlClient(INSTANCE_ID, PORT), {
        headers: { "Content-Type": "text/html" },
      });
    }

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          instance: INSTANCE_ID,
          port: PORT,
          users: connectedUsers.size,
          redis: pubsub.isConnected() ? "connected" : "disconnected",
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response("Not found", { status: 404 });
  },
  websocket,
});

console.log(`🌐 Listening on http://localhost:${PORT}`);
console.log(`   WebSocket: ws://localhost:${PORT}/ws`);
console.log(`   Health: http://localhost:${PORT}/health`);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down...");
  await pubsub.destroy();
  server.stop();
  process.exit(0);
});

/**
 * Simple HTML client for testing
 */
function getHtmlClient(instanceId: string, port: number) {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Redis Chat - Instance #${instanceId}</title>
  <style>
    body { font-family: -apple-system, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #333; margin-top: 0; }
    .status { padding: 10px; border-radius: 4px; margin-bottom: 20px; font-weight: bold; }
    .status.connected { background: #d4edda; color: #155724; }
    .status.disconnected { background: #f8d7da; color: #721c24; }
    .messages { height: 300px; border: 1px solid #ddd; border-radius: 4px; padding: 10px; overflow-y: auto; margin-bottom: 10px; background: #f9f9f9; }
    .message { margin-bottom: 8px; padding: 8px; background: white; border-left: 3px solid #007bff; }
    .message.system { border-left-color: #6c757d; color: #6c757d; }
    .message.own { border-left-color: #28a745; }
    .timestamp { font-size: 0.8em; color: #999; }
    .input-group { display: flex; gap: 10px; margin-bottom: 10px; }
    input { flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
    button { padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
    button:hover { background: #0056b3; }
    button:disabled { background: #ccc; cursor: not-allowed; }
  </style>
</head>
<body>
  <div class="container">
    <h1>💬 Redis Chat - Instance #${instanceId}</h1>
    <div class="status disconnected" id="status">Disconnected</div>

    <div class="messages" id="messages"></div>

    <div class="input-group">
      <input type="text" id="username" placeholder="Enter your name" />
      <button id="joinBtn" onclick="join()">Join</button>
    </div>

    <div class="input-group">
      <input type="text" id="messageInput" placeholder="Type a message..." disabled />
      <button id="sendBtn" onclick="sendMessage()" disabled>Send</button>
    </div>
  </div>

  <script>
    const instanceId = '${instanceId}';
    const port = ${port};
    let ws = null;
    let username = null;
    let joined = false;

    function connect() {
      ws = new WebSocket(\`ws://localhost:\${port}/ws\`);

      ws.onopen = () => {
        console.log('Connected to instance #' + instanceId);
        updateStatus(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'CHAT') {
            addMessage(msg.payload.username, msg.payload.text, msg.payload.timestamp, msg.payload.username === username);
          }
        } catch (e) {
          console.error('Parse error:', e);
        }
      };

      ws.onclose = () => {
        console.log('Disconnected from instance #' + instanceId);
        updateStatus(false);
        joined = false;
        document.getElementById('joinBtn').disabled = false;
        document.getElementById('joinBtn').textContent = 'Join';
        document.getElementById('messageInput').disabled = true;
        document.getElementById('sendBtn').disabled = true;
        setTimeout(connect, 2000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateStatus(false);
      };
    }

    function updateStatus(connected) {
      const status = document.getElementById('status');
      if (connected) {
        status.textContent = '🟢 Connected to Instance #' + instanceId;
        status.className = 'status connected';
      } else {
        status.textContent = '🔴 Disconnected';
        status.className = 'status disconnected';
      }
    }

    function join() {
      const input = document.getElementById('username');
      username = input.value.trim();

      if (!username) {
        alert('Please enter your name');
        return;
      }

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Not connected to server');
        return;
      }

      ws.send(JSON.stringify({
        type: 'JOIN',
        payload: { username }
      }));

      joined = true;
      input.disabled = true;
      document.getElementById('joinBtn').disabled = true;
      document.getElementById('joinBtn').textContent = 'Joined';
      document.getElementById('messageInput').disabled = false;
      document.getElementById('sendBtn').disabled = false;
      document.getElementById('messageInput').focus();

      addMessage('System', \`You joined as '\${username}' on instance #\${instanceId}\`, Date.now());
    }

    function sendMessage() {
      const input = document.getElementById('messageInput');
      const text = input.value.trim();

      if (!text) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Not connected');
        return;
      }

      ws.send(JSON.stringify({
        type: 'CHAT',
        payload: {
          username,
          text,
          timestamp: Date.now()
        }
      }));

      input.value = '';
      input.focus();
    }

    function addMessage(user, text, timestamp, isOwn = false) {
      const messages = document.getElementById('messages');
      const div = document.createElement('div');
      const time = new Date(timestamp).toLocaleTimeString();

      div.className = 'message' + (user === 'System' ? ' system' : '') + (isOwn ? ' own' : '');
      div.innerHTML = \`
        <strong>\${user}</strong>
        <div>\${text}</div>
        <span class="timestamp">\${time}</span>
      \`;

      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    // Connect on load
    document.getElementById('messageInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });

    connect();
  </script>
</body>
</html>
  `;
}
