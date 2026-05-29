/**
 * Ledger ↔ Chain Matcher
 *
 * Matches ledger entries to on-chain transfer events using txHash.
 *
 * Detects:
 * - Ledger entries with txHash but no matching on-chain event
 * - On-chain events with no matching ledger entry
 * - Amount mismatches between ledger and chain
 */

import { parseAmount, formatAmount } from "@attestia/ledger";
import { preventDoubleCounting } from "./cross-chain-rules.js";
import { makeDiscrepancy } from "./discrepancy.js";
import type { Discrepancy } from "./discrepancy.js";
import type { CrossChainEvent } from "./cross-chain-rules.js";
import type {
  LedgerChainMatch,
  ReconcilableLedgerEntry,
  ReconcilableChainEvent,
} from "./types.js";

export class LedgerChainMatcher {
  /**
   * Match ledger entries against on-chain events.
   *
   * Strategy:
   * 1. Index chain events by txHash
   * 2. For each ledger entry with a txHash, find the matching chain event
   * 3. Compare amounts (converting chain amounts from raw to same decimal basis)
   * 4. Report mismatches and orphans
   */
  match(
    ledgerEntries: readonly ReconcilableLedgerEntry[],
    chainEvents: readonly ReconcilableChainEvent[],
  ): readonly LedgerChainMatch[] {
    const results: LedgerChainMatch[] = [];

    // Index chain events by txHash
    const byTxHash = new Map<string, ReconcilableChainEvent[]>();
    const matchedTxHashes = new Set<string>();

    for (const event of chainEvents) {
      const list = byTxHash.get(event.txHash) ?? [];
      list.push(event);
      byTxHash.set(event.txHash, list);
    }

    // Match ledger entries to chain events
    for (const entry of ledgerEntries) {
      if (!entry.txHash) continue; // Only match entries that reference a chain tx

      const events = byTxHash.get(entry.txHash);

      if (!events || events.length === 0) {
        const msg =
          `Ledger entry ${entry.id} references txHash ${entry.txHash} but no on-chain event found`;
        results.push({
          correlationId: entry.correlationId,
          txHash: entry.txHash,
          status: "missing-chain",
          ledgerAmount: entry.money,
          discrepancies: [msg],
          structuredDiscrepancies: [
            makeDiscrepancy("MISSING_CHAIN", "presence", msg),
          ],
        });
        continue;
      }

      matchedTxHashes.add(entry.txHash);

      // Find the event that matches the same currency/symbol
      const matchingEvent = events.find(
        (e) => e.symbol === entry.money.currency,
      );

      if (!matchingEvent) {
        const expected = entry.money.currency;
        const actual = events[0]!.symbol;
        const msg = `Currency mismatch: ledger=${expected} chain=${actual}`;
        results.push({
          correlationId: entry.correlationId,
          txHash: entry.txHash,
          chainId: events[0]!.chainId,
          status: "amount-mismatch",
          ledgerAmount: entry.money,
          chainAmount: events[0]!.amount,
          chainDecimals: events[0]!.decimals,
          discrepancies: [msg],
          structuredDiscrepancies: [
            makeDiscrepancy("CURRENCY_MISMATCH", "currency", msg, { expected, actual }),
          ],
        });
        continue;
      }

      // Compare amounts
      const ledgerRaw = parseAmount(entry.money.amount, entry.money.decimals);
      // Chain amount is already in smallest unit (wei/drops)
      const chainRaw = BigInt(matchingEvent.amount);

      const discrepancies: string[] = [];
      const structuredDiscrepancies: Discrepancy[] = [];
      const sameDecimals = entry.money.decimals === matchingEvent.decimals;

      let amountMatches: boolean;
      if (sameDecimals) {
        amountMatches = ledgerRaw === chainRaw;
        if (!amountMatches) {
          const expected = formatAmount(ledgerRaw, entry.money.decimals);
          const actual = formatAmount(chainRaw, matchingEvent.decimals);
          const msg = `Amount mismatch: ledger=${expected} chain=${actual}`;
          discrepancies.push(msg);
          structuredDiscrepancies.push(
            makeDiscrepancy("AMOUNT_MISMATCH", "amount", msg, { expected, actual }),
          );
        }
      } else {
        // Different decimal bases — normalize to the higher precision
        const maxDec = Math.max(entry.money.decimals, matchingEvent.decimals);
        const lNorm = ledgerRaw * 10n ** BigInt(maxDec - entry.money.decimals);
        const cNorm = chainRaw * 10n ** BigInt(maxDec - matchingEvent.decimals);
        amountMatches = lNorm === cNorm;
        if (!amountMatches) {
          const expected = formatAmount(ledgerRaw, entry.money.decimals);
          const actual = formatAmount(chainRaw, matchingEvent.decimals);
          const msg =
            `Amount mismatch (cross-decimal): ledger=${expected} ` +
            `(${entry.money.decimals} dec) chain=${actual} ` +
            `(${matchingEvent.decimals} dec)`;
          discrepancies.push(msg);
          // Values disagree after decimal normalization → a true amount mismatch.
          // The differing bases are surfaced in the message for context.
          structuredDiscrepancies.push(
            makeDiscrepancy("AMOUNT_MISMATCH", "amount", msg, { expected, actual }),
          );
        }
      }

      results.push({
        correlationId: entry.correlationId,
        txHash: entry.txHash,
        chainId: matchingEvent.chainId,
        status: amountMatches ? "matched" : "amount-mismatch",
        ledgerAmount: entry.money,
        chainAmount: matchingEvent.amount,
        chainDecimals: matchingEvent.decimals,
        discrepancies,
        structuredDiscrepancies,
      });
    }

    // Find unmatched chain events (no ledger entry references them)
    for (const event of chainEvents) {
      if (!matchedTxHashes.has(event.txHash)) {
        const msg = `On-chain event ${event.txHash} has no matching ledger entry`;
        results.push({
          correlationId: `unmatched:${event.txHash}`,
          txHash: event.txHash,
          chainId: event.chainId,
          status: "missing-ledger",
          chainAmount: event.amount,
          chainDecimals: event.decimals,
          discrepancies: [msg],
          structuredDiscrepancies: [
            makeDiscrepancy("MISSING_LEDGER", "presence", msg),
          ],
        });
      }
    }

    return results;
  }

