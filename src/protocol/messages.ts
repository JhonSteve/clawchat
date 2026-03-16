// ClawChat — Message Format and Encoding
import { generateMessageId } from "../utils/id.ts";
import type {
  ClawEnvelope,
  MessageType,
  ChatPayload,
  TaskDelegation,
  TaskResult,
  QueryPayload,
  QueryResultPayload,
  KnowledgeEntry,
  ControlPayload,
  GroupInvitePayload,
} from "./types.ts";

// ─── Message Factory ────────────────────────────────────────────

export function createEnvelope(params: {
  from: string;
  to: string | string[];
  type: MessageType;
  payload: unknown;
  replyTo?: string;
  seq?: number;
}): ClawEnvelope {
  return {
    version: 1,
    id: generateMessageId(),
    from: params.from,
    to: params.to,
    timestamp: Date.now(),
    type: params.type,
    payload: params.payload,
    replyTo: params.replyTo,
    seq: params.seq,
  };
}

// ─── Message Constructors ───────────────────────────────────────

export function createChatMessage(
  from: string,
  to: string | string[],
  content: string,
  format: "text" | "markdown" | "code" = "markdown",
  replyTo?: string,
): ClawEnvelope {
  return createEnvelope({
    from,
    to,
    type: "chat",
    payload: { content, format } satisfies ChatPayload,
    replyTo,
  });
}

export function createTaskMessage(
  from: string,
  to: string,
  task: Omit<TaskDelegation, "taskId">,
): ClawEnvelope {
  return createEnvelope({
    from,
    to,
    type: "task",
    payload: {
      taskId: generateMessageId().replace("msg_", "task_"),
      ...task,
    } satisfies TaskDelegation,
  });
}

export function createTaskResultMessage(
  from: string,
  to: string,
  result: Omit<TaskResult, "taskId"> & { taskId: string },
): ClawEnvelope {
  return createEnvelope({
    from,
    to,
    type: "task-result",
    payload: result satisfies TaskResult,
  });
}

export function createQueryMessage(
  from: string,
  to: string,
  query: Omit<QueryPayload, "queryId">,
): ClawEnvelope {
  return createEnvelope({
    from,
    to,
    type: "query",
    payload: {
      queryId: generateMessageId().replace("msg_", "query_"),
      ...query,
    } satisfies QueryPayload,
  });
}

export function createQueryResultMessage(
  from: string,
  to: string,
  result: Omit<QueryResultPayload, "queryId"> & { queryId: string },
): ClawEnvelope {
  return createEnvelope({
    from,
    to,
    type: "query-result",
    payload: result satisfies QueryResultPayload,
  });
}

export function createControlMessage(
  from: string,
  to: string,
  action: ControlPayload["action"],
  data?: unknown,
): ClawEnvelope {
  return createEnvelope({
    from,
    to,
    type: "control",
    payload: { action, data } satisfies ControlPayload,
  });
}

export function createKnowledgeMessage(
  from: string,
  to: string | string[],
  entry: KnowledgeEntry,
): ClawEnvelope {
  return createEnvelope({
    from,
    to,
    type: "knowledge",
    payload: entry satisfies KnowledgeEntry,
  });
}

export function createGroupInviteMessage(
  from: string,
  to: string,
  invite: GroupInvitePayload,
): ClawEnvelope {
  return createEnvelope({
    from,
    to,
    type: "group-invite",
    payload: invite satisfies GroupInvitePayload,
  });
}

export function createErrorMessage(
  from: string,
  to: string,
  errorCode: string,
  errorMessage: string,
  replyTo?: string,
): ClawEnvelope {
  return createEnvelope({
    from,
    to,
    type: "error",
    payload: { code: errorCode, message: errorMessage },
    replyTo,
  });
}

// ─── Serialization ──────────────────────────────────────────────

export function serializeMessage(envelope: ClawEnvelope): Uint8Array {
  const json = JSON.stringify(envelope);
  return new TextEncoder().encode(json);
}

export function deserializeMessage(data: Uint8Array): ClawEnvelope | null {
  try {
    const json = new TextDecoder().decode(data);
    return JSON.parse(json) as ClawEnvelope;
  } catch {
    return null;
  }
}

// ─── Validation ─────────────────────────────────────────────────

export function validateEnvelope(envelope: unknown): envelope is ClawEnvelope {
  if (typeof envelope !== "object" || envelope === null) return false;
  const e = envelope as Record<string, unknown>;
  return (
    e.version === 1 &&
    typeof e.id === "string" &&
    typeof e.from === "string" &&
    typeof e.timestamp === "number" &&
    typeof e.type === "string" &&
    e.payload !== undefined
  );
}
