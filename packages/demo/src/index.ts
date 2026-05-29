#!/usr/bin/env node
/**
 * @attestia/demo — Interactive CLI walkthrough.
 *
 * Runs the full Attestia pipeline in your terminal:
 * declare intent -> approve -> execute -> ledger -> verify ->
 * reconcile -> attest -> state-hash -> merkle-tree -> proof -> verify-proof
 *
 * Uses real domain packages directly (no HTTP server).
 */

import chalk from "chalk";
import crypto from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { Vault } from "@attestia/vault";
import { Ledger } from "@attestia/ledger";
import { InMemoryEventStore, isHashedEvent } from "@attestia/event-store";
import type { HashedStoredEvent } from "@attestia/event-store";
import { StructuralRegistrar } from "@attestia/registrum";
import { ObserverRegistry } from "@attestia/chain-observer";
import type {
  ChainObserver,
  ConnectionStatus,
  BalanceQuery,
  BalanceResult,
  TokenBalanceQuery,
  TokenBalance,
  TransferQuery,
  TransferEvent,
} from "@attestia/chain-observer";
import { Reconciler } from "@attestia/reconciler";
import { computeGlobalStateHash } from "@attestia/verify";
import { MerkleTree, packageAttestationProof, verifyAttestationProof } from "@attestia/proof";
import type { ChainId, DomainEvent, LedgerEntry } from "@attestia/types";
import type { ReconcilableIntent, ReconcilableLedgerEntry, ReconcilableChainEvent } from "@attestia/reconciler";

// =============================================================================
// Helpers
// =============================================================================

const DELAY_MS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let _eventSeq = 0;

/** Build a minimal DomainEvent for the demo event store. */
function domainEvent(
  type: string,
  payload: Record<string, unknown>,
  source: "vault" | "treasury" | "registrum" | "observer" = "vault",
): DomainEvent {
  _eventSeq++;
  return {
    type,
    metadata: {
      eventId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      actor: "demo-cli",
      correlationId: `demo-${_eventSeq}`,
      source,
    },
    payload,
  };
}

function banner(): void {
  console.log();
  console.log(chalk.cyan.bold("  ╔══════════════════════════════════════════════════════════╗"));
  console.log(chalk.cyan.bold("  ║") + chalk.white.bold("                     ATTESTIA DEMO                       ") + chalk.cyan.bold("║"));
  console.log(chalk.cyan.bold("  ║") + chalk.gray("          Financial Truth Infrastructure                 ") + chalk.cyan.bold("║"));
  console.log(chalk.cyan.bold("  ╚══════════════════════════════════════════════════════════╝"));
  console.log();
}

function stepHeader(step: number, total: number, title: string): void {
  const prefix = chalk.cyan.bold(`  Step ${step}/${total}`);
  const line = chalk.gray("─".repeat(50 - title.length));
  console.log(`\n${prefix}  ${chalk.white.bold(title)}  ${line}`);
}

function ok(msg: string): void {
  console.log(chalk.green("    ✓ ") + chalk.white(msg));
}

function info(label: string, value: string): void {
  console.log(chalk.gray("    → ") + chalk.gray(label.padEnd(18)) + chalk.white(value));
}

function hashLine(label: string, hash: string): void {
  const short = hash.length > 16 ? `${hash.slice(0, 16)}...${hash.slice(-8)}` : hash;
  console.log(chalk.gray("    → ") + chalk.gray(label.padEnd(18)) + chalk.yellow(short));
}

function warn(msg: string): void {
  console.log(chalk.yellow("    ! ") + chalk.yellow(msg));
}

/** Print a per-check pass/fail line (used for proof verification output). */
function check(label: string, passed: boolean): void {
  const mark = passed ? chalk.green("✓") : chalk.red("✗");
  const value = passed ? chalk.green("pass") : chalk.red("fail");
  console.log(chalk.gray("    ") + mark + " " + chalk.gray(label.padEnd(18)) + value);
}

