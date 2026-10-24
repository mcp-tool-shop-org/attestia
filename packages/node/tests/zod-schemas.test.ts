/**
 * Comprehensive Zod schema & route validation error-shape tests (Card bz r4).
 *
 * Verifies:
 * 1. Every exported Zod schema in `@attestia/node` accepts valid inputs and
 *    rejects invalid inputs with the expected `{ path, message }` issue shape.
 * 2. Every route family that turns a Zod error into an HTTP 400 response or a
 *    thrown `ConfigError` produces the expected error envelope shape.
 */

import { describe, it, expect } from "vitest";
import { ConfigSchema, loadConfig, ConfigError } from "../src/config.js";
import {
  boundedRecord,
  MAX_RECORD_ENTRIES,
  MoneySchema,
  PaginationQuerySchema,
  DeclareIntentSchema,
  ApproveIntentSchema,
  RejectIntentSchema,
  ExecuteIntentSchema,
  VerifyIntentSchema,
  ListIntentsQuerySchema,
  ListEventsQuerySchema,
  ListStreamEventsQuerySchema,
  ReplayVerifySchema,
  HashVerifySchema,
  ReconcileSchema,
} from "../src/types/dto.js";
import {
  AddSignerSchema,
  RemoveSignerSchema,
  ChangeQuorumSchema,
} from "../src/types/dto-governance.js";
import {
  PayComponentSchema,
  PayPeriodSchema,
  CreatePayrollRunSchema,
  ListPayrollRunsQuerySchema,
  DistributionRecipientSchema,
  CreateDistributionSchema,
  ListDistributionsQuerySchema,
  SubmitFundingSchema,
  ApproveFundingGateSchema,
  RejectFundingSchema,
  ListFundingRequestsQuerySchema,
} from "../src/types/dto-treasury.js";
import {
  CreateEnvelopeSchema,
  AllocateEnvelopeSchema,
  ListEnvelopesQuerySchema,
} from "../src/types/dto-vault.js";
import { createTestApp, jsonRequest } from "./setup.js";

function issuePaths(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): string[] {
  return error.issues.map((i) => i.path.map(String).join("."));
}

