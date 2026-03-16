// ClawChat — Group Management
import { generateGroupId } from "../utils/id.ts";
import { logger } from "../utils/logger.ts";
import type { GroupInfo } from "./types.ts";

const MODULE = "group";

export class GroupManager {
  private groups = new Map<string, GroupInfo>();

  // ─── Group Operations ────────────────────────────────────────

  createGroup(name: string, creatorId: string): GroupInfo {
    const groupId = generateGroupId();
    const group: GroupInfo = {
      id: groupId,
      name,
      creator: creatorId,
      members: [creatorId],
      createdAt: Date.now(),
    };

    this.groups.set(groupId, group);
    logger.info(MODULE, `Group '${name}' created by ${creatorId.slice(0, 8)}...`);

    return group;
  }

  getGroup(groupId: string): GroupInfo | undefined {
    return this.groups.get(groupId);
  }

  getAllGroups(): GroupInfo[] {
    return [...this.groups.values()];
  }

  // ─── Member Management ───────────────────────────────────────

  addMember(groupId: string, peerId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    if (group.members.includes(peerId)) return false;

    group.members.push(peerId);
    logger.info(MODULE, `Peer ${peerId.slice(0, 8)}... joined group '${group.name}'`);

    return true;
  }

  removeMember(groupId: string, peerId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    const idx = group.members.indexOf(peerId);
    if (idx === -1) return false;

    group.members.splice(idx, 1);

    // If group is empty, delete it
    if (group.members.length === 0) {
      this.groups.delete(groupId);
      logger.info(MODULE, `Group '${group.name}' deleted (no members)`);
    } else {
      logger.info(MODULE, `Peer ${peerId.slice(0, 8)}... left group '${group.name}'`);
    }

    return true;
  }

  isMember(groupId: string, peerId: string): boolean {
    const group = this.groups.get(groupId);
    return group?.members.includes(peerId) ?? false;
  }

  getMembers(groupId: string): string[] {
    return this.groups.get(groupId)?.members ?? [];
  }

  // ─── Dissolve ────────────────────────────────────────────────

  dissolveGroup(groupId: string, requesterId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    // Only creator can dissolve
    if (group.creator !== requesterId) return false;

    this.groups.delete(groupId);
    logger.info(MODULE, `Group '${group.name}' dissolved by creator`);

    return true;
  }
}
