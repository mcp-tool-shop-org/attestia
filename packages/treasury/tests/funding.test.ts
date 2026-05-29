/**
 * Tests for FundingGateManager — dual-gate funding approval.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { FundingGateManager, FundingError } from "../src/funding.js";
import { Ledger } from "@attestia/ledger";
import type { Money } from "@attestia/types";

function usdc(amount: string): Money {
  return { amount, currency: "USDC", decimals: 6 };
}

const GATEKEEPERS: readonly [string, string] = ["cfo", "ceo"];

describe("FundingGateManager", () => {
  let funding: FundingGateManager;

  beforeEach(() => {
    funding = new FundingGateManager(GATEKEEPERS, "USDC", 6);
  });

  // ─── Construction ──────────────────────────────────────────────────

  describe("construction", () => {
    it("throws if gatekeepers are the same", () => {
      expect(
        () => new FundingGateManager(["cfo", "cfo"], "USDC", 6),
      ).toThrow(/distinct/i);
    });
  });

  // ─── Request management ────────────────────────────────────────────

  describe("submitRequest", () => {
    it("creates a pending request", () => {
      const req = funding.submitRequest(
        "f-1",
        "Office supplies",
        usdc("500"),
        "alice",
      );

      expect(req.id).toBe("f-1");
      expect(req.status).toBe("pending");
      expect(req.requestedBy).toBe("alice");
    });

    it("throws on duplicate request", () => {
      funding.submitRequest("f-1", "Test", usdc("100"), "alice");
      expect(() =>
        funding.submitRequest("f-1", "Test 2", usdc("200"), "bob"),
      ).toThrow(FundingError);
    });
  });

  // ─── Gate approvals ────────────────────────────────────────────────

  describe("approveGate", () => {
    it("first approval moves to gate1-approved", () => {
      funding.submitRequest("f-1", "Test", usdc("1000"), "alice");
      const updated = funding.approveGate("f-1", "cfo", "Budget available");

      expect(updated.status).toBe("gate1-approved");
      expect(updated.gate1?.approvedBy).toBe("cfo");
      expect(updated.gate1?.reason).toBe("Budget available");
    });

    it("second approval by different gatekeeper moves to approved", () => {
      funding.submitRequest("f-1", "Test", usdc("1000"), "alice");
      funding.approveGate("f-1", "cfo");
      const approved = funding.approveGate("f-1", "ceo", "Confirmed");

      expect(approved.status).toBe("approved");
      expect(approved.gate2?.approvedBy).toBe("ceo");
    });

    it("throws if same gatekeeper tries to approve twice", () => {
      funding.submitRequest("f-1", "Test", usdc("1000"), "alice");
      funding.approveGate("f-1", "cfo");

      expect(() => funding.approveGate("f-1", "cfo")).toThrow(
        /already approved/i,
      );
    });

    it("throws if non-gatekeeper tries to approve", () => {
      funding.submitRequest("f-1", "Test", usdc("1000"), "alice");

      expect(() => funding.approveGate("f-1", "alice")).toThrow(
        /not a gatekeeper/i,
      );
    });

    it("throws for invalid state", () => {
      funding.submitRequest("f-1", "Test", usdc("1000"), "alice");
      funding.approveGate("f-1", "cfo");
      funding.approveGate("f-1", "ceo");

      // Already approved — can't approve again
      expect(() => funding.approveGate("f-1", "cfo")).toThrow(
        /cannot approve/i,
      );
    });
  });

  // ─── Separation of duties (D4-A-003) ──────────────────────────────

  describe("separation of duties", () => {
    it("rejects when the requester (also a gatekeeper) approves their own gate", () => {
      // cfo is a gatekeeper. If cfo also raised the request, cfo approving a
      // gate would self-satisfy one of the two required approvals.
      funding.submitRequest("f-sod", "Self-funded", usdc("1000"), "cfo");

      expect(() => funding.approveGate("f-sod", "cfo")).toThrow(
        /requester cannot approve|cannot approve.*own/i,
      );
    });

    it("exposes a REQUESTER_CANNOT_APPROVE error code", () => {
      funding.submitRequest("f-sod2", "Self-funded", usdc("1000"), "cfo");
      try {
        funding.approveGate("f-sod2", "cfo");
        throw new Error("expected approveGate to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(FundingError);
        expect((err as FundingError).code).toBe("REQUESTER_CANNOT_APPROVE");
      }
    });

    it("still allows the OTHER gatekeeper to approve a gatekeeper-raised request", () => {
      // cfo raises; ceo (the other gatekeeper) may approve gate 1.
      funding.submitRequest("f-sod3", "Cross-approved", usdc("1000"), "cfo");
      const updated = funding.approveGate("f-sod3", "ceo");
      expect(updated.status).toBe("gate1-approved");
      expect(updated.gate1?.approvedBy).toBe("ceo");
    });

    it("does not affect requests raised by a non-gatekeeper", () => {
      // Regression guard for the common path: alice (non-gatekeeper) requests,
      // both gatekeepers approve normally.
      funding.submitRequest("f-sod4", "Normal", usdc("1000"), "alice");
      funding.approveGate("f-sod4", "cfo");
      const approved = funding.approveGate("f-sod4", "ceo");
      expect(approved.status).toBe("approved");
    });
  });

  // ─── Rejection ────────────────────────────────────────────────────

  describe("rejectRequest", () => {
    it("rejects a pending request", () => {
      funding.submitRequest("f-1", "Test", usdc("1000"), "alice");
      const rejected = funding.rejectRequest("f-1", "cfo", "Too expensive");

      expect(rejected.status).toBe("rejected");
    });

    it("rejects a gate1-approved request", () => {
      funding.submitRequest("f-1", "Test", usdc("1000"), "alice");
      funding.approveGate("f-1", "cfo");
      const rejected = funding.rejectRequest("f-1", "ceo", "Changed my mind");

      expect(rejected.status).toBe("rejected");
    });

    it("throws rejecting an already rejected request", () => {
      funding.submitRequest("f-1", "Test", usdc("1000"), "alice");
      funding.rejectRequest("f-1", "cfo");

      expect(() => funding.rejectRequest("f-1", "ceo")).toThrow(
        /cannot reject/i,
      );
    });

    it("throws if non-gatekeeper tries to reject", () => {
      funding.submitRequest("f-1", "Test", usdc("1000"), "alice");

      expect(() =>
        funding.rejectRequest("f-1", "alice", "I want to reject"),
      ).toThrow(/not a gatekeeper/i);
    });
  });

  // ─── Execute ──────────────────────────────────────────────────────

  describe("executeRequest", () => {
    it("executes an approved request with ledger entries", () => {
      const ledger = new Ledger();
      funding.submitRequest("f-1", "Office supplies", usdc("500"), "alice");
      funding.approveGate("f-1", "cfo");
      funding.approveGate("f-1", "ceo");

      const executed = funding.executeRequest("f-1", ledger);

      expect(executed.status).toBe("executed");
      expect(executed.executedAt).toBeDefined();

      // 2 entries: debit funding expense, credit treasury
      expect(ledger.getEntries().length).toBe(2);
    });

    it("throws executing non-approved request", () => {
      const ledger = new Ledger();
      funding.submitRequest("f-1", "Test", usdc("1000"), "alice");
      funding.approveGate("f-1", "cfo");

      expect(() => funding.executeRequest("f-1", ledger)).toThrow(
        /must be 'approved'/i,
      );
    });
  });

  // ─── Queries ──────────────────────────────────────────────────────

  describe("queries", () => {
    it("lists requests by status", () => {
      funding.submitRequest("f-1", "A", usdc("100"), "alice");
      funding.submitRequest("f-2", "B", usdc("200"), "bob");
      funding.approveGate("f-2", "cfo");

      expect(funding.listRequests().length).toBe(2);
      expect(funding.listRequests("pending").length).toBe(1);
      expect(funding.listRequests("gate1-approved").length).toBe(1);
    });
  });

  // ─── Export / Import ──────────────────────────────────────────────

  describe("export / import", () => {
    it("round-trips requests", () => {
      funding.submitRequest("f-1", "Test", usdc("500"), "alice");

      const requests = funding.exportRequests();
      const funding2 = new FundingGateManager(GATEKEEPERS, "USDC", 6);
      funding2.importRequests(requests);

      expect(funding2.getRequest("f-1").description).toBe("Test");
    });
  });
});
