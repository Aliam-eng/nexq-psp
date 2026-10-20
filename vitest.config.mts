import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Never let real Whish/3Pay credentials from .env reach a test (Prisma auto-loads .env,
    // but does not override variables that are already set — even to "").
    env: {
      WHISH_BASE_URL: "",
      WHISH_CHANNEL: "",
      WHISH_SECRET: "",
      WHISH_WEBSITE_URL: "",
      WHISH_USER_AGENT: "",
      THREEPAY_BASE_URL: "",
      THREEPAY_API_KEY: "",
      THREEPAY_API_SECRET: "",
      THREEPAY_WEBHOOK_SECRET: "",
    },
    // Integration tests share one Postgres database — run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
