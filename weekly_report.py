"""Weekly Work Tracker reports; PDF writer uses only Python's standard library.

SQLite timestamps are UTC; report weeks use the workstation's local calendar.
The PDF uses standard PDF built-in fonts (WinAnsi), with no external packages.
"""
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
import re

MODULES = ('tickets', 'projects', 'tasks')
TITLES = {'tickets':'Tickets', 'projects':'Projects', 'tasks':'Tasks'}
STATUS_LABELS = {
 'open':'Open', 'in_progress':'In Progress', 'pending':'Pending', 'closed':'Closed', 'transferred':'Transferred',
 'planned':'Planned', 'on_hold':'On Hold', 'completed':'Completed', 'cancelled':'Cancelled',
 'todo':'To Do', 'done':'Done', 'normal':'Normal', 'low':'Low', 'high':'High', 'urgent':'Urgent'
}


def parse_period(raw, period_kind='weekly'):
    try:
        day = date.fromisoformat(raw)
    except (ValueError, TypeError):
        raise ValueError('Select a valid report date (YYYY-MM-DD).')
    if period_kind == 'monthly':
        first = day.replace(day=1)
        next_month = first.replace(year=first.year+1, month=1) if first.month == 12 else first.replace(month=first.month+1)
        return first, next_month-timedelta(days=1)
    monday = day - timedelta(days=day.weekday())
    return monday, monday + timedelta(days=6)


def parse_modules(raw):
    names = tuple(dict.fromkeys((raw or ','.join(MODULES)).split(',')))
    if not names or any(n not in MODULES for n in names):
        raise ValueError('Choose at least one valid report module.')
    return names


def local_dt(stamp):
    if not stamp:
        return None
    try:
        s = str(stamp).replace('T', ' ').removesuffix('Z')
        dt = datetime.strptime(s[:19], '%Y-%m-%d %H:%M:%S')
        return dt.replace(tzinfo=timezone.utc).astimezone()
    except (ValueError, TypeError):
        return None


def local_day(stamp):
    dt = local_dt(stamp)
    return dt.date() if dt else None


def friendly_stamp(stamp):
    dt = local_dt(stamp)
    return dt.strftime('%b %d, %Y %I:%M %p') if dt else str(stamp or '')


def weekly_data(connection_factory, selected_date, selected_modules=None):
    return activity_data(connection_factory,selected_date,selected_modules,'weekly')


def monthly_data(connection_factory, selected_date, selected_modules=None):
    return activity_data(connection_factory,selected_date,selected_modules,'monthly')


