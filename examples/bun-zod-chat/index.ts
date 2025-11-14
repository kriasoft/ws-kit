// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Real-time chat application using @ws-kit/bun + @ws-kit/zod
 *
 * Features:
 * - Type-safe message routing with Zod validation
 * - Room-based pub/sub
 * - User authentication
 * - Connection tracking
 *
 * Run: bun run examples/bun-zod-chat/index.ts
 * Connect: ws://localhost:3000/ws
 */

import { createBunHandler } from "@ws-kit/bun";
import type { WsKitError } from "@ws-kit/core";
import { createRouter, message, withZod, z } from "@ws-kit/zod";

// =======================
// Message Schemas
// =======================

// Using the new export-with-helpers pattern:
// - Import message() directly instead of factory
// - Single import source for z, message(), and createRouter()

// Client -> Server messages
const JoinRoomMessage = message("ROOM:JOIN", {
  room: z.string().min(1).max(50),
});

const SendMessageMessage = message("MESSAGE:SEND", {
  text: z.string().min(1).max(500),
});

const LeaveRoomMessage = message("ROOM:LEAVE", {});

// Server -> Client messages
const RoomUsersMessage = message("ROOM:USERS", {
  room: z.string(),
  users: z.array(z.string()),
  count: z.number(),
});

const UserJoinedMessage = message("USER:JOINED", {
  user: z.string(),
  room: z.string(),
});

const UserLeftMessage = message("USER:LEFT", {
  user: z.string(),
  room: z.string(),
});

const MessageBroadcastMessage = message("MESSAGE:BROADCAST", {
  user: z.string(),
  room: z.string(),
  text: z.string(),
  timestamp: z.number(),
});

const WelcomeMessage = message("SERVER:WELCOME", {
  clientId: z.string(),
  timestamp: z.number(),
});

const ErrorMessage = message("SERVER:ERROR", {
  message: z.string(),
});

// =======================
// State Management
// =======================

interface User {
  clientId: string;
  name: string;
  rooms: Set<string>;
}

type WebSocketData = { clientId: string } & Record<string, unknown>;

const users = new Map<string, User>();
const rooms = new Map<string, Set<string>>();

// =======================
// Router Setup
// =======================

const router = createRouter<WebSocketData>().plugin(withZod());

// =======================
// Middleware
// =======================

// Authentication middleware - validates user exists before handling message
router.use((ctx, next) => {
  const clientId = ctx.ws.data.clientId;
  const user = users.get(clientId);

  // User must exist to process messages
  if (!user) {
    ctx.send(ErrorMessage, {
      message: "Not authenticated. Please reconnect.",
    });
    return; // Skip handler
  }

  // Continue to next middleware or handler
  return next();
});

// =======================
// Lifecycle Hooks
// =======================

router.onOpen(async (ctx) => {
  const clientId = ctx.ws.data?.clientId || crypto.randomUUID();

  // Create user record
  users.set(clientId, {
    clientId,
    name: `User-${clientId.slice(0, 8)}`,
    rooms: new Set(),
  });

  console.log(`[${clientId}] Connected (${users.size} users online)`);

  // Send welcome message
  ctx.send(WelcomeMessage, {
    clientId,
    timestamp: Date.now(),
  });
});

router.onClose(async (ctx) => {
  const clientId = ctx.ws.data?.clientId || "";
  const user = users.get(clientId);

  if (user) {
    // Notify all rooms this user was in
    const roomsArray = Array.from(user.rooms);
    for (const room of roomsArray) {
      const roomUsers = rooms.get(room);
      if (roomUsers) {
        roomUsers.delete(clientId);

        // Broadcast user left message
        await router.publish(`room:${room}`, UserLeftMessage, {
          user: user.name,
          room,
        });

        // Broadcast updated user list
        await router.publish(`room:${room}`, RoomUsersMessage, {
          room,
          users: Array.from(roomUsers),
          count: roomUsers.size,
        });

        // Clean up empty room
        if (roomUsers.size === 0) {
          rooms.delete(room);
        }
      }
    }

    // Remove user
    users.delete(clientId);
  }

  console.log(`[${clientId}] Disconnected (${users.size} users online)`);
});

router.onError((error: WsKitError) => {
  console.error("Error:", error.message);
  return true; // Indicate error was handled
});

// =======================
// Message Handlers
// =======================

