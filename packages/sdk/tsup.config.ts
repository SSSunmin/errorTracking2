import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "es2022",
    sourcemap: true,
    clean: true,
    splitting: false
  },
  {
    entry: {
      "mini-sentry": "src/loader.ts"
    },
    format: ["iife"],
    target: "es2022",
    globalName: "MiniSentry",
    sourcemap: true,
    splitting: false
  },
  {
    entry: {
      "mini-sentry": "src/loader.ts"
    },
    format: ["iife"],
    target: "es2022",
    globalName: "MiniSentry",
    minify: true,
    splitting: false,
    outExtension: () => ({
      js: ".min.js"
    })
  }
]);
