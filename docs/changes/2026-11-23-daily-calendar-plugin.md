# Daily Calendar plugin

EdgeEver now supports plugin panels docked in the notebook sidebar. Existing `dialog` and `fullscreen` panels keep their prior behavior; the new `sidebar` presentation reuses the same mount, shell, cleanup, and permission contracts.

The bundled Daily Calendar plugin uses that presentation to provide a month calendar for rule-driven daily notes. Its defaults match the MySystem layout:

```text
30_daily/YYYY/YYYY-MM/YYYY-MM-DD/YYYY-MM-DD
```

The final segment is the note title; the preceding segments are notebooks. A date is marked when its resolved day notebook contains notes. Clicking a date resolves every notebook by exact parent and name, creates only missing levels, finds the exact daily title, creates it when absent, and opens it. Duplicate sibling notebooks or duplicate daily titles stop the operation instead of guessing.

The plugin is client-only. It changes no database schema, API route, reverse proxy, or sync protocol. Settings remain device-local under the existing plugin setting contract. Same-device repeated clicks are serialized; cross-device simultaneous creation is reduced by re-reading after each notebook creation but is not a server-atomic operation.
