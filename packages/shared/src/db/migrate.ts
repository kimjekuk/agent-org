import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** 배포 때 자동 실행 (PRD 12장 서버 자동화). 이미 적용된 마이그레이션은 건너뛴다. */
export async function runMigrations(url: string, migrationsFolder: string) {
  const sql = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder });
  } finally {
    await sql.end();
  }
}
