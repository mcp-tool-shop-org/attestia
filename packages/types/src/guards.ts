/**
 * Runtime Type Guards
 *
 * Narrowing functions for Attestia domain types.
 * These enable safe runtime validation at system boundaries
 * (API inputs, deserialized data, external integrations).
 */

import type { Money, AccountRef, LedgerEntry, LedgerEntryType } from "./financial.js";
import type { Intent, IntentStatus } from "./intent.js";
import type { DomainEvent, EventMetadata } from "./event.js";
import type { ChainRef, BlockRef, TokenRef, OnChainEvent } from "./chain.js";
import type { SolanaOnChainEvent } from "./solana.js";

// =============================================================================
// Financial guards
// =============================================================================

const ACCOUNT_TYPES = new Set(["asset", "liability", "income", "expense", "equity"]);
const ENTRY_TYPES = new Set<string>(["debit", "credit"]);

/**
 * Canonical decimal numeral.
 *
 * Money.amount is a string (to dodge IEEE-754 error), but it must still be a
 * well-formed decimal. This anchored pattern accepts only:
 *   - an optional leading minus
 *   - one or more integer digits (no leading-dot, no separators)
 *   - an optional fractional part with at least one digit
 *
 * It rejects empty strings, whitespace, "NaN"/"Infinity", exponential
 * notation, multiple dots, thousands separators, hex, and signs other than a
 * single leading "-". This is the fail-closed boundary check: a string that is
 * not a real number must never narrow to Money.
 */
const CANONICAL_AMOUNT = /^-?\d+(\.\d+)?$/;

export function isMoney(value: unknown): value is Money {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.amount === "string" &&
    CANONICAL_AMOUNT.test(v.amount) &&
    typeof v.currency === "string" &&
    typeof v.decimals === "number" &&
    Number.isInteger(v.decimals) &&
    v.decimals >= 0
  );
}

export function isAccountRef(value: unknown): value is AccountRef {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.type === "string" &&
    ACCOUNT_TYPES.has(v.type) &&
    typeof v.name === "string"
  );
}

export function isLedgerEntryType(value: unknown): value is LedgerEntryType {
  return typeof value === "string" && ENTRY_TYPES.has(value);
}

export function isLedgerEntry(value: unknown): value is LedgerEntry {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.accountId === "string" &&
    isLedgerEntryType(v.type) &&
    isMoney(v.money) &&
    typeof v.timestamp === "string" &&
    typeof v.correlationId === "string" &&
    (v.intentId === undefined || typeof v.intentId === "string") &&
    (v.txHash === undefined || typeof v.txHash === "string")
  );
}

// =============================================================================
// Intent guards
// =============================================================================

const INTENT_STATUSES = new Set<string>([
  "declared", "approved", "rejected", "executing", "executed", "verified", "failed",
]);

export function isIntentStatus(value: unknown): value is IntentStatus {
  return typeof value === "string" && INTENT_STATUSES.has(value);
}

export function isIntent(value: unknown): value is Intent {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    isIntentStatus(v.status) &&
    typeof v.kind === "string" &&
    typeof v.description === "string" &&
    typeof v.declaredBy === "string" &&
    typeof v.declaredAt === "string" &&
    v.params !== null &&
    typeof v.params === "object"
  );
}

// =============================================================================
// Event guards
// =============================================================================

const EVENT_SOURCES = new Set<string>(["vault", "treasury", "registrum", "observer"]);

export function isEventMetadata(value: unknown): value is EventMetadata {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.eventId === "string" &&
    typeof v.timestamp === "string" &&
    typeof v.actor === "string" &&
    typeof v.correlationId === "string" &&
    typeof v.source === "string" &&
    EVENT_SOURCES.has(v.source)
  );
}

export function isDomainEvent(value: unknown): value is DomainEvent {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.type === "string" &&
    isEventMetadata(v.metadata) &&
    v.payload !== null &&
    typeof v.payload === "object"
  );
}

// =============================================================================
// Chain guards
// =============================================================================

export function isChainRef(value: unknown): value is ChainRef {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.chainId === "string" &&
    typeof v.name === "string" &&
    typeof v.family === "string"
  );
}

export function isBlockRef(value: unknown): value is BlockRef {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.chainId === "string" &&
    typeof v.blockNumber === "number" &&
    Number.isInteger(v.blockNumber) &&
    typeof v.blockHash === "string" &&
    typeof v.timestamp === "string"
  );
}

export function isTokenRef(value: unknown): value is TokenRef {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.chainId === "string" &&
    typeof v.address === "string" &&
    typeof v.symbol === "string" &&
    typeof v.decimals === "number" &&
    Number.isInteger(v.decimals) &&
    v.decimals >= 0
  );
}

export function isOnChainEvent(value: unknown): value is OnChainEvent {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.chainId === "string" &&
    typeof v.txHash === "string" &&
    isBlockRef(v.block) &&
    typeof v.eventType === "string" &&
    v.data !== null &&
    typeof v.data === "object" &&
    typeof v.observedAt === "string"
  );
}

// =============================================================================
// Solana chain guards
// =============================================================================

/**
 * Check if a value is a SolanaOnChainEvent.
 *
 * A SolanaOnChainEvent is an OnChainEvent with additional Solana-specific
 * fields: slot, programId, accountKeys, signature.
 */
export function isSolanaOnChainEvent(value: unknown): value is SolanaOnChainEvent {
  if (!isOnChainEvent(value)) return false;
  const v = value as unknown as Record<string, unknown>;
  return (
    typeof v.slot === "number" &&
    Number.isInteger(v.slot) &&
    typeof v.programId === "string" &&
    Array.isArray(v.accountKeys) &&
    (v.accountKeys as unknown[]).every((k) => typeof k === "string") &&
    typeof v.signature === "string"
  );
}
