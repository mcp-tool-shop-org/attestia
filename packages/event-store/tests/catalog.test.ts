/**
 * Tests for EventCatalog, schema versioning, and migration.
 *
 * Verifies:
 * - Schema registration and lookup
 * - Payload validation against schemas
 * - Schema version migration (v1 → v2 → v3)
 * - Forward compatibility (unknown events preserved)
 * - Versioned event creation and schema extraction
 * - Attestia catalog factory (all 34 event types)
 */

import { describe, it, expect } from "vitest";
import type { DomainEvent, EventMetadata } from "@attestia/types";
import type { EventSchema } from "../src/catalog.js";
import {
  EventCatalog,
  CatalogError,
  createVersionedEvent,
  getSchemaVersion,
} from "../src/catalog.js";
import {
  ATTESTIA_EVENTS,
  createAtlestiaCatalog,
} from "../src/attestia-events.js";

// =============================================================================
// Helpers
// =============================================================================

function makeSchema(
  type: string,
  version = 1,
  source: EventMetadata["source"] = "vault",
): EventSchema {
  return {
    type,
    version,
    description: `Test schema for ${type}`,
    source,
    validate: (p): p is { id: string } =>
      typeof p === "object" && p !== null && "id" in p,
  };
}

function makeMetadata(): EventMetadata {
  return {
    eventId: "evt-1",
    timestamp: new Date().toISOString(),
    actor: "test",
    correlationId: "corr-1",
    source: "vault",
  };
}

// =============================================================================
// Registration
// =============================================================================

describe("registration", () => {
  it("registers a schema", () => {
    const catalog = new EventCatalog();
    catalog.register(makeSchema("test.event"));

    expect(catalog.has("test.event")).toBe(true);
    expect(catalog.size).toBe(1);
  });

  it("retrieves a registered schema", () => {
    const catalog = new EventCatalog();
    const schema = makeSchema("test.event", 1, "treasury");
    catalog.register(schema);

    const found = catalog.getSchema("test.event");
    expect(found).toBeDefined();
    expect(found!.type).toBe("test.event");
    expect(found!.version).toBe(1);
    expect(found!.source).toBe("treasury");
  });

  it("returns undefined for unregistered type", () => {
    const catalog = new EventCatalog();
    expect(catalog.getSchema("nope")).toBeUndefined();
  });

  it("re-registration of same version is idempotent", () => {
    const catalog = new EventCatalog();
    catalog.register(makeSchema("test.event", 1));
    catalog.register(makeSchema("test.event", 1));

    expect(catalog.size).toBe(1);
  });

  it("version upgrade replaces schema", () => {
    const catalog = new EventCatalog();
    catalog.register(makeSchema("test.event", 1));
    catalog.register(makeSchema("test.event", 2));

    expect(catalog.getSchema("test.event")!.version).toBe(2);
    expect(catalog.size).toBe(1);
  });
});

// =============================================================================
// Listing & Querying
// =============================================================================

describe("listing", () => {
  it("lists all registered types sorted", () => {
    const catalog = new EventCatalog();
    catalog.register(makeSchema("c.event"));
    catalog.register(makeSchema("a.event"));
    catalog.register(makeSchema("b.event"));

    expect(catalog.listTypes()).toEqual(["a.event", "b.event", "c.event"]);
  });

  it("lists schemas", () => {
    const catalog = new EventCatalog();
    catalog.register(makeSchema("a.event"));
    catalog.register(makeSchema("b.event"));

    const schemas = catalog.listSchemas();
    expect(schemas).toHaveLength(2);
  });

  it("lists by source", () => {
    const catalog = new EventCatalog();
    catalog.register(makeSchema("vault.a", 1, "vault"));
    catalog.register(makeSchema("treasury.a", 1, "treasury"));
    catalog.register(makeSchema("vault.b", 1, "vault"));

    const vaultEvents = catalog.listBySource("vault");
    expect(vaultEvents).toHaveLength(2);
    expect(vaultEvents.map((s) => s.type)).toContain("vault.a");
    expect(vaultEvents.map((s) => s.type)).toContain("vault.b");
  });
});

