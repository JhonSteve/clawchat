// ClawChat — Task Delegation Protocol
import { generateTaskId } from "../utils/id.ts";
import { logger } from "../utils/logger.ts";
import type { TaskDelegation, TaskResult, TaskStatus, TaskPriority } from "./types.ts";

const MODULE = "delegation";

export interface DelegatedTask extends TaskDelegation {
  status: DelegationStatus;
  assignedTo: string;
  assignedBy: string;
  assignedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  result: TaskResult | null;
}

export type DelegationStatus =
  | "pending"
  | "accepted"
  | "in-progress"
  | "completed"
  | "failed"
  | "cancelled";

export class DelegationManager {
  private tasks = new Map<string, DelegatedTask>();

  // ─── Task Creation ───────────────────────────────────────────

  delegate(params: {
    title: string;
    description: string;
    context: string;
    assignedTo: string;
    assignedBy: string;
    constraints?: TaskDelegation["constraints"];
    priority?: TaskPriority;
  }): DelegatedTask {
    const taskId = generateTaskId();
    const now = Date.now();

    const task: DelegatedTask = {
      taskId,
      title: params.title,
      description: params.description,
      context: params.context,
      constraints: params.constraints ?? {},
      priority: params.priority ?? "medium",
      status: "pending",
      assignedTo: params.assignedTo,
      assignedBy: params.assignedBy,
      assignedAt: now,
      startedAt: null,
      completedAt: null,
      result: null,
    };

    this.tasks.set(taskId, task);
    logger.info(MODULE, `Task '${params.title}' delegated to ${params.assignedTo.slice(0, 8)}...`);

    return task;
  }

  // ─── Task Status Transitions ─────────────────────────────────

  acceptTask(taskId: string, acceptorId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.assignedTo !== acceptorId) return false;
    if (task.status !== "pending") return false;

    task.status = "accepted";
    return true;
  }

  startTask(taskId: string, workerId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.assignedTo !== workerId) return false;
    if (task.status !== "pending" && task.status !== "accepted") return false;

    task.status = "in-progress";
    task.startedAt = Date.now();
    return true;
  }

  completeTask(taskId: string, workerId: string, result: TaskResult): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.assignedTo !== workerId) return false;
    if (task.status !== "in-progress") return false;

    task.status = result.status === "completed" ? "completed" : "failed";
    task.completedAt = Date.now();
    task.result = result;

    logger.info(
      MODULE,
      `Task '${task.title}' ${task.status} by ${workerId.slice(0, 8)}... (${result.tokensUsed} tokens)`,
    );

    return true;
  }

  cancelTask(taskId: string, cancellerId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.assignedBy !== cancellerId) return false;
    if (task.status === "completed" || task.status === "failed") return false;

    task.status = "cancelled";
    task.completedAt = Date.now();
    return true;
  }

  // ─── Query ───────────────────────────────────────────────────

  getTask(taskId: string): DelegatedTask | undefined {
    return this.tasks.get(taskId);
  }

  getTasksByStatus(status: DelegationStatus): DelegatedTask[] {
    return [...this.tasks.values()].filter((t) => t.status === status);
  }

  getTasksForPeer(peerId: string): DelegatedTask[] {
    return [...this.tasks.values()].filter(
      (t) => t.assignedTo === peerId || t.assignedBy === peerId,
    );
  }

  // ─── Stats ────────────────────────────────────────────────────

  getStats() {
    const byStatus: Record<string, number> = {};
    let totalTokens = 0;

    for (const task of this.tasks.values()) {
      byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
      totalTokens += task.result?.tokensUsed ?? 0;
    }

    return {
      totalTasks: this.tasks.size,
      byStatus,
      totalTokensUsed: totalTokens,
    };
  }
}
