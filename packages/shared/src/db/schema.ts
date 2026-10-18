// PRD 7장 핵심 데이터 모델. 금액 단위는 원(KRW).
import {
  type AnyPgColumn,
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const autonomy = pgEnum("autonomy", ["FULL", "CHECKPOINT", "MANUAL"]);
export const agentRank = pgEnum("agent_rank", ["LEADER", "MANAGER", "MEMBER"]);
export const missionStatus = pgEnum("mission_status", ["DRAFT", "RUNNING", "PAUSED", "REVIEW", "DONE", "CANCELLED"]);
export const taskStatus = pgEnum("task_status", ["TODO", "DOING", "REVIEW", "DONE"]);
export const actorType = pgEnum("actor_type", ["USER", "AGENT", "SYSTEM"]);
export const messageType = pgEnum("message_type", ["DIRECTIVE", "REPORT", "QUESTION", "PROPOSAL"]);
export const memoryScope = pgEnum("memory_scope", ["SHORT", "MID", "LONG"]);
export const approvalType = pgEnum("approval_type", ["QUESTION", "PROPOSAL", "EXTERNAL", "CHECKPOINT", "BUDGET"]);
export const approvalStatus = pgEnum("approval_status", ["PENDING", "APPROVED", "REJECTED", "HELD"]);

/** 에이전트 상태 (PRD F003 상태 뱃지). PAUSED = 사용자가 멈춤 */
export type AgentStatus = "IDLE" | "WORKING" | "PAUSED" | "BLOCKED";

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  briefingSeenAt: timestamp("briefing_seen_at", { withTimezone: true }), // F016 출근 브리핑을 마지막으로 닫은 때
  createdAt: createdAt(),
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // "anthropic" | "openai" | "gemini"
    encryptedKey: text("encrypted_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.userId, t.provider)],
);

export const organizations = pgTable("organizations", {
  id: id(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  theme: text("theme"),
  emergencyStop: boolean("emergency_stop").notNull().default(false),
  autonomyDefault: autonomy("autonomy_default").notNull().default("CHECKPOINT"),
  budgetMonthly: integer("budget_monthly"),
  budgetDaily: integer("budget_daily").notNull().default(2000), // 2026-10-18 결정: Max 5x 월 API 크레딧 안 (PRD 11장 초기값 20,000원에서 변경)
  workHours: jsonb("work_hours"),
  fallbackModel: text("fallback_model"), // F109 API 장애 시 대체 모델 (없으면 대체 없이 실패 처리)
  createdAt: createdAt(),
});

export const agents = pgTable("agents", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  avatar: jsonb("avatar"),
  personality: text("personality"),
  rank: agentRank("rank").notNull().default("MEMBER"),
  supervisorId: uuid("supervisor_id").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
  skills: jsonb("skills").$type<string[]>().notNull().default([]),
  level: integer("level").notNull().default(1),
  xp: integer("xp").notNull().default(0),
  modelPrimary: text("model_primary"),
  modelEconomy: text("model_economy"),
  maxTurns: integer("max_turns").notNull().default(20),
  toolPermissions: jsonb("tool_permissions").$type<Partial<Record<string, boolean>>>().notNull().default({}),
  budgetLimit: integer("budget_limit"),
  autonomy: autonomy("autonomy"), // null → 조직 기본값
  status: text("status").$type<AgentStatus>().notNull().default("IDLE"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const missions = pgTable("missions", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  topic: text("topic").notNull(),
  goal: text("goal"),
  successCriteria: jsonb("success_criteria").$type<string[]>().notNull().default([]),
  deadline: timestamp("deadline", { withTimezone: true }),
  budgetLimit: integer("budget_limit").notNull().default(5000), // PRD 11장 초기값
  priority: integer("priority").notNull().default(0),
  outputFormat: text("output_format"),
  referenceNotes: text("reference_notes"), // 참고 자료 URL·텍스트 (파일 업로드는 이후 단계)
  autonomy: autonomy("autonomy"),
  leaderId: uuid("leader_id").references(() => agents.id, { onDelete: "set null" }),
  scheduleId: uuid("schedule_id").references((): AnyPgColumn => schedules.id, { onDelete: "set null" }), // F106 반복·예약으로 만든 미션
  status: missionStatus("status").notNull().default("DRAFT"),
  callLimit: integer("call_limit").notNull().default(60), // F109 무한 반복 차단: 미션의 AI 호출 상한 (승인하면 늘어남)
  createdAt: createdAt(),
});

export const tasks = pgTable("tasks", {
  id: id(),
  missionId: uuid("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  requiredSkills: jsonb("required_skills").$type<string[]>().notNull().default([]),
  assigneeId: uuid("assignee_id").references(() => agents.id, { onDelete: "set null" }),
  status: taskStatus("status").notNull().default("TODO"),
  order: integer("order").notNull().default(0),
  failCount: integer("fail_count").notNull().default(0),
  rejectCount: integer("reject_count").notNull().default(0), // 리더 반려 횟수 (Task당 최대 1회)
  createdAt: createdAt(),
});

export const messages = pgTable("messages", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  missionId: uuid("mission_id").references(() => missions.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  senderType: actorType("sender_type").notNull(),
  senderAgentId: uuid("sender_agent_id").references(() => agents.id, { onDelete: "set null" }),
  receiverAgentId: uuid("receiver_agent_id").references(() => agents.id, { onDelete: "set null" }),
  type: messageType("type").notNull(),
  content: text("content").notNull(),
  payload: jsonb("payload"),
  priority: integer("priority").notNull().default(0),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const artifacts = pgTable("artifacts", {
  id: id(),
  // 미션 없이 사용자가 직접 지시한 결과물은 mission_id가 없다 (F004·F005 직접 지시)
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  missionId: uuid("mission_id").references(() => missions.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  format: text("format"),
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),
  parentVersionId: uuid("parent_version_id").references((): AnyPgColumn => artifacts.id, { onDelete: "set null" }),
  rating: integer("rating"), // 1~5
  createdAt: createdAt(),
});

export const memories = pgTable("memories", {
  id: id(),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  scope: memoryScope("scope").notNull(),
  missionId: uuid("mission_id").references(() => missions.id, { onDelete: "set null" }),
  content: text("content").notNull(),
  source: text("source"),
  createdAt: createdAt(),
});

// F105 조직 지식 베이스: 좋은 결과물·직접 쓴 문서를 모아 검색·재활용 (2026-10-18 결정)
export const knowledgeDocs = pgTable(
  "knowledge_docs",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    source: text("source").$type<"MISSION" | "ARTIFACT" | "MANUAL">().notNull(),
    /** 같은 결과물 계열이면 새로 만들지 않고 고친다: mission:<id> · task:<id> · artifact:<id> (직접 쓴 문서는 null) */
    sourceKey: text("source_key"),
    artifactId: uuid("artifact_id").references(() => artifacts.id, { onDelete: "set null" }),
    missionId: uuid("mission_id").references(() => missions.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("knowledge_docs_source_key").on(t.orgId, t.sourceKey)],
);

export const costLogs = pgTable("cost_logs", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
  missionId: uuid("mission_id").references(() => missions.id, { onDelete: "set null" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  cost: numeric("cost", { precision: 12, scale: 4 }).notNull(), // 원
  createdAt: createdAt(),
});

export const approvalRequests = pgTable("approval_requests", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
  missionId: uuid("mission_id").references(() => missions.id, { onDelete: "set null" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  type: approvalType("type").notNull(),
  content: text("content").notNull(),
  payload: jsonb("payload"), // 체크포인트 단계(PLAN/TASK/FINAL), 산출물 id 등
  status: approvalStatus("status").notNull().default("PENDING"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  userComment: text("user_comment"),
  createdAt: createdAt(),
});

// org_id가 null이면 조직과 무관한 계정 단위 행동 (첫 계정 생성, API 키 등록 등)
export const auditLogs = pgTable("audit_logs", {
  id: id(),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
  actorType: actorType("actor_type").notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  reasoning: text("reasoning"),
  payload: jsonb("payload"),
  createdAt: createdAt(),
});

// F017 웹 푸시 구독 (기기·브라우저마다 1개)
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: createdAt(),
});

// 앱이 스스로 만들어 쓰는 비밀값 (예: 웹 푸시 VAPID 키). 값은 ENCRYPTION_KEY로 암호화해 저장한다
export const appSecrets = pgTable("app_secrets", {
  name: text("name").primaryKey(),
  encryptedValue: text("encrypted_value").notNull(),
  createdAt: createdAt(),
});

// 추가 LLM 모델과 요금 (OpenAI·Gemini·DeepSeek 등). Claude 모델은 코드 요금표(llm/pricing.ts)에 있다.
// 요금은 자주 바뀌므로 사용자가 설정 화면에서 공식 페이지를 보고 고친다 (2026-10-18 결정). 켜진 모델만 쓸 수 있다
export const llmModels = pgTable("llm_models", {
  id: text("id").primaryKey(), // 제공사 API에 보내는 모델 이름 그대로
  provider: text("provider").notNull(), // "openai" | "gemini" | "deepseek"
  label: text("label").notNull(),
  inputUsd: numeric("input_usd", { precision: 10, scale: 4 }).notNull(), // 100만 토큰당 달러
  outputUsd: numeric("output_usd", { precision: 10, scale: 4 }).notNull(),
  cachedInputUsd: numeric("cached_input_usd", { precision: 10, scale: 4 }),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// F106 스케줄: 반복 미션·예약 지시. 시간은 한국 시간(KST) 기준
export const scheduleKind = pgEnum("schedule_kind", ["MISSION", "DIRECTIVE"]);
export const scheduleRepeat = pgEnum("schedule_repeat", ["ONCE", "DAILY", "WEEKLY", "MONTHLY"]);

export const schedules = pgTable("schedules", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kind: scheduleKind("kind").notNull(),
  title: text("title").notNull(),
  /** MISSION: 미션 내용(주제·목표·성공 기준·형식·예산·자율성…) / DIRECTIVE: { content } */
  spec: jsonb("spec").notNull(),
  /** DIRECTIVE 받는 에이전트, MISSION 담당 리더(없으면 자동) */
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
  repeat: scheduleRepeat("repeat").notNull(),
  time: text("time").notNull(), // "HH:MM" (KST)
  weekdays: jsonb("weekdays").$type<number[]>().notNull().default([]), // WEEKLY: 0=일 … 6=토
  dayOfMonth: integer("day_of_month"), // MONTHLY: 1~28
  runDate: text("run_date"), // ONCE: "YYYY-MM-DD" (KST)
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastMissionId: uuid("last_mission_id"),
  lastResult: text("last_result"), // 마지막 실행 결과 한 줄 (실행·건너뜀 이유)
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt(),
});
