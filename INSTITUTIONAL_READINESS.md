# Attestia — Institutional Readiness Checklist

What an institution should verify before adopting Attestia for production financial operations.

---

## Purpose

This checklist helps organizations evaluate whether Attestia meets their requirements for production deployment. It covers security, operational maturity, governance, and compliance considerations.

---

## 1. Security Audit

| Item | Status | Notes |
|------|--------|-------|
| External security audit completed | Pending | No third-party audit performed yet |
| STRIDE threat model published | Done | See `THREAT_MODEL.md` |
| Control matrix published | Done | See `CONTROL_MATRIX.md` |
| Responsible disclosure policy | Done | See `SECURITY.md` |
| Dependency supply chain review | Pending | Core packages have zero runtime deps; chain-observer uses viem, xrpl.js |

### Recommendation

Commission an external security audit before deploying with real financial data. The threat model and control matrix provide a starting point for auditors.

---

## 2. Test Coverage

| Item | Status | Notes |
|------|--------|-------|
| Unit test coverage ≥95% (core packages) | Done | 1,928 tests across 14 packages |
| Property-based tests for hash chain | Done | fast-check in event-store |
| End-to-end lifecycle test | Done | Pilot use case covers declare→attest |
| Edge case coverage | Done | 33 dedicated edge case tests |
| Performance baselines | Done | See `PERFORMANCE_BASELINE.md` |
| CI regression gate | Done | >20% regression blocks merge |

---

## 3. Operational Readiness

| Item | Status | Notes |
|------|--------|-------|
| Health endpoints (`/health`, `/ready`) | Done | Deep health checks per subsystem |
| Prometheus metrics | Done | Business + HTTP metrics exposed at `/metrics` |
| Alerting rules | Done | See `packages/node/alerts/attestia-alerts.yml` |
| Startup integrity verification | Done | Hash chain + snapshot verified before accepting requests |
| Graceful degradation (witness) | Done | XRPL witness failures do not block operations |
| Event export for offline audit | Done | NDJSON + state snapshot endpoints |
| Upgrade guide | Done | See `UPGRADE_GUIDE.md` |
| Docker Compose deployment | Done | Single-node reference deployment |

---

## 4. Formal Specifications

| Item | Status | Notes |
|------|--------|-------|
| Deterministic event model (RFC-001) | Draft | `specs/RFC-001-DETERMINISTIC-EVENT-MODEL.md` |
| Proof-of-reconciliation (RFC-002) | Draft | `specs/RFC-002-PROOF-OF-RECONCILIATION.md` |
| Intent control standard (RFC-003) | Draft | `specs/RFC-003-INTENT-CONTROL-STANDARD.md` |
| GlobalStateHash (RFC-004) | Draft | `specs/RFC-004-GLOBAL-STATE-HASH.md` |
| Witness protocol (RFC-005) | Draft | `specs/RFC-005-WITNESS-PROTOCOL.md` |
| Shared definitions | Draft | `specs/DEFINITIONS.md` |

### Recommendation

RFCs are in Draft status. Institutions should treat the specification as stable for evaluation purposes but monitor for changes during the Review → Final process. See `packages/registrum/docs/governance/RFC_PROCESS.md` for the RFC lifecycle.

---

## 5. Governance

| Item | Status | Notes |
|------|--------|-------|
| Change class taxonomy | Done | Class A/B/C in `CHANGE_CLASSES.md` |
| Formal RFC process | Done | See `RFC_PROCESS.md` |
| Governance proposals | Done | 3 proposals documented (001, 002, 003) |
| Version upgrade discipline | Done | Semantic versioning; breaking changes require Class C |
| Event schema freeze policy | Planned | Schema versioning per RFC-001 Section 3 |

---

## 6. Compliance Considerations

| Item | Status | Notes |
|------|--------|-------|
| Deterministic replay | Done | GlobalStateHash proves lossless state reconstruction |
| Tamper-evident event log | Done | SHA-256 hash chain; any modification detectable |
| Independent verification | Done | Auditor can replay events and compare hashes |
| On-chain attestation | Done | XRPL witness provides immutable timestamp proof |
| Data export | Done | NDJSON events + JSON state snapshot |
| Audit trail | Done | Append-only in-memory audit log |

### What Attestia Does NOT Provide

- **Regulatory compliance certification** — Attestia provides the technical controls; compliance determination requires legal review specific to your jurisdiction.
- **Data encryption at rest** — Event files are plaintext JSONL. Deploy on encrypted volumes if required.
- **User authentication** — Attestia authenticates API keys and JWTs but does not manage user identity. Integrate with your identity provider.
- **Smart contract auditing** — Attestia observes on-chain state but does not audit contract code.

---

## 7. Deployment Checklist

Before going live:

- [ ] External security audit completed (or risk accepted with documented rationale)
- [ ] Deployment environment uses encrypted storage for event files
- [ ] API keys rotated and stored in secrets manager
- [ ] XRPL witness wallet funded and keys secured
- [ ] Prometheus monitoring connected with alerting rules active
- [ ] Backup strategy for event store files documented
- [ ] Incident response plan includes Attestia subsystems
- [ ] Upgrade procedure tested in staging environment
- [ ] Export endpoints tested with auditor tooling
- [ ] Rate limiting configured for production traffic

---

## 8. Known Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| No database backend | Single-node scaling only | Sufficient for small-to-medium orgs; database adapter planned |
| In-memory audit log | Lost on restart | Event store provides durable audit trail; in-memory log supplements |
| Single XRPL witness chain | Vendor concentration | Multi-chain witness planned (Phase 12) |
| No UI | Operator must use API | Dashboard planned (Phase 13) |
| RFC specs in Draft | May change before Final | Monitor RFC process; breaking changes follow governance |

---

## 9. Support and Community

| Resource | Location |
|----------|----------|
| Source code | `github.com/mcp-tool-shop-org/Attestia` |
| Issue tracker | GitHub Issues |
| Security reports | See `SECURITY.md` |
| Documentation | `HANDBOOK.md`, `INTEGRATION_GUIDE.md`, `VERIFICATION_GUIDE.md` |
| Architecture | `ARCHITECTURE.md`, `REFERENCE_ARCHITECTURE.md` |

---

*This checklist reflects Attestia's current state. Items marked "Pending" or "Planned" represent known gaps that are tracked in the roadmap.*
