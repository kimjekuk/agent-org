import type { Db } from "./db/client";
import { auditLogs } from "./db/schema";

export type AuditEntry = typeof auditLogs.$inferInsert;

/** CLAUDE.md 절대 규칙 4: 모든 상태 변경은 AuditLog에 기록한다. */
export async function writeAudit(db: Pick<Db, "insert">, entry: AuditEntry) {
  await db.insert(auditLogs).values(entry);
}