def activity_data(connection_factory, selected_date, selected_modules=None, period_kind='weekly'):
    monday, sunday = parse_period(selected_date, period_kind)
    period_label = 'month' if period_kind=='monthly' else 'week'
    modules = parse_modules(selected_modules)
    with connection_factory() as conn:
        acts = [dict(x) for x in conn.execute('SELECT * FROM activity ORDER BY created_at DESC,id DESC')]
        grouped = {}
        for a in acts:
            if a['kind'] not in ('ticket', 'project', 'task'):
                continue
            ld = local_day(a.get('created_at'))
            if ld is not None and monday <= ld <= sunday:
                a['local_time'] = friendly_stamp(a['created_at'])
                grouped.setdefault((a['kind'], a['record_id']), []).append(a)
        tables = {'tickets':'tickets','projects':'projects','tasks':'tasks'}
        result = {}
        for name in modules:
            kind = name[:-1]  # ticket, project, task
            records = [dict(x) for x in conn.execute(f'SELECT * FROM {tables[name]} ORDER BY id DESC')]
            items = []
            for r in records:
                reasons = []
                def stamp_reason(field, phrase):
                    d = local_day(r.get(field))
                    if d and monday <= d <= sunday:
                        reasons.append(phrase)
                def date_reason(field, phrase):
                    raw = r.get(field)
                    if raw:
                        try:
                            d = date.fromisoformat(raw)
                            if monday <= d <= sunday:
                                reasons.append(phrase)
                        except (ValueError, TypeError):
                            pass
                stamp_reason('created_at', 'Created this '+period_label)
                stamp_reason('updated_at', 'Modified this '+period_label)
                if name == 'tickets':
                    date_reason('due_date', 'Due this '+period_label)
                elif name == 'projects':
                    date_reason('start_date', 'Starts this '+period_label)
                    date_reason('due_date', 'Due this '+period_label)
                else:
                    date_reason('task_date', 'Scheduled this '+period_label)
                activity = grouped.get((kind, r['id']), [])
                if activity:
                    reasons.append('Updates this '+period_label)
                if name == 'projects':
                    milestones = [dict(ph) for ph in conn.execute(
                        'SELECT name,due_date,status FROM project_phases WHERE project_id=? ORDER BY id', (r['id'],))
                        if ph['due_date'] and monday.isoformat() <= ph['due_date'] <= sunday.isoformat()]
                    if milestones:
                        reasons.append('Phase milestone this '+period_label)
                    r['milestones'] = milestones
                if not reasons:
                    continue
                r['reasons'] = reasons
                r['activity'] = activity
                r['status_label'] = STATUS_LABELS.get(r.get('status'), r.get('status', ''))
                if name == 'tickets':
                    r['display_name'] = r['ticket_number']
                elif name == 'projects':
                    r['display_name'] = r['name']
                else:
                    r['display_name'] = r['title']
                items.append(r)
            result[name] = items
        summary = {'status_breakdown':{}, 'outcomes':{}, 'transfer_destinations':{}}
        status_choices={'tickets':['open','in_progress','pending','closed','transferred'],
                        'projects':['planned','in_progress','on_hold','completed','cancelled'],
                        'tasks':['todo','in_progress','done']}
        for module, items in result.items():
            summary['status_breakdown'][module] = {status: sum(i['status']==status for i in items) for status in status_choices[module]}
        ticket_items = result.get('tickets',[])
        project_items = result.get('projects',[])
        task_items = result.get('tasks',[])
        summary['outcomes']['tickets_worked'] = sum(any(x in i['reasons'] for x in ('Created this '+period_label,'Modified this '+period_label,'Updates this '+period_label)) for i in ticket_items)
        summary['outcomes']['tickets_created'] = sum('Created this '+period_label in i['reasons'] for i in ticket_items)
        summary['outcomes']['tickets_closed'] = sum(any(a['new_status']=='closed' for a in i['activity']) or (i['status']=='closed' and 'Created this '+period_label in i['reasons'] and not i['activity']) for i in ticket_items)
        summary['outcomes']['tickets_transferred'] = sum(any(a['new_status']=='transferred' for a in i['activity']) or (i['status']=='transferred' and 'Created this '+period_label in i['reasons'] and not i['activity']) for i in ticket_items)
        summary['outcomes']['projects_updated'] = sum(any('Created this '+period_label in x or 'Modified this '+period_label in x or 'Updates this '+period_label in x for x in i['reasons']) for i in project_items)
        summary['outcomes']['projects_completed'] = sum(any(a['new_status']=='completed' for a in i['activity']) or (i['status']=='completed' and 'Created this '+period_label in i['reasons'] and not i['activity']) for i in project_items)
        summary['outcomes']['tasks_completed'] = sum(any(a['new_status']=='done' for a in i['activity']) or (i['status']=='done' and 'Created this '+period_label in i['reasons'] and not i['activity']) for i in task_items)
        transfers={}
        for item in ticket_items:
            last = next((a for a in item['activity'] if a['new_status']=='transferred' and a.get('transfer_to')), None)
            if last:
                team=last['transfer_to']
                transfers[team]=transfers.get(team,0)+1
        summary['transfer_destinations']=transfers
    return {
      'start': monday.isoformat(), 'end': sunday.isoformat(), 'period_kind':period_kind,
      'generated_at': datetime.now().astimezone().strftime('%b %d, %Y %I:%M %p %Z'),
      'modules': list(modules), 'counts': {name:len(result[name]) for name in modules},
      'sections': result, 'summary': summary, 'owner': 'Gustavo Montano',
      'note': ('Items appear when created, modified, updated or scheduled during this local-time '+period_label+'. '
               'The displayed status reflects the current record, not a historical end-of-period snapshot. '
               'Dates are optional; undated items with activity are included.'),
    }


