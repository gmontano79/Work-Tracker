"""Work Tracker v1.5: local web workspace (Python 3.9+ standard library)."""
import csv
import base64
import binascii
import io
import json
import mimetypes
import subprocess
import os
import re
import sqlite3
import sys
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
import webbrowser
import threading
from weekly_report import weekly_data, monthly_data, create_weekly_pdf

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get('WORK_TRACKER_DATA_DIR', str(Path.home() / 'Documents' / 'WorkTracker'))).expanduser()
DB_PATH = DATA_DIR / 'work_tracker.sqlite3'
BACKUP_DIR = DATA_DIR / 'backups'
PORT = int(os.environ.get('WORK_TRACKER_PORT', '8765'))
BACKUP_LOCK = threading.Lock()
# Optional background launch: a local, file-based graceful stop request.
STOP_REQUEST_FILE = APP_DIR / '.work_tracker_stop_request'
TICKET_STATUSES = ('open', 'in_progress', 'pending', 'closed', 'transferred')
PROJECT_STATUSES = ('planned', 'in_progress', 'on_hold', 'completed', 'cancelled')
PHASE_STATUSES = ('not_started', 'in_progress', 'completed')
TASK_STATUSES = ('todo', 'in_progress', 'done')
PRIORITIES = ('low', 'normal', 'high', 'urgent')
NOTE_COLORS = ('blue', 'cyan', 'mint', 'amber', 'violet', 'rose', 'slate')
NOTE_LINK_TABLES = {'ticket': 'tickets', 'project': 'projects', 'task': 'tasks'}
APP_VERSION = '1.5.11'
# Reference folder only: manuals are never copied into SQLite or backed up.
MANUALS_DIR = Path(os.environ.get('WORK_TRACKER_MANUALS_DIR',
    str(Path.home() / 'Documents' / 'Manuales'))).expanduser()
MANUAL_EXTENSIONS = {
    '.pdf', '.doc', '.docx', '.docm', '.txt', '.rtf', '.odt',
    '.xls', '.xlsx', '.xlsm', '.csv', '.ods',
    '.ppt', '.pptx', '.odp', '.mp4', '.mov', '.avi', '.mkv', '.webm',
    '.wmv', '.m4v', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'
}
MANUAL_EXT_GROUPS = {
    **dict.fromkeys(('.pdf',), 'PDF'),
    **dict.fromkeys(('.doc','.docx','.docm','.txt','.rtf','.odt'), 'Document'),
    **dict.fromkeys(('.xls','.xlsx','.xlsm','.csv','.ods'), 'Spreadsheet'),
    **dict.fromkeys(('.ppt','.pptx','.odp'), 'Presentation'),
    **dict.fromkeys(('.mp4','.mov','.avi','.mkv','.webm','.wmv','.m4v'), 'Video'),
    **dict.fromkeys(('.jpg','.jpeg','.png','.gif','.webp','.bmp'), 'Image'),
}


def list_manuals():
    root = MANUALS_DIR.resolve()
    if not root.is_dir():
        return {'folder': str(MANUALS_DIR), 'exists': False, 'files': []}
    files = []
    # Read metadata only; never serve internal document bytes via the web API.
    # Traverse up to 5 levels, skip hidden/temp files and symlinks.
    def visit(folder, depth):
        if depth > 5 or len(files) >= 1500:
            return
        try:
            children = list(folder.iterdir())
        except (OSError, PermissionError):
            return
        for child in children:
            if len(files) >= 1500:
                break
            if child.name.startswith('.') or child.name.startswith('~$') or child.is_symlink():
                continue
            try:
                if child.is_dir():
                    visit(child, depth+1)
                elif child.is_file() and child.suffix.lower() in MANUAL_EXTENSIONS:
                    st = child.stat()
                    files.append({'path': child.relative_to(root).as_posix(),
                                  'name': child.name, 'folder': child.parent.relative_to(root).as_posix() if child.parent != root else '',
                                  'type': MANUAL_EXT_GROUPS[child.suffix.lower()],
                                  'extension': child.suffix.lower(),
                                  'size': st.st_size,
                                  'modified': datetime.fromtimestamp(st.st_mtime).astimezone().isoformat(timespec='seconds')})
            except (OSError, PermissionError, ValueError):
                continue
    visit(root, 0)
    files.sort(key=lambda x: (x['folder'].casefold(), x['name'].casefold()))
    return {'folder': str(MANUALS_DIR), 'exists': True, 'files': files}


