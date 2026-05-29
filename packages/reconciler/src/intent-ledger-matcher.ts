/**
 * Intent ↔ Ledger Matcher
 *
 * Matches vault intents to treasury ledger entries using:
 * - intentId on LedgerEntry → intent.id
 * - correlationId patterns (e.g. "payroll:{runId}:{payeeId}")
 *
 * Detects:
 * - Missing ledger entries for executed intents
 * - Ledger entries with no matching intent
 * - Amount mismatches between intent and ledger
 */

import { formatAmount, parseAmount } from "@attestia/ledger";
import { makeDiscrepancy } from "./discrepancy.js";
import type { Discrepancy } from "./discrepancy.js";
import type {
  IntentLedgerMatch,
  ReconcilableIntent,
  ReconcilableLedgerEntry,
} from "./types.js";

export class IntentLedgerMatcher {
  /**
   * Match intents against ledger entries.
   *
   * Strategy:
   * 1. Index ledger entries by intentId (where present)
   * 2. For each intent, find matching ledger entries
   * 3. Compare debit-side amounts (the outflow that matches the intent amount)
   * 4. Report mismatches and orphans
   */
  match(
    intents: readonly ReconcilableIntent[],
    ledgerEntries: readonly ReconcilableLedgerEntry[],
  ): readonly IntentLedgerMatch[] {
    const results: IntentLedgerMatch[] = [];

    // Index ledger entries by intentId
    const byIntentId = new Map<string, ReconcilableLedgerEntry[]>();
    const matchedEntryIds = new Set<string>();

    for (const entry of ledgerEntries) {
      if (entry.intentId) {
        const list = byIntentId.get(entry.intentId) ?? [];
        list.push(entry);
        byIntentId.set(entry.intentId, list);
      }
    }

    // Match each intent to its ledger entries
    for (const intent of intents) {
      const entries = byIntentId.get(intent.id);

      if (!entries || entries.length === 0) {
        // Intent has no matching ledger entries
        if (intent.status === "executed" || intent.status === "verified") {
          const msg = `Intent ${intent.id} is ${intent.status} but has no ledger entries`;
          results.push({
            intentId: intent.id,
            correlationId: intent.correlationId ?? intent.id,
            status: "missing-ledger",
            ...(intent.amount ? { intentAmount: intent.amount } : {}),
            discrepancies: [msg],
            structuredDiscrepancies: [
              makeDiscrepancy("MISSING_LEDGER", "presence", msg),
            ],
          });
        }
        // Intents that haven't executed yet are expected to have no entries
        continue;
      }

      // Mark entries as matched
      for (const e of entries) {
        matchedEntryIds.add(e.id);
      }

      // Compare amounts — sum the debit entries to get total outflow
      const debitEntries = entries.filter((e) => e.type === "debit");
      if (debitEntries.length === 0) {
        // An amount-bearing outflow intent linked only to credit entries has
        // NOT been debited — the recorded outflow is zero. Reporting that as a
        // clean "matched" hides a real discrepancy (intent amount vs 0). Flag
        // it as amount-mismatch (D4-A-004). Only when the intent carries no
        // amount is the absence of a debit legitimately clean.
        if (intent.amount) {
          const intentRaw = parseAmount(intent.amount.amount, intent.amount.decimals);
          const expected = formatAmount(intentRaw, intent.amount.decimals);
          const actual = formatAmount(0n, intent.amount.decimals);
          const msg =
            `Amount mismatch: intent=${expected} ledger=${actual} (no debit entries)`;
          results.push({
            intentId: intent.id,
            correlationId: entries[0]!.correlationId,
            status: "amount-mismatch",
            intentAmount: intent.amount,
            ledgerAmount: {
              amount: actual,
              currency: intent.amount.currency,
              decimals: intent.amount.decimals,
            },
            discrepancies: [msg],
            structuredDiscrepancies: [
              makeDiscrepancy("AMOUNT_MISMATCH", "amount", msg, { expected, actual }),
            ],
          });
          continue;
        }

        results.push({
          intentId: intent.id,
          correlationId: entries[0]!.correlationId,
          status: "matched",
          discrepancies: [],
          structuredDiscrepancies: [],
        });
        continue;
      }

      // Check amount match if intent has an amount
      if (intent.amount) {
        const intentRaw = parseAmount(intent.amount.amount, intent.amount.decimals);
        let debitTotal = 0n;
        for (const d of debitEntries) {
          if (d.money.currency === intent.amount.currency) {
            debitTotal += parseAmount(d.money.amount, d.money.decimals);
          }
        }

        const discrepancies: string[] = [];
        const structuredDiscrepancies: Discrepancy[] = [];
        const amountMatches = intentRaw === debitTotal;

        if (!amountMatches) {
          const expected = formatAmount(intentRaw, intent.amount.decimals);
          const actual = formatAmount(debitTotal, intent.amount.decimals);
          const msg = `Amount mismatch: intent=${expected} ledger=${actual}`;
          discrepancies.push(msg);
          structuredDiscrepancies.push(
            makeDiscrepancy("AMOUNT_MISMATCH", "amount", msg, { expected, actual }),
          );
        }

        results.push({
          intentId: intent.id,
          correlationId: entries[0]!.correlationId,
          status: amountMatches ? "matched" : "amount-mismatch",
          intentAmount: intent.amount,
          ledgerAmount: {
            amount: formatAmount(debitTotal, intent.amount.decimals),
            currency: intent.amount.currency,
            decimals: intent.amount.decimals,
          },
          discrepancies,
          structuredDiscrepancies,
        });
      } else {
        results.push({
          intentId: intent.id,
          correlationId: entries[0]!.correlationId,
          status: "matched",
          discrepancies: [],
          structuredDiscrepancies: [],
        });
      }
    }

    // Find orphaned ledger entries (entries with intentId that didn't match)
    for (const entry of ledgerEntries) {
      if (entry.intentId && !matchedEntryIds.has(entry.id)) {
        const alreadyReported = results.some(
          (r) => r.intentId === entry.intentId,
        );
        if (!alreadyReported) {
          const msg =
            `Ledger entry ${entry.id} references intent ${entry.intentId} but intent not found`;
          results.push({
            intentId: entry.intentId,
            correlationId: entry.correlationId,
            status: "missing-intent",
            ledgerAmount: entry.money,
            discrepancies: [msg],
            structuredDiscrepancies: [
              makeDiscrepancy("MISSING_INTENT", "presence", msg),
            ],
          });
        }
      }
    }

    return results;
  }
}