# Small, self-contained, multi-page PDF generator; built-in Helvetica fonts.
class PdfCanvas:
    WIDTH, HEIGHT = 612, 792
    def __init__(self):
        self.pages = []
        self.commands = []
        self.y = 0
        self.open_page()

    @staticmethod
    def _pdf_bytes(s):
        b = str(s).encode('cp1252', errors='replace')
        return b.replace(b'\\',b'\\\\').replace(b'(',b'\\(').replace(b')',b'\\)').replace(b'\n',b' ')

    def text(self, x, y, label, size=10, bold=False, color=(.12,.20,.31)):
        r,g,b = color
        self.commands.append(b'BT /F%d %.2f Tf %.3f %.3f %.3f rg 1 0 0 1 %.2f %.2f Tm (' % (
            2 if bold else 1, size, r,g,b,x,y) + self._pdf_bytes(label) + b') Tj ET\n')

    def rectangle(self, x, y, w, h, color):
        r,g,b=color
        self.commands.append(f'{r:.3f} {g:.3f} {b:.3f} rg {x:.2f} {y:.2f} {w:.2f} {h:.2f} re f\n'.encode('ascii'))

    def rule(self, y):
        self.rectangle(42,y,528,0.65,(.87,.90,.94))

    def open_page(self):
        if self.commands:
            self.pages.append(b''.join(self.commands))
        self.commands=[]
        self.rectangle(0, 728, self.WIDTH, 64, (.067,.169,.306))
        self.rectangle(0, 720, self.WIDTH, 8, (.090,.414,.702))
        self.text(42,767,'WORK TRACKER',10,True,(.75,.88,1))
        self.text(402,767,'GUSTAVO MONTANO',10,True,(.75,.88,1))
        self.text(42,743,getattr(self,'report_title','ACTIVITY REPORT'),19,True,(1,1,1))
        self.y=697

    def ensure(self, pixels):
        if self.y-pixels<55:
            self.open_page()

    @staticmethod
    def estimated_width(s,size,bold=False):
        # Deliberately conservative estimate to avoid right-margin clipping.
        width=0.0
        for ch in str(s):
            if ch in 'ilI.,:;!\'| ':
                width += .30
            elif ch in 'MW@%w':
                width += .94
            elif ch in 'ABCDEFGHKNOPQRSTUVXYZ':
                width += .68
            else:
                width += (.58 if bold else .54)
        return width*size*1.07

    def wrap(self, s, size=10, maxwidth=515, bold=False):
        segments = re.split(r'\r?\n', str(s if s is not None else ''))
        lines=[]
        for paragraph in segments:
            if not paragraph.strip():
                lines.append('')
                continue
            current=''
            for word in paragraph.split():
                if self.estimated_width(word,size,bold)>maxwidth:
                    # Split unusually long technical identifiers without overflowing.
                    chunks=[]
                    chunk=''
                    for char in word:
                        if chunk and self.estimated_width(chunk+char,size,bold)>maxwidth:
                            chunks.append(chunk);chunk=char
                        else:chunk+=char
                    if chunk:chunks.append(chunk)
                else:chunks=[word]
                for bit in chunks:
                    probe = f'{current} {bit}'.strip()
                    if current and self.estimated_width(probe,size,bold)>maxwidth:
                        lines.append(current)
                        current=bit
                    else:
                        current=probe
            if current:lines.append(current)
        return lines

    def paragraph(self, s, size=9, color=(.23,.32,.45), indent=0, leading=None, bold=False):
        leading=leading or size*1.48
        for line in self.wrap(s,size,528-indent,bold):
            self.ensure(leading+3)
            if line:self.text(42+indent,self.y,line,size,bold,color)
            self.y-=leading

    def section(self, text, n):
        self.ensure(49)
        self.y-=7
        self.rectangle(42,self.y-7,528,31,(.91,.95,.99))
        self.rectangle(42,self.y-7,4,31,(.09,.41,.70))
        self.text(54,self.y+3,text.upper(),11,True,(.07,.19,.35))
        self.text(508,self.y+3,str(n)+' items',9,False,(.38,.47,.58))
        self.y-=46

    def finish(self):
        if self.commands:self.pages.append(b''.join(self.commands))
        count=len(self.pages)
        obj=[b'']* (5+2*count)
        obj[1]=b'<< /Type /Catalog /Pages 2 0 R >>'
        kid_ids=[5+2*i for i in range(count)]
        obj[2]=b'<< /Type /Pages /Kids ['+b' '.join(f'{j} 0 R'.encode() for j in kid_ids)+b'] /Count '+str(count).encode()+b' >>'
        obj[3]=b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
        obj[4]=b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
        for idx,stream in enumerate(self.pages):
            page_id=5+2*idx
            content_id=page_id+1
            footer=(b'BT /F1 8 Tf .44 .53 .63 rg 1 0 0 1 42 30 Tm (Work Tracker | Local report) Tj ET\n'
                    +f'BT /F1 8 Tf .44 .53 .63 rg 1 0 0 1 492 30 Tm (Page {idx+1} of {count}) Tj ET\n'.encode())
            stream+=footer
            obj[page_id]=(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {content_id} 0 R >>').encode()
            obj[content_id]=(f'<< /Length {len(stream)} >>\nstream\n').encode()+stream+b'endstream'
        out=BytesIO();out.write(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
        offsets=[0]*len(obj)
        for idx in range(1,len(obj)):
            offsets[idx]=out.tell();out.write(f'{idx} 0 obj\n'.encode()+obj[idx]+b'\nendobj\n')
        off=out.tell();out.write(f'xref\n0 {len(obj)}\n'.encode()+b'0000000000 65535 f \n')
        for idx in range(1,len(obj)):
            out.write(f'{offsets[idx]:010d} 00000 n \n'.encode())
        out.write((f'trailer << /Size {len(obj)} /Root 1 0 R >>\nstartxref\n{off}\n%%EOF').encode())
        return out.getvalue()


def create_weekly_pdf(report):
    c=PdfCanvas()
    c.report_title=report.get('period_kind','weekly').upper()+' ACTIVITY REPORT'
    c.pages=[]
    c.commands=[]
    c.open_page()
    begin=date.fromisoformat(report['start']).strftime('%b %d, %Y')
    end=date.fromisoformat(report['end']).strftime('%b %d, %Y')
    c.paragraph(f'Report period: {begin} - {end}',12,(.08,.23,.41),bold=True)
    c.paragraph(f'Prepared for: {report.get("owner","Gustavo Montano")}',9,bold=True)
    c.paragraph(f'Generated: {report["generated_at"]}',9)
    c.y-=10
    c.rectangle(42,c.y-37,528,49,(.94,.97,1.0))
    module_summaries=[f'{TITLES[k]}: {report["counts"][k]}' for k in report['modules']]
    c.text(54,c.y-8,'    |    '.join(module_summaries),11,True,(.08,.32,.57))
    c.y-=59
    summary = report['summary']
    outcomes = summary['outcomes']
    if 'tickets' in report['modules']:
        c.paragraph('TICKET ACTIVITY & RESULTS',10,(.06,.33,.61),bold=True)
        c.paragraph('Worked: {tickets_worked}   |   New: {tickets_created}   |   Closed in period: {tickets_closed}   |   Transferred in period: {tickets_transferred}'.format(**outcomes),9,bold=True)
        statuses=summary['status_breakdown']['tickets']
        c.paragraph('Current status of listed tickets: '+ '   |   '.join(f'{STATUS_LABELS[k]}: {n}' for k,n in statuses.items()),8.5)
        if summary['transfer_destinations']:
            c.paragraph('Transfers by team (within period): '+', '.join(f'{team}: {n}' for team,n in summary['transfer_destinations'].items()),8.5)
    for module in ('projects','tasks'):
        if module in report['modules']:
            c.y-=5
            statuses=summary['status_breakdown'][module]
            c.paragraph(TITLES[module].upper()+' - STATUS BREAKDOWN (CURRENT)',9.3,(.06,.33,.61),bold=True)
            c.paragraph('   |   '.join(f'{STATUS_LABELS[k]}: {n}' for k,n in statuses.items()),8.5)
    c.y-=7
    c.paragraph(report['note'],8.2,(.36,.45,.57))
    c.y-=11
    for key in report['modules']:
        items=report['sections'][key]
        if items: c.ensure(150)  # Keep section heading together with its first record.
        c.section(TITLES[key],len(items))
        if not items:
            c.paragraph('No records with activity or scheduled dates in this period.',9)
            c.y-=10
            continue
        for item in items:
            c.ensure(58)
            c.paragraph(item['display_name'],11,(.07,.23,.42),bold=True)
            c.paragraph(f'Current status: {item["status_label"]}  |  Reasons: {", ".join(item["reasons"])}',8.5)
            if key=='tickets':
                c.paragraph(f'Site: {item["site"] or "-"}  |  User: {item.get("ticket_user") or "-"}  |  Priority: {STATUS_LABELS.get(item["priority"],item["priority"])}  |  Due: {item["due_date"] or "-"}',8.5)
                if item.get('transfer_to'):
                    c.paragraph(f'Last transferred to: {item["transfer_to"]}  |  At: {friendly_stamp(item.get("transferred_at"))}',8.5)
                c.paragraph(f'Description: {item["description"]}',9)
                if item.get('ip_address') or item.get('mac_address'):
                    c.paragraph(f'IP: {item.get("ip_address") or "-"}  |  MAC: {item.get("mac_address") or "-"}',8.5)
            elif key=='projects':
                c.paragraph(f'Site: {item["site"] or "-"}  |  Start: {item["start_date"] or "-"}  |  Due: {item["due_date"] or "-"}',8.5)
                if item['description']:c.paragraph('Details: '+item['description'],9)
                for ph in item['milestones']:
                    c.paragraph(f'Phase milestone: {ph["name"]}  |  {ph["due_date"]}  |  {STATUS_LABELS.get(ph["status"],ph["status"])}',8.5,indent=10)
            else:
                c.paragraph(f'Priority: {STATUS_LABELS.get(item["priority"],item["priority"])}  |  Task date: {item["task_date"] or "-"}',8.5)
                if item['details']:c.paragraph('Details: '+item['details'],9)
            if item['activity']:
                c.y-=3
                c.paragraph(report['period_kind'].upper()+' UPDATE HISTORY',8.4,(.09,.34,.62),bold=True)
                for evt in item['activity']:
                    if evt['action']=='note':
                        details=evt['body']
                    elif evt['action']=='edit':
                        details=evt.get('body') or 'Details updated'
                    elif evt['action']=='transfer':
                        details=f'Transferred to {evt.get("transfer_to") or "another team"}' + (f' - {evt["body"]}' if evt.get('body') else '')
                    else:
                        old=STATUS_LABELS.get(evt.get('old_status',''),evt.get('old_status',''))
                        new=STATUS_LABELS.get(evt.get('new_status',''),evt.get('new_status',''))
                        details=f'Status: {old} -> {new}'
                    c.paragraph(f'{evt["local_time"]}: {details}',8.4,indent=12)
            c.y-=10
            c.ensure(12)
            c.rule(c.y);c.y-=18
    return c.finish()
