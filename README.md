# Work Tracker

**A private, offline-first productivity workspace for IT operations, personal projects, and daily work.**

Work Tracker is a lightweight local web application for tracking tickets, projects, tasks, notes and technical manuals from a single dashboard. It runs in a desktop browser, uses the Python standard library for its local server, and stores application records in SQLite. No cloud account or monthly subscription is required.

**Version:** 1.5.11 · **Project:** Personal software portfolio · **Developer:** Gustavo Montano

> **Privacy:** This repository contains application source code only. It does **not** contain production records, company documents, support tickets, private notes, local PDF manuals or an SQLite database. Any demonstration content should use fictional data.

## Features

| Area | Functionality |
| --- | --- |
| Dashboard | At-a-glance metrics, current work, ticket statuses and quick navigation |
| Tickets | Ticket ID, site, requester, status, priority, optional IP/MAC, history, team transfers |
| Projects | Project lifecycle, milestones/phases, related tickets and tasks |
| Tasks | To Do / In Progress / Done, optional deadlines, Today and status filters, linked records |
| Notes Center | Richly formatted notes, folders, tags, colors, pinned and archived items |
| Clipboard images | Paste screenshots into tickets, projects, tasks or notes with `Ctrl+V`; saved to SQLite and included in backups |
| Calendar | Month/week views, deadline colors and optional display of completed records |
| Manuals Library | Read-only catalog of local PDFs, Office files, images and videos; open with native Windows applications |
| Global Search | Fast cross-module lookup, including manual filenames; `Ctrl+K` shortcut |
| Reports | Weekly/monthly activity PDFs and CSV exports, including status changes and transfer activity |
| Backups | Downloadable local SQLite backups and rolling recovery files |
| Desktop launcher | Windows Start / Stop shortcuts; optional hidden-console mode |

## Technology

- **Python 3.9+** — HTTP server and business logic, standard library only
- **SQLite** — local relational data storage
- **Vanilla JavaScript, HTML, CSS** — responsive browser interface
- **PDF** — generated locally, without an external API
- **Windows** — desktop shortcut scripts; core web server also supports Python on other systems

## Quick start (Windows)

1. Install Python 3.9 or later and ensure `py` or `python` is available.
2. Download or clone this repository to a personal folder (for example `Documents\\WorkTracker`).
3. Run `launch_windows.bat` to start Work Tracker. Keep its console open while using this launch method.
4. Visit **http://127.0.0.1:8765** in your browser if it does not open automatically.
5. Optional: run `Create_Desktop_Shortcuts.vbs` to add **Work Tracker** and **Stop Work Tracker** shortcuts. The Work Tracker shortcut launches the server with its console hidden.

On Windows, the application defaults to `Documents\\WorkTracker\\work_tracker.sqlite3` for user data; the SQLite database is created automatically. **Never commit this file.**

### Run directly with Python

```bash
python app.py
```

The default server binds to the loopback interface only (`127.0.0.1:8765`) and is not a multi-user or Internet-facing service.

### Isolated demonstration data (optional)

For portfolio screenshots or a demo that does not touch the usual Work Tracker database:

```bash
python scripts/create_demo_data.py
```

This script writes only to `./demo_data/work_tracker.sqlite3` (a git-ignored folder). To run the demo on **Windows PowerShell**:

```powershell
$env:WORK_TRACKER_DATA_DIR = (Resolve-Path .\\demo_data).Path
python app.py
```

The demo includes fictional data, not any information imported from a workplace. Stop the demo server before switching back to your personal installation.

## Configuration

| Environment variable | Meaning | Default |
| --- | --- | --- |
| `WORK_TRACKER_DATA_DIR` | Folder where SQLite and backups are saved | `~/Documents/WorkTracker` |
| `WORK_TRACKER_MANUALS_DIR` | Local manuals folder; filenames can be browsed and opened | `~/Documents/Manuales` |
| `WORK_TRACKER_PORT` | Local HTTP port | `8765` |

The Manuals Library does not copy documents into SQLite or GitHub. If you have a private manuals folder, **never add its contents to this repository**.

## Reporting and business logic

Images pasted into records are embedded in the local SQLite database and included in full backups. Keep backups private and allow room for database growth.

Ticket states include **Open**, **In Progress**, **Pending**, **Closed**, and **Transferred**. Transfers are logged separately from closures and can identify the destination team. Weekly and monthly reports distinguish **activity within the period** from the **current state** of records, so the report does not misrepresent historical snapshots.

Calendar due-date colors: green for three or more days remaining, yellow for one or two days, and red when due today or overdue. Dates are optional. Finished items are hidden by default and can be shown with filters.

## Repository map

```text
app.py                 Python server and SQLite-backed APIs
weekly_report.py       Local PDF and activity reporting
app.js                 Front-end application logic
index.html             Browser shell and navigation
styles.css             Visual design system
app-icon.png           App icon
favicon.ico            Browser favicon
worktracker.ico        Windows shortcut icon
WorkTracker_Start.vbs   Quiet Windows launcher
WorkTracker_Stop.vbs    Quiet shutdown
scripts/                Synthetic demo data generator
docs/                   Architecture, security and portfolio notes
```

## Safeguards and limitations

- **Single-user, local-only app.** It has no authentication and must not be exposed publicly.
- Notes and saved database records are **not encrypted at rest**. Do not store credentials, private keys or sensitive secrets.
- SQLite backups include user data; do not commit or share them.
- The PDF/CSV reports may contain private data if generated from a real database; never upload them as portfolio evidence without sanitizing.
- Manuals are opened from your local folder using the default operating system application; only open files you trust.
- A private repository is recommended until you have inspected the contents and decided what to publish.

## Background and engineering contributions

Work Tracker began as a personal need to replace spreadsheets and scattered sticky notes. The development process focused on user requirements, practical iteration, offline/local data control, UI design, data modeling, CRUD workflows, reporting and regression testing. AI-assisted tools supported implementation; design decisions, testing, requirements and acceptance were guided by the project owner.

See [Architecture](docs/ARCHITECTURE.md), [Project case study](docs/PORTFOLIO_CASE_STUDY.md), [Changelog](CHANGELOG.md) and [Security](SECURITY.md).

## License

No open-source license has been selected. Do not assume permission to redistribute or reuse this code until the repository owner chooses a license.
