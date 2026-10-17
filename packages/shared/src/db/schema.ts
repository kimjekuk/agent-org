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

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
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
  budgetDaily: integer("budget_daily").notNull().default(20000), // PRD 11장 초기값
  workHours: jsonb("work_hours"),
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
  toolPermissions: jsonb("tool_permissions").$type<Record<string, boolean>>().notNull().default({}),
  budgetLimit: integer("budget_limit"),
  autonomy: autonomy("autonomy"), // null → 조직 기본값
  status: text("status").notNull().default("IDLE"),
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
  autonomy: autonomy("autonomy"),
  leaderId: uuid("leader_id").references(() => agents.id, { onDelete: "set null" }),
  status: missionStatus("status").notNull().default("DRAFT"),
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
  missionId: uuid("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
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
  type: approvalType("type").notNull(),
  content: text("content").notNull(),
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
