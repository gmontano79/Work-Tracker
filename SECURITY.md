# Security and data protection

Work Tracker is designed for a **single user on localhost**, not a public website or shared enterprise service.

Do not commit:
- SQLite databases, backup files, WAL/SHM files or exports.
- Client/employee identities, technical incidents, network addresses or credentials.
- Internal documents, manuals or screenshots captured from a real workspace (including images embedded in SQLite).
- API tokens, environment secrets or personally identifying test data.

Treat any data-bearing artifact as private even if the GitHub repository is private: publishing a repository later, sharing it with collaborators or attaching logs can disclose such data.

Report a vulnerability privately to the repository owner; avoid publicly sharing exploit details or real user data.
