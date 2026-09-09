# Validation status

Development checkpoint: September 9, 2026. This package is not yet a completed bounty claim. Tested plugin source: commit `603b9b6aa6019cf07f402f6a6a625349c5bde974`.

## Verified

- 66 local tests pass on Node.js 24 on Windows, including a clean dependency installation from the public checkout.
- The generated plugin initializes in an isolated DOM harness and was installed in the actual Amplenote app. Its installed source matches the published build.
- Live card creation and editing preserve native task identity, Markdown, note links and start dates. Acknowledged saves are followed by a separate fresh board read.
- Keyboard movement, actual drag gestures, completion in the final column and reopening work. A drop onto an already completed card preserves both task identities and completes the moved task.
- Column creation, renaming, reordering and deletion work. Deletion preserves tasks in Unassigned. A limit of one rejected a second open card; increasing it to two allowed the move.
- Search matches rich-footnote body text, handles no matches and restores cards when cleared. Custom date patterns render and update.
- Existing-note labels, new-note creation and temporary local-note alias resolution work. A label uses the linked note's first tag color; the configured and rendered values matched.
- The first image appears at the bottom of its card. Mixed rich-footnote text and images render together in the Peek Viewer. Linked-note previews also render there.
- At a 390 by 844 viewport, the toolbar wraps and the board scrolls horizontally to the remaining columns. The temporary viewport override was reset afterward.
- The installed write service preserved control-task IDs and dates through note rewrites. An intentionally interrupted hidden-date restoration left a durable recovery record; a fresh invocation restored the date and explicit review acknowledgment cleared the record.

## Outstanding

- External HTTPS navigation fails in the host's sandbox. Ordinary new-window links are blocked, and host-mediated navigation rejected the tested Amplenote API-documentation URL and GitHub release URL. Support was asked which documented method is supported. These links must not be represented as verified.
- Directory publication, program eligibility, sponsor acceptance and payment remain outstanding.
- Simultaneous edits across independent clients cannot be made atomic with the documented API. Observed stale snapshots are rejected, but there is no native compare-and-swap transaction. A live multi-client race test has not been completed.

## Demonstrations

The development release includes a usage overview of about 1 minute 55 seconds and a code overview of about 2 minutes 20 seconds. They are edited browser captures with narration; captured frames are held and paced for explanation. They are not uncut real-time recordings or a replacement for the validation evidence above. The source walkthrough shows the immutable tested commit and its earlier documentation; this document records the later completed checks.

## Recovery details

Native Markdown replacement dropped hidden controls with default options and with either tested combination of explicit include flags. Allowing completed-task replacement also removed a completed control. The service keeps completed-task replacement disabled, temporarily clears hidden dates in the replacement payload, and forces the native hidden-date updater through null before restoring each date.

An individual-task response alone could retain an old cached date. Verification therefore requires saved Markdown, the task collection and individual-task reads to agree. A cleared native setting can be serialized as the string `null`; recovery handles that representation. Acknowledged writes are never silently replayed merely because the subsequent render fails.

Private fixture IDs and account-specific reports remain in the development workspace.
