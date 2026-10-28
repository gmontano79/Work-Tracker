# Architecture

```text
Chrome / Edge / local browser
         |
         | HTTP requests to 127.0.0.1:8765 only
         v
   Python stdlib HTTP server (app.py)
         |
         +-- SQLite (work_tracker.sqlite3) -- local tickets/projects/tasks/notes/activity
         |
         +-- weekly_report.py -- PDF and CSV report generation
         |
         +-- Manuals Library -- metadata-only local folder reader/open action
         |
         +-- Backup manager -- local SQLite backups (excluded from git)
```

- Front end: `index.html` shell, `app.js` navigation & state, `styles.css` styles.
- Backend: a single-process threaded local HTTP server serving static assets and JSON APIs.
- Data: SQLite with foreign keys. Notes and report history have dedicated tables.
- Privacy boundary: Work Tracker itself does not require a cloud service. Hosting the source on GitHub does not upload your local database.
- Concurrency: intended for a single local user; not built for network access or multi-user deployment.
- Reports: current status and activity-within-period are different metrics.

## Safety considerations

Because there is no authentication, do not change the listener from `127.0.0.1` to a public interface without a proper security redesign. Do not deploy the server behind a public reverse proxy. Do not commit generated backups, private manuals or screenshots of real tickets.

## Inline images (v1.5.11)

Clipboard images pasted into notes, tickets, projects or tasks are stored as BLOBs in the `record_images` SQLite table. Application-level image size limits and the local-only HTTP server mitigate unbounded uploads, but heavy use increases backup size. Full SQLite backups include these images; the repository never includes the database.
