# First-class file notes iteration

## Goal

Treat a non-Markdown file as a note that remains visible and manageable in its notebook. The original bytes stay in object storage. Unknown formats always fall back to file information and download.

## This iteration

- Keep `memo` as the note identity and lifecycle owner.
- Mark one active resource per file note as `primary`, with a stable `formatKey`.
- Import one dropped file. Markdown keeps the existing text-note path; other non-image files become file notes.
- Return a minimal document descriptor from memo APIs.
- Show file notes in the memo list and open them in a generic file pane.
- Support download and conflict-safe replacement of the primary file.
- Touch the owning memo when primary bytes or filename change so existing memo sync observes the change.
- Prevent deleting a primary resource independently of its memo.
- Preserve the primary role and format through backup and restore.
- Keep a generated Markdown attachment link for old clients; the server rejects removal of the file marker through the normal Markdown editor.

## Deliberately excluded

- Binary CLI workspace sync and file revision history. The CLI explicitly skips and reports file notes instead of presenting them as Markdown.
- Full-text extraction from Office, PDF, or unknown files.
- D2 preview/editing and third-party format registration.
- Migrating diagrams, tables, posters, or infographics to the new renderer dispatch.
- File-note templates, merge semantics, or a new parallel file hierarchy.

## Acceptance

1. Dropping a non-Markdown file creates one memo and one primary resource.
2. The list identifies the memo as a file note; opening it shows current file metadata and download.
3. Replacing the file requires its current SHA-256 and returns `409 resource_conflict` when stale.
4. Primary replacement/rename changes the owning memo timestamp and is visible to existing memo sync.
5. A primary resource cannot be deleted from the asset library; deleting/restoring the memo manages it.
6. Backup/restore keeps the primary role and format key.
7. Existing Markdown and structured note editors keep their current routing.

## Implementation record

- Database: migration `0098_primary_file_resources.sql` adds `role` and `format_key` and enforces one active primary resource per memo.
- Protocol: memo responses include a `document` descriptor; resource responses include primary identity and format.
- Web: file drop, list identification, generic file pane, download, and SHA-256-guarded replacement are connected.
- Safety: a primary resource must belong to the memo; normal editing cannot remove the file marker; the asset library cannot delete a primary resource independently.
- Compatibility: backup, restore, and memo duplication preserve primary metadata; the fallback attachment link remains available to old clients.
- Verified: root and mobile type checks, production Web build, all 24 CLI tests, the complete 5,895-test non-E2E regression suite, plus focused migration, import, resource, backup/restore, and duplication tests. Yunxiao run `#11` is deployed and the live migration is `0098`.
- Not run: live UI creation/replacement of a real file note, D2 preview, and CLI binary synchronization.
