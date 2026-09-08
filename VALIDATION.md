# Validation status

Development checkpoint: September 8, 2026. This is not a claim of full interface validation or bounty acceptance.

## Verified

- 54 local tests pass on Node.js 24 on Windows.
- The complete generated plugin initializes in an isolated environment without a DOM.
- The write service, installed in Amplenote, moved an original card through three headings while retaining all three control-task IDs and their dates.
- A deliberate failure of hidden-date restoration preserved all tasks and a durable recovery record. A fresh service invocation read that record and restored the date; review acknowledgment cleared it.
- The complete board plugin was imported, its source was checked against the build, and it rendered a newly created board in the actual Amplenote app.

## In progress

The first interface run found that Amplenote's iframe disallows native form submission and JavaScript modal dialogs. The current source uses direct buttons and inline confirmation instead. Live card creation and keyboard movement now work. Post-insertion reads can settle after a native write. The service retries coherent reads, reports an existing task ID if placement fails, and acknowledges a verified write separately from the next board refresh. A refresh failure therefore does not ask the user to repeat a successful save. The latest acknowledgment/refresh change needs live retesting.

The remaining live matrix includes card creation/editing, dates, drag and keyboard moves, completion/reopening, column operations and limits, rich footnotes, note labels, note creation, image previews, refresh/concurrent edits, and mobile/responsive behavior. Demonstration recordings and directory publication remain unfinished.

A rich-footnote sidebar rendered its formatted description successfully. Ordinary popup navigation was blocked by the iframe sandbox; host-mediated URL navigation is being tested and must not yet be treated as fully verified.

## Regression details

Identical native Markdown replacement dropped a hidden control with default options and with either tested combination of explicit include flags. Allowing completed-task replacement also removed the completed control. The service preserves completed tasks and temporarily clears hidden dates in its replacement payload, then forces the native hidden-date updater through null before restoring each date.

An individual-task response alone initially produced a false restoration success because it could retain an old cached date. The corrected service requires saved Markdown, the task collection and individual task reads to agree. A cleared native setting can be serialized as the string `null`; the recovery reader handles that representation.

Private fixture IDs and account-specific reports are retained in the development workspace rather than published here.
