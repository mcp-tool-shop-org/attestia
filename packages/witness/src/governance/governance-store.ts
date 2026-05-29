/**
 * Event-Sourced Governance Store
 *
 * Manages the governance policy state through event sourcing.
 * All mutations (add/remove signer, change quorum) emit events,
 * and the current state can be rebuilt by replaying events.
 *
 * Design:
 * - Event-sourced: state is derived from event history
 * - Deterministic replay: same events → same state
 * - Fail-closed: invalid operations throw
 * - Immutable policy snapshots
 */

import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { deriveAddress } from "xrpl";
import type {
  SignerEntry,
  GovernancePolicy,
  GovernanceChangeEvent,
  QuorumResult,
} from "./types.js";

// =============================================================================
// Governance Store
// =============================================================================

export class GovernanceStore {
  private signers: Map<string, SignerEntry> = new Map();
  private quorum = 1;
  private version = 0;
  private lastUpdated = new Date().toISOString();
  private readonly events: GovernanceChangeEvent[] = [];
  private activeSlaPolicy: {
    id: string;
    name: string;
    version: number;
    targetCount: number;
  } | null = null;

  /**
   * Add a new signer to the governance policy.
   *
   * @param address Signer's XRPL address
   * @param label Human-readable label
   * @param weight Voting weight (default: 1)
   * @param publicKey Optional signer XRPL public key (hex). When provided,
   *   signatures from this signer are cryptographically verified over the
   *   canonical payload hash before counting toward quorum. The public key
   *   must derive to `address`, or this throws (fail-closed).
   * @throws If signer already exists
   * @throws If publicKey does not derive to address
   */
  addSigner(
    address: string,
    label: string,
    weight = 1,
    publicKey?: string,
  ): GovernanceChangeEvent {
    if (this.signers.has(address)) {
      throw new Error(`Signer already exists: ${address}`);
    }
    if (weight < 1) {
      throw new Error(`Weight must be >= 1, got ${weight}`);
    }
    if (publicKey !== undefined) {
      let derived: string;
      try {
        derived = deriveAddress(publicKey);
      } catch (err) {
        throw new Error(
          `Invalid signer public key for ${address}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (derived !== address) {
        throw new Error(
          `Signer public key does not match address: key derives to ${derived}, expected ${address}`,
        );
      }
    }

    const timestamp = new Date().toISOString();
    const event: GovernanceChangeEvent = {
      type: "signer_added",
      address,
      label,
      weight,
      timestamp,
      ...(publicKey !== undefined ? { publicKey } : {}),
    };

    this.applyEvent(event);
    return event;
  }

  /**
   * Remove a signer from the governance policy.
   *
   * @param address Signer's address to remove
   * @throws If signer does not exist
   * @throws If removal would make quorum impossible
   */
  removeSigner(address: string): GovernanceChangeEvent {
    if (!this.signers.has(address)) {
      throw new Error(`Signer not found: ${address}`);
    }

    // Check if removal would make quorum impossible
    const remainingWeight = this.totalWeight() - (this.signers.get(address)!.weight);
    if (remainingWeight < this.quorum) {
      throw new Error(
        `Cannot remove signer ${address}: remaining weight (${remainingWeight}) ` +
        `would be less than quorum (${this.quorum})`,
      );
    }

    const timestamp = new Date().toISOString();
    const event: GovernanceChangeEvent = {
      type: "signer_removed",
      address,
      timestamp,
    };

    this.applyEvent(event);
    return event;
  }

  /**
   * Change the quorum threshold.
   *
   * @param newQuorum New quorum value
   * @throws If newQuorum < 1
   * @throws If newQuorum > total weight of current signers
   */
  changeQuorum(newQuorum: number): GovernanceChangeEvent {
    if (newQuorum < 1) {
      throw new Error(`Quorum must be >= 1, got ${newQuorum}`);
    }

    const total = this.totalWeight();
    if (total > 0 && newQuorum > total) {
      throw new Error(
        `Quorum (${newQuorum}) cannot exceed total signer weight (${total})`,
      );
    }

    const timestamp = new Date().toISOString();
    const event: GovernanceChangeEvent = {
      type: "quorum_changed",
      previousQuorum: this.quorum,
      newQuorum,
      timestamp,
    };

    this.applyEvent(event);
    return event;
  }

  /**
   * Set or update the active SLA policy.
   *
   * @param policyId Unique policy identifier
   * @param policyName Human-readable policy name
   * @param policyVersion Policy version number
   * @param targetCount Number of SLA targets in the policy
   * @returns The emitted governance change event
   */
  setSlaPolicy(
    policyId: string,
    policyName: string,
    policyVersion: number,
    targetCount: number,
  ): GovernanceChangeEvent {
    if (policyId.length === 0) {
      throw new Error("SLA policy ID cannot be empty");
    }
    if (policyVersion < 1) {
      throw new Error(`SLA policy version must be >= 1, got ${policyVersion}`);
    }

    const timestamp = new Date().toISOString();
    const event: GovernanceChangeEvent = {
      type: "sla_policy_set",
      policyId,
      policyName,
      policyVersion,
      targetCount,
      timestamp,
    };

    this.applyEvent(event);
    return event;
  }

  /**
   * Get the currently active SLA policy, if any.
   */
  getCurrentSlaPolicy(): {
    id: string;
    name: string;
    version: number;
    targetCount: number;
  } | null {
    return this.activeSlaPolicy;
  }

  /**
   * Get the current governance policy snapshot.
   */
  getCurrentPolicy(): GovernancePolicy {
    const signers = [...this.signers.values()];
    const policyData = canonicalize({
      version: this.version,
      signers: signers.map((s) => s.address).sort(),
      quorum: this.quorum,
    });
    const id = createHash("sha256").update(policyData).digest("hex").slice(0, 16);

    return {
      id,
      version: this.version,
      signers,
      quorum: this.quorum,
      updatedAt: this.lastUpdated,
    };
  }

  /**
   * Check if a set of signer addresses meets the quorum.
   */
  checkQuorum(signerAddresses: readonly string[]): QuorumResult {
    const validSigners = signerAddresses.filter((addr) => this.signers.has(addr));
    const totalWeight = validSigners.reduce(
      (sum, addr) => sum + (this.signers.get(addr)?.weight ?? 0),
      0,
    );

    const allAddresses = [...this.signers.keys()];
    const missingAddresses = allAddresses.filter((addr) => !signerAddresses.includes(addr));

    return {
      met: totalWeight >= this.quorum,
      totalWeight,
      requiredWeight: this.quorum,
      signerAddresses: validSigners,
      missingAddresses,
    };
  }

  /**
   * Replay governance history from a sequence of events.
   * Resets the store to empty state first, then replays all events.
   */
  replayFrom(events: readonly GovernanceChangeEvent[]): void {
    this.signers.clear();
    this.quorum = 1;
    this.version = 0;
    this.events.length = 0;
    this.activeSlaPolicy = null;

    for (const event of events) {
      this.applyEvent(event);
    }
  }

  /**
   * Get the full event history.
   */
  getEventHistory(): readonly GovernanceChangeEvent[] {
    return [...this.events];
  }

  /**
   * Get the current number of signers.
   */
  get signerCount(): number {
    return this.signers.size;
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private applyEvent(event: GovernanceChangeEvent): void {
    switch (event.type) {
      case "signer_added":
        this.signers.set(event.address, {
          address: event.address,
          label: event.label,
          weight: event.weight,
          addedAt: event.timestamp,
          ...(event.publicKey !== undefined ? { publicKey: event.publicKey } : {}),
        });
        break;

      case "signer_removed":
        this.signers.delete(event.address);
        break;

      case "quorum_changed":
        this.quorum = event.newQuorum;
        break;

      case "policy_rotated":
        // Policy rotation is a no-op on state — it's an audit marker
        break;

      case "sla_policy_set":
        this.activeSlaPolicy = {
          id: event.policyId,
          name: event.policyName,
          version: event.policyVersion,
          targetCount: event.targetCount,
        };
        break;
    }

    this.version++;
    this.lastUpdated = event.timestamp;
    this.events.push(event);
  }

  private totalWeight(): number {
    return [...this.signers.values()].reduce((sum, s) => sum + s.weight, 0);
  }
}
