import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

/** 드라이버와 무관한 DB 타입 (운영: postgres-js, 테스트: PGlite). 트랜잭션도 이 타입이다. */
export type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(url: string) {
  return drizzle(postgres(url, { max: 5 }), { schema });
}

let shared: Db | undefined;

/** 프로세스당 연결 풀 1개 (DATABASE_URL 사용). */
export function getDb(): Db {
  if (!shared) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL이 설정되지 않았습니다");
    shared = createDb(url);
  }
  return shared;
}

export { schema };