router.on(JoinRoomMessage, async (ctx) => {
  const clientId = ctx.ws.data.clientId;
  const user = users.get(clientId);
  const { room } = ctx.payload;

  if (!user) return;

  // Subscribe to room
  await ctx.topics.subscribe(`room:${room}`);

  // Track user in room
  user.rooms.add(room);
  if (!rooms.has(room)) {
    rooms.set(room, new Set());
  }
  const roomSet = rooms.get(room);
  if (roomSet) {
    roomSet.add(clientId);
  }

  console.log(`[${clientId}] Joined room: ${room}`);

  // Broadcast user joined
  await router.publish(`room:${room}`, UserJoinedMessage, {
    user: user.name,
    room,
  });

  // Send updated user list
  const roomUsers = rooms.get(room);
  if (roomUsers) {
    await router.publish(`room:${room}`, RoomUsersMessage, {
      room,
      users: Array.from(roomUsers),
      count: roomUsers.size,
    });
  }
});

router.on(SendMessageMessage, async (ctx) => {
  const clientId = ctx.ws.data.clientId;
  const user = users.get(clientId);
  const { text } = ctx.payload;

  if (!user || user.rooms.size === 0) {
    ctx.send(ErrorMessage, {
      message: "Join a room first",
    });
    return;
  }

  // Broadcast to all rooms user is in
  const roomsArray = Array.from(user.rooms);
  for (const room of roomsArray) {
    await router.publish(`room:${room}`, MessageBroadcastMessage, {
      user: user.name,
      room,
      text,
      timestamp: Date.now(),
    });
  }

  console.log(`[${clientId}] Sent: ${text}`);
});

router.on(LeaveRoomMessage, async (ctx) => {
  const { clientId } = ctx.ws.data;
  const user = users.get(clientId);

  if (!user || user.rooms.size === 0) {
    ctx.send(ErrorMessage, {
      message: "Not in any room",
    });
    return;
  }

  // Leave first room for now (could be enhanced for multi-room)
  const room = Array.from(user.rooms)[0];
  if (room) {
    user.rooms.delete(room);
    await ctx.topics.unsubscribe(`room:${room}`);

    const roomUsers = rooms.get(room);
    if (roomUsers) {
      roomUsers.delete(clientId);

      // Broadcast user left
      await router.publish(`room:${room}`, UserLeftMessage, {
        user: user.name,
        room,
      });

      // Send updated user list
      await router.publish(`room:${room}`, RoomUsersMessage, {
        room,
        users: Array.from(roomUsers),
        count: roomUsers.size,
      });

      if (roomUsers.size === 0) {
        rooms.delete(room);
      }
    }

    console.log(`[${clientId}] Left room: ${room}`);
  }
});

// =======================
// Server Setup
// =======================

const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// Create handler with authentication for client ID initialization
const { fetch: handleWebSocket, websocket } = createBunHandler(router, {
  authenticate() {
    // Generate unique client ID for this connection
    return { clientId: crypto.randomUUID() };
  },
});

