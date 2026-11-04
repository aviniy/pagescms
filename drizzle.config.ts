import "./db/envConfig";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  strict: true,
  verbose: true,
  dbCredentials: {
    // Migrations need a direct connection. Runtime traffic keeps using the
    // pooled DATABASE_URL that Neon writes for serverless deployments.
    url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL!,
  },
});