/** SHA-256 over the RFC 8785 canonical JSON form — identical to @attestia/proof. */
function canonicalSha256(value: unknown): string {
  return crypto.createHash("sha256").update(canonicalize(value)).digest("hex");
}

/**
 * A read-only stub chain observer for the demo.
 *
 * Satisfies the real {@link ChainObserver} interface and is registered on the
 * real {@link ObserverRegistry}, so reconciliation consumes an *observation*
 * rather than a hand-authored literal. It returns canned data instead of
 * hitting a live RPC endpoint — clearly a demo stub, not a mock of the
 * matching/verification logic (which runs for real).
 */
class DemoChainObserver implements ChainObserver {
  readonly chainId: ChainId;
  private readonly transfer: TransferEvent;
  private connected = false;

  constructor(chainId: ChainId, transfer: TransferEvent) {
    this.chainId = chainId;
    this.transfer = transfer;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async getStatus(): Promise<ConnectionStatus> {
    return {
      chainId: this.chainId,
      connected: this.connected,
      latestBlock: this.transfer.blockNumber,
      checkedAt: new Date().toISOString(),
    };
  }

  async getBalance(_query: BalanceQuery): Promise<BalanceResult> {
    throw new Error("DemoChainObserver: getBalance is not implemented (demo stub)");
  }

  async getTokenBalance(_query: TokenBalanceQuery): Promise<TokenBalance> {
    throw new Error("DemoChainObserver: getTokenBalance is not implemented (demo stub)");
  }

  async getTransfers(query: TransferQuery): Promise<readonly TransferEvent[]> {
    // Return the canned transfer when it concerns the queried address.
    const addr = query.address.toLowerCase();
    const involvesAddress =
      this.transfer.from.toLowerCase() === addr ||
      this.transfer.to.toLowerCase() === addr;
    return involvesAddress ? [this.transfer] : [];
  }
}

const TOTAL_STEPS = 14;

// =============================================================================
// Demo
// =============================================================================

async function run(): Promise<void> {
  banner();
  console.log(chalk.gray("  Walk-through of the full Attestia pipeline."));
  console.log(chalk.gray("  Every step runs the real domain packages — matching, hashing,"));
  console.log(chalk.gray("  attestation, and proof are all computed for real."));
  console.log(chalk.gray("  The on-chain leg uses a local stub observer (no live RPC),"));
  console.log(chalk.gray("  clearly labelled where it appears.\n"));

  await sleep(DELAY_MS);

  // ─── Step 1: Boot ───────────────────────────────────────────────────

  stepHeader(1, TOTAL_STEPS, "Boot");

  const observerRegistry = new ObserverRegistry();
  const vault = new Vault(
    {
      ownerId: "acme-corp",
      watchedAddresses: [],
      defaultCurrency: "USDC",
      defaultDecimals: 6,
    },
    observerRegistry,
  );
  ok("Vault initialized (owner: acme-corp)");

  const ledger = new Ledger();
  ledger.registerAccount({ id: "treasury", type: "asset", name: "Treasury" });
  ledger.registerAccount({ id: "payroll", type: "expense", name: "Payroll" });
  ok("Ledger initialized (2 accounts: treasury, payroll)");

  const eventStore = new InMemoryEventStore();
  ok("EventStore initialized (InMemory, hash-chained)");

  const registrar = new StructuralRegistrar({ mode: "legacy" });
  ok("Registrum initialized (structural registrar)");

  const reconciler = new Reconciler({
    registrar,
    attestorId: "demo-cli",
  });
  ok("Reconciler initialized (attestor: demo-cli)");

  await sleep(DELAY_MS);

  // ─── Step 2: Declare Intent ─────────────────────────────────────────

  stepHeader(2, TOTAL_STEPS, "Declare Intent");

  const intentId = "payroll-jan-2025";
  // Amounts are decimal strings (50,000 USDC at 6 decimals). The on-chain leg
  // expresses the same value in raw base units (50000000000), so all three
  // reconciliation legs agree.
  const intent = vault.declareIntent(intentId, "transfer", "January 2025 payroll — 5 employees", {
    fromAddress: "0xTreasury",
    toAddress: "0xPayrollContract",
    amount: { amount: "50000", currency: "USDC", decimals: 6 },
  });

  info("id", intent.id);
  info("kind", intent.kind);
  info("description", intent.description);
  info("amount", "50,000.000000 USDC");
  info("from", "0xTreasury");
  info("to", "0xPayrollContract");
  ok(`Status: ${chalk.bold(intent.status)}`);

  eventStore.append("vault.intents", [
    domainEvent("vault.intent.declared", { intentId: intent.id, kind: intent.kind }),
  ]);

  await sleep(DELAY_MS);

  // ─── Step 3: Approve Intent ─────────────────────────────────────────

  stepHeader(3, TOTAL_STEPS, "Approve Intent");

  const approved = vault.approveIntent(intentId, "Budget verified, headcount confirmed");
  info("approver", "CFO");
  info("reason", "Budget verified, headcount confirmed");
  ok(`Status: ${chalk.bold(approved.status)}`);

  eventStore.append("vault.intents", [
    domainEvent("vault.intent.approved", { intentId, approvedBy: "CFO" }),
  ]);

  await sleep(DELAY_MS);

  // ─── Step 4: Execute Intent ─────────────────────────────────────────

  stepHeader(4, TOTAL_STEPS, "Execute Intent");

  vault.markIntentExecuting(intentId);
  const executed = vault.recordIntentExecution(intentId, "evm:1", "0xabc123def456");
  info("chain", "evm:1 (Ethereum Mainnet)");
  info("txHash", "0xabc123def456");
  ok(`Status: ${chalk.bold(executed.status)}`);

  eventStore.append("vault.intents", [
    domainEvent("vault.intent.executed", { intentId, chainId: "evm:1", txHash: "0xabc123def456" }),
  ]);

  await sleep(DELAY_MS);

  // ─── Step 5: Record Ledger Entries ──────────────────────────────────

  stepHeader(5, TOTAL_STEPS, "Record Ledger Entries");

  const now = new Date().toISOString();
  const entries: readonly LedgerEntry[] = [
    {
      id: "le-payroll-debit",
      accountId: "treasury",
      type: "debit",
      money: { amount: "50000", currency: "USDC", decimals: 6 },
      timestamp: now,
      intentId,
      txHash: "0xabc123def456",
      correlationId: "payroll-jan",
    },
    {
      id: "le-payroll-credit",
      accountId: "payroll",
      type: "credit",
      money: { amount: "50000", currency: "USDC", decimals: 6 },
      timestamp: now,
      intentId,
      txHash: "0xabc123def456",
      correlationId: "payroll-jan",
    },
  ];

  const appendResult = ledger.append(entries);
  info("debit", "treasury  -50,000 USDC");
  info("credit", "payroll   +50,000 USDC");
  info("correlation", appendResult.correlationId);
  ok(`Balanced double-entry recorded (${appendResult.entryCount} entries)`);

  eventStore.append("ledger.transactions", [
    domainEvent("ledger.transaction.appended", { correlationId: appendResult.correlationId, entryCount: 2 }, "treasury"),
  ]);

  await sleep(DELAY_MS);

  // ─── Step 6: Verify Intent ─────────────────────────────────────────

  stepHeader(6, TOTAL_STEPS, "Verify Intent");

  // NOTE: vault.verifyIntent(intentId, verdict) RECORDS an attestor-supplied
  // verdict on the intent — the boolean is an INPUT the vault stores, not a
  // value the vault computes. The actual cross-system match is computed in
  // Step 7 (reconciliation), and its result is surfaced here for honesty.
  const attestorVerdict = true;
  const verified = vault.verifyIntent(intentId, attestorVerdict);
  info("attestor verdict", `${String(attestorVerdict)} (recorded, not computed)`);
  warn("This is the attestor's input — the computed match is Step 7 below");
  ok(`Status: ${chalk.bold(verified.status)}`);

  eventStore.append("vault.intents", [
    domainEvent("vault.intent.verified", { intentId, attestorVerdict }),
  ]);

  await sleep(DELAY_MS);

  // ─── Step 7: Reconcile ──────────────────────────────────────────────

  stepHeader(7, TOTAL_STEPS, "Reconcile (3-way match)");

  // Intent/ledger amounts are decimal strings (50,000 USDC at 6 decimals).
  // The matchers scale these by `decimals`; the on-chain leg below carries the
  // same value as raw base units, so all three legs reconcile cleanly.
  const reconcilableIntents: readonly ReconcilableIntent[] = [
    {
      id: intentId,
      status: "executed",
      kind: "transfer",
      amount: { amount: "50000", currency: "USDC", decimals: 6 },
      chainId: "evm:1",
      txHash: "0xabc123def456",
      declaredAt: now,
      correlationId: "payroll-jan",
    },
  ];

  const reconcilableEntries: readonly ReconcilableLedgerEntry[] = [
    {
      id: "le-payroll-debit",
      accountId: "treasury",
      type: "debit",
      money: { amount: "50000", currency: "USDC", decimals: 6 },
      timestamp: now,
      intentId,
      txHash: "0xabc123def456",
      correlationId: "payroll-jan",
    },
  ];

  // Register a read-only stub observer on the (previously unused) registry and
  // OBSERVE the on-chain transfer, rather than hand-authoring the chain event.
  // The observer returns canned data (no live RPC) but flows through the real
  // ObserverRegistry + ChainObserver interface and the real matchers.
  const observedTransfer: TransferEvent = {
    chainId: "evm:1",
    txHash: "0xabc123def456",
    blockNumber: 19_000_000,
    from: "0xTreasury",
    to: "0xPayrollContract",
    amount: "50000000000", // raw base units = 50,000.000000 USDC
    decimals: 6,
    symbol: "USDC",
    timestamp: now,
    observedAt: new Date().toISOString(),
  };
  observerRegistry.register(new DemoChainObserver("evm:1", observedTransfer));
  await observerRegistry.connectAll();

  const observed = await observerRegistry
    .get("evm:1")
    .getTransfers({ address: "0xTreasury", direction: "outgoing" });

  const reconcilableChainEvents: readonly ReconcilableChainEvent[] = observed.map((t) => ({
    chainId: t.chainId,
    txHash: t.txHash,
    from: t.from,
    to: t.to,
    amount: t.amount,
    decimals: t.decimals,
    symbol: t.symbol,
    timestamp: t.timestamp,
  }));

  warn(`chain leg: observed via STUB observer (no live RPC) — ${observed.length} transfer(s)`);

  const report = reconciler.reconcile({
    intents: reconcilableIntents,
    ledgerEntries: reconcilableEntries,
    chainEvents: reconcilableChainEvents,
  });

  info("intent <> ledger", `${report.intentLedgerMatches.length} match(es)`);
  info("ledger <> chain", `${report.ledgerChainMatches.length} match(es)`);
  info("intent <> chain", `${report.intentChainMatches.length} match(es)`);
  info("all reconciled", String(report.summary.allReconciled));
  if (report.summary.allReconciled) {
    ok(`Reconciliation complete — ${report.summary.matchedCount} matched, ${report.summary.mismatchCount} mismatches`);
  } else {
    warn(`Reconciliation found discrepancies — ${report.summary.matchedCount} matched, ${report.summary.mismatchCount} mismatches`);
    for (const d of report.summary.discrepancies) {
      warn(`  ${d}`);
    }
  }

  eventStore.append("reconciler", [
    domainEvent("reconciler.reconciliation.completed", { reportId: report.id, allReconciled: report.summary.allReconciled }, "registrum"),
  ]);

  await sleep(DELAY_MS);

  // ─── Step 8: Attest ─────────────────────────────────────────────────

  stepHeader(8, TOTAL_STEPS, "Attest");

  const attestation = await reconciler.attest(report);
  info("attestation id", attestation.id);
  info("attested by", attestation.attestedBy);
  hashLine("report hash", attestation.reportHash);
  ok("Attestation recorded with SHA-256 hash");

  eventStore.append("reconciler", [
    domainEvent("reconciler.attestation.recorded", { attestationId: attestation.id, reportHash: attestation.reportHash }, "registrum"),
  ]);

  await sleep(DELAY_MS);

  // ─── Step 9: Compute Global State Hash ──────────────────────────────

  stepHeader(9, TOTAL_STEPS, "Compute Global State Hash");

  const ledgerSnapshot = ledger.snapshot();
  const registrumSnapshot = registrar.snapshot();
  const globalState = computeGlobalStateHash(ledgerSnapshot, registrumSnapshot);

  hashLine("ledger hash", globalState.subsystems.ledger);
  hashLine("registrum hash", globalState.subsystems.registrum);
  hashLine("global hash", globalState.hash);
  info("computed at", globalState.computedAt);
  ok("Deterministic state fingerprint — any auditor can replay to the same hash");

  await sleep(DELAY_MS);

  // ─── Step 10: Build Merkle Tree ─────────────────────────────────────

  stepHeader(10, TOTAL_STEPS, "Build Merkle Tree");

  const allEvents = eventStore.readAll();
  // InMemoryEventStore stores HashedStoredEvent at runtime
  const hashedEvents = allEvents.filter(isHashedEvent) as readonly HashedStoredEvent[];
  const eventHashes = hashedEvents.map((e) => e.hash);

  // The attestation EVENT's hash (an envelope hash from the store) has a
  // different preimage than the attestation OBJECT we package as a proof.
  // To make the proof's leaf preimage equal what packageAttestationProof
  // hashes, append the attestation's OWN canonical hash as an explicit leaf.
  const attestationHash = canonicalSha256(attestation);
  const merkleLeaves: readonly string[] = [...eventHashes, attestationHash];

  const tree = MerkleTree.build(merkleLeaves);
  const root = tree.getRoot();

  info("event leaves", `${eventHashes.length} event hashes`);
  info("attestation leaf", "1 (canonical hash of the attestation)");
  info("total leaves", `${tree.getLeafCount()}`);
  if (root !== null) {
    hashLine("merkle root", root);
  }
  ok("Binary SHA-256 hash tree built from event hashes + attestation hash");

  await sleep(DELAY_MS);

  // ─── Step 11: Generate Attestation Proof ────────────────────────────

  stepHeader(11, TOTAL_STEPS, "Generate Attestation Proof");

  // Locate the attestation leaf by IDENTITY (its canonical hash), not by
  // assuming it is the last appended store event. lastIndexOf finds the leaf
  // we explicitly appended above; guarding against -1 keeps this honest if the
  // leaf set ever changes.
  const attestationLeafIndex = merkleLeaves.lastIndexOf(attestationHash);
  // Verified for real in Step 12; surfaced in the Step 14 summary.
  let proofValid = false;
  const proofPkg =
    attestationLeafIndex >= 0
      ? packageAttestationProof(
          attestation,
          merkleLeaves,
          tree,
          attestationLeafIndex,
        )
      : null;

  if (proofPkg !== null) {
    hashLine("attestation hash", proofPkg.attestationHash);
    hashLine("merkle root", proofPkg.merkleRoot);
    info("proof steps", `${proofPkg.inclusionProof.siblings.length} sibling(s)`);
    hashLine("package hash", proofPkg.packageHash);
    ok("Self-contained proof package — verifiable offline by any third party");
  } else {
    warn("Could not generate proof (unexpected null)");
  }

  await sleep(DELAY_MS);

  // ─── Step 12: Verify Proof ──────────────────────────────────────────

  stepHeader(12, TOTAL_STEPS, "Verify Attestation Proof");

  if (proofPkg !== null) {
    // Compute the verdict FIRST, then report each check against actual results.
    proofValid = verifyAttestationProof(proofPkg);

    // Per-check breakdown — each line reflects a real recomputation, mirroring
    // the checks inside verifyAttestationProof (never printed unconditionally).
    const hashMatches = proofPkg.attestationHash === canonicalSha256(proofPkg.attestation);
    const merklePathValid = MerkleTree.verifyProof(proofPkg.inclusionProof);
    const leafIsAttestation = proofPkg.inclusionProof.leafHash === proofPkg.attestationHash;
    const rootConsistent = proofPkg.merkleRoot === proofPkg.inclusionProof.root;

    check("attestation hash", hashMatches);
    check("merkle path", merklePathValid);
    check("leaf == att hash", leafIsAttestation);
    check("root consistency", rootConsistent);

    if (proofValid) {
      ok(chalk.green.bold("PROOF VALID") + " — attestation is cryptographically included in the event tree");
    } else {
      warn("PROOF INVALID — one or more checks failed (see above)");
    }
  } else {
    warn("No proof package to verify");
  }

  await sleep(DELAY_MS);

  // ─── Step 13: Export Event Log ──────────────────────────────────────

  stepHeader(13, TOTAL_STEPS, "Export Event Log (NDJSON)");

  info("format", "application/x-ndjson");
  info("events", `${allEvents.length} total`);
  console.log();
  for (const se of hashedEvents) {
    const line = JSON.stringify({
      type: se.event.type,
      stream: se.streamId,
      hash: se.hash.slice(0, 12) + "...",
    });
    console.log(chalk.gray("    ") + chalk.dim(line));
  }
  ok("Append-only, hash-chained, replayable event stream");

  await sleep(DELAY_MS);

  // ─── Step 14: Summary ───────────────────────────────────────────────

  stepHeader(14, TOTAL_STEPS, "Summary");

  console.log();
  console.log(chalk.white("    Events recorded:     ") + chalk.cyan.bold(String(allEvents.length)));
  console.log(chalk.white("    Intents:             ") + chalk.cyan.bold("1 (declared -> approved -> executed -> verified)"));
  console.log(chalk.white("    Ledger entries:      ") + chalk.cyan.bold("2 (balanced debit + credit)"));
  console.log(chalk.white("    Reconciliation:      ") + chalk.cyan.bold(`${report.summary.matchedCount} matched, ${report.summary.mismatchCount} mismatches`));
  if (root !== null) {
    console.log(chalk.white("    Merkle root:         ") + chalk.yellow(root.slice(0, 16) + "..." + root.slice(-8)));
  }
  console.log(chalk.white("    Global state hash:   ") + chalk.yellow(globalState.hash.slice(0, 16) + "..." + globalState.hash.slice(-8)));
  if (proofPkg !== null) {
    console.log(
      chalk.white("    Proof package:       ") +
        (proofValid ? chalk.green.bold("VALID") : chalk.red.bold("INVALID")),
    );
  } else {
    console.log(chalk.white("    Proof package:       ") + chalk.red.bold("NOT GENERATED"));
  }

  console.log();
  console.log(chalk.gray("    Every financial event is append-only, hash-chained,"));
  console.log(chalk.gray("    and externally verifiable."));
  console.log();
  console.log(chalk.cyan.bold("    AI can advise. Humans decide."));
  console.log();
}

run().catch((err: unknown) => {
  console.error(chalk.red("\n  Demo failed:"), err);
  process.exit(1);
});