Bun.serve({
  port,
  fetch(req, server) {
    const url = new URL(req.url);

    // Route WebSocket requests
    if (url.pathname === "/ws") {
      return handleWebSocket(req, server);
    }

    // Simple HTTP endpoint for stats
    if (url.pathname === "/stats") {
      return new Response(
        JSON.stringify({
          usersOnline: users.size,
          rooms: Array.from(rooms.keys()),
          timestamp: Date.now(),
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Serve client HTML
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML, {
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
  websocket,
});

console.log(`🚀 Chat server running at http://localhost:${port}`);
console.log(`📊 Stats available at http://localhost:${port}/stats`);

// =======================
// Simple HTML Client
// =======================

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>@ws-kit/bun Chat Demo</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .container {
      width: 100%;
      max-width: 600px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      display: flex;
      flex-direction: column;
      height: 90vh;
      max-height: 600px;
    }

    .header {
      padding: 20px;
      border-bottom: 1px solid #eee;
      background: #f8f9fa;
    }

    .header h1 {
      font-size: 20px;
      margin-bottom: 10px;
    }

    .controls {
      display: flex;
      gap: 10px;
      margin-bottom: 10px;
    }

    input {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 14px;
    }

    button {
      padding: 8px 16px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
      transition: background 0.2s;
    }

    button:hover {
      background: #5568d3;
    }

    .status {
      font-size: 12px;
      color: #666;
    }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .message {
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 14px;
      word-break: break-word;
    }

    .message.system {
      background: #f0f0f0;
      color: #666;
      font-style: italic;
    }

    .message.user {
      background: #667eea;
      color: white;
      margin-left: auto;
      max-width: 80%;
    }

    .message.other {
      background: #e9ecef;
      color: #333;
      max-width: 80%;
    }

    .message.user-meta {
      font-size: 12px;
      margin: 5px 0;
      opacity: 0.8;
    }

    .input-area {
      padding: 20px;
      border-top: 1px solid #eee;
      display: flex;
      gap: 10px;
    }

    #messageInput {
      flex: 1;
    }

    #sendBtn {
      padding: 8px 24px;
    }

    .info {
      font-size: 12px;
      color: #999;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>💬 WebSocket Chat</h1>
      <div class="controls">
        <input id="roomInput" type="text" placeholder="Room name" value="general">
        <button id="joinBtn">Join Room</button>
      </div>
      <div class="status">
        <span id="statusText">Connecting...</span>
      </div>
    </div>

    <div class="messages" id="messages"></div>

    <div class="input-area">
      <input id="messageInput" type="text" placeholder="Type a message..." disabled>
      <button id="sendBtn" disabled>Send</button>
    </div>

    <div class="info" id="info"></div>
  </div>

  <script>
    let ws = null;
    let currentRoom = null;

    const elements = {
      roomInput: document.getElementById('roomInput'),
      joinBtn: document.getElementById('joinBtn'),
      messageInput: document.getElementById('messageInput'),
      sendBtn: document.getElementById('sendBtn'),
      messages: document.getElementById('messages'),
      statusText: document.getElementById('statusText'),
      info: document.getElementById('info'),
    };

    function connect() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(\`\${protocol}//\${location.host}/ws\`);

      ws.onopen = () => {
        elements.statusText.textContent = '✅ Connected';
        elements.joinBtn.disabled = false;
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'SERVER:WELCOME':
            addSystemMessage(\`Welcome! Your ID: \${msg.clientId.slice(0, 8)}\`);
            elements.info.textContent = \`Client ID: \${msg.clientId.slice(0, 8)}\`;
            break;

          case 'ROOM:USERS':
            addSystemMessage(\`Room '\${msg.room}' has \${msg.count} user(s)\`);
            break;

          case 'USER:JOINED':
            addSystemMessage(\`→ \${msg.user} joined the room\`);
            break;

          case 'USER:LEFT':
            addSystemMessage(\`← \${msg.user} left the room\`);
            break;

          case 'MESSAGE:BROADCAST':
            addMessage(msg.user, msg.text);
            break;

          case 'SERVER:ERROR':
            addSystemMessage(\`⚠️ Error: \${msg.message}\`);
            break;
        }
      };

      ws.onclose = () => {
        elements.statusText.textContent = '❌ Disconnected';
        elements.joinBtn.disabled = true;
        elements.messageInput.disabled = true;
        elements.sendBtn.disabled = true;
        setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        elements.statusText.textContent = '⚠️ Connection error';
      };
    }

    function addMessage(user, text) {
      const div = document.createElement('div');
      const isOwn = text.startsWith('[YOU]');

      div.className = 'message ' + (isOwn ? 'user' : 'other');
      div.innerHTML = \`
        <div class="user-meta">\${user}</div>
        <div>\${text}</div>
      \`;

      elements.messages.appendChild(div);
      elements.messages.scrollTop = elements.messages.scrollHeight;
    }

    function addSystemMessage(text) {
      const div = document.createElement('div');
      div.className = 'message system';
      div.textContent = text;
      elements.messages.appendChild(div);
      elements.messages.scrollTop = elements.messages.scrollHeight;
    }

    elements.joinBtn.onclick = () => {
      const room = elements.roomInput.value.trim();
      if (!room) return;

      currentRoom = room;
      ws.send(JSON.stringify({
        type: 'ROOM:JOIN',
        room,
      }));

      elements.messageInput.disabled = false;
      elements.sendBtn.disabled = false;
      elements.messageInput.focus();
    };

    elements.sendBtn.onclick = () => {
      const text = elements.messageInput.value.trim();
      if (!text) return;

      ws.send(JSON.stringify({
        type: 'MESSAGE:SEND',
        text,
      }));

      addMessage('[YOU]', text);
      elements.messageInput.value = '';
      elements.messageInput.focus();
    };

    elements.messageInput.onkeydown = (e) => {
      if (e.key === 'Enter') elements.sendBtn.click();
    };

    // Start connection
    connect();
  </script>
</body>
</html>`;