def open_manual(relative):
    if not isinstance(relative, str) or not relative or len(relative) > 1500 or '\x00' in relative:
        raise ValueError('Invalid manual path.')
    root = MANUALS_DIR.resolve()
    target = (root / relative).resolve()
    if not target.is_relative_to(root) or not target.is_file() or target.suffix.lower() not in MANUAL_EXTENSIONS:
        raise LookupError('Manual not found in the configured folder.')
    # Explicitly disallow symlinks in any intermediate folder as well.
    current = root
    for part in target.relative_to(root).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('Symbolic links cannot be opened.')
    if os.name == 'nt':
        os.startfile(str(target))
    elif sys.platform == 'darwin':
        subprocess.Popen(['open', str(target)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        subprocess.Popen(['xdg-open', str(target)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)



def db():
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    conn.execute('PRAGMA busy_timeout=10000')
    return conn


def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    with db() as c:
        c.executescript('''
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                site TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'planned',
                start_date TEXT NOT NULL DEFAULT '',
                due_date TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY,
                ticket_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
                description TEXT NOT NULL,
                site TEXT NOT NULL DEFAULT '',
                ticket_user TEXT NOT NULL DEFAULT '',
                transfer_to TEXT NOT NULL DEFAULT '',
                transfer_reason TEXT NOT NULL DEFAULT '',
                transferred_at TEXT NOT NULL DEFAULT '',
                ip_address TEXT NOT NULL DEFAULT '',
                mac_address TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                priority TEXT NOT NULL DEFAULT 'normal',
                due_date TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS project_phases (
                id INTEGER PRIMARY KEY,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'not_started',
                due_date TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                details TEXT NOT NULL DEFAULT '',
                task_date TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'todo',
                priority TEXT NOT NULL DEFAULT 'normal',
                project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS activity (
                id INTEGER PRIMARY KEY,
                kind TEXT NOT NULL,
                record_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                old_status TEXT NOT NULL DEFAULT '',
                new_status TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                transfer_to TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_activity_record ON activity(kind,record_id,id);
            CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(task_date);
            CREATE INDEX IF NOT EXISTS idx_phases_project ON project_phases(project_id);
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                body TEXT NOT NULL DEFAULT '',
                folder TEXT NOT NULL DEFAULT 'General',
                category TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL DEFAULT '',
                color TEXT NOT NULL DEFAULT 'blue',
                pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1)),
                archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0, 1)),
                linked_kind TEXT NOT NULL DEFAULT '',
                linked_id INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_notes_display ON notes(archived,pinned,updated_at);
            -- Screenshots live inside SQLite so Full Backup contains everything.
            CREATE TABLE IF NOT EXISTS record_images (
                id INTEGER PRIMARY KEY,
                kind TEXT NOT NULL CHECK (kind IN ('ticket','project','task','note')),
                record_id INTEGER NOT NULL,
                image_type TEXT NOT NULL,
                filename TEXT NOT NULL,
                image_bytes BLOB NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_record_images_owner ON record_images(kind,record_id,id);
            CREATE TABLE IF NOT EXISTS note_folders (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
        ''')
        # Register legacy folder names, including archived notes. Keep existing note data unchanged.
        c.execute("INSERT OR IGNORE INTO note_folders(name) VALUES ('General')")
        for old in c.execute('SELECT DISTINCT folder FROM notes').fetchall():
            folder = (old['folder'] or '').strip() or 'General'
            c.execute('INSERT OR IGNORE INTO note_folders(name) VALUES (?)', (folder,))
        # Upgrade old databases in place, without deleting existing records.
        ticket_columns = {row['name'] for row in c.execute('PRAGMA table_info(tickets)')}
        for column in ('ticket_user','transfer_to','transfer_reason','transferred_at'):
            if column not in ticket_columns:
                c.execute(f"ALTER TABLE tickets ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
        activity_columns = {row['name'] for row in c.execute('PRAGMA table_info(activity)')}
        if 'transfer_to' not in activity_columns:
            c.execute("ALTER TABLE activity ADD COLUMN transfer_to TEXT NOT NULL DEFAULT ''")


def rows(sql, params=()):
    with db() as c:
        return [dict(x) for x in c.execute(sql, params).fetchall()]


def one(sql, params=()):
    with db() as c:
        r = c.execute(sql, params).fetchone()
        return dict(r) if r else None


def value(data, key, maxlen=3000):
    v = data.get(key, '')
    if v is None:
        return ''
    if not isinstance(v, (str, int, float)):
        raise ValueError(f'Invalid {key}')
    return str(v).strip()[:maxlen]


def date_value(data, key):
    v = value(data, key, 10)
    if v:
        try:
            if date.fromisoformat(v).isoformat() != v:
                raise ValueError()
        except ValueError:
            raise ValueError(f'Invalid date: {key}')
    return v


def choice(data, key, allowed, default):
    v = value(data, key, 50) or default
    if v not in allowed:
        raise ValueError(f'Invalid {key}')
    return v


def optional_id(data, key, table):
    v = data.get(key)
    if v in ('', None):
        return None
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise ValueError(f'Invalid {key}')
    with db() as c:
        if c.execute(f'SELECT id FROM {table} WHERE id=?', (n,)).fetchone() is None:
            raise ValueError(f'Unknown {key}')
    return n


def ticket_payload(data):
    result = {
        'ticket_number': value(data, 'ticket_number', 90),
        'description': value(data, 'description', 6000),
        'site': value(data, 'site', 200),
        'ticket_user': value(data, 'ticket_user', 200),
        'transfer_to': value(data, 'transfer_to', 120),
        'transfer_reason': value(data, 'transfer_reason', 3000),
        'ip_address': value(data, 'ip_address', 100),
        'mac_address': value(data, 'mac_address', 100),
        'status': choice(data, 'status', TICKET_STATUSES, 'open'),
        'priority': choice(data, 'priority', PRIORITIES, 'normal'),
        'due_date': date_value(data, 'due_date'),
        'notes': value(data, 'notes', 8000),
        'project_id': optional_id(data, 'project_id', 'projects'),
    }
    if not result['ticket_number'] or not result['description']:
        raise ValueError('Ticket number and description are required.')
    if result['status'] == 'transferred' and not result['transfer_to']:
        raise ValueError('Choose the destination team for a transferred ticket.')
    return result


def project_payload(data):
    result = {
        'name': value(data, 'name', 200),
        'description': value(data, 'description', 6000),
        'site': value(data, 'site', 200),
        'status': choice(data, 'status', PROJECT_STATUSES, 'planned'),
        'start_date': date_value(data, 'start_date'),
        'due_date': date_value(data, 'due_date'),
        'notes': value(data, 'notes', 8000),
    }
    if not result['name']:
        raise ValueError('Project name is required.')
    return result


def task_payload(data):
    result = {
        'title': value(data, 'title', 250),
        'details': value(data, 'details', 6000),
        'task_date': date_value(data, 'task_date'),
        'status': choice(data, 'status', TASK_STATUSES, 'todo'),
        'priority': choice(data, 'priority', PRIORITIES, 'normal'),
        'project_id': optional_id(data, 'project_id', 'projects'),
        'ticket_id': optional_id(data, 'ticket_id', 'tickets'),
    }
    if not result['title']:
        raise ValueError('Task title is required.')
    return result


def phase_payload(data):
    project_id = optional_id(data, 'project_id', 'projects')
    if not project_id:
        raise ValueError('A project is required.')
    result = {
        'project_id': project_id,
        'name': value(data, 'name', 200),
        'status': choice(data, 'status', PHASE_STATUSES, 'not_started'),
        'due_date': date_value(data, 'due_date'),
    }
    if not result['name']:
        raise ValueError('Phase name is required.')
    return result


def insert(table, payload):
    cols = list(payload)
    sql = f"INSERT INTO {table} ({','.join(cols)}) VALUES ({','.join('?' for _ in cols)})"
    with db() as c:
        cur = c.execute(sql, tuple(payload.values()))
        if table == 'tickets' and payload.get('status') == 'transferred':
            c.execute("UPDATE tickets SET transferred_at=datetime('now') WHERE id=?", (cur.lastrowid,))
            c.execute('INSERT INTO activity(kind,record_id,action,new_status,body,transfer_to) VALUES (?,?,?,?,?,?)',
                      ('ticket', cur.lastrowid, 'transfer', 'transferred', payload.get('transfer_reason',''), payload.get('transfer_to','')))
        c.commit()
        return cur.lastrowid


KIND_TABLES = {'ticket': 'tickets', 'project': 'projects', 'task': 'tasks', 'phase': 'project_phases'}
TABLE_KINDS = {v: k for k, v in KIND_TABLES.items()}
STATUS_OPTIONS = {'ticket': TICKET_STATUSES, 'project': PROJECT_STATUSES,
                  'task': TASK_STATUSES, 'phase': PHASE_STATUSES}


def update_status(kind, row_id, status, transfer_to='', transfer_reason=''):
    if kind not in KIND_TABLES or status not in STATUS_OPTIONS[kind]:
        raise ValueError('Invalid status or record type.')
    table = KIND_TABLES[kind]
    with db() as c:
        prev = c.execute(f'SELECT status, transfer_to FROM {table} WHERE id=?', (row_id,)).fetchone() if kind=='ticket' else c.execute(f'SELECT status FROM {table} WHERE id=?', (row_id,)).fetchone()
        if prev is None:
            raise LookupError('Record not found.')
        if kind == 'ticket' and status == 'transferred':
            transfer_to = str(transfer_to).strip()[:120]
            transfer_reason = str(transfer_reason).strip()[:3000]
            if not transfer_to:
                raise ValueError('Destination team is required for transfer.')
            if prev['status'] != status or prev['transfer_to'] != transfer_to:
                c.execute("UPDATE tickets SET status=?,transfer_to=?,transfer_reason=?,transferred_at=datetime('now'),updated_at=datetime('now') WHERE id=?",
                          ('transferred',transfer_to,transfer_reason,row_id))
                c.execute('INSERT INTO activity(kind,record_id,action,old_status,new_status,body,transfer_to) VALUES (?,?,?,?,?,?,?)',
                          (kind,row_id,'transfer',prev['status'],status,transfer_reason,transfer_to))
        elif prev['status'] != status:
            c.execute(f"UPDATE {table} SET status=?,updated_at=datetime('now') WHERE id=?", (status, row_id))
            c.execute('INSERT INTO activity(kind,record_id,action,old_status,new_status) VALUES (?,?,?,?,?)',
                      (kind, row_id, 'status', prev['status'], status))
        c.commit()


def add_note(kind, row_id, note):
    if kind not in KIND_TABLES:
        raise ValueError('Invalid record type.')
    note = str(note).strip()[:6000]
    if not note:
        raise ValueError('Please enter an update note.')
    with db() as c:
        if c.execute(f'SELECT id FROM {KIND_TABLES[kind]} WHERE id=?', (row_id,)).fetchone() is None:
            raise LookupError('Record not found.')
        c.execute('INSERT INTO activity(kind,record_id,action,body) VALUES (?,?,?,?)',
                  (kind, row_id, 'note', note))
        c.commit()


def list_updates(kind, row_id):
    if kind not in KIND_TABLES:
        raise ValueError('Invalid record type.')
    return rows('SELECT * FROM activity WHERE kind=? AND record_id=? ORDER BY id DESC', (kind, row_id))


def update(table, row_id, payload):
    cols = list(payload)
    sql = f"UPDATE {table} SET {','.join(k+'=?' for k in cols)},updated_at=datetime('now') WHERE id=?"
    with db() as c:
        # Fetch every persisted field before comparing form edits (not only the status).
        prev = c.execute(f'SELECT * FROM {table} WHERE id=?', (row_id,)).fetchone()
        if prev is None:
            raise LookupError('Record not found.')
        # Preserve meaningful edit history across future weeks/months; avoid logging a no-op save.
        changed = [k for k,v in payload.items() if prev[k] != v]
        if not changed:
            return
        c.execute(sql, (*payload.values(), row_id))
        if table=='tickets' and payload['status']=='transferred' and (prev['status']!='transferred' or prev['transfer_to']!=payload['transfer_to']):
            c.execute("UPDATE tickets SET transferred_at=datetime('now') WHERE id=?", (row_id,))
            c.execute('INSERT INTO activity(kind,record_id,action,old_status,new_status,body,transfer_to) VALUES (?,?,?,?,?,?,?)',
                      ('ticket',row_id,'transfer',prev['status'],'transferred',payload['transfer_reason'],payload['transfer_to']))
        elif 'status' in payload and prev['status'] != payload['status']:
            c.execute('INSERT INTO activity(kind,record_id,action,old_status,new_status) VALUES (?,?,?,?,?)',
                      (TABLE_KINDS[table], row_id, 'status', prev['status'], payload['status']))
        detail_changes = [key for key in changed if key not in ('status','transfer_to')]
        if detail_changes:
            detail = 'Updated: ' + ', '.join(key.replace('_',' ').title() for key in detail_changes)
            c.execute('INSERT INTO activity(kind,record_id,action,body) VALUES (?,?,?,?)',
                      (TABLE_KINDS[table],row_id,'edit',detail))
        c.commit()


def delete(table, row_id):
    with db() as c:
        cur = c.execute(f'DELETE FROM {table} WHERE id=?', (row_id,))
        if not cur.rowcount:
            raise LookupError('Record not found.')
        c.execute('DELETE FROM activity WHERE kind=? AND record_id=?', (TABLE_KINDS[table], row_id))
        if TABLE_KINDS[table] in IMAGE_OWNER_TABLES:
            c.execute('DELETE FROM record_images WHERE kind=? AND record_id=?', (TABLE_KINDS[table], row_id))
        if table == 'projects':
            c.execute("DELETE FROM activity WHERE kind='phase' AND record_id NOT IN (SELECT id FROM project_phases)")
        c.commit()


def list_projects():
    return rows('''SELECT p.*, COUNT(ph.id) AS phase_count,
                   COALESCE(SUM(CASE WHEN ph.status='completed' THEN 1 ELSE 0 END),0) AS phase_done,
                   (SELECT COUNT(*) FROM tickets t WHERE t.project_id=p.id AND t.status NOT IN ('closed','transferred')) AS active_tickets
                   FROM projects p LEFT JOIN project_phases ph ON ph.project_id=p.id
                   GROUP BY p.id ORDER BY CASE p.status WHEN 'in_progress' THEN 0 WHEN 'planned' THEN 1 WHEN 'on_hold' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END, p.due_date='',p.due_date,p.name''')


def list_tickets():
    return rows('''SELECT t.*, p.name AS project_name FROM tickets t
                   LEFT JOIN projects p ON p.id=t.project_id
                   ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'pending' THEN 2 WHEN 'transferred' THEN 3 ELSE 4 END,
                   t.created_at DESC,t.id DESC''')


def list_tasks():
    return rows('''SELECT t.*,p.name AS project_name,k.ticket_number AS ticket_number
                   FROM tasks t LEFT JOIN projects p ON p.id=t.project_id
                   LEFT JOIN tickets k ON k.id=t.ticket_id
                   ORDER BY t.task_date='',t.task_date ASC, CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,t.id DESC''')



def notes_payload(data):
    kind = value(data, 'linked_kind', 20)
    if kind and kind not in NOTE_LINK_TABLES:
        raise ValueError('Invalid related record type.')
    linked_id = optional_id(data, 'linked_id', NOTE_LINK_TABLES[kind]) if kind else None
    result = {
        'title': value(data, 'title', 200),
        'body': value(data, 'body', 50000),
        'folder': value(data, 'folder', 90) or 'General',
        'category': value(data, 'category', 90),
        'tags': value(data, 'tags', 300),
        'color': choice(data, 'color', NOTE_COLORS, 'blue'),
        'pinned': 1 if data.get('pinned') is True or data.get('pinned') in (1, '1', 'true', 'on') else 0,
        'archived': 1 if data.get('archived') is True or data.get('archived') in (1, '1', 'true', 'on') else 0,
        'linked_kind': kind,
        'linked_id': linked_id,
    }
    if not result['title']:
        raise ValueError('Note title is required.')
    return result


def folder_name(data):
    name = value(data, 'name', 90)
    if not name:
        raise ValueError('Folder name is required.')
    if any(ord(c) < 32 for c in name):
        raise ValueError('Folder name contains unsupported characters.')
    return name


def list_note_folders():
    return rows('''SELECT f.id, f.name, f.created_at, COUNT(n.id) AS note_count
        FROM note_folders AS f LEFT JOIN notes AS n ON n.folder = f.name COLLATE NOCASE
        GROUP BY f.id ORDER BY CASE WHEN f.name='General' THEN 0 ELSE 1 END, f.name COLLATE NOCASE''')


def create_note_folder(name):
    with db() as c:
        existing = c.execute('SELECT id FROM note_folders WHERE name=? COLLATE NOCASE', (name,)).fetchone()
        if existing:
            raise ValueError('That folder already exists.')
        return c.execute('INSERT INTO note_folders(name) VALUES (?)', (name,)).lastrowid


def update_note_folder(folder_id, new_name):
    with db() as c:
        original = c.execute('SELECT name FROM note_folders WHERE id=?', (folder_id,)).fetchone()
        if not original:
            raise LookupError('Folder not found.')
        if original['name'].lower() == 'general':
            raise ValueError('The General folder cannot be renamed.')
        if c.execute('SELECT id FROM note_folders WHERE name=? COLLATE NOCASE AND id!=?', (new_name, folder_id)).fetchone():
            raise ValueError('That folder already exists.')
        c.execute('UPDATE note_folders SET name=? WHERE id=?', (new_name, folder_id))
        # Note timestamps are deliberately unchanged; organizing folders is not user work activity.
        c.execute('UPDATE notes SET folder=? WHERE folder=? COLLATE NOCASE', (new_name, original['name']))


def remove_note_folder(folder_id):
    with db() as c:
        original = c.execute('SELECT name FROM note_folders WHERE id=?', (folder_id,)).fetchone()
        if not original:
            raise LookupError('Folder not found.')
        if original['name'].lower() == 'general':
            raise ValueError('The General folder cannot be deleted.')
        moved = c.execute("UPDATE notes SET folder='General' WHERE folder=? COLLATE NOCASE", (original['name'],)).rowcount
        c.execute('DELETE FROM note_folders WHERE id=?', (folder_id,))
        return moved


def list_notes():
    return rows('SELECT * FROM notes ORDER BY archived ASC, pinned DESC, updated_at DESC, id DESC')


def save_note(payload, row_id=None):
    with db() as c:
        # Preserve existing quick-entry behavior: typing a folder name while editing creates it.
        folder = c.execute('SELECT name FROM note_folders WHERE name=? COLLATE NOCASE', (payload['folder'],)).fetchone()
        if folder:
            payload['folder'] = folder['name']
        else:
            c.execute('INSERT INTO note_folders(name) VALUES (?)', (payload['folder'],))
        columns = list(payload)
        if row_id is None:
            cur = c.execute(f"INSERT INTO notes ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})", list(payload.values()))
            return cur.lastrowid
        cur = c.execute(f"UPDATE notes SET {','.join(k+'=?' for k in columns)}, updated_at=datetime('now') WHERE id=?", [*payload.values(), row_id])
        if not cur.rowcount:
            raise LookupError('Note not found.')
        return row_id


def delete_note(row_id):
    with db() as c:
        result = c.execute('DELETE FROM notes WHERE id=?', (row_id,))
        if not result.rowcount:
            raise LookupError('Note not found.')
        c.execute("DELETE FROM record_images WHERE kind='note' AND record_id=?", (row_id,))


def backup(to_path=None):
    if to_path is None:
        to_path = BACKUP_DIR / ('work_tracker_' + datetime.now().strftime('%Y%m%d_%H%M%S_%f') + '.sqlite3')
    target = sqlite3.connect(str(to_path))
    try:
        with db() as c:
            c.backup(target)
        target.commit()
    finally:
        target.close()
    return to_path


def rolling_backup():
    """Safely refresh a restorable database copy after data changes."""
    with BACKUP_LOCK:
        working = BACKUP_DIR / '.work_tracker_latest.tmp.sqlite3'
        current = BACKUP_DIR / 'work_tracker_latest.sqlite3'
        try:
            backup(working)
            os.replace(working, current)
        finally:
            if working.exists():
                working.unlink()


def safe_rolling_backup():
    try:
        rolling_backup()
    except Exception as e:
        print('WARNING: Backup could not be updated:', repr(e), file=sys.stderr)


def daily_backup():
    if any(BACKUP_DIR.glob('work_tracker_' + date.today().strftime('%Y%m%d') + '_*.sqlite3')):
        return
    backup()


def safe_csv_cell(val):
    if val is None:
        return ''
    s = str(val)
    if s.startswith(('=', '+', '-', '@', '\t', '\r', '\n')):
        return "'" + s
    return s



# Clipboard image uploads are validated, local-only and embedded in the SQLite backup.
IMAGE_OWNER_TABLES = {'ticket': 'tickets', 'project': 'projects', 'task': 'tasks', 'note': 'notes'}
IMAGE_MAX_BYTES = 5 * 1024 * 1024
IMAGE_MAX_PER_RECORD = 40
IMAGE_MIME = {'image/png', 'image/jpeg', 'image/webp', 'image/gif'}


def image_metadata():
    return rows('SELECT id,kind,record_id,image_type,filename,length(image_bytes) AS size,created_at '
                'FROM record_images ORDER BY id')


def image_bytes_for(image_id):
    with db() as conn:
        result = conn.execute('SELECT image_bytes,image_type FROM record_images WHERE id=?', (image_id,)).fetchone()
        if result is None:
            raise LookupError('Image not found.')
        return bytes(result['image_bytes']), result['image_type']


def save_clipboard_image(payload):
    kind = payload.get('kind')
    if kind not in IMAGE_OWNER_TABLES:
        raise ValueError('Invalid screenshot owner.')
    try:
        record_id = int(payload.get('record_id'))
    except (TypeError, ValueError):
        raise ValueError('Invalid record ID.')
    mime = payload.get('image_type')
    if mime not in IMAGE_MIME:
        raise ValueError('Only PNG, JPEG, WEBP and GIF images are supported.')
    raw = payload.get('data')
    if not isinstance(raw, str) or len(raw) > 7 * 1024 * 1024:
        raise ValueError('Screenshot is too large (maximum 5 MB).')
    try:
        content = base64.b64decode(raw, validate=True)
    except (ValueError, binascii.Error):
        raise ValueError('Invalid image data.')
    if not content or len(content) > IMAGE_MAX_BYTES:
        raise ValueError('Screenshot is too large (maximum 5 MB).')
    valid = (mime == 'image/png' and content.startswith(b'\x89PNG\r\n\x1a\n')) or \
            (mime == 'image/jpeg' and content.startswith(b'\xff\xd8\xff')) or \
            (mime == 'image/gif' and content[:6] in (b'GIF87a', b'GIF89a')) or \
            (mime == 'image/webp' and content.startswith(b'RIFF') and content[8:12] == b'WEBP')
    if not valid:
        raise ValueError('The image file type does not match its contents.')
    filename = payload.get('filename', 'clipboard-image')
    filename = re.sub(r'[^A-Za-z0-9._-]', '_', filename if isinstance(filename,str) else '')[:120] or 'clipboard-image'
    with db() as conn:
        if conn.execute(f'SELECT id FROM {IMAGE_OWNER_TABLES[kind]} WHERE id=?',(record_id,)).fetchone() is None:
            raise LookupError('Related record not found.')
        count = conn.execute('SELECT COUNT(*) FROM record_images WHERE kind=? AND record_id=?',(kind,record_id)).fetchone()[0]
        if count >= IMAGE_MAX_PER_RECORD:
            raise ValueError('Maximum 40 images per record.')
        cursor = conn.execute('INSERT INTO record_images(kind,record_id,image_type,filename,image_bytes) '
                              'VALUES(?,?,?,?,?)',(kind,record_id,mime,filename,content))
        return cursor.lastrowid


def delete_clipboard_image(image_id):
    with db() as conn:
        if not conn.execute('DELETE FROM record_images WHERE id=?',(image_id,)).rowcount:
            raise LookupError('Image not found.')

def make_csv(kind):
    if kind == 'tickets':
        names = ('ticket_number', 'description', 'site', 'ticket_user', 'transfer_to', 'transfer_reason', 'transferred_at', 'ip_address', 'mac_address', 'status', 'priority', 'due_date', 'project_name', 'notes', 'created_at', 'updated_at')
        data = list_tickets()
    elif kind == 'projects':
        names = ('name', 'description', 'site', 'status', 'start_date', 'due_date', 'phase_count', 'phase_done', 'active_tickets', 'notes', 'created_at', 'updated_at')
        data = list_projects()
    elif kind == 'tasks':
        names = ('title', 'details', 'task_date', 'status', 'priority', 'project_name', 'ticket_number', 'created_at', 'updated_at')
        data = list_tasks()
    elif kind == 'phases':
        names = ('project_name', 'name', 'status', 'due_date', 'sort_order', 'created_at', 'updated_at')
        data = rows('''SELECT p.name AS project_name,ph.* FROM project_phases ph
                       INNER JOIN projects p ON p.id=ph.project_id ORDER BY p.name,ph.sort_order,ph.id''')
    elif kind == 'activity':
        names = ('kind','record_id','action','old_status','new_status','body','transfer_to','created_at')
        data = rows('SELECT * FROM activity ORDER BY id DESC')
    else:
        raise LookupError('Unknown report.')
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(names)
    for item in data:
        writer.writerow([safe_csv_cell(item.get(n)) for n in names])
    return ('\ufeff' + buf.getvalue()).encode('utf-8')


class Handler(BaseHTTPRequestHandler):
    server_version = 'WorkTracker/' + APP_VERSION

    def log_message(self, fmt, *args):
        if not self.path.startswith('/api/'):
            return
        print('[WorkTracker]', fmt % args)

    def send_bytes(self, body, content_type, status=200, filename=None):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if filename:
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(body)

    def reply(self, data, status=200):
        self.send_bytes(json.dumps(data, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8', status)

    def error(self, code, message):
        self.reply({'error': message}, code)

    def read_json(self):
        length = int(self.headers.get('Content-Length', '0'))
        if not (0 < length < 1024 * 1024):
            raise ValueError('Invalid request size.')
        data = json.loads(self.rfile.read(length).decode('utf-8'))
        if not isinstance(data, dict):
            raise ValueError('Expected an object.')
        return data

    def read_image_json(self):
        # The normal JSON request limit remains 1 MB; only clipboard uploads use this allowance.
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            raise ValueError('Invalid upload size.')
        if not 0 < length < 8 * 1024 * 1024:
            raise ValueError('Image upload exceeds the allowed size.')
        payload = json.loads(self.rfile.read(length).decode('utf-8'))
        if not isinstance(payload, dict):
            raise ValueError('Expected an image object.')
        return payload

    def process(self, method):
        path = urlsplit(self.path).path
        try:
            if method == 'GET':
                if path == '/' or path == '/index.html':
                    return self.send_bytes((APP_DIR / 'index.html').read_bytes(), 'text/html; charset=utf-8')
                if path == '/styles.css':
                    return self.send_bytes((APP_DIR / 'styles.css').read_bytes(), 'text/css; charset=utf-8')
                if path == '/app.js':
                    return self.send_bytes((APP_DIR / 'app.js').read_bytes(), 'text/javascript; charset=utf-8')
                if path == '/favicon.ico':
                    return self.send_bytes((APP_DIR / 'favicon.ico').read_bytes(), 'image/x-icon')
                if path == '/app-icon.png':
                    return self.send_bytes((APP_DIR / 'app-icon.png').read_bytes(), 'image/png')
                if path == '/api/attachments':
                    return self.reply(image_metadata())
                match_image = re.fullmatch(r'/api/attachments/(\d+)/image', path)
                if match_image:
                    data, mime = image_bytes_for(int(match_image.group(1)))
                    return self.send_bytes(data, mime)
                if path == '/api/manuals':
                    return self.reply(list_manuals())
                if path == '/api/tickets':
                    return self.reply(list_tickets())
                if path == '/api/projects':
                    return self.reply(list_projects())
                if path == '/api/tasks':
                    return self.reply(list_tasks())
                if path == '/api/notes':
                    return self.reply(list_notes())
                if path == '/api/note-folders':
                    return self.reply(list_note_folders())
                if path == '/api/phases':
                    return self.reply(rows('SELECT * FROM project_phases ORDER BY project_id,sort_order,id'))
                if path == '/api/updates':
                    q = parse_qs(urlsplit(self.path).query)
                    kind = (q.get('kind') or [''])[0]
                    raw_id = (q.get('record_id') or [''])[0]
                    if not raw_id.isdigit():
                        raise ValueError('Invalid record ID.')
                    return self.reply(list_updates(kind, int(raw_id)))
                if path == '/api/overview':
                    today = date.today().isoformat()
                    return self.reply({
                        'tickets_open': one("SELECT COUNT(*) AS n FROM tickets WHERE status NOT IN ('closed','transferred')")['n'],
                        'tickets_closed': one("SELECT COUNT(*) AS n FROM tickets WHERE status='closed'")['n'],
                        'tickets_transferred': one("SELECT COUNT(*) AS n FROM tickets WHERE status='transferred'")['n'],
                        'ticket_status_counts': {status: one('SELECT COUNT(*) AS n FROM tickets WHERE status=?',(status,))['n'] for status in TICKET_STATUSES},
                        'tickets_pending': one("SELECT COUNT(*) AS n FROM tickets WHERE status='pending'")['n'],
                        'projects_active': one("SELECT COUNT(*) AS n FROM projects WHERE status NOT IN ('completed','cancelled')")['n'],
                        'tasks_open': one("SELECT COUNT(*) AS n FROM tasks WHERE status!='done'")['n'],
                        'tasks_today': one("SELECT COUNT(*) AS n FROM tasks WHERE (task_date=? OR task_date='') AND status!='done'", (today,))['n'],
                        'tasks_overdue': one("SELECT COUNT(*) AS n FROM tasks WHERE task_date!='' AND task_date<? AND status!='done'", (today,))['n'],
                        'today': today,
                    })
                if path == '/api/settings':
                    return self.reply({'data_folder': str(DATA_DIR), 'database_file': str(DB_PATH), 'backups_folder': str(BACKUP_DIR), 'app_version': APP_VERSION, 'manuals_folder': str(MANUALS_DIR)})
                if path in ('/api/reports/weekly', '/api/reports/weekly.pdf', '/api/reports/monthly', '/api/reports/monthly.pdf'):
                    query = parse_qs(urlsplit(self.path).query)
                    selected_date = (query.get('start') or [date.today().isoformat()])[0]
                    modules = (query.get('modules') or ['tickets,projects,tasks'])[0]
                    report = monthly_data(db, selected_date, modules) if 'monthly' in path else weekly_data(db, selected_date, modules)
                    if path.endswith('.pdf'):
                        data = create_weekly_pdf(report)
                        return self.send_bytes(data, 'application/pdf', filename=f'work_tracker_{report["period_kind"]}_{report["start"]}_to_{report["end"]}.pdf')
                    return self.reply(report)
                match = re.fullmatch(r'/api/reports/(tickets|projects|tasks|phases|activity)\.csv', path)
                if match:
                    name = match.group(1)
                    return self.send_bytes(make_csv(name), 'text/csv; charset=utf-8', filename=f'work_tracker_{name}_{date.today().isoformat()}.csv')
                if path == '/api/backup/download':
                    import tempfile
                    fd, name = tempfile.mkstemp(prefix='work_tracker_', suffix='.sqlite3')
                    os.close(fd)
                    try:
                        b = backup(Path(name)).read_bytes()
                    finally:
                        os.unlink(name)
                    return self.send_bytes(b, 'application/octet-stream', filename=f'work_tracker_backup_{datetime.now().strftime("%Y%m%d_%H%M")}.sqlite3')
            elif method in ('POST', 'PUT', 'DELETE'):
                if path == '/api/attachments' and method == 'POST':
                    origin = self.headers.get('Origin', '')
                    if origin and origin not in (f'http://127.0.0.1:{PORT}', f'http://localhost:{PORT}'):
                        raise ValueError('Invalid origin.')
                    result_id = save_clipboard_image(self.read_image_json())
                    safe_rolling_backup()
                    return self.reply({'ok': True, 'id': result_id})
                remove_image = re.fullmatch(r'/api/attachments/(\d+)', path)
                if remove_image and method == 'DELETE':
                    origin = self.headers.get('Origin', '')
                    if origin and origin not in (f'http://127.0.0.1:{PORT}', f'http://localhost:{PORT}'):
                        raise ValueError('Invalid origin.')
                    delete_clipboard_image(int(remove_image.group(1)))
                    safe_rolling_backup()
                    return self.reply({'ok': True})
                if path == '/api/manuals/open' and method == 'POST':
                    origin = self.headers.get('Origin', '')
                    if origin and origin not in (f'http://127.0.0.1:{PORT}', f'http://localhost:{PORT}'):
                        raise ValueError('Invalid origin.')
                    opened = self.read_json().get('path')
                    open_manual(opened)
                    return self.reply({'ok': True})
                if method == 'POST' and path in ('/api/status', '/api/updates'):
                    data = self.read_json()
                    kind = value(data, 'kind', 20)
                    try:
                        row_id = int(data.get('record_id', 0))
                    except (TypeError, ValueError):
                        raise ValueError('Invalid record ID.')
                    if row_id <= 0:
                        raise ValueError('Invalid record ID.')
                    if path == '/api/status':
                        update_status(kind, row_id, value(data, 'status', 50), value(data,'transfer_to',120), value(data,'transfer_reason',3000))
                    else:
                        add_note(kind, row_id, value(data, 'note', 6000))
                    safe_rolling_backup()
                    return self.reply({'ok': True})
                folder_match = re.fullmatch(r'/api/note-folders(?:/(\d+))?', path)
                if folder_match:
                    folder_id = int(folder_match.group(1)) if folder_match.group(1) else None
                    if method == 'POST' and folder_id is None:
                        name = folder_name(self.read_json())
                        new_id = create_note_folder(name)
                        safe_rolling_backup()
                        return self.reply({'id':new_id,'name':name})
                    if method == 'PUT' and folder_id is not None:
                        name = folder_name(self.read_json())
                        update_note_folder(folder_id,name)
                        safe_rolling_backup()
                        return self.reply({'ok':True,'name':name})
                    if method == 'DELETE' and folder_id is not None:
                        moved = remove_note_folder(folder_id)
                        safe_rolling_backup()
                        return self.reply({'ok':True,'moved':moved})
                    raise ValueError('Invalid folder operation.')
                note_match = re.fullmatch(r'/api/notes(?:/(\d+))?', path)
                if note_match:
                    row_id = int(note_match.group(1)) if note_match.group(1) else None
                    if method == 'DELETE':
                        if row_id is None:
                            raise ValueError('Missing note ID.')
                        delete_note(row_id)
                        safe_rolling_backup()
                        return self.reply({'ok': True})
                    if method == 'POST' and row_id is not None:
                        raise ValueError('Unexpected note ID.')
                    if method == 'PUT' and row_id is None:
                        raise ValueError('Missing note ID.')
                    payload = notes_payload(self.read_json())
                    saved_id = save_note(payload, row_id)
                    safe_rolling_backup()
                    return self.reply({'ok': True, 'id': saved_id})
                match = re.fullmatch(r'/api/(tickets|projects|tasks|phases)(?:/(\d+))?', path)
                if not match:
                    if path == '/api/backup/create' and method == 'POST':
                        return self.reply({'saved_to': str(backup())})
                    raise LookupError('Unknown endpoint.')
                entity, rawid = match.groups()
                rowid = int(rawid) if rawid else None
                table = {'tickets': 'tickets', 'projects': 'projects', 'tasks': 'tasks', 'phases': 'project_phases'}[entity]
                if method == 'DELETE':
                    if entity not in ('tasks', 'phases'):
                        raise ValueError('Tickets and projects are retained for history; only tasks and phases can be deleted.')
                    if rowid is None:
                        raise ValueError('Missing record ID.')
                    delete(table, rowid)
                    safe_rolling_backup()
                    return self.reply({'ok': True})
                data = self.read_json()
                payload = {'tickets': ticket_payload, 'projects': project_payload, 'tasks': task_payload, 'phases': phase_payload}[entity](data)
                if entity == 'phases' and method == 'POST':
                    with db() as c:
                        mx = c.execute('SELECT COALESCE(MAX(sort_order),-1)+1 FROM project_phases WHERE project_id=?', (payload['project_id'],)).fetchone()[0]
                    payload['sort_order'] = mx
                if method == 'POST':
                    if rowid is not None:
                        raise ValueError('Unexpected record ID.')
                    result_id = insert(table, payload)
                else:
                    if rowid is None:
                        raise ValueError('Missing record ID.')
                    if entity == 'phases':
                        previous = one('SELECT project_id FROM project_phases WHERE id=?', (rowid,))
                        if previous and previous['project_id'] != payload['project_id']:
                            raise ValueError('Cannot move phase to a different project.')
                    update(table, rowid, payload)
                    result_id = rowid
                safe_rolling_backup()
                return self.reply({'id': result_id, 'ok': True})
            raise LookupError('Unknown endpoint.')
        except LookupError as e:
            self.error(404, str(e))
        except (ValueError, json.JSONDecodeError) as e:
            self.error(400, str(e))
        except sqlite3.IntegrityError as e:
            message = 'This ticket number already exists.' if 'ticket_number' in str(e) else 'Database constraint failed.'
            self.error(409, message)
        except Exception as e:
            print('ERROR:', repr(e), file=sys.stderr)
            self.error(500, 'Internal application error.')

    def do_GET(self):
        self.process('GET')

    def do_POST(self):
        self.process('POST')

    def do_PUT(self):
        self.process('PUT')

    def do_DELETE(self):
        self.process('DELETE')


def watch_for_stop_request(server):
    """Shut down gracefully when the desktop Stop shortcut requests it."""
    import time
    while True:
        if STOP_REQUEST_FILE.exists():
            try:
                STOP_REQUEST_FILE.unlink()
            except OSError:
                pass
            server.shutdown()  # Run from a different thread than serve_forever().
            return
        time.sleep(0.5)


def main():
    # Ignore a stale stop file left while the server was not running.
    try:
        STOP_REQUEST_FILE.unlink(missing_ok=True)
    except OSError:
        pass
    init_db()
    daily_backup()
    safe_rolling_backup()
    host = ('127.0.0.1', PORT)
    try:
        server = ThreadingHTTPServer(host, Handler)
    except OSError as e:
        print(f'Unable to start on port {PORT}: {e}')
        print(f'If Work Tracker is already running, open http://127.0.0.1:{PORT}')
        raise SystemExit(1)
    threading.Thread(target=watch_for_stop_request, args=(server,), daemon=True).start()
    url = f'http://127.0.0.1:{PORT}'
    print('\nWORK TRACKER - Local only')
    print('Browser:', url)
    print('Database:', DB_PATH)
    print('Backups:', BACKUP_DIR)
    print('Close this window to stop the app. Your data remains saved.\n')
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
