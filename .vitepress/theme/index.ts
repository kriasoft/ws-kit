// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { Theme } from "vitepress";
import { useData } from "vitepress";
import { createMermaidRenderer } from "vitepress-mermaid-renderer";
import DefaultTheme from "vitepress/theme";
import { h, nextTick, watch } from "vue";
import "./style.css";

// https://vitepress.dev/guide/custom-theme
export default {
  extends: DefaultTheme,
  Layout: () => {
    const { isDark } = useData();
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

    return h(DefaultTheme.Layout, null, {
      // https://vitepress.dev/guide/extending-default-theme#layout-slots
    });
  },
  enhanceApp() {
    // ...
  },
} satisfies Theme;
