/**
 * Intent ↔ Chain Matcher
 *
 * Matches vault intent executions to on-chain transfer events.
 * This verifies that what the vault says was executed actually
 * appeared on-chain.
 *
 * Detects:
 * - Executed intents with no matching on-chain event
 * - Amount mismatches between intent and chain
 * - Chain events that don't correspond to any known intent
 */

import { parseAmount, formatAmount } from "@attestia/ledger";
import { makeDiscrepancy } from "./discrepancy.js";
import type { Discrepancy } from "./discrepancy.js";
import type {
  IntentChainMatch,
  ReconcilableIntent,
  ReconcilableChainEvent,
} from "./types.js";

export class IntentChainMatcher {
  /**
   * Match intents against on-chain events.
   *
   * Strategy:
   * 1. Index chain events by txHash
   * 2. For each executed intent with a txHash, find the matching chain event
   * 3. Compare amounts
   * 4. Report mismatches and orphans
   */
  match(
    intents: readonly ReconcilableIntent[],
    chainEvents: readonly ReconcilableChainEvent[],
  ): readonly IntentChainMatch[] {
    const results: IntentChainMatch[] = [];

    // Index chain events by txHash
    const byTxHash = new Map<string, ReconcilableChainEvent[]>();
    const matchedTxHashes = new Set<string>();

    for (const event of chainEvents) {
      const list = byTxHash.get(event.txHash) ?? [];
      list.push(event);
      byTxHash.set(event.txHash, list);
    }

    // Match executed intents to chain events
    for (const intent of intents) {
      // Only match intents that have been executed and have a txHash
      if (!intent.txHash) continue;

      const events = byTxHash.get(intent.txHash);

      if (!events || events.length === 0) {
        const msg =
          `Intent ${intent.id} executed with txHash ${intent.txHash} but no on-chain event found`;
        results.push({
          intentId: intent.id,
          txHash: intent.txHash,
          ...(intent.chainId ? { chainId: intent.chainId } : {}),
          status: "missing-chain",
          ...(intent.amount ? { intentAmount: intent.amount } : {}),
          discrepancies: [msg],
          structuredDiscrepancies: [
            makeDiscrepancy("MISSING_CHAIN", "presence", msg),
          ],
        });
        continue;
      }

      matchedTxHashes.add(intent.txHash);

      // Verify amount if both sides have one
      if (intent.amount) {
        const matchingEvent = events.find(
          (e) => e.symbol === intent.amount!.currency,
        );

        if (!matchingEvent) {
          const expected = intent.amount.currency;
          const actual = events[0]!.symbol;
          const msg = `Currency mismatch: intent=${expected} chain=${actual}`;
          results.push({
            intentId: intent.id,
            txHash: intent.txHash,
            chainId: events[0]!.chainId,
            status: "amount-mismatch",
            intentAmount: intent.amount,
            chainAmount: events[0]!.amount,
            chainDecimals: events[0]!.decimals,
            discrepancies: [msg],
            structuredDiscrepancies: [
              makeDiscrepancy("CURRENCY_MISMATCH", "currency", msg, { expected, actual }),
            ],
          });
          continue;
        }

        const intentRaw = parseAmount(intent.amount.amount, intent.amount.decimals);
        const chainRaw = BigInt(matchingEvent.amount);

        const discrepancies: string[] = [];
        const structuredDiscrepancies: Discrepancy[] = [];
        let amountMatches: boolean;

        if (intent.amount.decimals === matchingEvent.decimals) {
          amountMatches = intentRaw === chainRaw;
          if (!amountMatches) {
            const expected = formatAmount(intentRaw, intent.amount.decimals);
            const actual = formatAmount(chainRaw, matchingEvent.decimals);
            const msg = `Amount mismatch: intent=${expected} chain=${actual}`;
            discrepancies.push(msg);
            structuredDiscrepancies.push(
              makeDiscrepancy("AMOUNT_MISMATCH", "amount", msg, { expected, actual }),
            );
          }
        } else {
          const maxDec = Math.max(intent.amount.decimals, matchingEvent.decimals);
          const iNorm = intentRaw * 10n ** BigInt(maxDec - intent.amount.decimals);
          const cNorm = chainRaw * 10n ** BigInt(maxDec - matchingEvent.decimals);
          amountMatches = iNorm === cNorm;
          if (!amountMatches) {
            const expected = formatAmount(intentRaw, intent.amount.decimals);
            const actual = formatAmount(chainRaw, matchingEvent.decimals);
            const msg = `Amount mismatch (cross-decimal): intent=${expected} chain=${actual}`;
            discrepancies.push(msg);
            structuredDiscrepancies.push(
              makeDiscrepancy("AMOUNT_MISMATCH", "amount", msg, { expected, actual }),
            );
          }
        }

        results.push({
          intentId: intent.id,
          txHash: intent.txHash,
          chainId: matchingEvent.chainId,
          status: amountMatches ? "matched" : "amount-mismatch",
          intentAmount: intent.amount,
          chainAmount: matchingEvent.amount,
          chainDecimals: matchingEvent.decimals,
          discrepancies,
          structuredDiscrepancies,
        });
      } else {
        // Intent has no amount — just verify chain event exists
        results.push({
          intentId: intent.id,
          txHash: intent.txHash,
          chainId: events[0]!.chainId,
          status: "matched",
          chainAmount: events[0]!.amount,
          chainDecimals: events[0]!.decimals,
          discrepancies: [],
          structuredDiscrepancies: [],
        });
      }
    }

    // Flag on-chain events that correspond to NO declared/approved intent.
    // An unmatched chain transfer is an unauthorized withdrawal — fail-closed:
    // it must surface as missing-intent (which the summary counts toward
    // missingCount, flipping allReconciled to false), never silently ignored
    // (D4-A-002). Dedup by txHash so events sharing a hash yield one finding,
    // mirroring the txHash-indexed matching above.
    const reportedOrphanTxHashes = new Set<string>();
    for (const event of chainEvents) {
      if (matchedTxHashes.has(event.txHash)) continue;
      if (reportedOrphanTxHashes.has(event.txHash)) continue;
      reportedOrphanTxHashes.add(event.txHash);

      const msg =
        `Chain event ${event.txHash} (${event.amount} ${event.symbol}) has no matching intent`;
      results.push({
        intentId: "", // no intent declared this transfer
        txHash: event.txHash,
        chainId: event.chainId,
        status: "missing-intent",
        chainAmount: event.amount,
        chainDecimals: event.decimals,
        discrepancies: [msg],
        structuredDiscrepancies: [
          makeDiscrepancy("MISSING_INTENT", "presence", msg),
        ],
      });
    }

    return results;
  }
}