// =============================================================================
// Validation
// =============================================================================

describe("validation", () => {
  it("validates a correct payload", () => {
    const catalog = new EventCatalog();
    catalog.register(makeSchema("test.event"));

    expect(catalog.validate("test.event", { id: "123" })).toBe(true);
  });

  it("rejects an invalid payload", () => {
    const catalog = new EventCatalog();
    catalog.register(makeSchema("test.event"));

    expect(catalog.validate("test.event", { name: "wrong" })).toBe(false);
  });

  it("returns false for unregistered type", () => {
    const catalog = new EventCatalog();

    expect(catalog.validate("unknown", { id: "123" })).toBe(false);
  });

  it("rejects null payload", () => {
    const catalog = new EventCatalog();
    catalog.register(makeSchema("test.event"));

    expect(catalog.validate("test.event", null)).toBe(false);
  });
});

// =============================================================================
// Migration
// =============================================================================

describe("migration", () => {
  it("returns payload as-is when already at current version", () => {
    const catalog = new EventCatalog();
    catalog.register(makeSchema("test.event", 2));

    const payload = { id: "123", name: "test" };
    const migrated = catalog.migrate("test.event", payload, 2);

    expect(migrated).toBe(payload); // Same reference
  });

  it("applies single migration v1 → v2", () => {
    const catalog = new EventCatalog();
    catalog.register(makeSchema("test.event", 2));
    catalog.registerMigration("test.event", 1, (payload) => ({
      ...payload,
      addedInV2: "default-value",
    }));

    const migrated = catalog.migrate("test.event", { id: "123" }, 1);

    expect(migrated).toEqual({ id: "123", addedInV2: "default-value" });
  });

  it("applies chained migrations v1 → v2 → v3", () => {
    const catalog = new EventCatalog();
    catalog.register(makeSchema("test.event", 3));

    catalog.registerMigration("test.event", 1, (p) => ({
      ...p,
      fieldV2: "from-v1",
    }));
    catalog.registerMigration("test.event", 2, (p) => ({
      ...p,
      fieldV3: "from-v2",
    }));

    const migrated = catalog.migrate("test.event", { id: "123" }, 1);

    expect(migrated).toEqual({
      id: "123",
      fieldV2: "from-v1",
      fieldV3: "from-v2",
    });
  });

  it("throws on missing migration in chain", () => {
    const catalog = new EventCatalog();
    catalog.register(makeSchema("test.event", 3));
    // Only register v1→v2, missing v2→v3
    catalog.registerMigration("test.event", 1, (p) => ({ ...p, v2: true }));

    expect(() => catalog.migrate("test.event", { id: "123" }, 1)).toThrow(
      "Missing migration",
    );
  });

  it("returns payload as-is for unknown event type (forward compatibility)", () => {
    const catalog = new EventCatalog();
    const payload = { custom: "data" };

    const migrated = catalog.migrate("unknown.event", payload, 1);

    expect(migrated).toBe(payload);
  });

  it("returns payload as-is for future version (forward compatibility)", () => {
    const catalog = new EventCatalog();
    catalog.register(makeSchema("test.event", 2));

    const payload = { id: "123", futureField: "from-v5" };
    const migrated = catalog.migrate("test.event", payload, 5);

    expect(migrated).toBe(payload);
  });

  it("throws when registering migration for unknown type", () => {
    const catalog = new EventCatalog();

    expect(() =>
      catalog.registerMigration("unknown", 1, (p) => p),
    ).toThrow(CatalogError);
  });
});

// =============================================================================
// Upcast
// =============================================================================

