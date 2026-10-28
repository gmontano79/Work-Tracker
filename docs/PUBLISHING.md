# Publishing Work Tracker to GitHub

## Initial publication

1. Work on a **personal computer**, not a workplace-managed device.
2. Verify the repository contains only source files, assets, documentation and example-data generator.
3. Never include `work_tracker.sqlite3`, any `backups/` directory, real screenshots, manuals, or exported reports.
4. Open GitHub Desktop and choose **File → Add Local Repository**; point to this extracted folder. If it is not a Git repository, choose **Create a Repository Here**.
5. Use repository name `work-tracker`; commit the initial source.
6. Choose **Publish repository** and leave **Keep this code private** selected until you inspect it.
7. To showcase publicly later, use only an isolated demo database created by `python scripts/create_demo_data.py`.

## Working on new versions

After testing a new release, replace only the source files in this repository and create a commit such as `Release v1.5.12`. Never copy the live SQLite database into the repo folder.
