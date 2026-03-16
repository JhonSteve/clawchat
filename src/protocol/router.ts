// ClawChat — Message Router
import { EventEmitter } from "node:events";
import { validateEnvelope, deserializeMessage } from "./messages.ts";
import { logger } from "../utils/logger.ts";
import type { ClawEnvelope, MessageType } from "./types.ts";

const MODULE = "router";

export interface MessageRoute {
  from: string;
  to: string | string[];
  receivedAt: number;
  envelope: ClawEnvelope;
}

export class MessageRouter extends EventEmitter {
  private messageHistory = new Map<string, MessageRoute>();
  private sequenceNumbers = new Map<string, number>();
  private maxHistorySize = 10_000;

  // ─── Route Incoming Messages ─────────────────────────────────

  routeMessage(peerId: string, rawData: Uint8Array): ClawEnvelope | null {
    const envelope = deserializeMessage(rawData);
    if (!envelope) {
      logger.warn(MODULE, `Failed to deserialize message from ${peerId.slice(0, 8)}...`);
      return null;
    }

    if (!validateEnvelope(envelope)) {
      logger.warn(MODULE, `Invalid message envelope from ${peerId.slice(0, 8)}...`);
      return null;
    }

    // Deduplication — check if we've seen this message
    if (this.messageHistory.has(envelope.id)) {
      logger.debug(MODULE, `Duplicate message ${envelope.id} from ${peerId.slice(0, 8)}...`);
      return null;
    }

    // Store in history
    const route: MessageRoute = {
      from: envelope.from,
      to: envelope.to,
      receivedAt: Date.now(),
      envelope,
    };
    this.messageHistory.set(envelope.id, route);

    // Cleanup old messages
    if (this.messageHistory.size > this.maxHistorySize) {
      const oldest = [...this.messageHistory.keys()].slice(0, 100);
      for (const key of oldest) {
        this.messageHistory.delete(key);
      }
    }

    // Emit typed event
    this.emit(`message:${envelope.type}`, envelope);
    this.emit("message", envelope);

    logger.debug(
      MODULE,
      `Routed ${envelope.type} message ${envelope.id.slice(0, 16)}... from ${peerId.slice(0, 8)}...`,
    );

    return envelope;
  }

  // ─── Group Routing ────────────────────────────────────────────

  routeToGroup(groupId: string, members: string[], envelope: ClawEnvelope): string[] {
    const nextSeq = (this.sequenceNumbers.get(groupId) ?? 0) + 1;
    this.sequenceNumbers.set(groupId, nextSeq);

    // Assign sequence number
    envelope.seq = nextSeq;

    // Return list of peers to send to (excluding sender)
    return members.filter((id) => id !== envelope.from);
  }

  // ─── Message Lookup ──────────────────────────────────────────

  getMessage(id: string): MessageRoute | undefined {
    return this.messageHistory.get(id);
  }

  getMessagesByType(type: MessageType): MessageRoute[] {
    return [...this.messageHistory.values()].filter((r) => r.envelope.type === type);
  }

  getMessagesForPeer(peerId: string): MessageRoute[] {
    return [...this.messageHistory.values()].filter(
      (r) => r.envelope.from === peerId || r.envelope.to === peerId,
    );
  }

  // ─── Acknowledgment ──────────────────────────────────────────

  createAck(envelope: ClawEnvelope, myId: string): ClawEnvelope {
    return {
      version: 1,
      id: `ack_${envelope.id}`,
      from: myId,
      to: envelope.from,
      timestamp: Date.now(),
      type: "control",
      payload: { action: "ack", data: { messageId: envelope.id } },
      replyTo: envelope.id,
    };
  }

  // ─── Stats ────────────────────────────────────────────────────

  getStats() {
    const byType: Record<string, number> = {};
    for (const route of this.messageHistory.values()) {
      byType[route.envelope.type] = (byType[route.envelope.type] ?? 0) + 1;
    }

    return {
      totalMessages: this.messageHistory.size,
      byType,
      trackedGroups: this.sequenceNumbers.size,
    };
  }
}
