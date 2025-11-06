// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { Theme } from "vitepress";
import { useData } from "vitepress";
import { createMermaidRenderer } from "vitepress-mermaid-renderer";
import DefaultTheme from "vitepress/theme";
import { h, nextTick, watch } from "vue";
import PostLayout from "./PostLayout.vue";
import "./style.css";

// https://vitepress.dev/guide/custom-theme
export default {
  extends: DefaultTheme,
  Layout: () => {
    const { isDark, page } = useData();
    const initMermaid = () => {
      nextTick(() =>
        createMermaidRenderer({
          theme: isDark.value ? "dark" : "forest",
        }).initialize(),
      );
    };

    nextTick(() => initMermaid());

    watch(
      () => isDark.value,
      () => {
        initMermaid();
      },
    );

    // Use PostLayout for blog posts
    const filePath = page.value.filePath;
    const isPost =
      typeof filePath === "string" && filePath.startsWith("posts/");
    const Layout = isPost ? PostLayout : DefaultTheme.Layout;

    return h(Layout, null, {
      // https://vitepress.dev/guide/extending-default-theme#layout-slots
    });
  },
  enhanceApp() {
    // ...
  },
} satisfies Theme;
