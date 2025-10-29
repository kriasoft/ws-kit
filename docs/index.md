---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "WS-Kit"
  text: "Type-Safe WebSocket router for Bun and Cloudflare"
  tagline: Type-safe message routing with pluggable validators and platform adapters
  actions:
    - theme: brand
      text: Getting Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/kriasoft/ws-kit

features:
  - icon: 🛡️
    title: Type-Safe Routing
    details: Define message schemas with Zod or Valibot and get full TypeScript type inference from schema to handler
  - icon: ⚡
    title: Multi-Platform
    details: Works with Bun's high-performance WebSocket server and Cloudflare Durable Objects with platform-specific optimizations
  - icon: 🎯
    title: Message-Based Architecture
    details: Consistent message structure with automatic routing based on message types
  - icon: 🔧
    title: Developer Experience
    details: Simple API with powerful features like error boundaries, connection metadata, and async handlers
  - icon: 📦
    title: Lightweight
    details: Choose Valibot for significantly smaller bundles or Zod for familiar syntax. Core logic shared between adapters
  - icon: 🚀
    title: Production Ready
    details: Built-in error handling, authentication patterns, and room broadcasting for real-world applications
---
