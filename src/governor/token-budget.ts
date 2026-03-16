// ClawChat — Token Budget Tracker
import { EventEmitter } from "node:events";
import { logger } from "../utils/logger.ts";
import type { TokenBudget, TokenUsage, BudgetAlert } from "./types.ts";

const MODULE = "token-budget";

const WARNING_THRESHOLDS = [0.8, 0.9, 0.95]; // 80%, 90%, 95%

export class TokenBudgetTracker extends EventEmitter {
  private budget: TokenBudget;
  private usage: TokenUsage;
  private alertedThresholds = new Set<string>();

  constructor(budget: TokenBudget) {
    super();
    this.budget = budget;
    this.usage = this.createEmptyUsage();

    // Daily reset at midnight
    this.scheduleReset();
  }

  // ─── Token Recording ─────────────────────────────────────────

  recordTokens(tokens: number, peerId?: string, sessionId?: string): boolean {
    // Check limits before recording
    if (!this.canSpend(tokens, peerId, sessionId)) {
      return false;
    }

    this.usage.daily += tokens;
    this.usage.monthly += tokens;
    this.usage.total += tokens;

    if (peerId) {
      this.usage.perPeer[peerId] = (this.usage.perPeer[peerId] ?? 0) + tokens;
    }

    if (sessionId) {
      this.usage.perSession[sessionId] = (this.usage.perSession[sessionId] ?? 0) + tokens;
    }

    // Check thresholds and emit alerts
    this.checkThresholds(peerId);

    return true;
  }

  // ─── Budget Checks ───────────────────────────────────────────

  canSpend(tokens: number, peerId?: string, sessionId?: string): boolean {
    // Check daily limit
    if (this.budget.dailyLimit && this.usage.daily + tokens > this.budget.dailyLimit) {
      return false;
    }

    // Check monthly limit
    if (this.budget.monthlyLimit && this.usage.monthly + tokens > this.budget.monthlyLimit) {
      return false;
    }

    // Check per-peer limit
    if (peerId && this.budget.perPeerLimit) {
      const peerUsage = this.usage.perPeer[peerId] ?? 0;
      if (peerUsage + tokens > this.budget.perPeerLimit) {
        return false;
      }
    }

    // Check per-session limit
    if (sessionId && this.budget.perSessionLimit) {
      const sessionUsage = this.usage.perSession[sessionId] ?? 0;
      if (sessionUsage + tokens > this.budget.perSessionLimit) {
        return false;
      }
    }

    return true;
  }

  getRemainingBudget(peerId?: string): {
    daily: number | null;
    monthly: number | null;
    perPeer: number | null;
  } {
    return {
      daily: this.budget.dailyLimit ? this.budget.dailyLimit - this.usage.daily : null,
      monthly: this.budget.monthlyLimit ? this.budget.monthlyLimit - this.usage.monthly : null,
      perPeer:
        peerId && this.budget.perPeerLimit
          ? this.budget.perPeerLimit - (this.usage.perPeer[peerId] ?? 0)
          : null,
    };
  }

  // ─── Threshold Alerts ────────────────────────────────────────

  private checkThresholds(peerId?: string): void {
    if (!this.budget.dailyLimit) return;

    const percentage = this.usage.daily / this.budget.dailyLimit;

    for (const threshold of WARNING_THRESHOLDS) {
      const key = `daily:${threshold}`;
      if (percentage >= threshold && !this.alertedThresholds.has(key)) {
        this.alertedThresholds.add(key);

        const type = threshold >= 0.95 ? "critical" : "warning";
        const alert: BudgetAlert = {
          type,
          budget: "daily",
          current: this.usage.daily,
          limit: this.budget.dailyLimit,
          percentage: Math.round(percentage * 100),
          timestamp: Date.now(),
        };

        this.emit("alert", alert);
        logger.warn(
          MODULE,
          `Daily budget ${alert.percentage}% used (${this.usage.daily}/${this.budget.dailyLimit})`,
        );
      }
    }
  }

  // ─── Reset ───────────────────────────────────────────────────

  resetDaily(): void {
    this.usage.daily = 0;
    this.usage.perPeer = {};
    this.usage.perSession = {};
    this.alertedThresholds.clear();
    this.usage.lastReset = Date.now();
    logger.info(MODULE, "Daily token usage reset");
  }

  resetMonthly(): void {
    this.usage.monthly = 0;
    logger.info(MODULE, "Monthly token usage reset");
  }

  // ─── Configuration ───────────────────────────────────────────

  updateBudget(budget: Partial<TokenBudget>): void {
    this.budget = { ...this.budget, ...budget };
    logger.info(MODULE, "Budget configuration updated");
  }

  getBudget(): TokenBudget {
    return { ...this.budget };
  }

  getUsage(): TokenUsage {
    return { ...this.usage };
  }

  // ─── Scheduling ──────────────────────────────────────────────

  private scheduleReset(): void {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    setTimeout(() => {
      this.resetDaily();
      // Re-schedule for next day
      setInterval(() => this.resetDaily(), 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private createEmptyUsage(): TokenUsage {
    return {
      daily: 0,
      monthly: 0,
      perPeer: {},
      perSession: {},
      total: 0,
      lastReset: Date.now(),
    };
  }
}
