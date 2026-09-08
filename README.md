# Markdown Kanban for Amplenote

A Kanban board that uses note headings as columns and native tasks as cards. This is a development version undergoing live interface testing.

The implementation includes card editing, start dates, drag and keyboard movement, completion, column limits and reordering, search, note labels, image previews and rich-footnote/sidebar rendering. The note remains the source of truth.

## Development

Requires Node.js 22 or newer.

```sh
npm ci
npm test
npm run build
```

The build produces `dist/plugin.js` and an importable `dist/PLUGIN_NOTE.md`. Tests include Markdown preservation, task identity and date checks, interrupted writes, conflict detection, rich-content handling, and the isolated plugin bundle.

## Installation for testing

Import `dist/PLUGIN_NOTE.md` through Amplenote's Markdown importer, then select its note in Account Settings → Plugins. Open Quick Open (`Ctrl-O` on Windows/Linux, `Cmd-O` on macOS) and choose **Create a Kanban board**, or use **Open Kanban** from an existing note's menu.

Use a dedicated test note while interface validation is in progress. The current validation scope is recorded in `VALIDATION.md`.

## Preservation and recovery

The parser retains original Markdown spans, including opaque task metadata and rich footnotes. Completed-task export sections remain separate from user headings. Parent cards keep nested tasks attached when moved.

Native note replacement needs special handling for hidden tasks. The service persists a small recovery record, writes the updated note, restores hidden dates through the native task API, and checks the saved Markdown and both task APIs. If interrupted, use **Restore task dates**, review the source note, then acknowledge recovery. It never silently replays an uncertain move or rolls the whole note back over later changes.

Already-observed concurrent edits are rejected. Amplenote's documented API does not provide an atomic compare-and-swap operation, so simultaneous edits across clients cannot be made fully atomic by this plugin. The current conservative rewrite limit is 100,000 characters per note.

## Licensing

Original plugin code is MIT-licensed. Parser and sanitization dependencies retain their own licenses; see `THIRD_PARTY_NOTICES.md`. The build includes dependency license comments, and the importable note includes the notices.

## References

- [Published Kanban requirements](https://public.amplenote.com/Y6vpMukmBqdZFn2K38CkR6yZ)
- [Amplenote plugin API](https://www.amplenote.com/help/developing_amplenote_plugins/app_interface)
- [Native Markdown reference](https://www.amplenote.com/help/plugin_api_markdown_reference_parse_markdown)
- [Tag-color behavior](https://www.amplenote.com/help/color_calendar_events)
