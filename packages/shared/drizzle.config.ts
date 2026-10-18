import { defineConfig } from "drizzle-kit";

// 마이그레이션 생성: pnpm --filter @agentorg/shared db:generate (DB 연결 불필요)
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
