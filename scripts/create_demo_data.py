"""Create synthetic portfolio records in ./demo_data. Never touches the default Work Tracker DB.

Run from the repository root: python scripts/create_demo_data.py
The output directory is git-ignored and can be deleted at any time.
"""
import os
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEMO = (ROOT / 'demo_data').resolve()
DEMO.mkdir(parents=True, exist_ok=True)
os.environ['WORK_TRACKER_DATA_DIR'] = str(DEMO)
sys.path.insert(0, str(ROOT))
import app  # noqa: E402  (imported after safe data-dir override)

if app.DB_PATH.resolve() != (DEMO / 'work_tracker.sqlite3'):
    raise RuntimeError('Refusing to write outside the isolated demo folder.')
if app.DB_PATH.exists():
    raise SystemExit('Demo DB already exists; remove demo_data manually before recreating it.')

app.init_db()
today = date.today()
due_soon = (today + timedelta(days=1)).isoformat()
next_week = (today + timedelta(days=5)).isoformat()

with sqlite3.connect(app.DB_PATH) as c:
    c.execute("INSERT INTO projects(name,description,site,status,start_date,due_date,notes) VALUES (?,?,?,?,?,?,?)",
              ('Branch Network Refresh', 'Replace legacy switches and validate uplinks.', 'Demo Branch A', 'in_progress', today.isoformat(), next_week, 'Sample project.'))
    project_id = c.execute('SELECT last_insert_rowid()').fetchone()[0]
    c.execute('INSERT INTO project_phases(project_id,name,status,sort_order) VALUES (?,?,?,?)',
              (project_id, 'Plan rollout', 'completed', 1))
    c.execute('INSERT INTO project_phases(project_id,name,status,sort_order) VALUES (?,?,?,?)',
              (project_id, 'Validate connections', 'in_progress', 2))
    c.execute('INSERT INTO tickets(ticket_number,description,site,ticket_user,status,priority,due_date,project_id) VALUES (?,?,?,?,?,?,?,?)',
              ('DEMO-1001', 'Access point intermittently disconnects', 'Demo Branch A', 'Sample User A', 'in_progress', 'high', due_soon, project_id))
    ticket_id = c.execute('SELECT last_insert_rowid()').fetchone()[0]
    c.execute('INSERT INTO tickets(ticket_number,description,site,ticket_user,status,priority) VALUES (?,?,?,?,?,?)',
              ('DEMO-1002', 'Printer setup assistance', 'Demo HQ', 'Sample User B', 'closed', 'normal'))
    c.execute('INSERT INTO tickets(ticket_number,description,site,ticket_user,status,priority,transfer_to,transfer_reason,transferred_at) VALUES (?,?,?,?,?,?,?,?,datetime("now"))',
              ('DEMO-1003', 'Account permissions review', 'Demo HQ', 'Sample User C', 'transferred', 'normal', 'Help Desk', 'Assigned to account administration.'))
    transfer_id = c.execute('SELECT last_insert_rowid()').fetchone()[0]
    c.execute('INSERT INTO activity(kind,record_id,action,old_status,new_status,body,transfer_to) VALUES (?,?,?,?,?,?,?)',
              ('ticket',transfer_id,'transfer','open','transferred','Reassigned for access request.','Help Desk'))
    c.execute('INSERT INTO tasks(title,details,task_date,status,priority,project_id,ticket_id) VALUES (?,?,?,?,?,?,?)',
              ('Check AP event logs', 'Collect the last 24 hours of system events.', due_soon, 'in_progress','high',project_id,ticket_id))
    c.execute('INSERT INTO tasks(title,details,status,priority) VALUES (?,?,?,?)',
              ('Document troubleshooting checklist', 'Write a reusable, fictional support checklist.', 'todo','normal'))
    c.execute('INSERT INTO note_folders(name) VALUES (?)', ('Demo References',))
    c.execute('INSERT INTO notes(title,body,folder,category,tags,color,pinned) VALUES (?,?,?,?,?,?,?)',
              ('Example Commands', 'Use a lab environment to test configuration changes.\\nNever paste passwords into notes.', 'Demo References', 'Technical', 'sample,lab', 'blue', 1))
    c.execute('INSERT INTO notes(title,body,folder,category,tags,color) VALUES (?,?,?,?,?,?)',
              ('Ideas for improvement', '- Enhance filtered views\\n- Add accessibility checks', 'General', 'Ideas', 'ux,ideas', 'cyan'))
    c.commit()

print(f'Created fictitious example database at {app.DB_PATH}')
print('This demo is isolated from Documents/WorkTracker and excluded from Git.')