describe("upcast", () => {
  it("upcasts a stored event to current version", () => {
    const catalog = new EventCatalog();
    catalog.register(makeSchema("test.event", 2));
    catalog.registerMigration("test.event", 1, (p) => ({
      ...p,
      newField: "migrated",
    }));

    const event: DomainEvent = {
      type: "test.event",
      metadata: makeMetadata(),
      payload: { id: "123" },
    };

    const upcasted = catalog.upcast(event, 1);

    expect(upcasted.type).toBe("test.event");
    expect(upcasted.metadata).toBe(event.metadata); // Same reference
    expect(upcasted.payload).toEqual({ id: "123", newField: "migrated" });
  });

  it("returns same event if already at current version", () => {
    const catalog = new EventCatalog();
    catalog.register(makeSchema("test.event", 1));

    const event: DomainEvent = {
      type: "test.event",
      metadata: makeMetadata(),
      payload: { id: "123" },
    };

    const upcasted = catalog.upcast(event, 1);
    expect(upcasted).toBe(event); // Same reference
  });
});

// =============================================================================
// Versioned Event Helpers
// =============================================================================

describe("versioned event helpers", () => {
  it("creates a versioned event with _schemaVersion", () => {
    const event = createVersionedEvent(
      "test.event",
      makeMetadata(),
      { id: "123" },
      2,
    );

    expect(event.type).toBe("test.event");
    expect(event.payload).toEqual({ id: "123", _schemaVersion: 2 });
  });

  it("extracts schema version from event", () => {
    const event = createVersionedEvent(
      "test.event",
      makeMetadata(),
      { id: "123" },
      3,
    );

    expect(getSchemaVersion(event)).toBe(3);
  });

  it("returns 1 for events without _schemaVersion", () => {
    const event: DomainEvent = {
      type: "test.event",
      metadata: makeMetadata(),
      payload: { id: "123" },
    };

    expect(getSchemaVersion(event)).toBe(1);
  });

  it("returns 1 for non-integer _schemaVersion", () => {
    const event: DomainEvent = {
      type: "test.event",
      metadata: makeMetadata(),
      payload: { id: "123", _schemaVersion: "not-a-number" },
    };

    expect(getSchemaVersion(event)).toBe(1);
  });

  it("returns 1 for zero _schemaVersion", () => {
    const event: DomainEvent = {
      type: "test.event",
      metadata: makeMetadata(),
      payload: { _schemaVersion: 0 },
    };

    expect(getSchemaVersion(event)).toBe(1);
  });
});

// =============================================================================
// Attestia Catalog
// =============================================================================

