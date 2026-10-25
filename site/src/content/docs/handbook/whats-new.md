---
title: What's new
description: What changed in Attestia 2.1, release by release.
sidebar:
  order: 5
---

This page covers the 2.1 releases. The full list is in the repository's [CHANGELOG.md](https://github.com/mcp-tool-shop-org/attestia/blob/main/CHANGELOG.md).

## 2.1.2: crash recovery for the event log

A writer killed partway through a line can leave a torn last line with no trailing newline. Before 2.1.2, the first append after a restart was written onto that line. The next load then skipped the fused line, losing the new event, and refused to open the store.

Now `JsonlEventStore` (`@attestia/event-store` 0.2.3) notices on load that the file doesn't end in a newline. Before its first append, it writes and `fsync`s a lone newline, so the new event starts on a line of its own. It reports this as a `TORN_TAIL_NEWLINE_REPAIRED` telemetry warning.

What holds after a resume:

- Every event whose `append()` returned is on disk. The append that was in flight when the writer died isn't recovered.
- A multi-event `append()` goes out in one write, so a torn batch can leave some of its events committed. To see which landed, check `event.metadata.eventId` on the records from `read()` or `readAll()`, or check `streamVersion(streamId)`.
- The torn fragment stays in the file. The store never truncates or rewrites the log, and it skips the fragment as a `parse_error` line on every load.
- Events appended after the repair load and verify, in order with the events before the tear.
- The repair runs at most once per load. A file that already ends in `\n` or `\r\n`, or an empty file, gets no extra newline.

What is still refused: with the default `verifyOnLoad: true`, any damage that breaks the hash chain, such as a damaged event in the middle of the log, an edited event or a missing head, makes the store refuse to open (`INTEGRITY_VIOLATION`).

## 2.1.1: Zod 4

Validation moved to Zod 4.6.7, which fixes the `GHSA-mrhx-c7xc-m3w5` advisory in Zod 3.

The wording of built-in validation messages changed, both in the API's `details.issues[].message` and in `ConfigError` text:

| Before | Now |
|--------|-----|
| `Required` | `Invalid input: expected <type>, received undefined` |
| `String must contain …` | `Too small: …` |
| `Invalid enum value …` | `Invalid option: …` |

The HTTP error envelope, error codes, issue paths, and Attestia's own messages (the `WITNESS_*` boot checks and the record size limits) are unchanged. If you match on validation errors, match on codes and paths, not on message text.

Zod 4 also stops checking a field after its first failed `.int()` check, so some inputs report one issue where they used to report two. They still fail with the same code. `z.number()` now rejects `Infinity`. JSON can't carry it, so this only affects direct calls from code.

## 2.1.0: a durable event log for the service

`ATTESTIA_EVENTS_FILE` opens that file as the configured owner's event log. Snapshots stay in the tenant directory, and other tenants keep their own log under the parent directory. Unset, the service stays in memory. The server image and compose file set `/app/data/events.jsonl` on the `attestia-data` volume.

A malformed `API_KEYS` entry no longer puts the key in the startup error. The error names the entry by position and the problem.
