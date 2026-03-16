// ClawChat — Time Window Controller
import { EventEmitter } from "node:events";
import { logger } from "../utils/logger.ts";
import type { TimeWindowConfig, TimeWindowState } from "./types.ts";

const MODULE = "time-window";

export class TimeWindowController extends EventEmitter {
  private config: TimeWindowConfig;
  private state: TimeWindowState;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private durationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: TimeWindowConfig) {
    super();
    this.config = config;
    this.state = {
      isOpen: !config.enabled, // Open by default if not enabled
      openedAt: null,
      closesAt: null,
      reason: config.enabled ? "Schedule not active" : "No time restriction",
    };
  }

  // ─── Lifecycle ────────────────────────────────────────────────

  start(): void {
    if (!this.config.enabled) {
      this.state.isOpen = true;
      this.state.reason = "No time restriction";
      return;
    }

    // Check schedule every minute
    this.checkSchedule();
    this.checkTimer = setInterval(() => this.checkSchedule(), 60_000);

    logger.info(MODULE, "Time window controller started");
  }

  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }
    logger.info(MODULE, "Time window controller stopped");
  }

  // ─── Manual Override ──────────────────────────────────────────

  openWindow(durationMinutes?: number): void {
    const duration = durationMinutes ?? this.config.duration;
    const now = Date.now();

    this.state.isOpen = true;
    this.state.openedAt = now;
    this.state.closesAt = duration ? now + duration * 60 * 1000 : null;
    this.state.reason = duration ? `Manually opened for ${duration}m` : "Manually opened";

    if (duration) {
      if (this.durationTimer) clearTimeout(this.durationTimer);
      this.durationTimer = setTimeout(() => {
        this.closeWindow("Duration expired");
      }, duration * 60 * 1000);
    }

    this.emit("window-opened", this.state);
    logger.info(MODULE, `Window opened${duration ? ` for ${duration} minutes` : ""}`);
  }

  closeWindow(reason: string = "Manual close"): void {
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }

    this.state.isOpen = false;
    this.state.openedAt = null;
    this.state.closesAt = null;
    this.state.reason = reason;

    this.emit("window-closed", this.state);
    logger.info(MODULE, `Window closed: ${reason}`);
  }

  // ─── Schedule Checking ───────────────────────────────────────

  private checkSchedule(): void {
    if (!this.config.enabled) return;

    const now = new Date();
    const weekday = now.getDay() || 7; // 1=Mon, 7=Sun
    const hours = now.getHours();

    const inWeekdayRange = this.isInRange(weekday, this.config.weekdays ?? "1-5");
    const inHourRange = this.isInRange(hours, this.config.hours ?? "9-18");

    const shouldBeOpen = inWeekdayRange && inHourRange;

    if (shouldBeOpen && !this.state.isOpen) {
      this.state.isOpen = true;
      this.state.openedAt = Date.now();
      this.state.reason = `Schedule active (${this.config.weekdays ?? "1-5"}, ${this.config.hours ?? "9-18"})`;
      this.emit("window-opened", this.state);
      logger.info(MODULE, "Window opened by schedule");
    } else if (!shouldBeOpen && this.state.isOpen && this.state.openedAt) {
      // Only close if it was schedule-opened (not manually)
      if (!this.state.closesAt) {
        this.state.isOpen = false;
        this.state.reason = "Outside schedule";
        this.emit("window-closed", this.state);
        logger.info(MODULE, "Window closed by schedule");
      }
    }
  }

  private isInRange(value: number, range: string): boolean {
    // Parse range like "1-5" or "9-18"
    const parts = range.split("-").map(Number);
    if (parts.length === 2) {
      const [start, end] = parts;
      if (start !== undefined && end !== undefined) {
        return value >= start && value <= end;
      }
    }
    // Single value or comma-separated
    const values = range.split(",").map(Number);
    return values.includes(value);
  }

  // ─── State Query ─────────────────────────────────────────────

  getState(): TimeWindowState {
    return { ...this.state };
  }

  isOpen(): boolean {
    return this.state.isOpen;
  }

  getRemainingMs(): number | null {
    if (!this.state.closesAt) return null;
    return Math.max(0, this.state.closesAt - Date.now());
  }

  // ─── Config Update ───────────────────────────────────────────

  updateConfig(config: Partial<TimeWindowConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Restart if enabled state changed
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    
    if (this.config.enabled) {
      this.checkSchedule();
      this.checkTimer = setInterval(() => this.checkSchedule(), 60_000);
    } else {
      this.state.isOpen = true;
      this.state.reason = "No time restriction";
    }

    logger.info(MODULE, "Time window configuration updated");
  }
}
