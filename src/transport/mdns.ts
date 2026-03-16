// ClawChat — mDNS/Bonjour Discovery (LAN)
import { EventEmitter } from "node:events";
import { logger } from "../utils/logger.ts";
import type { DiscoveredPeer } from "./types.ts";

const MODULE = "mdns";
const SERVICE_TYPE = "_clawchat._tcp";
const SERVICE_NAME_PREFIX = "clawchat-";

export class MdnsDiscovery extends EventEmitter {
  private publishedService: unknown = null;
  private browser: unknown = null;
  private discoveredPeers = new Map<string, DiscoveredPeer>();
  private isRunning = false;

  constructor(private localPort: number = 3479) {
    super();
  }

  // ─── Service Discovery ───────────────────────────────────────

  async startDiscovery(): Promise<void> {
    if (this.isRunning) return;

    try {
      // Dynamic import to handle optional dependency
      const ciao = await import("@homebridge/ciao");
      const responder = ciao.getResponder();

      this.browser = responder.createBrowser(ciao.ServiceType.from(SERVICE_TYPE));

      const browser = this.browser as {
        on: (event: string, handler: (service: unknown) => void) => void;
      };

      browser.on("serviceUp", (service: unknown) => {
        this.handleServiceUp(service as ServiceInfo);
      });

      browser.on("serviceDown", (service: unknown) => {
        this.handleServiceDown(service as ServiceInfo);
      });

      this.isRunning = true;
      logger.info(MODULE, `mDNS discovery started for ${SERVICE_TYPE}`);
    } catch (err) {
      logger.warn(MODULE, `mDNS discovery unavailable: ${err}. LAN discovery disabled.`);
    }
  }

  async stopDiscovery(): Promise<void> {
    this.isRunning = false;
    this.discoveredPeers.clear();
    
    if (this.browser) {
      try {
        const browser = this.browser as { shutdown?: () => Promise<void> };
        await browser.shutdown?.();
      } catch {
        // Ignore shutdown errors
      }
      this.browser = null;
    }

    logger.info(MODULE, "mDNS discovery stopped");
  }

  // ─── Service Publishing ──────────────────────────────────────

  async publishService(config: {
    agentId: string;
    displayName: string;
    tags: string[];
    publicKeyFingerprint: string;
  }): Promise<void> {
    try {
      const ciao = await import("@homebridge/ciao");
      const responder = ciao.getResponder();

      const name = `${SERVICE_NAME_PREFIX}${config.agentId.slice(0, 8)}`;

      this.publishedService = responder.createService({
        name,
        type: SERVICE_TYPE,
        port: this.localPort,
        txt: {
          id: config.agentId,
          name: config.displayName,
          tags: config.tags.join(","),
          key: config.publicKeyFingerprint,
          ver: "0.1.0",
        },
      });

      const service = this.publishedService as { advertise: () => Promise<void> };
      await service.advertise();

      logger.info(MODULE, `Published mDNS service: ${name} on port ${this.localPort}`);
    } catch (err) {
      logger.warn(MODULE, `mDNS publish unavailable: ${err}`);
    }
  }

  async unpublishService(): Promise<void> {
    if (this.publishedService) {
      try {
        const service = this.publishedService as { destroy?: () => Promise<void> };
        await service.destroy?.();
      } catch {
        // Ignore
      }
      this.publishedService = null;
      logger.info(MODULE, "mDNS service unpublished");
    }
  }

  // ─── Peer Management ─────────────────────────────────────────

  getDiscoveredPeers(): DiscoveredPeer[] {
    return [...this.discoveredPeers.values()];
  }

  getPeer(agentId: string): DiscoveredPeer | undefined {
    return this.discoveredPeers.get(agentId);
  }

  // ─── Service Handlers ────────────────────────────────────────

  private handleServiceUp(service: ServiceInfo): void {
    const txt = service.txt ?? {};
    const agentId = txt.id as string;
    
    if (!agentId) return;

    const peer: DiscoveredPeer = {
      agentId,
      host: service.addresses?.[0] ?? service.host ?? "localhost",
      port: service.port ?? 3479,
      displayName: (txt.name as string) ?? "Unknown Agent",
      tags: ((txt.tags as string) ?? "").split(",").filter(Boolean),
      publicKeyFingerprint: (txt.key as string) ?? "",
      timestamp: Date.now(),
    };

    // Skip own service
    if (peer.agentId.startsWith(SERVICE_NAME_PREFIX)) return;

    this.discoveredPeers.set(agentId, peer);
    this.emit("peer-discovered", peer);

    logger.info(MODULE, `Discovered peer: ${peer.displayName} (${agentId.slice(0, 8)}...)`);
  }

  private handleServiceDown(service: ServiceInfo): void {
    const txt = service.txt ?? {};
    const agentId = txt.id as string;
    
    if (!agentId) return;

    const peer = this.discoveredPeers.get(agentId);
    this.discoveredPeers.delete(agentId);
    
    if (peer) {
      this.emit("peer-lost", peer);
      logger.info(MODULE, `Peer lost: ${peer.displayName} (${agentId.slice(0, 8)}...)`);
    }
  }
}

// ─── Type declarations for @homebridge/ciao ──────────────────────

interface ServiceInfo {
  name?: string;
  type?: string;
  host?: string;
  addresses?: string[];
  port?: number;
  txt?: Record<string, unknown>;
}
