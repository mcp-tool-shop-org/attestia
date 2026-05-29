import type { SiteConfig } from '@mcptoolshop/site-theme';

export const config: SiteConfig = {
  title: 'Attestia',
  description: 'Financial truth infrastructure for the decentralized world.',
  logoBadge: 'A',
  brandName: 'Attestia',
  repoUrl: 'https://github.com/mcp-tool-shop-org/Attestia',
  footerText: 'MIT Licensed — built by <a href="https://github.com/mcp-tool-shop-org" style="color:var(--color-muted);text-decoration:underline">mcp-tool-shop-org</a>',

  hero: {
    badge: '14 packages · 1,928 tests · 96.8% coverage',
    headline: 'Attestia',
    headlineAccent: 'financial truth infrastructure.',
    description: 'Structural governance, deterministic accounting, and human-approved intent — unified across chains, organizations, and individuals. We don\'t move your money. We prove what happened.',
    primaryCta: { href: '#architecture', label: 'See architecture' },
    secondaryCta: { href: 'handbook/', label: 'Read the Handbook' },
    previews: [
      { label: 'Flow', code: 'Intent → Approve → Execute → Verify' },
      { label: 'Test', code: 'pnpm test  # 1,928 tests, all green' },
      { label: 'Attest', code: 'XRPL witnesses. Ethereum settles.' },
    ],
  },

  sections: [
    {
      kind: 'features',
      id: 'architecture',
      title: 'Three Systems, One Truth',
      subtitle: 'Every interaction follows: Intent → Approve → Execute → Verify. No step is optional.',
      features: [
        { title: 'Personal Vault', desc: 'Multi-chain portfolio observation, envelope budgeting, and intent declaration. Evolved from NextLedger.' },
        { title: 'Org Treasury', desc: 'Deterministic payroll, DAO distributions, dual-gate funding, and double-entry ledger. Evolved from Payroll Engine.' },
        { title: 'Registrum', desc: 'Structural registrar — 11 invariants, dual-witness validation, XRPL attestation. The constitutional layer.' },
      ],
    },
    {
      kind: 'data-table',
      id: 'principles',
      title: 'Principles',
      subtitle: 'These are not aspirational. They are enforced in code.',
      columns: ['Principle', 'Implementation'],
      rows: [
        ['Append-only records', 'No UPDATE, no DELETE — only new entries'],
        ['Fail-closed', 'Disagreement halts the system, never heals silently'],
        ['Deterministic replay', 'Same events produce the same state, always'],
        ['Advisory AI only', 'AI can analyze, warn, suggest — never approve, sign, or execute'],
        ['Multi-chain observation', 'Ethereum, XRPL, Solana, L2s — chain-agnostic read layer'],
        ['Structural identity', 'Explicit, immutable, unique — constitutional, not biometric'],
      ],
    },
    {
      kind: 'data-table',
      id: 'packages',
      title: 'Packages',
      subtitle: '14 packages, all tested, all typed.',
      columns: ['Package', 'Tests', 'Purpose'],
      rows: [
        ['@attestia/types', '62', 'Shared domain types (zero deps)'],
        ['@attestia/registrum', '298', 'Constitutional governance — 11 invariants, dual-witness'],
        ['@attestia/ledger', '144', 'Append-only double-entry engine'],
        ['@attestia/chain-observer', '251', 'Multi-chain read-only observation (EVM + XRPL + Solana + L2s)'],
        ['@attestia/vault', '67', 'Personal vault — portfolios, budgets, intents'],
        ['@attestia/treasury', '63', 'Org treasury — payroll, distributions, funding gates'],
        ['@attestia/reconciler', '57', '3D cross-system matching + Registrum attestation'],
        ['@attestia/witness', '258', 'XRPL on-chain attestation, multi-sig governance, retry'],
        ['@attestia/verify', '203', 'Replay verification, compliance evidence, SLA enforcement'],
        ['@attestia/event-store', '197', 'Append-only event persistence, JSONL, hash chain, 32 event types'],
        ['@attestia/proof', '57', 'Merkle trees, inclusion proofs, attestation proof packaging'],
        ['@attestia/sdk', '73', 'Typed HTTP client SDK for external consumers'],
        ['@attestia/node', '198', 'Hono REST API — 34 endpoints, auth, multi-tenancy'],
      ],
    },
    {
      kind: 'code-cards',
      id: 'development',
      title: 'Development',
      cards: [
        { title: 'Build & test', code: `pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (1,928)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages` },
        { title: 'XRPL integration', code: `docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness \\
  run test:integration            # On-chain round-trip tests
docker compose down               # Stop rippled` },
      ],
    },
    {
      kind: 'features',
      id: 'docs',
      title: 'Documentation',
      features: [
        { title: 'Handbook & Architecture', desc: 'Executive overview, package graph, data flows, security model, and 5-layer reference architecture.' },
        { title: 'Integration & Verification', desc: 'API integration with curl examples, SDK usage, and auditor step-by-step replay guide.' },
        { title: 'Security & Compliance', desc: 'STRIDE threat model, control matrix with threat→control→file→test mappings, and responsible disclosure.' },
      ],
    },
  ],
};
