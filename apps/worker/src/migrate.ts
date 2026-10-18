// 워커 컨테이너 시작 시 먼저 실행된다 (Dockerfile CMD). PRD 12장 "서버 자동화"
import { fileURLToPath } from "node:url";
import { runMigrations } from "@agentorg/shared/db/migrate";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL이 설정되지 않았습니다");

// dist/migrate.js 기준 저장소 루트의 packages/shared/drizzle
const folder = fileURLToPath(new URL("../../../packages/shared/drizzle", import.meta.url));

await runMigrations(url, folder);
console.log("[migrate] DB 마이그레이션 완료");
