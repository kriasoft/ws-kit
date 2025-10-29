// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: "/ws-kit/",
  title: "WebSocket Kit",
  description:
    "Schema-first WebSocket message router for Bun with TypeScript validation",
  lang: "en-US",
  lastUpdated: true,
  cleanUrls: true,
  srcDir: "docs",

  sitemap: {
    hostname: "https://kriasoft.com/ws-kit/",
    lastmodDateOnly: false,
  },

  head: [
    ["link", { rel: "icon", href: "/ws-kit/favicon.ico" }],
    ["meta", { name: "theme-color", content: "#3c8772" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:locale", content: "en" }],
    [
      "meta",
      {
        property: "og:title",
        content: "Bun WebSocket Router | Schema-First WebSocket Routing",
      },
    ],
    ["meta", { property: "og:site_name", content: "Bun WebSocket Router" }],
    ["meta", { property: "og:url", content: "https://kriasoft.com/ws-kit/" }],
    [
      "meta",
      {
        property: "og:image",
        content: "https://kriasoft.com/ws-kit/og-image.webp",
      },
    ],
  ],
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: "Home", link: "/" },
      { text: "Docs", link: "/getting-started" },
    ],

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/kriasoft/ws-kit/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    sidebar: [
      {
        text: "Manual",
        items: [
          { text: "Getting Started", link: "/getting-started" },
          { text: "Core Concepts", link: "/core-concepts" },
          { text: "Message Schemas", link: "/message-schemas" },
          { text: "API Reference", link: "/api-reference" },
          { text: "Examples", link: "/examples" },
          { text: "Advanced Usage", link: "/advanced-usage" },
          { text: "Deployment", link: "/deployment" },
        ],
      },
      {
        text: "Client",
        items: [
          { text: "Setup", link: "/client-setup" },
          { text: "API Reference", link: "/client-api" },
          { text: "Authentication", link: "/client-auth" },
          { text: "Error Handling", link: "/client-errors" },
          { text: "Advanced", link: "/client-advanced" },
        ],
      },
      {
        text: "For Developers",
        items: [
          {
            text: "Specifications",
            link: "https://github.com/kriasoft/ws-kit/tree/main/docs/specs",
          },
          {
            text: "Architecture Decisions",
            link: "https://github.com/kriasoft/ws-kit/blob/main/docs/adr",
          },
          {
            text: "Contributing",
            link: "https://github.com/kriasoft/ws-kit/blob/main/.github/CONTRIBUTING.md",
          },
          {
            text: "Security Policy",
            link: "https://github.com/kriasoft/ws-kit/blob/main/.github/SECURITY.md",
          },
          {
            text: "Sponsor",
            link: "https://github.com/sponsors/koistya",
          },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/kriasoft/ws-kit" },
    ],

    footer: {
      message:
        'Released under the <a href="https://github.com/kriasoft/ws-kit/blob/main/LICENSE">MIT License</a>.',
      copyright:
        'Copyright © 2025-present <a href="https://kriasoft.com" target="_self">Kriasoft</a> · Created by <a href="https://github.com/koistya">Konstantin Tarkus</a>',
    },
  },

  vite: {
    publicDir: "../.vitepress/public",
  },
});
