// ClawChat — Governor Type Definitions

export interface TokenBudget {
  dailyLimit?: number;
  monthlyLimit?: number;
  perPeerLimit?: number;
  perSessionLimit?: number;
}

export interface TokenUsage {
  daily: number;
  monthly: number;
  perPeer: Record<string, number>;
  perSession: Record<string, number>;
  total: number;
  lastReset: number;
}

export interface BudgetAlert {
  type: "warning" | "critical" | "exceeded";
  budget: string;
  current: number;
  limit: number;
  percentage: number;
  timestamp: number;
}

export interface TimeWindowConfig {
  enabled: boolean;
  weekdays?: string;       // "1-5" for Mon-Fri
  hours?: string;          // "9-18" for 9am-6pm
  timezone?: string;       // "Asia/Shanghai"
  duration?: number;       // Duration in minutes
  autoClose: boolean;
}

export interface TimeWindowState {
  isOpen: boolean;
  openedAt: number | null;
  closesAt: number | null;
  reason: string;
}

export interface GovernorState {
  budget: TokenBudget;
  usage: TokenUsage;
  timeWindow: TimeWindowConfig;
  timeWindowState: TimeWindowState;
  suspended: boolean;
  suspensionReason: string | null;
}