describe("Exported Zod schemas — valid and invalid inputs + error shapes", () => {
  it("ConfigSchema: accepts valid env and rejects invalid env with issue paths and messages", () => {
    const ok = ConfigSchema.safeParse({ PORT: "4000", WITNESS_ENABLED: "false" });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.PORT).toBe(4000);
      expect(ok.data.WITNESS_ENABLED).toBe(false);
    }

    const bad = ConfigSchema.safeParse({ PORT: "0", WITNESS_ENABLED: "true" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(issuePaths(bad.error)).toEqual([
        "PORT",
        "WITNESS_URL",
        "WITNESS_SECRET",
        "WITNESS_ADDRESS",
      ]);
      for (const issue of bad.error.issues) {
        expect(typeof issue.message).toBe("string");
        expect(issue.message.length).toBeGreaterThan(0);
      }
    }
  });

  it("boundedRecord: accepts valid record and rejects non-object or over-cap record", () => {
    const schema = boundedRecord();
    expect(schema.safeParse({ a: 1, b: "x" }).success).toBe(true);

    const badType = schema.safeParse("not-an-object");
    expect(badType.success).toBe(false);
    if (!badType.success) {
      expect(issuePaths(badType.error)).toEqual([""]);
    }

    const tooMany: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_RECORD_ENTRIES; i++) tooMany[`k${i}`] = i;
    const badCap = schema.safeParse(tooMany);
    expect(badCap.success).toBe(false);
    if (!badCap.success) {
      expect(badCap.error.issues[0]?.message).toBe(
        `Record has too many entries (max ${MAX_RECORD_ENTRIES})`,
      );
    }

    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    const badCircular = schema.safeParse(circular);
    expect(badCircular.success).toBe(false);
  });

  it("MoneySchema: accepts valid money and rejects invalid money", () => {
    expect(
      MoneySchema.safeParse({ amount: "100.00", currency: "USDC", decimals: 6 }).success,
    ).toBe(true);

    const bad = MoneySchema.safeParse({ amount: "", currency: "", decimals: -1 });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(issuePaths(bad.error)).toEqual(["amount", "currency", "decimals"]);
    }
  });

  it("PaginationQuerySchema: accepts valid query and rejects out-of-range limit", () => {
    const ok = PaginationQuerySchema.safeParse({});
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.limit).toBe(20);

    const bad = PaginationQuerySchema.safeParse({ limit: "0" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(issuePaths(bad.error)).toEqual(["limit"]);
    }
  });

  it("DeclareIntentSchema: accepts valid intent and rejects missing/invalid fields", () => {
    expect(
      DeclareIntentSchema.safeParse({
        id: "int-1",
        kind: "transfer",
        description: "Transfer 10 USDC",
        params: { fromAddress: "0x1", toAddress: "0x2" },
      }).success,
    ).toBe(true);

    const bad = DeclareIntentSchema.safeParse({ kind: "invalid-kind" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(issuePaths(bad.error)).toEqual(["id", "kind", "description", "params"]);
    }
  });

  it("ApproveIntentSchema & RejectIntentSchema: accept valid inputs and reject invalid types", () => {
    expect(ApproveIntentSchema.safeParse({}).success).toBe(true);
    expect(ApproveIntentSchema.safeParse({ reason: "ok" }).success).toBe(true);
    const badApprove = ApproveIntentSchema.safeParse({ reason: 123 });
    expect(badApprove.success).toBe(false);
    if (!badApprove.success) expect(issuePaths(badApprove.error)).toEqual(["reason"]);

    expect(RejectIntentSchema.safeParse({ reason: "denied" }).success).toBe(true);
    const badReject = RejectIntentSchema.safeParse({ reason: "" });
    expect(badReject.success).toBe(false);
    if (!badReject.success) expect(issuePaths(badReject.error)).toEqual(["reason"]);
  });

  it("ExecuteIntentSchema & VerifyIntentSchema: accept valid inputs and reject invalid fields", () => {
    expect(
      ExecuteIntentSchema.safeParse({ chainId: "eip155:1", txHash: "0xabc" }).success,
    ).toBe(true);
    const badExec = ExecuteIntentSchema.safeParse({ chainId: "" });
    expect(badExec.success).toBe(false);
    if (!badExec.success) expect(issuePaths(badExec.error)).toEqual(["chainId", "txHash"]);

    expect(
      VerifyIntentSchema.safeParse({ matched: true, discrepancies: ["none"] }).success,
    ).toBe(true);
    const badVerify = VerifyIntentSchema.safeParse({ matched: "yes" });
    expect(badVerify.success).toBe(false);
    if (!badVerify.success) expect(issuePaths(badVerify.error)).toEqual(["matched"]);
  });

  it("ListIntentsQuerySchema, ListEventsQuerySchema, ListStreamEventsQuerySchema: accept valid queries and reject invalid numbers", () => {
    expect(ListIntentsQuerySchema.safeParse({ status: "declared", limit: "10" }).success).toBe(true);
    const badIntentsQ = ListIntentsQuerySchema.safeParse({ status: 123, limit: "200" });
    expect(badIntentsQ.success).toBe(false);
    if (!badIntentsQ.success) expect(issuePaths(badIntentsQ.error)).toEqual(["limit", "status"]);

    expect(ListEventsQuerySchema.safeParse({ afterPosition: "5" }).success).toBe(true);
    const badEventsQ = ListEventsQuerySchema.safeParse({ afterPosition: "-1" });
    expect(badEventsQ.success).toBe(false);
    if (!badEventsQ.success) expect(issuePaths(badEventsQ.error)).toEqual(["afterPosition"]);

    expect(ListStreamEventsQuerySchema.safeParse({ afterVersion: "0" }).success).toBe(true);
    const badStreamQ = ListStreamEventsQuerySchema.safeParse({ afterVersion: "-2" });
    expect(badStreamQ.success).toBe(false);
    if (!badStreamQ.success) expect(issuePaths(badStreamQ.error)).toEqual(["afterVersion"]);
  });

  it("ReplayVerifySchema & HashVerifySchema: accept valid snapshots and reject invalid fields", () => {
    expect(
      ReplayVerifySchema.safeParse({
        ledgerSnapshot: { a: 1 },
        registrumSnapshot: { b: 2 },
      }).success,
    ).toBe(true);
    const badReplay = ReplayVerifySchema.safeParse({ ledgerSnapshot: "bad" });
    expect(badReplay.success).toBe(false);
    if (!badReplay.success) {
      expect(issuePaths(badReplay.error)).toEqual(["ledgerSnapshot", "registrumSnapshot"]);
    }

    expect(
      HashVerifySchema.safeParse({
        ledgerSnapshot: {},
        registrumSnapshot: {},
        expectedHash: "abc",
      }).success,
    ).toBe(true);
    const badHash = HashVerifySchema.safeParse({
      ledgerSnapshot: {},
      registrumSnapshot: {},
      expectedHash: "",
    });
    expect(badHash.success).toBe(false);
    if (!badHash.success) expect(issuePaths(badHash.error)).toEqual(["expectedHash"]);
  });

  it("ReconcileSchema: accepts valid reconciliation input and rejects invalid entries", () => {
    expect(
      ReconcileSchema.safeParse({
        intents: [],
        ledgerEntries: [],
        chainEvents: [],
      }).success,
    ).toBe(true);

    const bad = ReconcileSchema.safeParse({
      intents: [{ id: 123 }],
      ledgerEntries: "not-array",
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(issuePaths(bad.error)).toContain("ledgerEntries");
      expect(issuePaths(bad.error)).toContain("chainEvents");
    }
  });

  it("Governance schemas (AddSignerSchema, RemoveSignerSchema, ChangeQuorumSchema): accept valid and reject invalid", () => {
    expect(
      AddSignerSchema.safeParse({ address: "r1", label: "Signer 1", weight: 2 }).success,
    ).toBe(true);
    const badAdd = AddSignerSchema.safeParse({ address: "", weight: 0 });
    expect(badAdd.success).toBe(false);
    if (!badAdd.success) expect(issuePaths(badAdd.error)).toEqual(["address", "label", "weight"]);

    expect(RemoveSignerSchema.safeParse({ address: "r1" }).success).toBe(true);
    const badRem = RemoveSignerSchema.safeParse({ address: "" });
    expect(badRem.success).toBe(false);
    if (!badRem.success) expect(issuePaths(badRem.error)).toEqual(["address"]);

    expect(ChangeQuorumSchema.safeParse({ quorum: 2 }).success).toBe(true);
    const badQuorum = ChangeQuorumSchema.safeParse({ quorum: 0 });
    expect(badQuorum.success).toBe(false);
    if (!badQuorum.success) expect(issuePaths(badQuorum.error)).toEqual(["quorum"]);
  });

  it("Treasury schemas (PayComponent, PayPeriod, CreatePayrollRun, DistributionRecipient, CreateDistribution, SubmitFunding, ApproveFundingGate, RejectFunding, List*Query): accept valid and reject invalid", () => {
    const money = { amount: "100", currency: "USDC", decimals: 6 };
    expect(
      PayComponentSchema.safeParse({
        id: "c1",
        name: "Base",
        type: "base",
        amount: money,
        recurring: true,
        taxable: true,
      }).success,
    ).toBe(true);
    const badComp = PayComponentSchema.safeParse({ id: "", type: "invalid" });
    expect(badComp.success).toBe(false);
    if (!badComp.success) {
      expect(issuePaths(badComp.error)).toEqual([
        "id",
        "name",
        "type",
        "amount",
        "recurring",
        "taxable",
      ]);
    }

    expect(
      PayPeriodSchema.safeParse({ start: "2025-01-01", end: "2025-01-31", label: "2025-01" }).success,
    ).toBe(true);
    const badPeriod = PayPeriodSchema.safeParse({ start: "" });
    expect(badPeriod.success).toBe(false);
    if (!badPeriod.success) expect(issuePaths(badPeriod.error)).toEqual(["start", "end", "label"]);

    expect(
      CreatePayrollRunSchema.safeParse({
        id: "run-1",
        period: { start: "2025-01-01", end: "2025-01-31", label: "2025-01" },
      }).success,
    ).toBe(true);
    const badRun = CreatePayrollRunSchema.safeParse({ id: "" });
    expect(badRun.success).toBe(false);
    if (!badRun.success) expect(issuePaths(badRun.error)).toEqual(["id", "period"]);

    expect(
      DistributionRecipientSchema.safeParse({ payeeId: "p1", share: 5000 }).success,
    ).toBe(true);
    const badRecip = DistributionRecipientSchema.safeParse({ payeeId: "" });
    expect(badRecip.success).toBe(false);
    if (!badRecip.success) expect(issuePaths(badRecip.error)).toEqual(["payeeId"]);

    expect(
      CreateDistributionSchema.safeParse({
        id: "dist-1",
        name: "Q1",
        strategy: "proportional",
        pool: money,
        recipients: [{ payeeId: "p1", share: 10000 }],
      }).success,
    ).toBe(true);
    const badDist = CreateDistributionSchema.safeParse({
      id: "",
      name: "",
      strategy: "bad",
      recipients: [],
    });
    expect(badDist.success).toBe(false);
    if (!badDist.success) {
      expect(issuePaths(badDist.error)).toEqual([
        "id",
        "name",
        "strategy",
        "pool",
        "recipients",
      ]);
    }

    expect(
      SubmitFundingSchema.safeParse({
        id: "fund-1",
        description: "Ops",
        amount: money,
      }).success,
    ).toBe(true);
    const badFund = SubmitFundingSchema.safeParse({ id: "" });
    expect(badFund.success).toBe(false);
    if (!badFund.success) {
      expect(issuePaths(badFund.error)).toEqual(["id", "description", "amount"]);
    }

    expect(ApproveFundingGateSchema.safeParse({ reason: "ok" }).success).toBe(true);
    expect(ApproveFundingGateSchema.safeParse({ reason: "x".repeat(1025) }).success).toBe(false);

    expect(RejectFundingSchema.safeParse({ reason: "no" }).success).toBe(true);
    expect(RejectFundingSchema.safeParse({ reason: "x".repeat(1025) }).success).toBe(false);

    expect(ListPayrollRunsQuerySchema.safeParse({ limit: "10" }).success).toBe(true);
    expect(ListPayrollRunsQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(ListDistributionsQuerySchema.safeParse({ limit: "10" }).success).toBe(true);
    expect(ListDistributionsQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(ListFundingRequestsQuerySchema.safeParse({ limit: "10" }).success).toBe(true);
    expect(ListFundingRequestsQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
  });

  it("Vault schemas (CreateEnvelopeSchema, AllocateEnvelopeSchema, ListEnvelopesQuerySchema): accept valid and reject invalid", () => {
    expect(
      CreateEnvelopeSchema.safeParse({ id: "env-1", name: "Ops", category: "fixed" }).success,
    ).toBe(true);
    const badEnv = CreateEnvelopeSchema.safeParse({ id: "", name: "" });
    expect(badEnv.success).toBe(false);
    if (!badEnv.success) expect(issuePaths(badEnv.error)).toEqual(["id", "name"]);

    expect(
      AllocateEnvelopeSchema.safeParse({
        amount: { amount: "50", currency: "USDC", decimals: 6 },
      }).success,
    ).toBe(true);
    const badAlloc = AllocateEnvelopeSchema.safeParse({});
    expect(badAlloc.success).toBe(false);
    if (!badAlloc.success) expect(issuePaths(badAlloc.error)).toEqual(["amount"]);

    expect(ListEnvelopesQuerySchema.safeParse({ limit: "5" }).success).toBe(true);
    expect(ListEnvelopesQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
  });
});

describe("Public API route families — invalid request error shapes", () => {
  it("returns structured 400 VALIDATION_ERROR with issues[{path, message}] across all body-validated route families and 400 on query-validated routes", async () => {
    const { app } = createTestApp();

    const bodyCases: readonly { family: string; path: string; payload: unknown; expectedPaths: string[] }[] = [
      {
        family: "intents",
        path: "/api/v1/intents",
        payload: { kind: "transfer" },
        expectedPaths: ["id", "description", "params"],
      },
      {
        family: "verify",
        path: "/api/v1/verify/hash",
        payload: { ledgerSnapshot: {}, registrumSnapshot: {}, expectedHash: "" },
        expectedPaths: ["expectedHash"],
      },
      {
        family: "attestation",
        path: "/api/v1/reconcile",
        payload: { intents: [], ledgerEntries: [] },
        expectedPaths: ["chainEvents"],
      },
      {
        family: "proofs",
        path: "/api/v1/proofs/verify",
        payload: { version: 2 },
        expectedPaths: [
          "version",
          "attestationHash",
          "merkleRoot",
          "inclusionProof",
          "packagedAt",
          "packageHash",
        ],
      },
      {
        family: "public-proofs",
        path: "/public/v1/proofs/verify",
        payload: { version: 1, attestationHash: "short" },
        expectedPaths: ["attestationHash", "merkleRoot", "inclusionProof", "packagedAt", "packageHash"],
      },
      {
        family: "public-verify",
        path: "/public/v1/verify/submit-report",
        payload: { verifierId: "alice", verdict: "MAYBE" },
        expectedPaths: [
          "reportId",
          "verdict",
          "subsystemChecks",
          "discrepancies",
          "bundleHash",
          "verifiedAt",
        ],
      },
      {
        family: "governance",
        path: "/api/v1/governance/signers",
        payload: { address: "rSigner1" },
        expectedPaths: ["label"],
      },
      {
        family: "treasury",
        path: "/api/v1/treasury/payroll-runs",
        payload: { id: "" },
        expectedPaths: ["id", "period"],
      },
      {
        family: "vault",
        path: "/api/v1/vault/envelopes",
        payload: { id: "env-1" },
        expectedPaths: ["name"],
      },
    ];

    for (const tc of bodyCases) {
      const res = await app.request(jsonRequest(tc.path, "POST", tc.payload));
      expect(res.status, tc.family).toBe(400);
      const body = (await res.json()) as {
        error: {
          code: string;
          message: string;
          hint: string;
          details: { issues: { path: string; message: string }[] };
        };
      };
      expect(body.error.code, tc.family).toBe("VALIDATION_ERROR");
      expect(body.error.message, tc.family).toBe("Request body validation failed");
      expect(body.error.hint, tc.family).toBe(
        "Check the listed field issues and resubmit with a valid body.",
      );
      const paths = body.error.details.issues.map((i) => i.path);
      for (const expectedPath of tc.expectedPaths) {
        expect(paths, `${tc.family} missing path ${expectedPath}`).toContain(expectedPath);
      }
      for (const issue of body.error.details.issues) {
        expect(typeof issue.message).toBe("string");
        expect(issue.message.length).toBeGreaterThan(0);
      }
    }

    // Query-validated route families
    const queryPaths = [
      "/api/v1/attestations?limit=0",
      "/api/v1/events?afterPosition=-1",
      "/api/v1/events/stream-1?afterVersion=-1",
      "/api/v1/intents?limit=999",
      "/api/v1/treasury/payroll-runs?limit=0",
      "/api/v1/treasury/distributions?limit=0",
      "/api/v1/treasury/funding-gates?limit=0",
      "/api/v1/vault/envelopes?limit=0",
    ];
    for (const qPath of queryPaths) {
      const res = await app.request(qPath);
      expect(res.status, qPath).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error).toEqual({
        code: "VALIDATION_ERROR",
        message: "Invalid query parameters",
      });
    }

    // ConfigError thrown by loadConfig
    expect(() => loadConfig({ PORT: "0" })).toThrowError(ConfigError);
  });
});
