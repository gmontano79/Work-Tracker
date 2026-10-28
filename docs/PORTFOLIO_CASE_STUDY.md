# Portfolio case study — Work Tracker

## Problem

Day-to-day technical work was fragmented across spreadsheets, sticky notes and manual status tracking. Finding a ticket, seeing the latest project update, and preparing an activity report took repeated effort.

## Solution

Designed a lightweight local web workspace with tickets, projects, tasks, notes, technical references, a calendar, and reports — one interface backed by SQLite.

## Selected product decisions

- **Local-first:** no hosted database or third-party login; explicit user control of records.
- **Workflow alignment:** optional due dates; ticket transfers tracked separately from ticket closures.
- **Linked records:** tasks and notes can reference relevant tickets and projects.
- **Real reporting:** weekly/monthly summaries distinguish status from activity during a period.
- **Discoverability:** unified search across five content modules.
- **Screenshot-first documentation:** paste reference captures into an individual record; images remain local and travel with backups.
- **Practical delivery:** Windows shortcuts, version labeling, backups and iterative patches.

## Role and process

Personal project concept, requirements definition, prioritization, hands-on acceptance testing and iterative quality review by Gustavo Montano. AI-assisted programming was used during implementation.

## Technologies

Python, SQLite, JavaScript, HTML, CSS, local HTTP, PDF generation and Windows Script Host shortcut integration.

## Evidence to add before public showcase

Capture three screenshots from an **isolated synthetic demo database**, showing:

1. Dashboard with fictional tickets/projects/tasks.
2. Notes Center with fictional folder names and snippets.
3. Weekly PDF report using fictional sample records.

Do **not** use photographs of a production screen or include private names, IP addresses, MAC addresses, internal documents or real task descriptions. Keep screenshots in `docs/screenshots/` only after verifying they are safe to publish.
