import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./netlify/database/schema.ts",
  out: "./netlify/database/migrations"
});
