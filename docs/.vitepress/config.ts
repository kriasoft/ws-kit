import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: "/bun-ws-router/",
  title: "Bun WebSocket Router",
  description:
    "Schema-first WebSocket message router for Bun with TypeScript validation",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: "Home", link: "/" },
      { text: "Docs", link: "/getting-started" },
    ],

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
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/kriasoft/bun-ws-router" },
    ],
  },
});
