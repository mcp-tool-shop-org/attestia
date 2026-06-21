/**
 * @attestia/vault — Personal Vault.
 *
 * Multi-chain portfolio observation, envelope budgeting,
 * and intent-based allocation with human approval.
 *
 * Three subsystems:
 * - Observe: Multi-chain portfolio via @attestia/chain-observer
 * - Budget: Envelope-based allocation via @attestia/ledger math
 * - Intents: Intent → Approve → Execute → Verify lifecycle
 *
 * Design rules:
 * - Every financial action is an intent (no direct mutations)
 * - Humans approve; machines verify
 * - All state is snapshot-able and restorable
 * - Read-only chain observation (no signing from the vault)
 */

// Top-level vault
export { Vault, VaultError, CURRENT_VAULT_SNAPSHOT_VERSION } from "./vault.js";
export type { VaultErrorCode } from "./vault.js";

// Subsystems
export { BudgetEngine, BudgetError } from "./budget.js";
export type { BudgetErrorCode } from "./budget.js";
export { IntentManager, IntentError } from "./intent-manager.js";
export type { IntentErrorCode } from "./intent-manager.js";
export { PortfolioObserver } from "./portfolio.js";

// Types
export type {
  TokenPosition,
  Portfolio,
  ObservationError,
  CurrencyTotal,
  Envelope,
  AllocationRequest,
  BudgetSnapshot,
  VaultIntentKind,
  VaultIntent,
  VaultIntentParams,
  VaultIntentApproval,
  VaultIntentExecution,
  VaultIntentVerification,
  WatchedAddress,
  VaultConfig,
  VaultSnapshot,
} from "./types.js";
