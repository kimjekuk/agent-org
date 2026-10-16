import Redis from "ioredis";
import postgres from "postgres";

export const dynamic = "force-dynamic";

/** 운영자가 원인을 알 수 있도록 ECONNREFUSED 같은 코드를 우선 보여준다. */
function errorCode(e: unknown): string {
  const err = e as { code?: string; name?: string };
  return err.code ?? err.name ?? "unknown";
}

async function checkDb(): Promise<string> {
  const sql = postgres(process.env.DATABASE_URL ?? "", { connect_timeout: 3, max: 1 });
  try {
    await sql`SELECT 1`;
    return "ok";
  } catch (e) {
    return `error: ${errorCode(e)}`;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function checkRedis(): Promise<string> {
  const redis = new Redis(process.env.REDIS_URL ?? "", {
    connectTimeout: 3000,
    maxRetriesPerRequest: 0,
    lazyConnect: true,
  });
  redis.on("error", () => {}); // 연결 실패는 아래 catch에서 처리
  try {
    await redis.connect();
    await redis.ping();
    return "ok";
  } catch (e) {
    return `error: ${errorCode(e)}`;
  } finally {
    redis.disconnect();
  }
}

export async function GET() {
  const [db, redis] = await Promise.all([checkDb(), checkRedis()]);
  const healthy = db === "ok" && redis === "ok";
  return Response.json({ db, redis }, { status: healthy ? 200 : 503 });
}
