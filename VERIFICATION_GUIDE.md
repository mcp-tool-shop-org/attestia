# Attestia — Auditor Verification Guide

Step-by-step guide for an independent auditor to verify Attestia's state integrity.

---

## Prerequisites

- Node.js 20+
- A running Attestia node (or the exported artifacts)
- `curl` or equivalent HTTP client

---

## Step 1: Export Events

Download the complete event log as NDJSON:

```bash
curl -H "X-Api-Key: YOUR_KEY" \
  http://localhost:3000/api/v1/export/events \
  -o events.ndjson
```

Each line is a JSON object with `{ event, streamId, version, globalPosition, appendedAt, hash, previousHash }`.

---

## Step 2: Export State Snapshot

Download the current state snapshot with GlobalStateHash:

```bash
curl -H "X-Api-Key: YOUR_KEY" \
  http://localhost:3000/api/v1/export/state \
  -o state.json
```

Response contains:
- `data.ledgerSnapshot` — all accounts and entries
- `data.registrumSnapshot` — all structural states and lineage
- `data.globalStateHash` — combined SHA-256 with per-subsystem hashes

---

## Step 3: Verify Hash Chain

Check that no events have been inserted, removed, or modified:

1. Parse each line of `events.ndjson`
2. For each event with a `hash` field:
   - Compute `SHA-256(canonicalize(event) + previousHash)`
   - Compare to the stored `hash`
   - The first event's `previousHash` should be `"genesis"`
3. Any mismatch indicates tampering

The system performs this automatically on startup via `verifyIntegrity()`.

---

## Step 4: Replay Verification

Independently re-derive the state and compare it to what the bundle claims.

The bundle's `globalStateHash` folds together three subsystems — `ledger`, `registrum`, and `chains`. The ledger and registrum hashes are fully reproducible by replaying their snapshots. The **chain hashes are not** — they are derived from on-chain observation data and cannot be recomputed without RPC access. So the global hash must be recomputed from the *replayed* ledger + registrum snapshots **plus the bundle's own `chainHashes`** — never by comparing a replay-only hash directly against `globalStateHash.hash` (on any chain-observing node that comparison fails spuriously, because replay alone omits the chain component).

The canonical, one-call way to do this correctly is `runVerification()`, which handles each subsystem with the right inputs (replayed ledger/registrum, bundle chain hashes) and returns a single verdict plus a per-subsystem breakdown:

```typescript
import { runVerification } from "@attestia/verify";

// `bundle` is the parsed export from GET /api/v1/export/state
const report = runVerification(bundle, { verifierId: "auditor-1" });

console.log(report.verdict);          // "PASS" or "FAIL"
console.log(report.subsystemChecks);  // ledger / registrum / global / chain:* breakdown
console.log(report.discrepancies);    // human-readable reasons on FAIL
```

Internally, `runVerification`:

1. Verifies bundle integrity (the bundle's own hashes are self-consistent).
2. Replays the ledger and registrum from their snapshots via `verifyByReplay()` — **without** passing `expectedHash`, since the per-subsystem and global comparisons are done explicitly in the following steps.
3. Recomputes each subsystem hash and compares it to the bundle's claim.
4. Recomputes the GlobalStateHash from the replayed snapshots **plus `bundle.chainHashes`** (RFC 8785 + SHA-256) and compares it to `globalStateHash.hash`.

If the verdict is `PASS`, the state is proven lossless and deterministic.

If you only need to confirm the **ledger + registrum** replay in isolation (e.g. a node with no chain observers), call `verifyByReplay()` directly — but do **not** pass the global hash as `expectedHash`, because it includes the chain component that replay cannot reproduce:

```typescript
import { verifyByReplay } from "@attestia/verify";

const result = verifyByReplay({
  ledgerSnapshot: bundle.ledgerSnapshot,
  registrumSnapshot: bundle.registrumSnapshot,
  // no expectedHash — global comparison belongs to runVerification() (Step 4 above)
});

console.log(result.verdict); // "PASS" or "FAIL"
```

---

## Step 5: Cross-Reference Audit Log

Query the audit log for all actions taken:

```bash
curl -H "X-Api-Key: YOUR_KEY" \
  http://localhost:3000/api/v1/attestations
```

Each attestation record contains:
- `reportHash` — SHA-256 of the reconciliation report
- `attestedAt` — timestamp of attestation
- `witnessRecord` — XRPL transaction details (if witness was available)

---

## Step 6: Verify On-Chain Witness Records

For each attestation with a `witnessRecord`:

1. Look up the XRPL transaction hash on the XRPL ledger
2. Decode the memo field (hex → UTF-8 JSON)
3. Compare the `reportHash` in the memo to the attestation's `reportHash`
4. Verify the transaction was signed by the expected witness account

---

## Verification Checklist

- [ ] Event hash chain is valid (no breaks, no gaps)
- [ ] GlobalStateHash matches after replay
- [ ] Ledger subsystem hash matches independently
- [ ] Registrum subsystem hash matches independently
- [ ] Attestation report hashes are consistent
- [ ] XRPL witness records match attestation records
- [ ] Audit log entries correspond to API actions
- [ ] No events exist after the snapshot timestamp (state is current)

---

## Automated Verification

Run the full test suite to verify all invariants programmatically:

```bash
pnpm test        # 2,564 tests
pnpm bench       # Performance within baselines
```

The `payroll-lifecycle.test.ts` performs an end-to-end verification of the complete flow.
