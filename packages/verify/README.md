<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/Attestia/main/assets/logo.png" alt="Attestia" width="200"></p>

# @attestia/verify

> Part of [Attestia](https://github.com/mcp-tool-shop-org/Attestia) — proves an event, a transaction, or a state transition happened. The domain it ships is financial truth.

**Deterministic replay verification, GlobalStateHash computation, compliance evidence generation, SLA enforcement, and tenant governance.**

[![npm version](https://img.shields.io/npm/v/@attestia/verify)](https://www.npmjs.com/package/@attestia/verify)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

---

## At a Glance

- Computes a content-addressed **GlobalStateHash** from ledger and registrum snapshots (SHA-256 + RFC 8785)
- **Replay verification** proves persistence is lossless by restoring snapshots and comparing hashes
- Quick `verifyHash()` path for fast checks without full replay
- **Multi-chain replay audit** with per-chain hash chains and combined cross-chain verification
- **Cross-chain invariant checks**: asset conservation, duplicate settlement detection, event ordering, governance consistency
- **Compliance evidence** generation for SOC 2 and ISO 27001 frameworks with per-control scoring
- **SLA evaluation engine** with configurable policies, thresholds, and multi-SLA batch evaluation
- **Tenant governance**: create policies, suspend/reactivate tenants, assign SLA policies
- Multi-verifier **consensus** aggregation for external verification networks
- 200 tests

## Installation

```bash
npm install @attestia/verify
```

## Usage

### Compute a GlobalStateHash

```typescript
import { computeGlobalStateHash } from "@attestia/verify";

const globalState = computeGlobalStateHash(ledgerSnapshot, registrumSnapshot);
console.log(globalState.hash);          // SHA-256 hex string
console.log(globalState.subsystems);    // { ledger: "...", registrum: "..." }
```

### Replay Verification

```typescript
import { verifyByReplay } from "@attestia/verify";

const result = verifyByReplay({
  ledgerSnapshot,
  registrumSnapshot,
  expectedHash: "abc123...",
});

console.log(result.verdict);        // "PASS" | "FAIL"
console.log(result.discrepancies);  // [] when PASS
```

### Quick Hash Verification (No Replay)

```typescript
import { verifyHash } from "@attestia/verify";

const result = verifyHash(
  { ledgerSnapshot, registrumSnapshot },
  expectedHash,
);
// result.verdict === "PASS" if hash matches
```

### Compliance Evidence

```typescript
import {
  generateComplianceEvidence,
  SOC2_FRAMEWORK,
  SOC2_MAPPINGS,
} from "@attestia/verify";

const report = generateComplianceEvidence(SOC2_MAPPINGS, SOC2_FRAMEWORK, bundle);
console.log(report.score);           // 0-100
console.log(report.passedControls);  // number of controls passing
```

### SLA Evaluation

```typescript
import { evaluateSla } from "@attestia/verify";

const evaluation = evaluateSla(slaPolicy, currentMetrics);
console.log(evaluation.verdict);  // "COMPLIANT" | "BREACHED" | "AT_RISK"
```

### Tenant Governance

```typescript
import {
  createTenantGovernancePolicy,
  suspendTenant,
  assignSlaPolicy,
} from "@attestia/verify";

const policy = createTenantGovernancePolicy("tenant-1", { maxIntentsPerDay: 1000 });
const suspended = suspendTenant(policy, "Policy violation");
const withSla = assignSlaPolicy(policy, slaPolicy);
```

## API

### Core Verification

| Export | Description |
|---|---|
| `computeGlobalStateHash()` | Combine subsystem snapshots into a single content-addressed hash |
| `hashLedgerSnapshot()` | SHA-256 hash of a canonical ledger snapshot |
| `hashRegistrumSnapshot()` | SHA-256 hash of a canonical registrum snapshot |
| `verifyByReplay()` | Full replay-based verification with discrepancy reporting |
| `verifyHash()` | Quick hash comparison without replay |

### Multi-Chain and Cross-Chain

| Export | Description |
|---|---|
| `auditMultiChainReplay()` | Replay audit across multiple chains |
| `computeChainHashChain()` | Per-chain hash chain computation |
| `auditCrossChainInvariants()` | Run all cross-chain invariant checks |
| `checkAssetConservation()` | Verify no assets created or destroyed in transit |
| `checkNoDuplicateSettlement()` | Detect duplicate settlement events |

### Compliance and SLA

| Export | Description |
|---|---|
| `generateComplianceEvidence()` | Evaluate controls against system state |
| `SOC2_FRAMEWORK` / `SOC2_MAPPINGS` | SOC 2 framework definition and control mappings |
| `ISO27001_FRAMEWORK` / `ISO27001_MAPPINGS` | ISO 27001 framework definition and control mappings |
| `evaluateSla()` / `evaluateMultipleSla()` | Evaluate SLA policies against metrics |
| `createTenantGovernancePolicy()` | Create tenant governance policies |
| `suspendTenant()` / `reactivateTenant()` | Tenant lifecycle management |

### External Verification

| Export | Description |
|---|---|
| `createStateBundle()` | Package system state for external verification |
| `verifyBundleIntegrity()` | Verify an exported state bundle |
| `VerifierNode` / `runVerification()` | Run verification as an external node |
| `aggregateVerifierReports()` | Aggregate reports from multiple verifiers |
| `isConsensusReached()` | Check if multi-verifier consensus is met |

## Ecosystem

This package is part of the Attestia monorepo with 13 sister packages:

`@attestia/types` | `@attestia/ledger` | `@attestia/registrum` | `@attestia/vault` | `@attestia/treasury` | `@attestia/event-store` | `@attestia/proof` | `@attestia/reconciler` | `@attestia/chain-observer` | `@attestia/witness` | `@attestia/sdk` | `@attestia/node` | `@attestia/demo`

## Docs

| Document | Description |
|---|---|
| [Architecture](../../docs/architecture.md) | System architecture overview |
| [API Reference](../../docs/api.md) | Full API documentation |
| [Verification Deep Dive](../../docs/verification.md) | How replay verification works |

## License

[MIT](../../LICENSE)
