// ClawChat — Plugin Configuration
import { z } from "zod";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

// ─── Configuration Schema ────────────────────────────────────────

export const BudgetSchema = z.object({
  dailyLimit: z.number().positive().optional(),
  monthlyLimit: z.number().positive().optional(),
  perPeerLimit: z.number().positive().optional(),
  perSessionLimit: z.number().positive().optional(),
}).optional();

export const ScheduleSchema = z.object({
  enabled: z.boolean().default(false),
  weekdays: z.string().default("1-5"),
  hours: z.string().default("9-18"),
  timezone: z.string().default("Asia/Shanghai"),
  duration: z.number().positive().optional(),
}).optional();

export const ClawChatConfigSchema = z.object({
  signalingServer: z.string().optional(),
  turnServer: z.string().optional(),
  displayName: z.string().optional(),
  autoConnect: z.boolean().default(true),
  budget: BudgetSchema,
  schedule: ScheduleSchema,
});

export type ClawChatConfig = z.infer<typeof ClawChatConfigSchema>;
export type BudgetConfig = z.infer<typeof BudgetSchema>;
export type ScheduleConfig = z.infer<typeof ScheduleSchema>;

// ─── Default Config ──────────────────────────────────────────────

export const DEFAULT_CONFIG: ClawChatConfig = {
  autoConnect: true,
};

// ─── Data Directory ──────────────────────────────────────────────

export const CLAWCHAT_DIR = join(homedir(), ".clawchat");

export function ensureDataDir(): string {
  if (!existsSync(CLAWCHAT_DIR)) {
    mkdirSync(CLAWCHAT_DIR, { recursive: true });
  }

  const subdirs = ["keys", "knowledge", "sessions", "logs"];
  for (const subdir of subdirs) {
    const path = join(CLAWCHAT_DIR, subdir);
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
  }

  return CLAWCHAT_DIR;
}

export function resolveKeyStorePath(): string {
  return join(CLAWCHAT_DIR, "keys", "signal-keys.db");
}

export function resolveKnowledgeStorePath(): string {
  return join(CLAWCHAT_DIR, "knowledge", "clawchat-lance");
}

export function resolveSessionStorePath(): string {
  return join(CLAWCHAT_DIR, "sessions", "sessions.json");
}

// ─── Config Loader ───────────────────────────────────────────────

export function loadConfig(rawConfig: unknown): ClawChatConfig {
  try {
    return ClawChatConfigSchema.parse(rawConfig ?? {});
  } catch (err) {
    console.warn("[clawchat] Config validation failed, using defaults:", err);
    return DEFAULT_CONFIG;
  }
}
