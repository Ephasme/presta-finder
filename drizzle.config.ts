import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: "file:placeholder.db", // only used by drizzle-kit CLI; runtime path is different
  },
})
