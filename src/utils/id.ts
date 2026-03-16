// ClawChat — ID Utilities
import { randomBytes, createHash } from "node:crypto";

/**
 * Generate a stable Agent ID from a public key.
 * This ensures the same identity key always produces the same agent ID.
 */
export function agentIdFromPublicKey(publicKeyBytes: Uint8Array): string {
  const hash = createHash("sha256").update(publicKeyBytes).digest("hex");
  return `agent_${hash.slice(0, 32)}`;
}

/**
 * Generate a random invitation code.
 * Format: claw:BASE64URL(bytes)
 */
export function generateInviteCode(): string {
  const bytes = randomBytes(24);
  return `claw:${bytes.toString("base64url")}`;
}

/**
 * Generate a unique message ID using timestamp + random suffix.
 * Ensures uniqueness across peers.
 */
export function generateMessageId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(8).toString("hex");
  return `msg_${timestamp}_${random}`;
}

/**
 * Generate a room/group ID.
 */
export function generateGroupId(): string {
  const hex = randomBytes(16).toString("hex");
  return `group_${hex}`;
}

/**
 * Generate a task ID.
 */
export function generateTaskId(): string {
  const hex = randomBytes(12).toString("hex");
  return `task_${hex}`;
}