  /**
   * Match ledger entries against multi-chain events with cross-chain
   * deduplication applied first.
   *
   * This extends `match()` by first removing settlement artifacts
   * (L1 duplicates of L2 events) via `preventDoubleCounting()`,
   * then running the standard matching logic.
   *
   * @param ledgerEntries Ledger entries to match
   * @param chainEvents On-chain events from multiple chains
   * @returns Match results with settlement artifacts excluded
   */
  matchMultiChain(
    ledgerEntries: readonly ReconcilableLedgerEntry[],
    chainEvents: readonly ReconcilableChainEvent[],
  ): {
    readonly matches: readonly LedgerChainMatch[];
    readonly removedSettlementArtifacts: readonly ReconcilableChainEvent[];
  } {
    // Convert to CrossChainEvent for deduplication
    const crossChainEvents: CrossChainEvent[] = chainEvents.map((e) => ({
      chainId: e.chainId,
      txHash: e.txHash,
      blockNumber: 0, // Not used for deduplication
      amount: e.amount,
      symbol: e.symbol,
      from: e.from,
      to: e.to,
      timestamp: e.timestamp,
    }));

    const { kept, removed } = preventDoubleCounting(crossChainEvents);

    // Map kept events back to ReconcilableChainEvent by txHash lookup
    const keptTxHashes = new Set(kept.map((e) => `${e.chainId}:${e.txHash}`));
    const dedupedEvents = chainEvents.filter(
      (e) => keptTxHashes.has(`${e.chainId}:${e.txHash}`),
    );

    // Map removed events back
    const removedTxHashes = new Set(removed.map((e) => `${e.chainId}:${e.txHash}`));
    const removedEvents = chainEvents.filter(
      (e) => removedTxHashes.has(`${e.chainId}:${e.txHash}`),
    );

    return {
      matches: this.match(ledgerEntries, dedupedEvents),
      removedSettlementArtifacts: removedEvents,
    };
  }
}
