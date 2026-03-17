// ClawChat — Governor (Main Orchestrator for User Controls)
import { EventEmitter } from "node:events";
import { TokenBudgetTracker } from "./token-budget.ts";
import { TimeWindowController } from "./time-window.ts";
import { logger } from "../utils/logger.ts";
import type { GovernorState, TokenBudget, TimeWindowConfig, BudgetAlert } from "./types.ts";

const MODULE = "governor";

export interface GovernorConfig {
  budget: TokenBudget;
  timeWindow: TimeWindowConfig;
}

export class Governor extends EventEmitter {
  private budgetTracker: TokenBudgetTracker;
  private timeController: TimeWindowController;
  private suspended = false;
  private suspensionReason: string | null = null;

  constructor(config: GovernorConfig) {
    super();
    this.budgetTracker = new TokenBudgetTracker(config.budget);
    this.timeController = new TimeWindowController(config.timeWindow);

    this.setupForwarding();
  }

  // ─── Lifecycle ────────────────────────────────────────────────

  start(): void {
    this.timeController.start();
    logger.info(MODULE, "Governor started");
  }

  stop(): void {
    this.timeController.stop();
    logger.info(MODULE, "Governor stopped");
  }

  // ─── Permission Checks ───────────────────────────────────────

  /**
   * Check if a message/operation is allowed.
   * Returns { allowed: boolean, reason?: string }
   */
  canProceed(tokens: number, peerId?: string, sessionId?: string): {
    allowed: boolean;
    reason?: string;
  } {
    // Check suspension
    if (this.suspended) {
      return { allowed: false, reason: `Suspended: ${this.suspensionReason}` };
    }

    // Check time window
    if (!this.timeController.isOpen()) {
      const remaining = this.timeController.getRemainingMs();
      return {
        allowed: false,
        reason: `Time window closed. ${remaining ? `Opens in ${Math.round(remaining / 60000)}m` : "Check schedule"}`,
      };
    }

    // Check token budget
    if (!this.budgetTracker.canSpend(tokens, peerId, sessionId)) {
      return { allowed: false, reason: "Token budget exceeded" };
    }

    return { allowed: true };
  }

  recordUsage(tokens: number, peerId?: string, sessionId?: string): boolean {
    return this.budgetTracker.recordTokens(tokens, peerId, sessionId);
  }

  // ─── Suspension ──────────────────────────────────────────────

  suspend(reason: string): void {
    this.suspended = true;
    this.suspensionReason = reason;
    this.emit("suspended", reason);
    logger.warn(MODULE, `Governor suspended: ${reason}`);
  }

  resume(): void {
    this.suspended = false;
    this.suspensionReason = null;
    this.emit("resumed");
    logger.info(MODULE, "Governor resumed");
  }

  // ─── State ───────────────────────────────────────────────────

  getState(): GovernorState {
    return {
      budget: this.budgetTracker.getBudget(),
      usage: this.budgetTracker.getUsage(),
      timeWindow: this.timeController.getConfig(),
      timeWindowState: this.timeController.getState(),
      suspended: this.suspended,
      suspensionReason: this.suspensionReason,
    };
  }

  isOperational(): boolean {
    return !this.suspended && this.timeController.isOpen();
  }

  // ─── Configuration Updates ───────────────────────────────────

  updateBudget(budget: Partial<TokenBudget>): void {
    this.budgetTracker.updateBudget(budget);
  }

  updateTimeWindow(config: Partial<TimeWindowConfig>): void {
    this.timeController.updateConfig(config);
  }

  // ─── Event Forwarding ────────────────────────────────────────

  private setupForwarding(): void {
    this.budgetTracker.on("alert", (alert: BudgetAlert) => {
      this.emit("budget-alert", alert);

      // Auto-suspend on exceeded
      if (alert.type === "exceeded") {
        this.suspend(`Daily token budget exceeded (${alert.current}/${alert.limit})`);
      }
    });

    this.timeController.on("window-opened", () => {
      this.emit("window-opened");
      if (this.suspended && this.suspensionReason?.includes("Time window")) {
        this.resume();
      }
    });

    this.timeController.on("window-closed", (state) => {
      this.emit("window-closed", state);
    });
  }
}

export { TokenBudgetTracker, TimeWindowController };
export type { GovernorConfig, GovernorState, TokenBudget, TimeWindowConfig, BudgetAlert } from "./types.ts";
