// ClawChat — Profile Manager and Broadcasting
import { EventEmitter } from "node:events";
import { AgentAnalyzer } from "./analyzer.ts";
import { formatTagsForDisplay, type AgentTag } from "./tags.ts";
import { logger } from "../utils/logger.ts";
import type { AgentProfile, Availability } from "../protocol/types.ts";

const MODULE = "profile";

export interface ProfileManagerConfig {
  agentId: string;
  displayName: string;
  version: string;
  workspaceDir: string;
  updateIntervalMs: number;
  capabilities: string[];
}

export class ProfileManager extends EventEmitter {
  private profile: AgentProfile;
  private analyzer: AgentAnalyzer;
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private startTime: number;

  constructor(private config: ProfileManagerConfig) {
    super();
    this.analyzer = new AgentAnalyzer(config.workspaceDir);
    this.startTime = Date.now();

    this.profile = {
      agentId: config.agentId,
      displayName: config.displayName,
      version: config.version,
      tags: [],
      totalTokensUsed: 0,
      uptime: "0s",
      peerCount: 0,
      availability: "online",
      capabilities: config.capabilities,
      lastUpdated: Date.now(),
    };
  }

  // ─── Lifecycle ────────────────────────────────────────────────

  async start(): Promise<void> {
    // Initial analysis
    await this.updateProfile();

    // Periodic updates
    this.updateTimer = setInterval(
      () => this.updateProfile(),
      this.config.updateIntervalMs,
    );

    logger.info(MODULE, `Profile manager started for ${this.config.displayName}`);
  }

  stop(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    logger.info(MODULE, "Profile manager stopped");
  }

  // ─── Profile Access ───────────────────────────────────────────

  getProfile(): AgentProfile {
    return { ...this.profile };
  }

  getDisplayString(): string {
    const tags = formatTagsForDisplay(this.profile.tags);
    const tokens = this.formatTokens(this.profile.totalTokensUsed);
    return `${this.profile.displayName} | ${tags} | 已消耗 token: ${tokens}`;
  }

  updateAvailability(status: Availability): void {
    this.profile.availability = status;
    this.profile.lastUpdated = Date.now();
    this.emit("profile-updated", this.getProfile());
  }

  updatePeerCount(count: number): void {
    this.profile.peerCount = count;
    this.profile.lastUpdated = Date.now();
  }

  incrementTokensUsed(tokens: number): void {
    this.profile.totalTokensUsed += tokens;
    this.profile.lastUpdated = Date.now();
  }

  // ─── Profile Update ──────────────────────────────────────────

  private async updateProfile(): Promise<void> {
    try {
      const analysis = await this.analyzer.analyze();

      this.profile.tags = analysis.tags;
      this.profile.uptime = this.formatUptime(Date.now() - this.startTime);
      this.profile.totalTokensUsed = analysis.estimatedTokens;
      this.profile.lastUpdated = Date.now();

      this.emit("profile-updated", this.getProfile());

      logger.debug(
        MODULE,
        `Profile updated: ${formatTagsForDisplay(analysis.tags)} (${analysis.workspaceFiles} files)`,
      );
    } catch (err) {
      logger.error(MODULE, `Profile update failed: ${err}`);
    }
  }

  // ─── Serialization ───────────────────────────────────────────

  serialize(): string {
    return JSON.stringify(this.profile);
  }

  deserialize(json: string): AgentProfile | null {
    try {
      const profile = JSON.parse(json) as AgentProfile;
      return profile;
    } catch {
      return null;
    }
  }

  // ─── Formatting ──────────────────────────────────────────────

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(1)}B`;
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
    return String(tokens);
  }
}
