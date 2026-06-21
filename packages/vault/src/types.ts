/**
 * Vault Types
 *
 * Domain types for the Personal Vault.
 * The vault operates three subsystems:
 *
 * 1. Portfolio — observe multi-chain balances and token positions
 * 2. Budget — envelope-based allocation (inspired by NextLedger)
 * 3. Intents — declare, approve, execute, verify financial actions
 *
 * Rules:
 * - All types are readonly (immutability by default)
 * - Amounts are strings (deterministic arithmetic)
 * - Every mutation flows through the intent lifecycle
 */

import type {
  Money,
  Currency,
  ChainId,
  TxHash,
  IntentStatus,
} from "@attestia/types";

// =============================================================================
// Portfolio — Multi-chain observation
// =============================================================================

/**
 * A token position observed on a specific chain.
 */
export interface TokenPosition {
  readonly chainId: ChainId;
  readonly address: string;
  readonly symbol: string;
  readonly balance: string;
  readonly decimals: number;
  /** ERC-20 contract address (EVM) or currency:issuer (XRPL) */
  readonly token?: string;
  readonly observedAt: string;
}

/**
 * A single per-address/per-chain failure encountered while observing.
 *
 * Surfacing these (rather than silently dropping them) is what makes
 * {@link Portfolio.partial} actionable: the caller learns WHICH chain/address
 * is missing and WHY, instead of seeing an authoritative-looking total that
 * silently omits unreachable chains.
 */
export interface ObservationError {
  /** Chain the failure occurred on (e.g. "eip155:1"). */
  readonly chainId: ChainId;
  /** Address being observed when the failure occurred (omitted for chain-level failures). */
  readonly address?: string;
  /** Reason the observation failed (no-observer, RPC error, etc.). */
  readonly reason: string;
}

/**
 * An aggregated portfolio view across all observed chains.
 */
export interface Portfolio {
  /** The vault owner's identity */
  readonly ownerId: string;

  /** Native token positions (ETH, XRP, etc.) */
  readonly nativePositions: readonly TokenPosition[];

  /** Token positions (ERC-20, trust lines, etc.) */
  readonly tokenPositions: readonly TokenPosition[];

  /** When this snapshot was taken */
  readonly observedAt: string;

  /** Total value per currency (aggregated across chains) */
  readonly totals: readonly CurrencyTotal[];

  /**
   * Per-address/per-chain failures collected during observation. Empty when
   * every watched address was reached. When non-empty the totals are computed
   * from a SUBSET of chains — see {@link partial}.
   */
  readonly errors: readonly ObservationError[];

  /**
   * True when one or more watched addresses could not be observed, so `totals`
   * reflect only the chains that responded. A caller MUST treat a partial
   * portfolio as incomplete (fail-soft but visible) rather than authoritative.
   */
  readonly partial: boolean;
}

/**
 * Total balance for a single currency across all chains.
 */
export interface CurrencyTotal {
  readonly currency: Currency;
  readonly totalBalance: string;
  readonly decimals: number;
  readonly chainCount: number;
}

// =============================================================================
// Budget — Envelope-based allocation
// =============================================================================

/**
 * A budget envelope — a named allocation of funds for a purpose.
 *
 * Evolved from NextLedger's envelope budgeting concept.
 * Each envelope tracks:
 * - How much is allocated (budgeted)
 * - How much has been spent (consumed via intents)
 * - What remains available
 */
export interface Envelope {
  /** Unique envelope identifier */
  readonly id: string;

  /** Human-readable name (e.g., "Rent", "Savings", "DCA: ETH") */
  readonly name: string;

  /** Which currency this envelope is denominated in */
  readonly currency: Currency;

  /** Number of decimals for this currency */
  readonly decimals: number;

  /** Total amount allocated to this envelope */
  readonly allocated: string;

  /** Total amount consumed (executed intents) */
  readonly spent: string;

  /** Remaining available = allocated - spent */
  readonly available: string;

  /** Optional category for grouping */
  readonly category?: string;

  /** When this envelope was created */
  readonly createdAt: string;
}

/**
 * A request to allocate funds to an envelope.
 */
export interface AllocationRequest {
  readonly envelopeId: string;
  readonly amount: Money;
  readonly reason: string;
}

/**
 * Result of a budget operation.
 */
export interface BudgetSnapshot {
  readonly ownerId: string;
  readonly envelopes: readonly Envelope[];
  readonly totalAllocated: string;
  readonly totalSpent: string;
  readonly totalAvailable: string;
  readonly currency: Currency;
  readonly asOf: string;
}

// =============================================================================
// Vault Intents — Intent lifecycle scoped to the personal vault
// =============================================================================

/** Kinds of intents the vault can originate */
export type VaultIntentKind =
  | "transfer"          // Send funds to another address
  | "swap"              // Trade one token for another
  | "allocate"          // Allocate funds to an envelope
  | "deallocate"        // Return funds from an envelope
  | "bridge"            // Move funds between chains
  | "stake"             // Stake tokens
  | "unstake";          // Unstake tokens

/**
 * A vault-specific intent with typed parameters.
 */
export interface VaultIntent {
  readonly id: string;
  readonly status: IntentStatus;
  readonly kind: VaultIntentKind;
  readonly description: string;
  readonly declaredBy: string;
  readonly declaredAt: string;
  readonly params: VaultIntentParams;

  /** Envelope this intent draws from (if applicable) */
  readonly envelopeId?: string;

  /** Approval record (populated after approval) */
  readonly approval?: VaultIntentApproval;

  /** Execution record (populated after execution) */
  readonly execution?: VaultIntentExecution;

  /** Verification record (populated after verification) */
  readonly verification?: VaultIntentVerification;
}

/**
 * Typed parameters for vault intents.
 */
export interface VaultIntentParams {
  /** Source chain */
  readonly fromChainId?: ChainId;
  /** Destination chain */
  readonly toChainId?: ChainId;
  /** Source address */
  readonly fromAddress?: string;
  /** Destination address */
  readonly toAddress?: string;
  /** Amount to transfer/swap/allocate */
  readonly amount?: Money;
  /** Token to receive (for swaps) */
  readonly receiveToken?: string;
  /** Additional parameters */
  readonly extra?: Readonly<Record<string, unknown>>;
}

export interface VaultIntentApproval {
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly approved: boolean;
  readonly reason?: string;
}

export interface VaultIntentExecution {
  readonly executedAt: string;
  readonly chainId: ChainId;
  readonly txHash: TxHash;
}

export interface VaultIntentVerification {
  readonly verifiedAt: string;
  readonly matched: boolean;
  readonly discrepancies?: readonly string[];
}

// =============================================================================
// Vault Configuration
// =============================================================================

/**
 * Configuration for a wallet address watched by the vault.
 */
export interface WatchedAddress {
  readonly chainId: ChainId;
  readonly address: string;
  readonly label?: string;
}

/**
 * Top-level vault configuration.
 */
export interface VaultConfig {
  /** Vault owner identifier */
  readonly ownerId: string;

  /** Addresses to watch across chains */
  readonly watchedAddresses: readonly WatchedAddress[];

  /** Default currency for budget envelopes */
  readonly defaultCurrency: Currency;

  /** Default decimals for the default currency */
  readonly defaultDecimals: number;
}

// =============================================================================
// Vault Snapshot — Serialization
// =============================================================================

/**
 * Complete vault state for persistence.
 */
export interface VaultSnapshot {
  readonly version: 1;
  readonly config: VaultConfig;
  readonly envelopes: readonly Envelope[];
  readonly intents: readonly VaultIntent[];
  readonly savedAt: string;
}