describe("createAtlestiaCatalog", () => {
  it("creates a catalog with all 34 event types", () => {
    const catalog = createAtlestiaCatalog();

    expect(catalog.size).toBe(34);
  });

  it("all ATTESTIA_EVENTS constants are registered", () => {
    const catalog = createAtlestiaCatalog();

    for (const eventType of Object.values(ATTESTIA_EVENTS)) {
      expect(catalog.has(eventType)).toBe(true);
    }
  });

  it("vault events are registered with source=vault", () => {
    const catalog = createAtlestiaCatalog();
    const vaultEvents = catalog.listBySource("vault");

    expect(vaultEvents.length).toBeGreaterThan(0);
    for (const schema of vaultEvents) {
      expect(schema.type.startsWith("vault.")).toBe(true);
    }
  });

  it("validates intent.declared payload", () => {
    const catalog = createAtlestiaCatalog();

    expect(
      catalog.validate(ATTESTIA_EVENTS.INTENT_DECLARED, {
        intentId: "int-1",
        kind: "transfer",
        description: "Transfer 100 USDC",
        declaredBy: "alice",
        params: {},
      }),
    ).toBe(true);
  });

  it("rejects invalid intent.declared payload", () => {
    const catalog = createAtlestiaCatalog();

    expect(
      catalog.validate(ATTESTIA_EVENTS.INTENT_DECLARED, {
        wrongField: "value",
      }),
    ).toBe(false);
  });

  it("validates state.registered payload", () => {
    const catalog = createAtlestiaCatalog();

    expect(
      catalog.validate(ATTESTIA_EVENTS.STATE_REGISTERED, {
        stateId: "s1",
        parentId: null,
        orderIndex: 0,
      }),
    ).toBe(true);
  });

  it("validates chain event detected payload", () => {
    const catalog = createAtlestiaCatalog();

    expect(
      catalog.validate(ATTESTIA_EVENTS.CHAIN_EVENT_DETECTED, {
        chainId: "evm:1",
        txHash: "0x123",
        blockNumber: 12345,
        eventType: "Transfer",
      }),
    ).toBe(true);
  });

  it("validates all event type payloads", () => {
    const catalog = createAtlestiaCatalog();

    // Vault events
    expect(catalog.validate(ATTESTIA_EVENTS.INTENT_APPROVED, { intentId: "i1", approvedBy: "alice" })).toBe(true);
    expect(catalog.validate(ATTESTIA_EVENTS.INTENT_REJECTED, { intentId: "i1", rejectedBy: "bob", reason: "bad" })).toBe(true);
    expect(catalog.validate(ATTESTIA_EVENTS.INTENT_EXECUTED, { intentId: "i1", correlationId: "c1" })).toBe(true);
    expect(catalog.validate(ATTESTIA_EVENTS.INTENT_VERIFIED, { intentId: "i1", verifiedAt: "2025-01-01" })).toBe(true);
    expect(catalog.validate(ATTESTIA_EVENTS.INTENT_FAILED, { intentId: "i1", reason: "timeout", failedAt: "2025-01-01" })).toBe(true);
    expect(catalog.validate(ATTESTIA_EVENTS.BUDGET_ALLOCATED, { budgetId: "b1", envelopeId: "e1", amount: "100", currency: "USD" })).toBe(true);
    expect(catalog.validate(ATTESTIA_EVENTS.PORTFOLIO_OBSERVED, { portfolioId: "p1", chainRef: "evm:1", observedAt: "2025-01-01" })).toBe(true);

    // Ledger events
    expect(catalog.validate(ATTESTIA_EVENTS.TRANSACTION_APPENDED, { correlationId: "c1", entryCount: 2, currency: "USD", totalAmount: "100" })).toBe(true);
    expect(catalog.validate(ATTESTIA_EVENTS.ACCOUNT_REGISTERED, { accountId: "a1", accountType: "asset", name: "Cash" })).toBe(true);

    // Treasury events
    expect(catalog.validate(ATTESTIA_EVENTS.PAYROLL_EXECUTED, { runId: "r1", recipientCount: 5, totalAmount: "5000", currency: "USD" })).toBe(true);
    expect(catalog.validate(ATTESTIA_EVENTS.DISTRIBUTION_EXECUTED, { planId: "p1", recipientCount: 3, totalAmount: "1000", currency: "USD" })).toBe(true);
    expect(catalog.validate(ATTESTIA_EVENTS.FUNDING_GATE_APPROVED, { gateId: "g1", approverId: "alice", level: 1 })).toBe(true);

    // Registrum events
    expect(catalog.validate(ATTESTIA_EVENTS.ATTESTATION_EMITTED, { registrumVersion: "1.0", snapshotHash: "abc", stateCount: 3 })).toBe(true);

    // Observer events
    expect(catalog.validate(ATTESTIA_EVENTS.BALANCE_OBSERVED, { chainId: "evm:1", address: "0x123", balance: "100", currency: "ETH" })).toBe(true);

    // Reconciler events
    expect(catalog.validate(ATTESTIA_EVENTS.RECONCILIATION_COMPLETED, { reportId: "r1", matchedCount: 5, mismatchCount: 0, missingCount: 0 })).toBe(true);
    expect(catalog.validate(ATTESTIA_EVENTS.ATTESTATION_RECORDED, { reportId: "r1", stateId: "s1", snapshotHash: "abc" })).toBe(true);

    // Witness events
    expect(catalog.validate(ATTESTIA_EVENTS.WITNESS_RECORD_SUBMITTED, { txHash: "0x123", witnessAddress: "rXXX", payloadHash: "abc" })).toBe(true);
  });

  it("validates Solana observer event payloads", () => {
    const catalog = createAtlestiaCatalog();

    expect(
      catalog.validate(ATTESTIA_EVENTS.SOLANA_EVENT_DETECTED, {
        chainId: "solana:mainnet-beta",
        txHash: "5VERv8NMvr...",
        slot: 250_000_000,
        programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        eventType: "Transfer",
      }),
    ).toBe(true);

    expect(
      catalog.validate(ATTESTIA_EVENTS.SOLANA_BALANCE_OBSERVED, {
        chainId: "solana:mainnet-beta",
        address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        balance: "1000000000",
        currency: "SOL",
        slot: 250_000_000,
        commitment: "confirmed",
      }),
    ).toBe(true);
  });

  it("validates L2 observer event payloads", () => {
    const catalog = createAtlestiaCatalog();

    expect(
      catalog.validate(ATTESTIA_EVENTS.L2_REORG_DETECTED, {
        chainId: "eip155:42161",
        blockNumber: 100_000,
        expectedHash: "0xabc",
        actualHash: "0xdef",
        detectedAt: "2025-01-01T00:00:00Z",
      }),
    ).toBe(true);

    expect(
      catalog.validate(ATTESTIA_EVENTS.L2_FINALITY_CONFIRMED, {
        chainId: "eip155:42161",
        blockNumber: 100_000,
        blockHash: "0xabc",
        settlementChainId: "eip155:1",
        confirmedAt: "2025-01-01T00:00:00Z",
      }),
    ).toBe(true);
  });

  it("validates governance event payloads", () => {
    const catalog = createAtlestiaCatalog();

    expect(
      catalog.validate(ATTESTIA_EVENTS.GOVERNANCE_SIGNER_ADDED, {
        signerAddress: "rSigner1",
        addedBy: "admin",
        newSignerCount: 3,
      }),
    ).toBe(true);

    expect(
      catalog.validate(ATTESTIA_EVENTS.GOVERNANCE_SIGNER_REMOVED, {
        signerAddress: "rSigner2",
        removedBy: "admin",
        newSignerCount: 2,
      }),
    ).toBe(true);

    expect(
      catalog.validate(ATTESTIA_EVENTS.GOVERNANCE_QUORUM_CHANGED, {
        previousQuorum: 1,
        newQuorum: 2,
        changedBy: "admin",
        totalSigners: 3,
      }),
    ).toBe(true);
  });

  it("validates governance SLA and tenant event payloads", () => {
    const catalog = createAtlestiaCatalog();

    expect(
      catalog.validate(ATTESTIA_EVENTS.GOVERNANCE_SLA_POLICY_SET, {
        policyId: "sla-1",
        policyName: "Production SLA",
        policyVersion: 1,
        targetCount: 5,
        setBy: "admin",
      }),
    ).toBe(true);

    expect(
      catalog.validate(ATTESTIA_EVENTS.GOVERNANCE_TENANT_CREATED, {
        tenantId: "tenant-1",
        tenantName: "Acme Corp",
        slaPolicyId: "sla-1",
        createdBy: "admin",
      }),
    ).toBe(true);

    expect(
      catalog.validate(ATTESTIA_EVENTS.GOVERNANCE_TENANT_SUSPENDED, {
        tenantId: "tenant-1",
        reason: "SLA violation",
        suspendedBy: "admin",
      }),
    ).toBe(true);
  });

  it("rejects invalid governance SLA and tenant event payloads", () => {
    const catalog = createAtlestiaCatalog();

    // Missing policyName
    expect(
      catalog.validate(ATTESTIA_EVENTS.GOVERNANCE_SLA_POLICY_SET, {
        policyId: "sla-1",
        policyVersion: 1,
        targetCount: 5,
        setBy: "admin",
      }),
    ).toBe(false);

    // Missing slaPolicyId
    expect(
      catalog.validate(ATTESTIA_EVENTS.GOVERNANCE_TENANT_CREATED, {
        tenantId: "tenant-1",
        tenantName: "Acme Corp",
        createdBy: "admin",
      }),
    ).toBe(false);

    // Missing reason
    expect(
      catalog.validate(ATTESTIA_EVENTS.GOVERNANCE_TENANT_SUSPENDED, {
        tenantId: "tenant-1",
        suspendedBy: "admin",
      }),
    ).toBe(false);
  });

  it("validates multi-sig witness event payload", () => {
    const catalog = createAtlestiaCatalog();

    expect(
      catalog.validate(ATTESTIA_EVENTS.WITNESS_MULTISIG_SUBMITTED, {
        txHash: "0xmultisig123",
        signerCount: 3,
        quorumRequired: 2,
        payloadHash: "abc123",
      }),
    ).toBe(true);
  });

  it("rejects invalid Solana event payloads", () => {
    const catalog = createAtlestiaCatalog();

    // Missing slot
    expect(
      catalog.validate(ATTESTIA_EVENTS.SOLANA_EVENT_DETECTED, {
        chainId: "solana:mainnet-beta",
        txHash: "5VERv8NMvr...",
        programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        eventType: "Transfer",
      }),
    ).toBe(false);

    // Missing commitment
    expect(
      catalog.validate(ATTESTIA_EVENTS.SOLANA_BALANCE_OBSERVED, {
        chainId: "solana:mainnet-beta",
        address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        balance: "1000000000",
        currency: "SOL",
        slot: 250_000_000,
      }),
    ).toBe(false);
  });

  it("rejects invalid governance payloads", () => {
    const catalog = createAtlestiaCatalog();

    // Missing newSignerCount (number)
    expect(
      catalog.validate(ATTESTIA_EVENTS.GOVERNANCE_SIGNER_ADDED, {
        signerAddress: "rSigner1",
        addedBy: "admin",
      }),
    ).toBe(false);

    // Missing changedBy
    expect(
      catalog.validate(ATTESTIA_EVENTS.GOVERNANCE_QUORUM_CHANGED, {
        previousQuorum: 1,
        newQuorum: 2,
        totalSigners: 3,
      }),
    ).toBe(false);
  });

  it("validates verification event payloads", () => {
    const catalog = createAtlestiaCatalog();

    expect(
      catalog.validate(ATTESTIA_EVENTS.VERIFICATION_EXTERNAL_REQUESTED, {
        bundleHash: "a".repeat(64),
        requestedBy: "operator",
        requestedAt: "2025-06-15T00:00:00Z",
      }),
    ).toBe(true);

    expect(
      catalog.validate(ATTESTIA_EVENTS.VERIFICATION_EXTERNAL_COMPLETED, {
        reportId: "report-1",
        verifierId: "verifier-alice",
        bundleHash: "a".repeat(64),
        verdict: "PASS",
        discrepancyCount: 0,
        completedAt: "2025-06-15T00:00:00Z",
      }),
    ).toBe(true);

    expect(
      catalog.validate(ATTESTIA_EVENTS.VERIFICATION_CONSENSUS_REACHED, {
        bundleHash: "a".repeat(64),
        verdict: "PASS",
        totalVerifiers: 3,
        agreementRatio: 1.0,
        consensusAt: "2025-06-15T00:00:00Z",
      }),
    ).toBe(true);
  });

  it("rejects invalid verification event payloads", () => {
    const catalog = createAtlestiaCatalog();

    // Missing bundleHash
    expect(
      catalog.validate(ATTESTIA_EVENTS.VERIFICATION_EXTERNAL_REQUESTED, {
        requestedBy: "operator",
        requestedAt: "2025-06-15T00:00:00Z",
      }),
    ).toBe(false);

    // Missing verdict
    expect(
      catalog.validate(ATTESTIA_EVENTS.VERIFICATION_EXTERNAL_COMPLETED, {
        reportId: "report-1",
        verifierId: "verifier-alice",
        bundleHash: "a".repeat(64),
        discrepancyCount: 0,
        completedAt: "2025-06-15T00:00:00Z",
      }),
    ).toBe(false);

    // Missing totalVerifiers (number)
    expect(
      catalog.validate(ATTESTIA_EVENTS.VERIFICATION_CONSENSUS_REACHED, {
        bundleHash: "a".repeat(64),
        verdict: "PASS",
        agreementRatio: 1.0,
        consensusAt: "2025-06-15T00:00:00Z",
      }),
    ).toBe(false);
  });

  it("event types follow naming convention", () => {
    const catalog = createAtlestiaCatalog();

    for (const eventType of catalog.listTypes()) {
      // Format: subsystem.entity.action
      const parts = eventType.split(".");
      expect(parts.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("all schemas are at version 1", () => {
    const catalog = createAtlestiaCatalog();

    for (const schema of catalog.listSchemas()) {
      expect(schema.version).toBe(1);
    }
  });
});

// =============================================================================
// M6: Atomic migration (structuredClone before migration chain)
// =============================================================================

describe("migration atomicity (M6)", () => {
  it("failing mid-chain migration preserves original payload", () => {
    const catalog = new EventCatalog();

    catalog.register(makeSchema("test.atomic.event", 3));
    // v1→v2: succeeds
    catalog.registerMigration("test.atomic.event", 1, (p: Record<string, unknown>) => ({ ...p, addedInV2: true }));
    // v2→v3: throws
    catalog.registerMigration("test.atomic.event", 2, () => { throw new Error("migration v2→v3 failed"); });

    const original = { name: "original", value: 42 };
    const originalCopy = structuredClone(original);

    expect(() => catalog.migrate("test.atomic.event", original, 1)).toThrow(
      "migration v2→v3 failed",
    );

    // Original must be untouched
    expect(original).toEqual(originalCopy);
  });

  it("successful multi-step migration returns fully migrated payload", () => {
    const catalog = new EventCatalog();

    catalog.register(makeSchema("test.multi.event", 3));
    catalog.registerMigration("test.multi.event", 1, (p: Record<string, unknown>) => ({ ...p, v2: true }));
    catalog.registerMigration("test.multi.event", 2, (p: Record<string, unknown>) => ({ ...p, v3: true }));

    const result = catalog.migrate("test.multi.event", { base: 1 }, 1);
    expect(result).toEqual({ base: 1, v2: true, v3: true });
  });
});

// =============================================================================
// D2-B-008: stable CatalogError codes
// =============================================================================

describe("CatalogError codes (D2-B-008)", () => {
  it("UNKNOWN_EVENT_TYPE when registering a migration for an unregistered type", () => {
    const catalog = new EventCatalog();

    let caught: CatalogError | undefined;
    try {
      catalog.registerMigration("never.registered", 1, (p) => p);
    } catch (err) {
      caught = err as CatalogError;
    }

    expect(caught).toBeInstanceOf(CatalogError);
    expect(caught!.code).toBe("UNKNOWN_EVENT_TYPE");
  });

  it("MISSING_MIGRATION when a version hop has no registered migration", () => {
    const catalog = new EventCatalog();
    catalog.register(makeSchema("test.gap.event", 3));
    // Register v1→v2 but deliberately omit v2→v3.
    catalog.registerMigration("test.gap.event", 1, (p) => ({ ...p, v2: true }));

    let caught: CatalogError | undefined;
    try {
      catalog.migrate("test.gap.event", { id: "x" }, 1);
    } catch (err) {
      caught = err as CatalogError;
    }

    expect(caught).toBeInstanceOf(CatalogError);
    expect(caught!.code).toBe("MISSING_MIGRATION");
    // Message includes the target version and an actionable hint.
    expect(caught!.message).toContain("target version 3");
    expect(caught!.message).toContain("registerMigration");
  });

  it("MIGRATION_FAILED when a registered migration throws", () => {
    const catalog = new EventCatalog();
    catalog.register(makeSchema("test.throwing.event", 2));
    catalog.registerMigration("test.throwing.event", 1, () => {
      throw new Error("boom");
    });

    let caught: CatalogError | undefined;
    try {
      catalog.migrate("test.throwing.event", { id: "x" }, 1);
    } catch (err) {
      caught = err as CatalogError;
    }

    expect(caught).toBeInstanceOf(CatalogError);
    expect(caught!.code).toBe("MIGRATION_FAILED");
    // Underlying cause message is preserved for diagnosis.
    expect(caught!.message).toContain("boom");
  });
});
