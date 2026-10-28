'use strict';

const state = {
  page: 'dashboard', tickets: [], projects: [], tasks: [], phases: [], noteFolders: [], notes: [], noteSearch:'', noteFolder:'all', noteView:'active', noteMode:'cards',
  overview: null, settings: null, detailKind: null, detailId: null, detailUpdates: [], attachments: [],
  calendarMode: 'month', calendarDate: null, calendarFilter: 'all', calendarShowCompleted: false,
  ticketStatus: 'all', projectStatus: 'all', taskView: 'all', taskStatuses: ['todo','in_progress','done'], search: '',
  manuals:[],manualsFolder:'',manualsExists:false,manualSearch:'',manualType:'all',manualLoading:false,manualError:'',manualLastUpdated:null,
  reportPeriod:'weekly', reportWeek: null, reportModules: {tickets:true,projects:true,tasks:true}, weeklyData: null, weeklyLoading: false, weeklyRequestKey: ''
};
const PAGE_TITLES = { dashboard:'Overview', tickets:'Ticket Management', projects:'Project Management', tasks:'Task Management', calendar:'Calendar', notes:'Notes Center', manuals:'Manuals Library', reports:'Reports & Backups' };
const LABELS = {
  open:'Open', in_progress:'In Progress', pending:'Pending', closed:'Closed', transferred:'Transferred',
  planned:'Planned', on_hold:'On Hold', completed:'Completed', cancelled:'Cancelled',
  todo:'To Do', done:'Done', not_started:'Not Started',
  urgent:'Urgent', high:'High', normal:'Normal', low:'Low'
};
const $ = (selector, root=document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text = value => esc(value || '—');
const label = value => LABELS[value] || value || '—';
const badge = status => `<span class="badge b-${esc(status)}">${esc(label(status))}</span>`;
const shortDate = s => {
  if (!s) return '—';
  const d = new Date(s + 'T12:00:00');
  return Number.isNaN(d.valueOf()) ? esc(s) : d.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
};
const stampDate = s => {
 if(!s)return '';
 const d=new Date(s.replace(' ','T')+'Z');
 return Number.isNaN(d.valueOf())?esc(s):d.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
};
const STATUSES={ticket:['open','in_progress','pending','closed','transferred'],project:['planned','in_progress','on_hold','completed','cancelled'],task:['todo','in_progress','done'],phase:['not_started','in_progress','completed']};
function quickStatus(kind,id,current){
 return `<select class="quick-status b-${esc(current)} no-print" aria-label="Change ${kind} status" data-quick-kind="${kind}" data-id="${id}">${STATUSES[kind].map(s=>`<option value="${s}" ${s===current?'selected':''}>${esc(label(s))}</option>`).join('')}</select><span class="print-only">${badge(current)}</span>`;
}
function updateButton(kind,id,small=true){return `<button class="btn ${small?'btn-sm':''} no-print" data-action="updates-${kind}" data-id="${id}">Updates</button>`;}
const brief = (v,n=92) => { const s=String(v||'');return esc(s.length>n?s.slice(0,n-1)+'…':s); };
const isOverdue = (s, status) => !!s && s < (state.overview?.today || '') && status !== 'done' && status !== 'closed' && status !== 'completed';
let toastTimer;
function toast(message, error=false) {
  const el = $('#toast');el.textContent=message;el.className='show'+(error?' error':'');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='',3700);
}
async function request(path,method='GET',payload) {
  const options={method,headers:{}};
  if (payload !== undefined) {options.headers['Content-Type']='application/json';options.body=JSON.stringify(payload)}
  const response=await fetch(path,options);
  const data=await response.json().catch(()=>({error:'Unexpected server response.'}));
  if(!response.ok)throw new Error(data.error||'Request failed');
  return data;
}
async function refresh() {
  const settings=await request('/api/settings');
  const versionLabel=$('#appVersion');
  if(versionLabel)versionLabel.textContent=settings?.app_version?`Version ${settings.app_version}`:'Version not reported by server';
  if(settings.app_version !== '1.5.11')throw new Error('Work Tracker 1.5.11 is not running yet. Use Stop Work Tracker, then start it again from your desktop shortcut.');
  const [tickets,projects,tasks,phases,notes,noteFolders,overview,manualsData,attachments]=await Promise.all([
    request('/api/tickets'),request('/api/projects'),request('/api/tasks'),request('/api/phases'),request('/api/notes'),request('/api/note-folders'),request('/api/overview'),
    // Manuals is a read-only local folder listing, not a database. A scan failure must not disable Work Tracker.
    request('/api/manuals').catch(error=>({error:error.message})), request('/api/attachments')
  ]);
  Object.assign(state,{tickets,projects,tasks,phases,notes,noteFolders,overview,settings,attachments});
  if(!manualsData.error){
    state.manuals=manualsData.files||[];
    state.manualsFolder=manualsData.folder||'';
    state.manualsExists=!!manualsData.exists;
    state.manualLastUpdated=new Date().toISOString();
    state.manualError='';
  }else state.manualError=manualsData.error;
  const today=new Date((overview?.today||new Date().toISOString().slice(0,10))+'T12:00:00');
  $('#todayLabel').textContent=today.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
}
// Global Quick Search (v1.5.8): includes local Manuals metadata alongside workspace records.
// Does not index PDF contents, copy file bytes, alter SQLite or use any external services.
let globalSearchItems=[];
let globalSearchActive=0;
const normalizeSearch=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
function searchTokens(value){
 // Windows filenames commonly contain underscores, hyphens and dots; treat these as word separators.
 return normalizeSearch(value).replace(/[_\\/().-]+/g,' ').split(/\s+/).filter(Boolean);
}
function searchMatches(terms,values){
 const raw=normalizeSearch(values.filter(v=>v!==null&&v!==undefined).join(' '));
 const separated=raw.replace(/[_\\/().-]+/g,' ');
 return terms.every(term=>raw.includes(term)||separated.includes(term));
}
function searchSnippet(value,term,max=103){
 const body=String(value||'').replace(/\s+/g,' ').trim();
 if(!body)return 'No description';
 const at=normalizeSearch(body).indexOf(term);
 const start=body.length>max&&at>=0?Math.max(0,at-27):0;
 const end=Math.min(body.length,start+max);
 return esc((start?'…':'')+body.slice(start,end)+(end<body.length?'…':''));
}
function searchWorkspace(raw){
 const terms=searchTokens(raw.trim());
 if(!terms.length)return [];
 const first=terms[0];
 const groups=[
  {kind:'ticket',label:'Tickets',list:state.tickets,fields:t=>[t.ticket_number,t.description,t.site,t.ticket_user,t.ip_address,t.mac_address,t.status,label(t.status),t.priority,t.notes,t.transfer_to,t.transfer_reason,t.project_name],title:t=>t.ticket_number,subtitle:t=>`${t.site||'No site'} · ${label(t.status)} · ${t.ticket_user||'No requester'}`,detail:t=>t.description||t.notes},
  {kind:'project',label:'Projects',list:state.projects,fields:p=>[p.name,p.description,p.site,p.status,label(p.status),p.notes],title:p=>p.name,subtitle:p=>`${p.site||'No site'} · ${label(p.status)}`,detail:p=>p.description||p.notes},
  {kind:'task',label:'Tasks',list:state.tasks,fields:t=>[t.title,t.details,t.status,label(t.status),t.priority,t.ticket_number,t.project_name],title:t=>t.title,subtitle:t=>`${label(t.status)}${t.ticket_number?' · '+t.ticket_number:''}`,detail:t=>t.details},
  {kind:'note',label:'Notes',list:state.notes,fields:n=>[n.title,n.body,n.folder,n.category,n.tags,noteLinkedName(n)],title:n=>n.title,subtitle:n=>`${n.folder||'General'}${n.archived?' · Archived':''}`,detail:n=>n.body||n.tags},
  {kind:'manual',label:'Manuals',list:state.manuals,fields:f=>[f.name,f.folder,f.path,f.extension,f.type],title:f=>f.name,subtitle:f=>`${f.type}${f.folder?' · '+f.folder:''} · Local file`,detail:f=>f.folder?`Folder: ${f.folder}`:'Open with the default Windows app'}
 ];
 return groups.map(g=>{
  const matches=g.list.filter(item=>searchMatches(terms,g.fields(item)));
  matches.sort((a,b)=>{
   const score=r=>terms.reduce((n,term)=>n+(normalizeSearch(g.title(r)).includes(term)?5:0),0);
   return score(b)-score(a);
  });
  return {kind:g.kind,label:g.label,count:matches.length,items:matches.slice(0,6).map(item=>({kind:g.kind,id:g.kind==='manual'?state.manuals.indexOf(item):Number(item.id),title:String(g.title(item)||''),subtitle:String(g.subtitle(item)||''),detail:String(g.detail(item)||'')}))};
 });
}
function renderGlobalSearch(){
 const input=$('#globalSearch'),panel=$('#globalSearchResults');
 if(!input||!panel)return;
 const value=input.value.trim();
 panel.hidden=false;
 input.setAttribute('aria-expanded','true');
 globalSearchItems=[];
 if(!value){
  panel.innerHTML='<div class="global-search-hint">Search tickets, projects, tasks, notes and manual filenames.<small>Try a ticket number, location, IP, note text, or an MT10 / WAN_LAN document.</small></div><div class="global-search-footer">Press Esc to close · Ctrl + K to search</div>';
  return;
 }
 const groups=searchWorkspace(value),hits=groups.reduce((n,g)=>n+g.count,0);
 if(!hits){
  panel.innerHTML=`<div class="global-search-empty">No results for <strong>${esc(value)}</strong><small>Try part of a filename, ticket number, project or note title.</small></div>`;
  return;
 }
 let output=`<div class="global-search-summary">${hits} ${hits===1?'result':'results'} across your workspace</div>`;
 for(const g of groups){
  if(!g.count)continue;
  output+=`<div class="global-search-group"><div class="global-search-group-title">${g.label}<span>${g.count}</span></div>`;
  for(const item of g.items){
   const position=globalSearchItems.length;
   globalSearchItems.push(item);
   output+=`<button type="button" role="option" id="global-result-${position}" aria-selected="${position===globalSearchActive?'true':'false'}" class="global-search-result ${position===globalSearchActive?'is-active':''}" data-action="global-open" data-kind="${g.kind}" data-id="${item.id}" data-global-index="${position}"><span class="global-result-icon ${g.kind}" aria-hidden="true">${{ticket:'▤',project:'▦',task:'☑',note:'▧',manual:'▤'}[g.kind]}</span><span class="global-result-text"><strong>${esc(item.title)}</strong><small>${esc(item.subtitle)}</small><small class="global-result-description">${searchSnippet(item.detail,normalizeSearch(value).split(/\s+/)[0])}</small></span><span class="global-result-arrow" aria-hidden="true">↗</span></button>`;
  }
  if(g.count>g.items.length)output+=`<p class="global-search-more">+ ${g.count-g.items.length} more ${g.label.toLowerCase()} · Refine your search</p>`;
  output+='</div>';
 }
 panel.innerHTML=output+'<div class="global-search-footer">↑ ↓ navigate · Enter open · Esc close</div>';
 if(globalSearchActive>=globalSearchItems.length)globalSearchActive=0;
 setGlobalSearchActive(globalSearchActive,false);
}
function setGlobalSearchActive(index,scroll=true){
 if(!globalSearchItems.length)return;
 globalSearchActive=(index+globalSearchItems.length)%globalSearchItems.length;
 const input=$('#globalSearch');
 document.querySelectorAll('#globalSearchResults [data-global-index]').forEach(button=>{
  const active=Number(button.dataset.globalIndex)===globalSearchActive;
  button.classList.toggle('is-active',active);
  button.setAttribute('aria-selected',String(active));
 });
 const chosen=$(`#global-result-${globalSearchActive}`);
 if(chosen){input.setAttribute('aria-activedescendant',chosen.id);if(scroll)chosen.scrollIntoView({block:'nearest'});}
}
function hideGlobalSearch(clear=false){
 const input=$('#globalSearch'),panel=$('#globalSearchResults');
 if(!input||!panel)return;
 panel.hidden=true;
 input.setAttribute('aria-expanded','false');
 input.removeAttribute('aria-activedescendant');
 if(clear)input.value='';
 globalSearchItems=[];
 globalSearchActive=0;
}
function openGlobalResult(kind,id){
 hideGlobalSearch(true);
 const input=$('#globalSearch');if(input)input.blur();
 if(kind==='note')return openNoteReader(id);
 if(kind==='manual')return openManual(Number(id));
 if(['ticket','project','task'].includes(kind))return showDetails(kind,id);
}
function heading(title,sub,buttons=''){
 return `<div class="page-heading"><div><h1>${title}</h1><p>${sub}</p></div><div class="page-actions no-print">${buttons}</div></div>`;
}
function metric(title,number,sub,symbol='•',tone=''){
 return `<div class="stat ${tone}"><span class="stat-symbol">${symbol}</span><span class="stat-label">${title}</span><strong>${number}</strong><span class="stat-meta">${sub}</span></div>`;
}
function empty(message) { return `<div class="zero">${esc(message)}</div>`; }

// v1.5.11 — Clipboard screenshots for notes, tickets, projects and tasks.
// Screenshots are stored in SQLite, so a full .sqlite3 backup includes all images.
let pendingScreenshots=[];
function imagesFor(kind,id){return state.attachments.filter(a=>a.kind===kind&&Number(a.record_id)===Number(id))}
function screenshotGallery(kind,id,{editable=false,pending=false}={}){
 const existing=id?imagesFor(kind,id):[];
 const previews=pending?pendingScreenshots:[];
 const cards=existing.map(a=>`<figure class="screenshot-item"><a href="/api/attachments/${a.id}/image" target="_blank" rel="noopener"><img src="/api/attachments/${a.id}/image" loading="lazy" alt="${esc(a.filename)}"></a><figcaption>${esc(a.filename)}</figcaption>${editable?`<button class="screenshot-remove" type="button" data-action="image-remove" data-id="${a.id}" title="Remove image">×</button>`:''}</figure>`).join('');
 const drafts=previews.map((a,index)=>`<figure class="screenshot-item"><img src="${a.preview}" alt="Pasted image awaiting save"><figcaption>New screenshot ${index+1}</figcaption><button type="button" class="screenshot-remove" data-action="image-pending-remove" data-id="${index}" title="Remove pasted image">×</button></figure>`).join('');
 return `<section class="screenshots-panel"><div class="screenshot-heading"><strong>Images & screenshots <span>(${existing.length+previews.length})</span></strong></div>
 <div class="screenshot-paste" data-paste-kind="${kind}" tabindex="0" role="group" aria-label="Paste an image into this ${kind}"><span>▧</span> Copy a screenshot, click here and press <kbd>Ctrl + V</kbd> (or paste directly into the editor).</div>
 ${(cards||drafts)?`<div class="screenshot-gallery">${cards}${drafts}</div>`:'<p class="screenshot-empty">No images attached yet.</p>'}
 <small class="screenshot-help">PNG, JPEG, WEBP or GIF · Up to 5 MB per image · Saved locally in SQLite and included in Full Backup.</small></section>`;
}
function redrawEditorGallery(){
 const form=$('#noteForm')||$('#recordForm');if(!form)return;
 const zone=form.querySelector('.screenshots-panel');if(!zone)return;
 const kind=form.id==='noteForm'?'note':form.dataset.endpoint.slice(0,-1);
 const id=Number(form.dataset.id)||null;
 zone.outerHTML=screenshotGallery(kind,id,{editable:true,pending:true});
}
async function pasteScreenshot(file){
 if(!file || !['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)){toast('Paste a PNG, JPEG, WEBP or GIF image.',true);return}
 if(file.size>5*1024*1024){toast('Image is over 5 MB. Copy a smaller screenshot.',true);return}
 const reader=new FileReader();
 const dataUrl=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Unable to read screenshot.'));reader.readAsDataURL(file)});
 const payload={image_type:file.type,filename:file.name||`screenshot-${Date.now()}.png`,data:dataUrl.split(',')[1]};
 const form=$('#editDialog').open?($('#noteForm')||$('#recordForm')):null;
 if(form && (form.id==='noteForm'||['tickets','projects','tasks'].includes(form.dataset.endpoint))){
   if(pendingScreenshots.length>=40){toast('Maximum 40 new images per save.',true);return}
   pendingScreenshots.push({...payload,preview:dataUrl});redrawEditorGallery();toast('Screenshot ready — click Save to attach.');return;
 }
 // Pasting into a read-only existing note or a ticket/project/task detail attaches immediately.
 const readerNote=$('#editDialog.note-reader-dialog');
 const kind=readerNote?'note':state.detailKind;
 const id=readerNote?Number(readerNote.dataset.noteId):state.detailId;
 if(!kind||!id){toast('Open a note or a ticket, project or task to attach the screenshot.',true);return}
 try{await request('/api/attachments','POST',{kind,record_id:id,...payload});await refresh();
   if(readerNote)openNoteReader(id);else render();toast('Screenshot saved in SQLite.');}
 catch(e){toast(e.message,true)}
}
async function onScreenshotPaste(ev){
 const files=[...(ev.clipboardData?.items||[])].filter(i=>i.kind==='file'&&i.type.startsWith('image/'));
 if(!files.length)return;
 const editor=$('#editDialog').open&&($('#recordForm')||$('#noteForm'));
 const noteReader=$('#editDialog').open&&$('#editDialog').classList.contains('note-reader-dialog');
 const details=state.detailKind&&state.detailId&&ev.target.closest('#page');
 if(!editor&&!noteReader&&!details)return;
 ev.preventDefault();
 try{await pasteScreenshot(files[0].getAsFile())}catch(e){toast(e.message,true)}
}
async function uploadPendingScreenshots(kind,id){
 // On a partial failure the pending images remain queued for a retry.
 while(pendingScreenshots.length){
   const image=pendingScreenshots[0];
   await request('/api/attachments','POST',{kind,record_id:id,image_type:image.image_type,filename:image.filename,data:image.data});
   pendingScreenshots.shift();
 }
}
async function removeScreenshot(id){
 if(!confirm('Remove this screenshot from the record?'))return;
 try{await request(`/api/attachments/${id}`,'DELETE');await refresh();
   if($('#noteForm')||$('#recordForm'))redrawEditorGallery();
   else if($('#editDialog.note-reader-dialog')?.open)openNoteReader(Number($('#editDialog').dataset.noteId));
   else render();toast('Screenshot removed.');
 }catch(e){toast(e.message,true)}
}

function renderDashboard(){
  const o=state.overview;
  const activeTasks=state.tasks.filter(t=>t.status!=='done').slice(0,7);
  const overdue=state.tasks.filter(t=>isOverdue(t.task_date,t.status)).slice(0,5);
  const tickets=state.tickets.filter(t=>!['closed','transferred'].includes(t.status)).slice(0,6);
  const projects=state.projects.filter(p=>!['completed','cancelled'].includes(p.status)).slice(0,5);
  const activeNotes=state.notes.filter(n=>!n.archived);
  const pinnedNoteCount=activeNotes.filter(n=>n.pinned).length;
  return `
    ${heading('Good day, here’s your workspace','Track tickets, project progress and the tasks that need your attention.',`
      <button class="btn" data-action="new-project">+ Project</button>
      <button class="btn" data-action="new-task">+ Task</button><button class="btn" data-action="new-note">+ Note</button>
      <button class="btn btn-primary" data-action="new-ticket">+ New Ticket</button>`)}
    <div class="stats">
      ${metric('Active Tickets',o.tickets_open,'Open, pending or in progress','▤')}
      ${metric('Active Projects',o.projects_active,'Planned or currently running','▦','success')}
      ${metric('Tasks',o.tasks_open,'To do or in progress','☑')}
      ${metric('Overdue Tasks',o.tasks_overdue,'Items needing attention','!','danger')}
      <button type="button" class="stat stat-notes" data-nav="notes" aria-label="Open Notes Center: ${activeNotes.length} notes, ${pinnedNoteCount} pinned">
        <span class="stat-symbol">▧</span><span class="stat-label">Notes Center</span>
        <strong>${activeNotes.length}</strong><span class="stat-meta">${pinnedNoteCount} pinned · Browse cards or list →</span>
      </button>
    </div>
    <section class="panel"><div class="panel-header"><h2>Ticket Status Overview</h2><button class="btn btn-sm" data-nav="tickets">View all tickets</button></div>
    <div class="status-breakdown">${STATUSES.ticket.map(status=>`<button data-action="filter-ticket-status" data-status="${status}" aria-label="View ${label(status)} tickets"><strong>${o.ticket_status_counts?.[status]||0}</strong><span>${esc(label(status))}</span></button>`).join('')}</div></section>
    <div class="two-column">
      <section class="panel"><div class="panel-header"><h2>Tasks</h2><button class="btn btn-sm" data-nav="tasks">View all</button></div>
      ${activeTasks.length?activeTasks.map(t=>`<div class="list-row"><div><h3><button class="link-btn" data-action="view-task" data-id="${t.id}">${esc(t.title)}</button></h3><p>${text(t.project_name||t.ticket_number||t.details)} · ${esc(label(t.priority))} priority</p></div><div class="row-end">${badge(t.status)}<button class="btn btn-sm" data-action="edit-task" data-id="${t.id}">Edit</button></div></div>`).join(''):empty('No open tasks. Add one to get started.')}
      </section>
      <section class="panel"><div class="panel-header"><h2>Tickets in Progress</h2><button class="btn btn-sm" data-nav="tickets">View all</button></div>
      ${tickets.length?tickets.map(t=>`<div class="list-row"><div><h3><button class="link-btn" data-action="view-ticket" data-id="${t.id}">${esc(t.ticket_number)}</button></h3><p>${brief(t.description,47)} ${t.site?'· '+esc(t.site):''}</p></div><div class="row-end">${badge(t.status)}${updateButton('ticket',t.id)}</div></div>`).join(''):empty('No active tickets yet.')}
      </section>
    </div>
    <section class="panel"><div class="panel-header"><h2>Active Projects</h2><button class="btn btn-sm" data-nav="projects">View all</button></div>
      ${projects.length?projects.map(p=>`<div class="list-row"><div><h3><button class="link-btn" data-action="view-project" data-id="${p.id}">${esc(p.name)}</button></h3><p>${esc(p.site||'No site')} · ${p.phase_count} phases · ${p.active_tickets} active tickets</p></div><div class="row-end">${badge(p.status)}<button class="btn btn-sm" data-action="view-project" data-id="${p.id}">Details</button></div></div>`).join(''):empty('No active projects.')}
    </section>
    ${overdue.length?`<section class="panel"><div class="panel-header"><h2>Overdue Tasks</h2><span class="badge b-overdue">Needs review</span></div>
       ${overdue.map(t=>`<div class="list-row"><div><h3>${esc(t.title)}</h3><p>Due ${shortDate(t.task_date)} ${t.project_name?' · '+esc(t.project_name):''}</p></div><button class="btn btn-sm" data-action="edit-task" data-id="${t.id}">Update</button></div>`).join('')}</section>`:''}
  `;
}
function renderTickets(){
  if(state.detailKind==='ticket')return renderTicketDetail();
  const statuses=['all','open','in_progress','pending','closed','transferred'];
  const filt=state.tickets.filter(t=>state.ticketStatus==='all'||t.status===state.ticketStatus)
    .filter(t=>[t.ticket_number,t.description,t.site,t.ticket_user,t.ip_address,t.mac_address,t.project_name].join(' ').toLowerCase().includes(state.search.toLowerCase()));
  return `${heading('Tickets',`${state.tickets.length} total tickets · Track incidents, requests and their status.`,`<button class="btn btn-primary" data-action="new-ticket">+ New Ticket</button>`)}
    <section class="panel"><div class="filterbar no-print">
    <input id="ticketSearch" class="field-input search" placeholder="Search number, user, description, site, IP or MAC…" value="${esc(state.search)}" aria-label="Search tickets">
    <select id="ticketStatus" class="field-select" aria-label="Filter ticket status">${statuses.map(s=>`<option value="${s}" ${s===state.ticketStatus?'selected':''}>${s==='all'?'All Statuses':label(s)}</option>`).join('')}</select>
    <span class="muted small">${filt.length} results</span></div>
    <div class="table-scroll"><table class="data-table"><thead><tr><th>Ticket / Description</th><th>Site</th><th>User</th><th>Status</th><th>Priority</th><th>Due</th><th>IP / MAC</th><th class="text-end">Actions</th></tr></thead><tbody>
    ${filt.map(t=>`<tr><td><button class="link-btn" data-action="view-ticket" data-id="${t.id}">${esc(t.ticket_number)}</button><span class="note-line">${brief(t.description,80)}</span></td>
       <td>${text(t.site)}${t.project_name?`<span class="note-line">${esc(t.project_name)}</span>`:''}</td>
       <td>${text(t.ticket_user)}</td>
       <td>${quickStatus('ticket',t.id,t.status)}</td><td><span class="dot ${esc(t.priority)}"></span>${esc(label(t.priority))}</td>
       <td>${t.due_date&&isOverdue(t.due_date,t.status)?`<span class="badge b-overdue">${shortDate(t.due_date)}</span>`:shortDate(t.due_date)}</td>
       <td><span class="small">${text(t.ip_address)}</span><span class="note-line">${text(t.mac_address)}</span></td>
       <td class="text-end cell-actions"><button class="btn btn-sm" data-action="view-ticket" data-id="${t.id}">Details</button> ${updateButton('ticket',t.id)} <button class="btn btn-sm" data-action="edit-ticket" data-id="${t.id}">Edit</button></td></tr>`).join('')||`<tr><td colspan="8">${empty('No tickets match this filter.')}</td></tr>`}
    </tbody></table></div></section>`;
}
function renderProjects(){
  if(state.detailKind==='project') return renderProjectDetail();
  const list=state.projects.filter(p=>state.projectStatus==='all'||p.status===state.projectStatus);
  return `${heading('Projects','Manage your work from planning to completion, with custom phases.',`<button class="btn btn-primary" data-action="new-project">+ New Project</button>`)}
  <div class="tabs no-print">${['all','planned','in_progress','on_hold','completed','cancelled'].map(s=>`<button class="tab ${state.projectStatus===s?'active':''}" data-action="filter-project" data-status="${s}">${s==='all'?'All Projects':label(s)}</button>`).join('')}</div>
  <div class="cards">${list.map(p=>{
    const percent=p.phase_count?Math.round(p.phase_done/p.phase_count*100):0;
    return `<article class="project-card"><div><div class="card-top"><span class="eyebrow">${esc(p.site||'Project')}</span>${badge(p.status)}</div><h3>${esc(p.name)}</h3><p>${brief(p.description||'No description yet.',140)}</p></div>
       <div><div class="card-meta"><span>Phase progress</span><strong>${p.phase_done}/${p.phase_count} completed</strong></div><div class="progress"><div style="width:${percent}%"></div></div></div>
       <div class="card-meta"><span>Start: ${shortDate(p.start_date)}</span><span>Due: ${shortDate(p.due_date)}</span></div><div class="card-meta"><span>Status</span>${quickStatus('project',p.id,p.status)}</div>
       <div class="card-bottom"><span class="small muted">${p.active_tickets} active tickets</span><div class="inline-actions">${updateButton('project',p.id)}<button class="btn btn-sm" data-action="view-project" data-id="${p.id}">View Details →</button></div></div></article>`;
  }).join('')}</div>${list.length?'':`<section class="panel">${empty('No projects found. Create a project to add custom phases.')}</section>`}`;
}
function renderProjectDetail(){
  const p=state.projects.find(x=>x.id===state.detailId);
  if(!p){state.detailKind=null;state.detailId=null;return renderProjects()}
  const phases=state.phases.filter(x=>x.project_id===p.id);
  const linked=state.tickets.filter(x=>x.project_id===p.id);
  const tasks=state.tasks.filter(x=>x.project_id===p.id);
  return `<div class="page-heading"><div><button class="btn btn-sm no-print" data-action="back-projects">← Back to Projects</button><h1 style="margin-top:13px">${esc(p.name)}</h1><p>${text(p.site)} · ${label(p.status)}</p></div>
       <div class="page-actions no-print">${quickStatus('project',p.id,p.status)}<button class="btn" data-action="edit-project" data-id="${p.id}">Edit Project</button><button class="btn btn-primary" data-action="new-phase" data-id="${p.id}">+ Add Phase</button></div></div>
       <div class="panel"><div class="panel-header"><h2>Project Details</h2>${badge(p.status)}</div><div class="panel-body">
         <p class="detail-desc">${text(p.description)}</p><div class="detail-grid"><div class="info"><span>Site</span><strong>${text(p.site)}</strong></div><div class="info"><span>Start date</span><strong>${shortDate(p.start_date)}</strong></div><div class="info"><span>Due date</span><strong>${shortDate(p.due_date)}</strong></div></div>
         ${p.notes?`<p class="detail-desc"><strong>Original notes:</strong> ${esc(p.notes)}</p>`:''}
         ${screenshotGallery('project',p.id,{editable:true})}
       </div></div>
       ${renderInlineHistory('project',p.id)}
       <section class="panel"><div class="panel-header"><h2>Project Phases (${phases.length})</h2><span class="muted small">${p.phase_done} completed</span></div>
       ${phases.length?phases.map((ph,i)=>`<div class="phase-row"><div><strong>${i+1}. ${esc(ph.name)}</strong><span class="small muted">Due ${shortDate(ph.due_date)}</span></div>
          ${quickStatus('phase',ph.id,ph.status)}${updateButton('phase',ph.id)}<button class="btn btn-sm no-print" data-action="edit-phase" data-id="${ph.id}">Edit</button>
          <button class="icon-btn no-print" title="Delete phase" data-action="delete-phase" data-id="${ph.id}">×</button></div>`).join(''):empty('No phases yet. Add phases that match this project’s workflow.')}
       </section>
       <div class="two-column"><section class="panel"><div class="panel-header"><h2>Linked Tickets (${linked.length})</h2><button class="btn btn-sm no-print" data-action="new-ticket" data-project="${p.id}">+ Ticket</button></div>
         ${linked.length?linked.slice(0,8).map(t=>`<div class="list-row"><div><h3>${esc(t.ticket_number)}</h3><p>${brief(t.description,55)}</p></div>${badge(t.status)}</div>`).join(''):empty('No linked tickets.')}</section>
         <section class="panel"><div class="panel-header"><h2>Linked Tasks (${tasks.length})</h2><button class="btn btn-sm no-print" data-action="new-task" data-project="${p.id}">+ Task</button></div>
         ${tasks.length?tasks.slice(0,8).map(t=>`<div class="list-row"><div><h3>${esc(t.title)}</h3><p>${shortDate(t.task_date)}</p></div>${badge(t.status)}</div>`).join(''):empty('No linked tasks.')}</section></div>${renderLinkedNotes('project',p.id)}`;
}
function renderTasks(){
  if(state.detailKind==='task')return renderTaskDetail();
  const today=state.overview.today;
  let list=state.tasks;
  if(state.taskView==='today') list=list.filter(t=>t.task_date===today || (!t.task_date && t.status!=='done'));
  if(state.taskView==='upcoming') list=list.filter(t=>t.task_date>today && t.status!=='done');
  if(state.taskView==='overdue') list=list.filter(t=>isOverdue(t.task_date,t.status));
  // Status filters are independent of the date-based tabs. Selecting multiple
  // statuses makes it easy to see To Do + In Progress without completed tasks.
  list=list.filter(t=>state.taskStatuses.includes(t.status));
  const viewNames={today:'Today',upcoming:'Upcoming',overdue:'Overdue',all:'All Tasks'};
  return `${heading('Tasks','Track work, with or without a due date, and mark items completed.',`<button class="btn btn-primary" data-action="new-task">+ New Task</button>`)}
  <div class="tabs no-print">${['today','upcoming','overdue','all'].map(s=>`<button class="tab ${s===state.taskView?'active':''}" data-action="task-view" data-view="${s}">${viewNames[s]}${s==='overdue'&&state.overview.tasks_overdue?` (${state.overview.tasks_overdue})`:''}</button>`).join('')}</div>
  ${state.taskView==='today'?'<p class="muted small task-view-help">Showing tasks scheduled for today and active tasks without a date.</p>':''}
  <div class="task-status-filter no-print" role="group" aria-label="Filter tasks by status">
    <div class="task-filter-heading"><strong>Status</strong><span class="muted small">Select one or more · To Do means pending</span></div>
    <div class="task-status-options">
      ${STATUSES.task.map(status=>`<label class="task-status-choice ${state.taskStatuses.includes(status)?'selected':''}"><input type="checkbox" data-task-status="${status}" ${state.taskStatuses.includes(status)?'checked':''}>${esc(label(status))}</label>`).join('')}
      <span class="task-filter-divider" aria-hidden="true"></span>
      <button type="button" class="btn btn-sm task-status-shortcut ${state.taskStatuses.length===2&&!state.taskStatuses.includes('done')?'is-active':''}" data-action="task-status-preset" data-preset="active">Active only</button>
      <button type="button" class="btn btn-sm task-status-shortcut ${state.taskStatuses.length===3?'is-active':''}" data-action="task-status-preset" data-preset="all">All statuses</button>
    </div>
  </div>
  <section class="panel"><div class="panel-header"><h2>${viewNames[state.taskView]}</h2><span class="muted small">${list.length} tasks</span></div>
  ${list.length?list.map(t=>`<div class="task-row ${t.status==='done'?'is-done':''}">
    <input class="check-mark no-print" type="checkbox" aria-label="Mark ${esc(t.title)} done" data-action="toggle-task" data-id="${t.id}" ${t.status==='done'?'checked':''}>
    <div><h3><button class="link-btn" data-action="view-task" data-id="${t.id}">${esc(t.title)}</button></h3><p>${brief(t.details,100)} ${t.project_name?' · '+esc(t.project_name):''}${t.ticket_number?' · '+esc(t.ticket_number):''}</p></div>
    <span class="task-date">${shortDate(t.task_date)}</span>
    ${quickStatus('task',t.id,t.status)}
    <div class="inline-actions no-print"><button class="btn btn-sm" data-action="view-task" data-id="${t.id}">Details</button>${updateButton('task',t.id)}<button class="btn btn-sm" data-action="edit-task" data-id="${t.id}">Edit</button><button class="icon-btn" title="Delete task" data-action="delete-task" data-id="${t.id}">×</button></div>
    </div>`).join(''):empty(state.taskStatuses.length ? 'No tasks match this view and the selected status filters.' : 'Select at least one status to display tasks.')}</section>`;
}

// Full record history is visible in details, not hidden inside a modal.
function activityHTML(list){
 return list.length?list.map(e=>`<article class="activity-entry"><time class="activity-date">${stampDate(e.created_at)}</time>${['note','edit'].includes(e.action)?`<div class="activity-body">${esc(e.body)}</div>`:e.action==='transfer'?`<div class="activity-body"><strong>Transferred to ${esc(e.transfer_to||'another team')}</strong>${e.body?` · ${esc(e.body)}`:''}</div>`:`<div class="activity-body">Status changed: ${badge(e.old_status)} → ${badge(e.new_status)}</div>`}</article>`).join(''):'<p class="muted small">No updates recorded yet.</p>';
}
function renderInlineHistory(kind,id){
 const same=state.detailKind===kind&&state.detailId===id;
 const feed=same&&state.detailUpdates!==null?activityHTML(state.detailUpdates):'<p class="muted small">Loading updates…</p>';
 return `<section class="panel update-panel" id="record-history"><div class="panel-header"><h2>Update History</h2><span class="muted small">Newest first · Stored with date and time</span></div>
 <div class="panel-body"><form id="inlineUpdateForm" data-kind="${kind}" data-id="${id}"><label class="update-label" for="inlineNote">Add an update</label>
 <textarea id="inlineNote" name="note" maxlength="6000" rows="3" placeholder="Write what changed, what you did, or what you're waiting for…" required></textarea>
 <div class="update-form-actions"><button class="btn btn-primary" type="submit">Save Update</button></div></form>
 <div class="activity-feed">${feed}</div></div></section>`;
}
function renderTicketDetail(){
 const t=state.tickets.find(x=>x.id===state.detailId);
 if(!t){state.detailKind=null;return renderTickets()}
 // Reciprocal view of the existing SQLite tasks.ticket_id relationship.
 // Includes completed tasks so the ticket retains its complete work history.
 const linkedTasks=state.tasks.filter(task=>Number(task.ticket_id)===Number(t.id));
 return `<div class="page-heading"><div><button class="btn btn-sm no-print" data-nav="tickets">← Back to Tickets</button><h1 class="detail-title">${esc(t.ticket_number)}</h1><p>${esc(t.site||'No site')} · ${esc(t.ticket_user||'No requester')}</p></div>
 <div class="page-actions no-print">${quickStatus('ticket',t.id,t.status)}<button class="btn" data-action="edit-ticket" data-id="${t.id}">Edit Ticket</button></div></div>
 <section class="panel"><div class="panel-header"><h2>Ticket Details</h2>${badge(t.status)}</div><div class="panel-body">
 <p class="detail-desc">${text(t.description)}</p><div class="detail-grid">
 <div class="info"><span>Site</span><strong>${text(t.site)}</strong></div><div class="info"><span>Ticket User / Requester</span><strong>${text(t.ticket_user)}</strong></div><div class="info"><span>Priority</span><strong>${esc(label(t.priority))}</strong></div>
 <div class="info"><span>Due date (optional)</span><strong>${shortDate(t.due_date)}</strong></div><div class="info"><span>IP Address</span><strong>${text(t.ip_address)}</strong></div><div class="info"><span>MAC Address</span><strong>${text(t.mac_address)}</strong></div></div>
 ${t.transfer_to?`<div class="transfer-highlight"><strong>Last transfer:</strong> ${esc(t.transfer_to)} · ${stampDate(t.transferred_at)}${t.transfer_reason?`<div><strong>Reason:</strong> ${esc(t.transfer_reason)}</div>`:''}</div>`:''}
 ${t.project_name?`<p class="detail-desc"><strong>Related Project:</strong> <button class="link-btn" data-action="view-project" data-id="${t.project_id}">${esc(t.project_name)}</button></p>`:''}
 ${t.notes?`<p class="detail-desc"><strong>Original notes:</strong> ${esc(t.notes)}</p>`:''}${screenshotGallery('ticket',t.id,{editable:true})}</div></section>
 <section class="panel"><div class="panel-header"><h2>Linked Tasks (${linkedTasks.length})</h2>
 <button class="btn btn-sm no-print" data-action="new-task-for-ticket" data-id="${t.id}">+ Task</button></div>
 ${linkedTasks.length?linkedTasks.map(task=>`<div class="list-row"><div><h3><button class="link-btn" data-action="view-task" data-id="${task.id}">${esc(task.title)}</button></h3><p>${task.task_date?`Due ${shortDate(task.task_date)}`:'No due date'}${task.details?` · ${brief(task.details,90)}`:''}</p></div><div class="row-end">${badge(task.status)}<button class="btn btn-sm no-print" data-action="view-task" data-id="${task.id}">Details</button></div></div>`).join(''):empty('No tasks linked to this ticket yet.')}
 </section>
 ${renderInlineHistory('ticket',t.id)}${renderLinkedNotes('ticket',t.id)}`;
}
function renderTaskDetail(){
 const t=state.tasks.find(x=>x.id===state.detailId);
 if(!t){state.detailKind=null;return renderTasks()}
 return `<div class="page-heading"><div><button class="btn btn-sm no-print" data-nav="tasks">← Back to Tasks</button><h1 class="detail-title">${esc(t.title)}</h1><p>${t.task_date?`Date: ${shortDate(t.task_date)}`:'No date assigned'}</p></div>
 <div class="page-actions no-print">${quickStatus('task',t.id,t.status)}<button class="btn" data-action="edit-task" data-id="${t.id}">Edit Task</button></div></div>
 <section class="panel"><div class="panel-header"><h2>Task Details</h2>${badge(t.status)}</div><div class="panel-body">
 <p class="detail-desc">${text(t.details)}</p><div class="detail-grid"><div class="info"><span>Task Date (optional)</span><strong>${shortDate(t.task_date)}</strong></div><div class="info"><span>Priority</span><strong>${esc(label(t.priority))}</strong></div><div class="info"><span>Status</span><strong>${esc(label(t.status))}</strong></div></div>
 ${t.transfer_to?`<div class="transfer-highlight"><strong>Last transfer:</strong> ${esc(t.transfer_to)} · ${stampDate(t.transferred_at)}${t.transfer_reason?`<div><strong>Reason:</strong> ${esc(t.transfer_reason)}</div>`:''}</div>`:''}
 ${t.project_name?`<p class="detail-desc"><strong>Related Project:</strong> <button class="link-btn" data-action="view-project" data-id="${t.project_id}">${esc(t.project_name)}</button></p>`:''}
 ${t.ticket_number?`<p class="detail-desc"><strong>Related Ticket:</strong> <button class="link-btn" data-action="view-ticket" data-id="${t.ticket_id}">${esc(t.ticket_number)}</button></p>`:''}
 ${screenshotGallery('task',t.id,{editable:true})}</div></section>${renderInlineHistory('task',t.id)}${renderLinkedNotes('task',t.id)}`;
}

// Calendar uses explicit dates only. Completed/closed work is hidden by default;
// risk colors use the due date, never an invented date.
function calendarToday(){return isoLocal(new Date())}
function dayDistance(date,today){
  const asDay=s=>{const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?Date.UTC(+m[1],+m[2]-1,+m[3]):NaN};
  const a=asDay(date),b=asDay(today);
  return Number.isFinite(a)&&Number.isFinite(b)?Math.round((a-b)/86400000):null;
}
function isCalendarFinished(kind,status){
 return kind==='ticket'?status==='closed':
  kind==='project'?['completed','cancelled'].includes(status):
  kind==='task'?status==='done':
  kind==='phase'?status==='completed':false;
}
function calendarRisk(dueDate,kind,status,today){
 if(isCalendarFinished(kind,status))return 'finished';
 const days=dayDistance(dueDate,today);
 if(days===null)return 'neutral';
 if(days<=0)return 'red';
 if(days<=2)return 'yellow';
 return 'green';
}
function calendarEntries(){
 const entries=[];
 const push=(date,dueDate,kind,id,title,what,status)=>{
  if(!date||(!state.calendarShowCompleted&&isCalendarFinished(kind,status)))return;
  entries.push({date,dueDate,kind,id,title,what,status});
 };
 state.tasks.forEach(t=>push(t.task_date,t.task_date,'task',t.id,t.title,'Task due',t.status));
 state.tickets.forEach(t=>push(t.due_date,t.due_date,'ticket',t.id,t.ticket_number,'Ticket due',t.status));
 state.projects.forEach(p=>{
  push(p.start_date,p.due_date,'project',p.id,p.name,'Project start',p.status);
  if(p.due_date&&p.due_date!==p.start_date)push(p.due_date,p.due_date,'project',p.id,p.name,'Project due',p.status);
  else if(p.due_date&&p.due_date===p.start_date){
   const entry=entries.find(e=>e.kind==='project'&&e.id===p.id&&e.date===p.due_date);
   if(entry)entry.what='Project start / due';
  }
 });
 state.phases.forEach(ph=>{const proj=state.projects.find(p=>p.id===ph.project_id);
  // A phase belonging to a completed or cancelled project is finished as well.
  const done=proj&&isCalendarFinished('project',proj.status);
  push(ph.due_date,ph.due_date,'phase',ph.id,`${proj?.name||'Project'}: ${ph.name}`,'Phase due',done?'completed':ph.status);
 });
 return entries.filter(e=>state.calendarFilter==='all'||e.kind===state.calendarFilter)
  .sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title));
}
function isoLocal(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function calendarTarget(){return new Date((state.calendarDate||calendarToday())+'T12:00:00')}
function calendarEvent(e){
 const days=dayDistance(e.dueDate,calendarToday());
 const risk=calendarRisk(e.dueDate,e.kind,e.status,calendarToday());
 const urgency=risk==='finished'?'Finished':days===null?'No due date':days<=0?(days===0?'Due today':`Overdue ${-days} day${days===-1?'':'s'}`):`Due in ${days} day${days===1?'':'s'}`;
 return `<button class="calendar-event cal-${risk}" data-action="calendar-open" data-kind="${e.kind}" data-id="${e.id}" title="${esc(e.what)}: ${esc(e.title)} · ${esc(urgency)}" aria-label="${esc(e.what)}: ${esc(e.title)}. ${esc(urgency)}"><span class="calendar-event-tag">${esc(e.what)}</span><span class="calendar-event-title">${esc(e.title)}</span></button>`;
}
function renderCalendar(){
 const chosen=calendarTarget(),entries=calendarEntries(),today=calendarToday();
 const month=state.calendarMode==='month';
 let title,dates=[];
 if(month){
  title=chosen.toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const first=new Date(chosen.getFullYear(),chosen.getMonth(),1,12),start=new Date(first);start.setDate(start.getDate()-start.getDay());
  const end=new Date(chosen.getFullYear(),chosen.getMonth()+1,0,12);
  const count=Math.ceil((first.getDay()+end.getDate())/7)*7;
  for(let i=0;i<count;i++){const d=new Date(start);d.setDate(start.getDate()+i);dates.push(d)}
 }else{
  const start=new Date(chosen);start.setDate(chosen.getDate()-chosen.getDay());
  for(let i=0;i<7;i++){const d=new Date(start);d.setDate(start.getDate()+i);dates.push(d)}
  title=`${dates[0].toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${dates[6].toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
 }
 const count=entries.filter(e=>dates.some(d=>isoLocal(d)===e.date)).length;
 return `${heading('Calendar','See scheduled tickets, project milestones, tasks and phases. Dates are optional.',`<button class="btn btn-primary" data-action="new-task">+ New Task</button>`)}
 <section class="panel"><div class="calendar-toolbar no-print"><div class="calendar-movement"><button class="btn" data-action="calendar-prev" aria-label="Previous period">‹</button><button class="btn" data-action="calendar-today">Today</button><button class="btn" data-action="calendar-next" aria-label="Next period">›</button><strong>${esc(title)}</strong></div>
 <div class="calendar-switch"><button class="tab ${month?'active':''}" data-action="calendar-mode" data-mode="month">Month</button><button class="tab ${!month?'active':''}" data-action="calendar-mode" data-mode="week">Week</button></div></div>
 <div class="calendar-filters no-print">${[['all','All'],['task','Tasks'],['ticket','Tickets'],['project','Projects'],['phase','Phases']].map(([v,t])=>`<button class="tab ${state.calendarFilter===v?'active':''}" data-action="calendar-filter" data-filter="${v}">${t}</button>`).join('')}<label class="calendar-finished-toggle"><input id="calendarShowCompleted" type="checkbox" ${state.calendarShowCompleted?'checked':''}> Show completed / closed</label><span class="muted small">${count} events in view</span></div>
 <div class="calendar-legend"><span><i class="legend-dot green"></i> 3+ days</span><span><i class="legend-dot yellow"></i> 1–2 days</span><span><i class="legend-dot red"></i> Today / overdue</span><span><i class="legend-dot neutral"></i> No due date</span>${state.calendarShowCompleted?'<span><i class="legend-dot finished"></i> Completed</span>':''}</div>
 <div class="calendar-scroll"><div class="calendar-grid ${month?'month-view':'week-view'}"><div class="calendar-weekdays">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<span>${d}</span>`).join('')}</div><div class="calendar-days">
 ${dates.map(d=>{const day=isoLocal(d),onDay=entries.filter(e=>e.date===day);return `<div class="calendar-day ${day===today?'is-today':''} ${month&&d.getMonth()!==chosen.getMonth()?'outside-month':''}"><div class="calendar-day-number">${d.getDate()} <span>${!month?d.toLocaleDateString('en-US',{month:'short'}):''}</span></div><div class="calendar-events">${onDay.map(calendarEvent).join('')}</div></div>`}).join('')}</div></div></div></section>
 <p class="calendar-help muted small">Completed and closed records are hidden by default; use the checkbox to view them again. Only items with an explicit date appear here. Items without dates remain in Tickets, Projects and Tasks. Click an event for details.</p>`;
}
async function showDetails(kind,id){
 const page={ticket:'tickets',project:'projects',task:'tasks'}[kind];if(!page)return;
 state.page=page;state.detailKind=kind;state.detailId=id;state.detailUpdates=null;render();window.scrollTo(0,0);
 try{
  const entries=await request(`/api/updates?kind=${encodeURIComponent(kind)}&record_id=${id}`);
  if(state.detailKind===kind&&state.detailId===id){state.detailUpdates=entries;render()}
 }catch(e){if(state.detailKind===kind&&state.detailId===id){state.detailUpdates=[];render();toast('Unable to load history: '+e.message,true)}}
}
async function saveInlineUpdate(event){
 event.preventDefault();const form=event.target,kind=form.dataset.kind,id=Number(form.dataset.id);
 const note=form.querySelector('[name="note"]').value.trim();if(!note){toast('Enter a note before saving.',true);return}
 const btn=form.querySelector('[type=submit]');btn.disabled=true;
 try{
  await request('/api/updates','POST',{kind,record_id:id,note});
  const history=await request(`/api/updates?kind=${encodeURIComponent(kind)}&record_id=${id}`);
  if(state.detailKind===kind&&state.detailId===id){state.detailUpdates=history;render()}
  toast('Update saved to history.');
 }catch(e){toast(e.message,true);btn.disabled=false}
}
// Weekly reports always use the existing SQLite records. Monday to Sunday, local calendar.
function mondayISO(day){
 const d=new Date((day||state.overview.today)+'T12:00:00');d.setDate(d.getDate()-(d.getDay()+6)%7);return isoLocal(d);
}
function weekShift(start,n){const d=new Date(start+'T12:00:00');d.setDate(d.getDate()+7*n);return isoLocal(d)}
function reportStart(){
 if(state.reportPeriod==='monthly'){
   const s=state.reportWeek||state.overview.today;
   return s.slice(0,7)+'-01';
 }
 return state.reportWeek||mondayISO();
}
function reportQuery(){
 const modules=Object.entries(state.reportModules).filter(([,yes])=>yes).map(([k])=>k);
 if(!modules.length)return '';
 return `start=${encodeURIComponent(reportStart())}&modules=${encodeURIComponent(modules.join(','))}`;
}
async function loadWeeklyReport(){
 const query=reportQuery();if(!query){state.weeklyRequestKey='';state.weeklyData=null;state.weeklyLoading=false;render();return}
 const key=query;state.weeklyRequestKey=key;state.weeklyLoading=true;state.weeklyData=null;render();
 try {const result=await request('/api/reports/'+state.reportPeriod+'?'+query);
   if(state.weeklyRequestKey!==key)return;
   state.weeklyData=result;state.weeklyLoading=false;render();
 } catch(e){if(state.weeklyRequestKey===key){state.weeklyLoading=false;render();toast(e.message,true)}}
}
function reportItem(item,module){
 const subtitle=module==='tickets'?[item.site,item.ticket_user,item.description].filter(Boolean).join(' · '):
 module==='projects'?[item.site,item.description].filter(Boolean).join(' · '):item.details;
 return `<article class="weekly-item"><div class="weekly-item-top"><div><strong>${esc(item.display_name)}</strong><p>${brief(subtitle,140)}</p></div>${badge(item.status)}</div>
 <p class="weekly-reasons">${item.reasons.map(esc).join(' · ')}</p>
 ${item.activity.length?`<div class="weekly-notes">${item.activity.map(a=>`<div><time>${esc(a.local_time)}</time> · ${['note','edit'].includes(a.action)?esc(a.body):a.action==='transfer'?`Transferred to ${esc(a.transfer_to||'another team')}${a.body?' · '+esc(a.body):''}`:`Status: ${esc(label(a.old_status))} → ${esc(label(a.new_status))}`}</div>`).join('')}</div>`:''}</article>`;
}
function reportSummaryRow(title,count,metrics,module,extra=''){
  const n = Number(count)||0;
  return `<section class="report-module-row report-module-${esc(module)}">
    <div class="report-module-title"><strong>${esc(title)}</strong><span>${n} ${n===1?'record':'records'} in report</span></div>
    <div class="report-module-metrics">${metrics.map(([name,value])=>`<div class="report-module-metric"><strong>${Number(value)||0}</strong><span>${esc(name)}</span></div>`).join('')}</div>
    ${extra?`<div class="report-module-extra">${esc(extra)}</div>`:''}
  </section>`;
}
function renderReports(){
 const o=state.overview;
 const offers=[['activity','Updates History','All notes and status changes with timestamps'],['tickets','Tickets','All ticket records, users, sites, IPs and MACs'],['projects','Projects','All project records, optional dates and progress'],['phases','Project Phases','All phase records and their status'],['tasks','Tasks','All tasks and linked work']];
 const d=state.weeklyData;
 const week=reportStart();const finish=new Date(week+'T12:00:00');
 if(state.reportPeriod==='monthly'){finish.setMonth(finish.getMonth()+1);finish.setDate(0)}else{finish.setDate(finish.getDate()+6)}
 const fullLabel=`${shortDate(week)} – ${shortDate(isoLocal(finish))}`;
 const modules=[['tickets','Tickets'],['projects','Projects'],['tasks','Tasks']];
 const query=reportQuery();
 return `${heading('Reports & Backups','Create weekly or monthly PDF reports and keep your local SQLite backups.')}
 <section class="panel weekly-report"><div class="panel-header"><div><h2>${state.reportPeriod==='weekly'?'Weekly':'Monthly'} Activity Report</h2><p class="muted small">Work done, closures, transfers and progress · ${state.reportPeriod==='weekly'?'Monday–Sunday':'Calendar month'}</p></div><span class="badge b-in_progress">PDF</span></div>
  <div class="panel-body"><div class="weekly-controls no-print">
   <div class="weekly-date"><label for="reportPeriod" class="eyebrow">REPORT PERIOD</label><select id="reportPeriod" class="field-select" style="max-width:205px"><option value="weekly" ${state.reportPeriod==='weekly'?'selected':''}>Weekly</option><option value="monthly" ${state.reportPeriod==='monthly'?'selected':''}>Monthly</option></select><span class="eyebrow">${state.reportPeriod==='weekly'?'REPORT WEEK':'REPORT MONTH'}</span><div class="weekly-nav"><button class="btn" data-action="weekly-prev" aria-label="Previous week">‹</button><strong>${fullLabel}</strong><button class="btn" data-action="weekly-next" aria-label="Next week">›</button><button class="btn btn-sm" data-action="weekly-current">This week</button></div>
   <label class="small muted" for="weeklyDate">Or select a day in the period</label><input type="date" class="field-input" id="weeklyDate" value="${week}"></div>
   <div class="weekly-module-controls"><span class="eyebrow">INCLUDE MODULES</span><div class="weekly-checks">${modules.map(([k,v])=>`<label><input type="checkbox" data-weekly-module="${k}" ${state.reportModules[k]?'checked':''}>${v}</label>`).join('')}</div>
   ${query?`<a class="btn btn-primary" href="/api/reports/${state.reportPeriod}.pdf?${query}" download>↓ Export ${state.reportPeriod==='weekly'?'Weekly':'Monthly'} PDF</a>`:`<button class="btn btn-primary" disabled>Select a module</button>`}</div>
  </div><p class="muted small report-explainer">The report includes records created, modified, updated or scheduled during the selected period. Status is shown as of today. Items do not need a due date.</p></div>
  <div class="weekly-preview"><div class="weekly-preview-title"><h3>Report Preview</h3><span class="muted small">${esc(fullLabel)}</span></div>
  ${state.weeklyLoading?'<p class="muted">Loading activity report…</p>':!query?'<p class="muted">Select at least one module.</p>':!d?'<p class="muted">Preview unavailable. Select a different week or try again.</p>':
   `<div class="report-module-summaries">
      ${d.modules.includes('tickets') ? reportSummaryRow('Tickets',d.counts.tickets,[
        ['Worked',d.summary.outcomes.tickets_worked],
        ['New in period',d.summary.outcomes.tickets_created],
        ['Closed in period',d.summary.outcomes.tickets_closed],
        ['Transferred in period',d.summary.outcomes.tickets_transferred],
        ['Pending now',d.summary.status_breakdown.tickets.pending]
       ],'tickets',Object.keys(d.summary.transfer_destinations).length?'Transferred to: '+Object.entries(d.summary.transfer_destinations).map(([team,num])=>`${team} (${num})`).join(', '):''):''}
      ${d.modules.includes('projects') ? reportSummaryRow('Projects',d.counts.projects,[
        ['Updated',d.summary.outcomes.projects_updated],
        ['Completed in period',d.summary.outcomes.projects_completed],
        ['In Progress now',d.summary.status_breakdown.projects.in_progress],
        ['On Hold now',d.summary.status_breakdown.projects.on_hold],
        ['Planned now',d.summary.status_breakdown.projects.planned]
       ],'projects'):''}
      ${d.modules.includes('tasks') ? reportSummaryRow('Tasks',d.counts.tasks,[
        ['Completed in period',d.summary.outcomes.tasks_completed],
        ['Done now',d.summary.status_breakdown.tasks.done],
        ['In Progress now',d.summary.status_breakdown.tasks.in_progress],
        ['To Do now',d.summary.status_breakdown.tasks.todo]
       ],'tasks'):''}
     </div>
    ${d.modules.map(k=>`<div class="weekly-preview-section"><h4>${k==='tickets'?'Tickets':k==='projects'?'Projects':'Tasks'} <span>${d.counts[k]}</span></h4>${d.sections[k].length?d.sections[k].map(item=>reportItem(item,k)).join(''):`<p class="muted small">No records for this period.</p>`}</div>`).join('')}`}
  </div></section>
 <div class="stats">${metric('Active Tickets',o.tickets_open,'Currently unresolved','▤')}${metric('Active Projects',o.projects_active,'Currently active','▦')}${metric('Tasks',o.tasks_open,'To do or in progress','☑')}${metric('Overdue Tasks',o.tasks_overdue,'Incomplete tasks','!','danger')}</div>
 <section class="panel"><div class="panel-header"><h2>Full Data Exports</h2><span class="small muted">Optional CSV format</span></div>
 <div class="panel-body"><div class="report-grid">${offers.map(([key,title,sub])=>`<div class="report-option"><div><h3>${title}</h3><p>${sub}</p></div><a class="btn btn-sm" href="/api/reports/${key}.csv" download>↓ CSV</a></div>`).join('')}</div></div></section>
 <section class="panel"><div class="panel-header"><h2>SQLite Database Backups</h2></div><div class="panel-body">
 <p class="muted">Your records remain in the same local SQLite database. A rolling backup is refreshed after every save.</p>
 <div class="eyebrow">DATABASE LOCATION</div><div class="path-box">${esc(state.settings.database_file)}</div>
 <div class="eyebrow">AUTOMATIC BACKUPS</div><div class="path-box">${esc(state.settings.backups_folder)}</div>
 <div class="page-actions no-print"><a class="btn btn-primary" href="/api/backup/download" download>↓ Download Full Backup</a><button class="btn" data-action="create-backup">Save Backup to Local Folder</button></div>
 <p class="notice"><strong>OneDrive:</strong> Store a copy of an exported backup in your approved corporate OneDrive folder, not the live SQLite file.</p>
 </div></section>`;
}


const NOTE_COLORS=['blue','cyan','mint','amber','violet','rose','slate'];
const noteTags=n=>String(n.tags||'').split(',').map(t=>t.trim()).filter(Boolean).slice(0,8);
function noteLinkedName(n){
 if(!n.linked_kind||!n.linked_id)return '';
 const collection={ticket:state.tickets,project:state.projects,task:state.tasks}[n.linked_kind];
 const r=collection?.find(x=>Number(x.id)===Number(n.linked_id));
 return r?(n.linked_kind==='ticket'?r.ticket_number:n.linked_kind==='project'?r.name:r.title):'Related record unavailable';
}
function noteCard(n){
 const category=n.category?`<span class="note-chip">${esc(n.category)}</span>`:'';
 const tags=noteTags(n).map(t=>`<span class="note-tag">#${esc(t)}</span>`).join('');
 const link=noteLinkedName(n);
 return `<article class="note-card note-color-${esc(n.color)} ${n.archived?'is-archived':''}">
   <div class="note-card-head"><span class="note-folder">▧ ${esc(n.folder)}</span><button class="note-pin ${n.pinned?'is-pinned':''}" data-action="note-pin" data-id="${n.id}" aria-label="${n.pinned?'Unpin':'Pin'} note" title="${n.pinned?'Unpin':'Pin'}">${n.pinned?'◆':'◇'}</button></div>
   <div class="note-open"><button type="button" class="note-open-title" data-action="open-note" data-id="${n.id}">${esc(n.title)}</button><div class="note-excerpt">${brief(n.body.replace(/[\\#*`_]/g,''),195)||'Empty note'}</div></div>
   <div class="note-meta">${category}${tags}${link?`<button class="note-linked" data-action="note-open-related" data-kind="${esc(n.linked_kind)}" data-id="${n.linked_id}" title="Open related record">↗ ${esc(link)}</button>`:''}</div>
   <div class="note-card-foot"><span>${stampDate(n.updated_at)}</span><div class="inline-actions no-print"><button class="note-action" data-action="note-copy" data-id="${n.id}">Copy</button><button class="note-action" data-action="note-archive" data-id="${n.id}">${n.archived?'Restore':'Archive'}</button><button class="note-action" data-action="open-note" data-id="${n.id}">View →</button><button class="note-action" data-action="edit-note" data-id="${n.id}">Edit</button></div></div>
 </article>`;
}
function renderLinkedNotes(kind,id){
 const linked=state.notes.filter(n=>n.linked_kind===kind&&Number(n.linked_id)===Number(id)&&!n.archived);
 return `<section class="panel linked-notes-panel"><div class="panel-header"><h2>Linked Notes (${linked.length})</h2><button class="btn btn-sm no-print" data-action="new-linked-note" data-kind="${kind}" data-id="${id}">+ Note</button></div>
 ${linked.length?linked.map(n=>`<div class="list-row"><div><h3><button class="link-btn" data-action="open-note" data-id="${n.id}">${esc(n.title)}</button></h3><p>${brief(n.body,95)} · ${esc(n.folder)}</p></div><span class="badge">${stampDate(n.updated_at)}</span></div>`).join(''):empty('No notes linked yet.')}</section>`;
}
function renderNotes(){
 const active=state.notes.filter(n=>!n.archived), archived=state.notes.filter(n=>n.archived);
 const folders=state.noteFolders.map(f=>f.name);
 const search=state.noteSearch.trim().toLowerCase();
 let filtered=state.notes.filter(n=>state.noteView==='archived'?n.archived:state.noteView==='pinned'?(n.pinned&&!n.archived):!n.archived);
 if(state.noteFolder!=='all')filtered=filtered.filter(n=>n.folder===state.noteFolder);
 if(search)filtered=filtered.filter(n=>[n.title,n.body,n.folder,n.category,n.tags,noteLinkedName(n)].some(v=>String(v||'').toLowerCase().includes(search)));
 return `${heading('Notes Center','Your ideas, references and quick notes — organized and searchable.',`<button class="btn btn-primary" data-action="new-note">+ New Note</button>`)}
 <div class="notes-hero"><div><span class="eyebrow">PERSONAL KNOWLEDGE BASE</span><h2>Everything worth remembering, in one place.</h2><p>Keep useful commands, ideas and reminders close at hand. Saved locally in SQLite.</p></div>
 <div class="notes-hero-stats"><div><strong>${active.length}</strong><span>Active notes</span></div><div><strong>${active.filter(n=>n.pinned).length}</strong><span>Pinned</span></div><div><strong>${folders.length}</strong><span>Folders</span></div></div></div>
 <section class="panel note-library"><div class="note-library-controls"><div class="note-search-box"><span>⌕</span><input id="notesSearch" class="field-input" placeholder="Search notes, content, tags, or links..." value="${esc(state.noteSearch)}" autocomplete="off" aria-label="Search notes"></div>
 <select id="notesFolder" class="field-select" aria-label="Filter notes by folder"><option value="all">All folders</option>${folders.map(f=>`<option value="${esc(f)}" ${f===state.noteFolder?'selected':''}>${esc(f)}</option>`).join('')}</select>
 <button type="button" class="btn btn-sm" data-action="new-folder">+ New Folder</button><button type="button" class="btn btn-sm" data-action="manage-folders">Manage Folders</button>
 <div class="notes-view-switch"><button class="tab ${state.noteMode==='cards'?'active':''}" data-action="note-mode" data-mode="cards">▦ Cards</button><button class="tab ${state.noteMode==='list'?'active':''}" data-action="note-mode" data-mode="list">☷ List</button></div></div>
 <div class="note-tabs no-print"><button class="tab ${state.noteView==='active'?'active':''}" data-action="note-view" data-view="active">All Notes <span>${active.length}</span></button><button class="tab ${state.noteView==='pinned'?'active':''}" data-action="note-view" data-view="pinned">Pinned <span>${active.filter(n=>n.pinned).length}</span></button><button class="tab ${state.noteView==='archived'?'active':''}" data-action="note-view" data-view="archived">Archived <span>${archived.length}</span></button></div>
 <div class="note-content"><div class="notes-count">${filtered.length} ${filtered.length===1?'note':'notes'} ${state.noteView==='archived'?'archived':state.noteView==='pinned'?'pinned':'available'}</div>
 ${filtered.length?`<div class="note-grid ${state.noteMode==='list'?'note-list':''}">${filtered.map(noteCard).join('')}</div>`:
 `<div class="notes-empty"><div class="notes-empty-icon">▧</div><strong>${search?'No matching notes':state.noteView==='pinned'?'Nothing pinned yet':state.noteView==='archived'?'Your archive is empty':'Your notes start here'}</strong><p>${search?'Try a different search or folder.':'Create a note for anything you want to find quickly later.'}</p>${!search&&state.noteView==='active'?'<button class="btn btn-primary" data-action="new-note">+ Create your first note</button>':''}</div>`}
 </div></section>`;
}
// Safe lightweight formatting: plaintext is escaped before Markdown delimiters are interpreted.
function noteFormatted(s){
 return String(s||'').split(/\r?\n/).map(line=>{
  const trimmed=line.trim();
  let raw=esc(line);
  raw=raw.replace(/`([^`]+)`/g,(_,t)=>`<code>${t}</code>`);
  raw=raw.replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
  raw=raw.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g,'<em>$1</em>');
  raw=raw.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)<]+)\)/gi,(_,name,url)=>`<a href="${url.replace(/&amp;/g,'&amp;')}" target="_blank" rel="noopener noreferrer">${name}</a>`);
  if(/^[-*] /.test(trimmed))return `<div class="note-line-list">• ${raw.replace(/^\s*[-*] /,'')}</div>`;
  if(/^#{1,3} /.test(trimmed))return `<strong class="note-inline-heading">${raw.replace(/^#{1,3} /,'')}</strong>`;
  return `<div>${raw||'&nbsp;'}</div>`;
 }).join('');
}
function openNoteReader(id){
 const n=state.notes.find(x=>x.id===id);
 if(!n){toast('Note not found.',true);return}
 const dialog=$('#editDialog');
 if(dialog.open)dialog.close();
 dialog.classList.remove('note-editor-dialog');dialog.classList.add('note-reader-dialog');
 const linkedName=noteLinkedName(n);
 const link=linkedName?`<button type="button" class="note-linked" data-action="note-open-related" data-kind="${esc(n.linked_kind)}" data-id="${Number(n.linked_id)}">↗ ${esc(linkedName)}</button>`:'';
 $('#dialogContent').innerHTML=`<div class="dialog-head note-read-head"><div><span class="eyebrow">NOTES CENTER · READ ONLY</span><h2>${esc(n.title)}</h2></div><button class="icon-btn" data-close-dialog aria-label="Close">×</button></div>
 <div class="dialog-body"><div class="note-read-meta"><span class="note-chip">▧ ${esc(n.folder)}</span>${n.category?`<span class="note-chip">${esc(n.category)}</span>`:''}${noteTags(n).map(t=>`<span class="note-tag">#${esc(t)}</span>`).join('')}${link}</div>
 <div class="note-read-date">Updated ${stampDate(n.updated_at)} · Select any text to copy</div>
 <div class="note-read-body note-color-${esc(n.color)}" tabindex="0" aria-label="Note content; select text to copy">${n.body?noteFormatted(n.body):'<span class="muted">Empty note</span>'}</div>
 ${screenshotGallery('note',n.id,{editable:true})}
 </div><div class="dialog-foot"><button type="button" class="btn" data-action="note-copy" data-id="${n.id}">Copy text</button><div class="note-spacer"></div><button class="btn" data-close-dialog>Close</button><button type="button" class="btn btn-primary" data-action="edit-note" data-id="${n.id}">Edit Note</button></div>`;
 dialog.dataset.noteId=String(id);dialog.showModal();
}
async function copyNote(id){
 const n=state.notes.find(x=>x.id===id);if(!n)return;
 const contents=String(n.body||'');
 try{
   if(navigator.clipboard && window.isSecureContext){await navigator.clipboard.writeText(contents)}
   else{
     const ta=document.createElement('textarea');ta.value=contents;ta.setAttribute('readonly','');ta.style.cssText='position:fixed;left:-9999px;top:0';document.body.appendChild(ta);ta.select();
     try{if(!document.execCommand('copy'))throw new Error('Copy unavailable')}finally{ta.remove()}
   }
   toast('Note content copied.');
 }catch(err){toast('Copy blocked by browser. Open View and select the text to copy.',true)}
}
function openNote(id=null, prelinkKind=null, prelinkId=null){
 pendingScreenshots=[];
 const n=id?state.notes.find(x=>x.id===id):null;
 if(id&&!n){toast('Note not found.',true);return}
 const linkOptions=[['','No related record'],['ticket','Ticket'],['project','Project'],['task','Task']];
 // A native <select> always lists all folders. Datalist suggestions were filtered
 // by the currently-entered 'General' value and hid other saved folders.
 const selectedFolder=n?.folder||(state.noteFolder==='all'?'General':state.noteFolder);
 const fld=[...new Set(['General',...state.noteFolders.map(x=>x.name),selectedFolder])];
 const dlg=$('#editDialog');if(dlg.open)dlg.close();dlg.classList.remove('note-reader-dialog');dlg.classList.add('note-editor-dialog');
 $('#dialogContent').innerHTML=`<div class="dialog-head"><div><span class="eyebrow">NOTES CENTER</span><h2>${n?'Edit Note':'Create Note'}</h2></div><button class="icon-btn" data-close-dialog aria-label="Close">×</button></div>
 <form id="noteForm" data-id="${n?.id||''}"><div class="dialog-body">
 <div class="form-grid"><div class="form-field full"><label for="noteTitle">Title *</label><input id="noteTitle" name="title" maxlength="200" required placeholder="Give your note a clear title" value="${esc(n?.title||'')}"></div>
 <div class="form-field"><label for="noteFolderInput">Folder</label>
  <div class="note-folder-picker"><select id="noteFolderInput" name="folder" required>${fld.map(x=>`<option value="${esc(x)}" ${x===selectedFolder?'selected':''}>${esc(x)}</option>`).join('')}</select>
  <button type="button" class="btn btn-sm" data-action="show-note-folder-create" title="Create and select a new folder">+ New</button></div>
  <div class="note-folder-create" id="noteFolderCreateRow" hidden><input id="newNoteFolderName" type="text" maxlength="90" placeholder="New folder name" autocomplete="off" aria-label="New folder name"><button type="button" class="btn btn-sm btn-primary" data-action="save-note-folder">Create</button><button type="button" class="btn btn-sm" data-action="cancel-note-folder">Cancel</button></div></div>
 <div class="form-field"><label for="noteCategory">Category</label><input id="noteCategory" name="category" maxlength="90" value="${esc(n?.category||'')}" placeholder="Networking, Ideas, Follow-ups..."></div>
 <div class="form-field full"><label for="noteTags">Tags (comma separated)</label><input id="noteTags" name="tags" maxlength="300" value="${esc(n?.tags||'')}" placeholder="switch, wifi, reference"></div></div>
 <div class="note-color-picker"><span class="note-editor-label">Note color</span><div class="note-colors">${NOTE_COLORS.map(color=>`<label class="note-color-choice ${color}"><input type="radio" name="color" value="${color}" ${(n?.color||'blue')===color?'checked':''}><span title="${color}" aria-label="${color}"></span></label>`).join('')}</div></div>
 <div class="note-editor-label">Content</div><div class="note-formatting no-print"><button type="button" data-action="note-format" data-format="bold" title="Bold">B</button><button type="button" data-action="note-format" data-format="italic" title="Italic"><em>I</em></button><button type="button" data-action="note-format" data-format="bullet" title="Bullet list">☷ List</button><button type="button" data-action="note-format" data-format="code" title="Code">&lt;/&gt; Code</button><button type="button" data-action="note-format" data-format="link" title="Link">↗ Link</button><span>Simple formatting · preview below</span></div>
 <textarea id="noteBody" name="body" maxlength="50000" rows="13" placeholder="Write a reminder, troubleshooting steps, commands, meeting notes...">${esc(n?.body||'')}</textarea>
 <div class="note-preview-head">Live preview</div><div class="note-preview" id="notePreview">${noteFormatted(n?.body||'')}</div>
 ${screenshotGallery('note',n?.id,{editable:true,pending:true})}
 <div class="form-grid note-link-fields"><div class="form-field"><label for="noteLinkedKind">Related to (optional)</label><select id="noteLinkedKind" name="linked_kind">${linkOptions.map(([k,v])=>`<option value="${k}" ${k===(n?.linked_kind||prelinkKind||'')?'selected':''}>${v}</option>`).join('')}</select></div>
 <div class="form-field"><label for="noteLinkedId">Select record</label><select id="noteLinkedId" name="linked_id"></select></div></div>
 <label class="note-checkbox"><input type="checkbox" name="pinned" ${n?.pinned?'checked':''}> Pin to Dashboard</label>
 </div><div class="dialog-foot">${n?`<button type="button" class="btn btn-danger" data-action="note-delete" data-id="${n.id}">Delete</button><button type="button" class="btn" data-action="note-archive" data-id="${n.id}">${n.archived?'Restore':'Archive'}</button>`:''}<div class="note-spacer"></div><button type="button" class="btn" data-close-dialog>Cancel</button><button class="btn btn-primary" type="submit">${n?'Save Changes':'Create Note'}</button></div></form>`;
 dlg.showModal();updateNoteLinkOptions(n?.linked_id||prelinkId||'');$('#noteTitle').focus();
}
function showNoteFolderCreate(){
 const row=$('#noteFolderCreateRow');if(!row)return;
 row.hidden=false;$('#newNoteFolderName')?.focus();
}
function cancelNoteFolderCreate(){
 const row=$('#noteFolderCreateRow');if(row)row.hidden=true;
 const input=$('#newNoteFolderName');if(input)input.value='';
}
async function saveNoteFolderFromEditor(){
 const input=$('#newNoteFolderName'),sel=$('#noteFolderInput');
 if(!input||!sel)return;
 const name=input.value.trim();if(!name){toast('Enter a folder name.',true);input.focus();return}
 const existing=[...sel.options].find(o=>o.value.toLowerCase()===name.toLowerCase());
 if(existing){sel.value=existing.value;cancelNoteFolderCreate();toast('Existing folder selected.');return}
 const button=$('[data-action="save-note-folder"]');if(button)button.disabled=true;
 try{
   const folder=await request('/api/note-folders','POST',{name});
   // Update the in-memory folder list without redrawing the editor: doing so
   // would discard any unsaved title, body, tags and link values.
   state.noteFolders=await request('/api/note-folders');
   const option=document.createElement('option');option.value=folder.name;option.textContent=folder.name;
   sel.add(option);sel.value=folder.name;
   cancelNoteFolderCreate();toast('Folder created and selected.');
 }catch(e){toast(e.message,true)}finally{if(button)button.disabled=false}
}
function updateNoteLinkOptions(selected=''){
 const kind=$('#noteLinkedKind')?.value;const sel=$('#noteLinkedId');if(!sel)return;
 const coll={ticket:state.tickets,project:state.projects,task:state.tasks}[kind]||[];
 sel.disabled=!kind;
 sel.innerHTML='<option value="">'+(kind?'Select a record':'Not linked')+'</option>'+coll.map(x=>`<option value="${x.id}" ${String(x.id)===String(selected)?'selected':''}>${esc(kind==='ticket'?x.ticket_number:kind==='project'?x.name:x.title)}</option>`).join('');
}
function openFolderManager(focusNew=false){
 const dialog=$('#editDialog');if(dialog.open)dialog.close();
 dialog.classList.remove('note-reader-dialog','note-editor-dialog');dialog.classList.add('folder-manager-dialog');
 $('#dialogContent').innerHTML=`<div class="dialog-head"><div><span class="eyebrow">NOTES CENTER</span><h2>Manage Folders</h2></div><button class="icon-btn" data-close-dialog aria-label="Close">×</button></div>
 <div class="dialog-body"><p class="muted small">Create folders for your notes, even before adding anything to them. Renaming or deleting a folder never deletes notes.</p>
 <form id="createFolderForm" class="folder-create-row"><label class="sr-only" for="newFolderName">New folder name</label><input id="newFolderName" name="name" maxlength="90" required placeholder="New folder name, e.g. Networking" autocomplete="off"><button class="btn btn-primary" type="submit">+ Create Folder</button></form>
 <div class="folder-list">${state.noteFolders.map(f=>`<div class="folder-manage-row"><span><strong>▧ ${esc(f.name)}</strong><small>${f.note_count} ${f.note_count===1?'note':'notes'}</small></span><div class="inline-actions">${f.name.toLowerCase()==='general'?'<small class="muted">Default folder</small>':`<button class="btn btn-sm" data-action="rename-folder" data-id="${f.id}">Rename</button><button class="btn btn-sm" data-action="delete-folder" data-id="${f.id}">Delete</button>`}</div></div>`).join('')}</div></div>
 <div class="dialog-foot"><button class="btn" data-close-dialog>Done</button></div>`;
 dialog.showModal();if(focusNew)$('#newFolderName').focus();
}
async function createFolder(ev){
 ev.preventDefault();const form=ev.target,name=form.querySelector('[name="name"]').value.trim();if(!name)return;
 const submit=form.querySelector('[type="submit"]');submit.disabled=true;
 try{await request('/api/note-folders','POST',{name});await refresh();state.noteFolder=name;state.noteView='active';render();openFolderManager();toast('Folder created.');}
 catch(e){toast(e.message,true);submit.disabled=false;}
}
async function renameFolder(id){
 const folder=state.noteFolders.find(f=>f.id===id);if(!folder)return;
 const proposed=window.prompt('Rename folder:',folder.name);if(proposed===null)return;
 const name=proposed.trim();if(!name||name===folder.name)return;
 try{await request(`/api/note-folders/${id}`,'PUT',{name});if(state.noteFolder===folder.name)state.noteFolder=name;await refresh();render();openFolderManager();toast('Folder renamed; notes remain in place.');}
 catch(e){toast(e.message,true)}
}
async function deleteFolder(id){
 const folder=state.noteFolders.find(f=>f.id===id);if(!folder)return;
 if(!window.confirm(`Delete the folder "${folder.name}"? Its ${folder.note_count} notes will be moved to General, not deleted.`))return;
 try{const result=await request(`/api/note-folders/${id}`,'DELETE');if(state.noteFolder===folder.name)state.noteFolder='General';await refresh();render();openFolderManager();toast(`Folder removed. ${result.moved} note(s) moved to General.`);}
 catch(e){toast(e.message,true)}
}
function noteFormat(type){
 const el=$('#noteBody');if(!el)return;
 const start=el.selectionStart,end=el.selectionEnd,selection=el.value.slice(start,end);
 let replacement='';
 if(type==='bold')replacement=`**${selection||'bold text'}**`;
 if(type==='italic')replacement=`*${selection||'italic text'}*`;
 if(type==='code')replacement='`'+(selection||'command')+'`';
 if(type==='bullet')replacement=selection?selection.split('\n').map(l=>'- '+l).join('\n'):'- list item';
 if(type==='link')replacement=`[${selection||'link text'}](https://example.com)`;
 el.setRangeText(replacement,start,end,'select');el.focus();updateNotePreview();
}
function updateNotePreview(){const preview=$('#notePreview'),body=$('#noteBody');if(preview&&body)preview.innerHTML=noteFormatted(body.value)}
async function saveNote(ev){
 ev.preventDefault();const form=ev.target,id=Number(form.dataset.id)||null;
 const data=Object.fromEntries(new FormData(form).entries());data.pinned=!!form.querySelector('[name="pinned"]').checked;
 data.archived=id?!!state.notes.find(n=>n.id===id)?.archived:false;
 if(!data.linked_kind)data.linked_id='';
 const button=form.querySelector('[type="submit"]');button.disabled=true;
 try{
   const result=await request('/api/notes'+(id?'/'+id:''),id?'PUT':'POST',data);
   const savedId=id||result.id;
   form.dataset.id=String(savedId);
   await uploadPendingScreenshots('note',savedId);
   $('#editDialog').close();$('#editDialog').classList.remove('note-editor-dialog');await refresh();render();toast(id?'Note updated.':'Note created.');
 }catch(e){button.disabled=false;toast('Save interrupted: '+e.message+' You can retry without losing pasted images.',true)}
}
async function patchNote(id,changes){
 const n=state.notes.find(x=>x.id===id);if(!n)return;
 const payload={...n,...changes};
 try{await request(`/api/notes/${id}`,'PUT',payload);$('#editDialog').close();$('#editDialog').classList.remove('note-editor-dialog');await refresh();render();toast(changes.archived!==undefined?(changes.archived?'Note archived.':'Note restored.'):'Note updated.');}
 catch(e){toast(e.message,true)}
}
async function deleteNote(id){
 const n=state.notes.find(x=>x.id===id);if(!n)return;
 if(!window.confirm(`Permanently delete "${n.title}"? This cannot be undone.`))return;
 try{await request(`/api/notes/${id}`,'DELETE');$('#editDialog').close();$('#editDialog').classList.remove('note-editor-dialog');await refresh();render();toast('Note deleted.');}
 catch(e){toast(e.message,true)}
}

// Work Tracker v1.5.7 — read-only index of files in Documents/Manuales.
// No manual bytes or paths are stored in SQLite, and nothing is uploaded.
const manualIcons={PDF:'▤',Document:'▧',Spreadsheet:'▦',Presentation:'▣',Video:'▶',Image:'▨'};
function manualSize(bytes){
 if(bytes<1024)return `${bytes} B`;
 if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KB`;
 return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}
function manualDate(value){
 const d=new Date(value);
 return isNaN(d.getTime())?'—':d.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
}
function renderManuals(){
 const types=['all','PDF','Document','Spreadsheet','Presentation','Video','Image'];
 const terms=searchTokens(state.manualSearch);
 const filtered=state.manuals.filter(f=>(state.manualType==='all'||f.type===state.manualType) &&
    searchMatches(terms,[f.name,f.path,f.type,f.folder]));
 const count=state.manuals.length;
 return heading('Manuals Library','Technical manuals and references, opened directly from your local folder.',
   '<button class="btn btn-primary" data-action="manual-refresh">⟳ Refresh files</button>')+`
 <section class="manual-intro panel">
  <div class="manual-intro-icon">▧</div>
  <div class="manual-intro-content"><strong>Local Manuals Folder</strong><p title="${esc(state.manualsFolder)}">${esc(state.manualsFolder||'Documents\\Manuales')}</p>
   <small>Files stay in the original folder. Add or remove a document in Windows Explorer and the library will update automatically.</small></div>
  <div class="manual-summary"><strong>${count}</strong><span>${count===1?'file':'files'}</span></div>
 </section>
 <section class="panel manual-library">
  <div class="manual-controls"><label class="manual-search"><span>⌕</span><input id="manualSearch" class="field-input" placeholder="Search manuals by name, folder or type…" autocomplete="off" value="${esc(state.manualSearch)}" aria-label="Search manuals"></label>
   <select id="manualType" class="field-select" aria-label="Filter manuals by file type">${types.map(t=>`<option value="${t}" ${t===state.manualType?'selected':''}>${t==='all'?'All file types':t}</option>`).join('')}</select>
   <span class="manual-refresh-time">${state.manualLastUpdated?'Checked '+manualDate(state.manualLastUpdated):'Not checked yet'}</span></div>
  ${state.manualLoading?'<p class="manual-feedback">Scanning local files…</p>':''}
  ${state.manualError?`<p class="manual-error">${esc(state.manualError)}</p>`:''}
  ${!state.manualsExists&&!state.manualLoading?`<div class="manual-empty"><strong>Manuals folder not found</strong><p>Create the folder at the path shown above, or check that Windows is using the same Documents location. No database change is needed.</p><button class="btn" data-action="manual-refresh">Try again</button></div>`:
   !filtered.length?`<div class="manual-empty"><strong>${count?'No matching files':'No manuals yet'}</strong><p>${count?'Try a different search or file type.':'Copy PDFs, Word documents, text files or videos into your Manuals folder.'}</p></div>`:
   `<div class="manual-list-head"><span>FILE</span><span>TYPE</span><span>MODIFIED</span><span>SIZE</span><span></span></div>
    <div class="manual-list">${filtered.map(f=>{const index=state.manuals.indexOf(f);return `<div class="manual-row">
     <div class="manual-name-cell"><span class="manual-type-icon" aria-hidden="true">${manualIcons[f.type]||'▤'}</span><div class="manual-name-wrap"><button type="button" class="manual-filename" data-action="manual-open" data-index="${index}" title="Open ${esc(f.name)}">${esc(f.name)}</button>${f.folder?`<small>▧ ${esc(f.folder)}</small>`:''}</div></div>
     <span class="manual-type">${esc(f.type)}</span><span class="manual-date">${manualDate(f.modified)}</span>
     <span class="manual-size">${manualSize(f.size)}</span><button class="btn btn-sm manual-open" data-action="manual-open" data-index="${index}">Open ↗</button>
    </div>`}).join('')}</div>`}
  <div class="manual-foot"><span>${filtered.length} shown out of ${count} files</span><span>Automatically checks for changes while this page is open</span></div>
 </section>`;
}
async function loadManuals({quiet=false}={}){
 if(state.manualLoading)return;
 if(!quiet){state.manualLoading=true;if(state.page==='manuals')render()}
 try{
  const result=await request('/api/manuals');
  state.manuals=result.files||[];state.manualsFolder=result.folder||'';state.manualsExists=!!result.exists;
  state.manualError='';state.manualLastUpdated=new Date().toISOString();
  // Keep the global results in sync when a new document appears in Manuals.
  const gs=$('#globalSearch');const panel=$('#globalSearchResults');
  if(gs?.value.trim()&&panel&&!panel.hidden)renderGlobalSearch();
 }catch(e){state.manualError=e.message;if(!quiet)toast('Cannot read the Manuals folder: '+e.message,true)}
 finally{state.manualLoading=false;if(state.page==='manuals'){const focused=document.activeElement?.id==='manualSearch';const pos=focused?document.activeElement.selectionStart:null;render();if(focused){const input=$('#manualSearch');input?.focus();if(input&&pos!==null)input.setSelectionRange(pos,pos)}}}
}
async function openManual(index){
 const file=state.manuals[index];if(!file)return;
 try{await request('/api/manuals/open','POST',{path:file.path});toast(`Opening ${file.name}`)}
 catch(e){toast('Could not open the file: '+e.message,true)}
}

function render(){
 $('#topTitle').textContent=PAGE_TITLES[state.page];
 document.querySelectorAll('.side-nav button').forEach(el=>el.classList.toggle('active',el.dataset.nav===state.page));
 const pageRender={dashboard:renderDashboard,tickets:renderTickets,projects:renderProjects,tasks:renderTasks,calendar:renderCalendar,notes:renderNotes,manuals:renderManuals,reports:renderReports};
 $('#page').innerHTML=pageRender[state.page]();
}
function navigate(page){
 if(!(page in PAGE_TITLES))return;
 hideGlobalSearch(true);
 state.page=page;state.detailKind=null;state.detailId=null;state.detailUpdates=[];
 render();window.scrollTo(0,0);
 if(page==='reports')loadWeeklyReport();
 if(page==='manuals')loadManuals();
}
function formField(name,title,val='',type='text',opts='') {
 return `<div class="form-field ${opts.includes('full')?'full':''}"><label for="field_${name}">${title}</label>
 <input id="field_${name}" type="${type}" name="${name}" value="${esc(val)}" ${opts.includes('required')?'required':''} maxlength="250"></div>`;
}
function textarea(name,title,val='',hint='') {
 return `<div class="form-field full"><label for="field_${name}">${title}</label><textarea id="field_${name}" name="${name}" maxlength="8000">${esc(val)}</textarea>${hint?`<div class="hint">${hint}</div>`:''}</div>`;
}
function selectField(name,title,options,value='',full=false) {
 return `<div class="form-field ${full?'full':''}"><label for="field_${name}">${title}</label><select id="field_${name}" name="${name}">${options.map(([key,label])=>`<option value="${esc(key)}" ${String(key)===String(value??'')?'selected':''}>${esc(label)}</option>`).join('')}</select></div>`;
}
function enumOptions(values){return values.map(x=>[x,label(x)]);}
function projectOptions(value){return selectField('project_id','Related Project (optional)',[['','None'],...state.projects.map(x=>[x.id,x.name])],value)}
function ticketOptions(value){return selectField('ticket_id','Related Ticket (optional)',[['','None'],...state.tickets.map(x=>[x.id,x.ticket_number])],value)}
function openEditor(kind,id,projectId,ticketId){
 pendingScreenshots=[];
 let item,fields='',title='',endpoint='';
 if(kind==='ticket'){
   item=state.tickets.find(x=>x.id===id)||{};
   title=id?'Edit Ticket':'New Ticket';endpoint='tickets';
   fields=formField('ticket_number','Ticket Number *',item.ticket_number||'','text','required')+
    textarea('description','Description *',item.description)+
    formField('site','Site / Location',item.site)+
    formField('ticket_user','Ticket User / Requester (optional)',item.ticket_user)+
    selectField('status','Status',enumOptions(STATUSES.ticket),item.status||'open')+
    `<div class="transfer-fields ${(item.status||'open')==='transferred'?'':'hidden'}" id="ticketTransferFields">${formField('transfer_to','Transfer To / Department *',item.transfer_to||'')}${formField('transfer_reason','Transfer Reason / Notes',item.transfer_reason||'')}<div class="hint">Examples: Help Desk, Cybersecurity, Other department. Transfer is recorded automatically with date and time.</div></div>`+
    selectField('priority','Priority',enumOptions(['low','normal','high','urgent']),item.priority||'normal')+
    formField('due_date','Due Date',item.due_date,'date')+
    formField('ip_address','IP Address (optional)',item.ip_address)+
    formField('mac_address','MAC Address (optional)',item.mac_address)+
    projectOptions(item.project_id??projectId??'')+
    textarea('notes','Notes / Updates',item.notes);
 }else if(kind==='project'){
   item=state.projects.find(x=>x.id===id)||{};
   title=id?'Edit Project':'New Project';endpoint='projects';
   fields=formField('name','Project Name *',item.name||'','text','required')+
    textarea('description','Description / Scope',item.description)+
    formField('site','Site / Location',item.site)+
    selectField('status','Status',enumOptions(STATUSES.project),item.status||'planned')+
    formField('start_date','Start Date',item.start_date,'date')+
    formField('due_date','Due Date',item.due_date,'date')+
    textarea('notes','Notes',item.notes);
 }else if(kind==='task'){
   item=state.tasks.find(x=>x.id===id)||{};
   title=id?'Edit Task':'New Task';endpoint='tasks';
   fields=formField('title','Task *',item.title||'','text','required')+
    textarea('details','Details',item.details)+
    formField('task_date','Due Date (optional)',item.task_date||'','date')+
    selectField('status','Status',enumOptions(['todo','in_progress','done']),item.status||'todo')+
    selectField('priority','Priority',enumOptions(['low','normal','high','urgent']),item.priority||'normal')+
    projectOptions(item.project_id??projectId??'')+
    ticketOptions(item.ticket_id??ticketId??'');
 }else if(kind==='phase'){
   item=state.phases.find(x=>x.id===id)||{};
   title=id?'Edit Project Phase':'Add Project Phase';endpoint='phases';
   const pid=item.project_id??projectId;
   fields=`<input type="hidden" name="project_id" value="${esc(pid)}">`+
    formField('name','Phase Name *',item.name||'','text','required')+
    selectField('status','Status',enumOptions(['not_started','in_progress','completed']),item.status||'not_started')+
    formField('due_date','Due Date',item.due_date,'date');
 }else return;
 const dialog=$('#editDialog');
 $('#dialogContent').innerHTML=`<div class="dialog-head"><h2>${title}</h2><button class="icon-btn" type="button" data-close-dialog aria-label="Close">×</button></div>
 <form id="recordForm" data-endpoint="${endpoint}" data-id="${id||''}"><div class="dialog-body"><div class="form-grid">${fields}</div>${kind!=='phase'?screenshotGallery(kind,id,{editable:true,pending:true}):''}</div>
 <div class="dialog-foot"><button type="button" class="btn" data-close-dialog>Cancel</button><button type="submit" class="btn btn-primary">${id?'Save Changes':'Create '+kind[0].toUpperCase()+kind.slice(1)}</button></div></form>`;
 dialog.showModal();
}
function recordName(kind,id){
 const rows={ticket:state.tickets,project:state.projects,task:state.tasks,phase:state.phases}[kind]||[];
 const record=rows.find(x=>x.id===id);
 return record?.ticket_number||record?.name||record?.title||'Record';
}
async function openUpdates(kind,id){
 const dialog=$('#editDialog');
 const title=recordName(kind,id);
 $('#dialogContent').innerHTML=`<div class="dialog-head"><h2>Updates · ${esc(title)}</h2><button class="icon-btn" type="button" data-close-dialog aria-label="Close">×</button></div><div class="dialog-body"><p class="muted small">Add a timestamped note without changing the original details.</p><form id="updateForm" data-kind="${kind}" data-id="${id}">${textarea('note','New Update / Note')}<div class="page-actions" style="justify-content:end;margin-top:12px"><button type="submit" class="btn btn-primary">Save Update</button></div></form><h3 style="margin-top:24px">Update History</h3><div id="updateHistory" class="activity-feed">Loading updates…</div></div><div class="dialog-foot"><button class="btn" data-close-dialog>Close</button></div>`;
 dialog.showModal();
 await loadUpdates(kind,id);
}
async function loadUpdates(kind,id){
 try{
 const list=await request(`/api/updates?kind=${encodeURIComponent(kind)}&record_id=${id}`);
 const feed=$('#updateHistory');if(!feed)return;
 feed.innerHTML=list.length?list.map(e=>`<div class="activity-entry"><span class="activity-date">${stampDate(e.created_at)}</span>${['note','edit'].includes(e.action)?`<div class="activity-body">${esc(e.body)}</div>`:e.action==='transfer'?`<div class="activity-body">Transferred to <strong>${esc(e.transfer_to||'another team')}</strong>${e.body?` · ${esc(e.body)}`:''}</div>`:`<div class="activity-body">Status: ${badge(e.old_status)} → ${badge(e.new_status)}</div>`}</div>`).join(''):'<p class="muted small">No updates yet.</p>';
 }catch(e){const feed=$('#updateHistory');if(feed)feed.textContent=e.message;}
}
async function saveUpdate(event){
 event.preventDefault();const form=event.target;
 const kind=form.dataset.kind,id=Number(form.dataset.id);
 const note=form.querySelector('[name="note"]').value.trim();if(!note){toast('Enter a note before saving.',true);return}
 const btn=form.querySelector('[type=submit]');btn.disabled=true;
 try{await request('/api/updates','POST',{kind,record_id:id,note});form.reset();await loadUpdates(kind,id);toast('Update saved.')}catch(e){toast(e.message,true)}finally{btn.disabled=false}
}
function openTransferDialog(id){
 const dialog=$('#editDialog'), t=state.tickets.find(x=>x.id===id);
 if(!t)return;
 $('#dialogContent').innerHTML=`<div class="dialog-head"><h2>Transfer ticket · ${esc(t.ticket_number)}</h2><button class="icon-btn" data-close-dialog>×</button></div>
   <form id="transferForm" data-id="${id}"><div class="dialog-body"><p class="muted small">The ticket will be marked as Transferred, not Closed. Its destination and timestamp are saved in the history.</p>
   ${formField('transfer_to','Destination team *',t.status==='transferred'?t.transfer_to:'')}
   <p class="muted small">For example: Help Desk, Cybersecurity, Network Operations.</p>${textarea('transfer_reason','Transfer reason / notes')}
   </div><div class="dialog-foot"><button class="btn" type="button" data-close-dialog>Cancel</button><button class="btn btn-primary" type="submit">Confirm Transfer</button></div></form>`;
 dialog.showModal();
}
async function saveTransfer(event){
 event.preventDefault();const form=event.target;
 const id=Number(form.dataset.id);const transfer_to=form.querySelector('[name="transfer_to"]').value.trim();
 const transfer_reason=form.querySelector('[name="transfer_reason"]').value.trim();
 if(!transfer_to){toast('Enter a destination team.',true);return}
 const b=form.querySelector('button[type="submit"]');b.disabled=true;
 try{await request('/api/status','POST',{kind:'ticket',record_id:id,status:'transferred',transfer_to,transfer_reason});
 $('#editDialog').close();await refresh();if(state.detailKind==='ticket'&&state.detailId===id)state.detailUpdates=await request(`/api/updates?kind=ticket&record_id=${id}`);
 render();toast('Ticket transferred and history updated.');}catch(e){toast(e.message,true);b.disabled=false}
}
async function setQuickStatus(kind,id,status){
 if(kind==='ticket' && status==='transferred'){
   render();openTransferDialog(id);return;
 }
 try{await request('/api/status','POST',{kind,record_id:id,status});await refresh();if(state.detailKind===kind&&state.detailId===id){state.detailUpdates=await request(`/api/updates?kind=${kind}&record_id=${id}`)}render();toast('Status updated.')}catch(e){toast(e.message,true);await refresh();render()}
}
async function saveForm(event){
 event.preventDefault();const form=event.target;
 const payload=Object.fromEntries(new FormData(form).entries());
 const id=form.dataset.id,endpoint=form.dataset.endpoint;
 if(endpoint==='tickets'&&payload.status==='transferred'&&!payload.transfer_to?.trim()){
   toast('Destination team required for transferred tickets.',true);return;
 }
 const saveButton=form.querySelector('[type=submit]');saveButton.disabled=true;
 try{
   const result=await request(`/api/${endpoint}${id?'/'+id:''}`,id?'PUT':'POST',payload);
   const kind=endpoint.slice(0,-1);
   form.dataset.id=String(id||result.id);
   await uploadPendingScreenshots(kind,Number(id||result.id));
   $('#editDialog').close();
   if(endpoint==='projects' && state.detailKind==='project' && !id)state.detailId=result.id;
   await refresh();if(state.detailKind && state.detailId)state.detailUpdates=await request(`/api/updates?kind=${state.detailKind}&record_id=${state.detailId}`);render();toast(`${endpoint.slice(0,-1)} saved successfully.`);
 }catch(e){toast('Save interrupted: '+e.message+' You can retry to finish attaching images.',true);saveButton.disabled=false;}
}
async function handleDelete(kind,id){
 if(!['task','phase'].includes(kind)){toast('Tickets and projects are retained for history.',true);return}
 const names={ticket:'ticket',task:'task',project:'project',phase:'phase'};
 if(!window.confirm(`Delete this ${names[kind]}? This cannot be undone.`))return;
 const path={ticket:'tickets',task:'tasks',project:'projects',phase:'phases'}[kind];
 try{
   await request(`/api/${path}/${id}`,'DELETE');
   if(state.detailKind===kind && state.detailId===id){state.detailKind=null;state.detailId=null;}
   await refresh();render();toast(`${kind} deleted.`);
 }catch(e){toast(e.message,true)}
}
async function toggleTask(id,checked){
 const t=state.tasks.find(t=>t.id===id);if(!t)return;
 const payload={...t,status:checked?'done':'todo'};
 try{await request(`/api/tasks/${id}`,'PUT',payload);await refresh();render();toast('Task updated.')}catch(e){toast(e.message,true)}
}
async function createBackup(){
 try{const result=await request('/api/backup/create','POST',{});toast('Backup saved: '+result.saved_to)}catch(e){toast(e.message,true)}
}
function actionClick(ev){
 const button=ev.target.closest('[data-action],[data-nav],[data-close-dialog]');if(!button)return;
 if(button.hasAttribute('data-close-dialog')){$('#editDialog').close();$('#editDialog').classList.remove('note-editor-dialog','note-reader-dialog','folder-manager-dialog');return}
 if(button.dataset.nav){navigate(button.dataset.nav);return}
 const action=button.dataset.action,id=Number(button.dataset.id),projectId=Number(button.dataset.project)||undefined;
 if(action==='global-open'){openGlobalResult(button.dataset.kind,id);return}
 if(action==='image-remove'){removeScreenshot(id);return}
 if(action==='image-pending-remove'){pendingScreenshots.splice(id,1);redrawEditorGallery();return}
 if(action==='show-note-folder-create')showNoteFolderCreate();
 else if(action==='save-note-folder')saveNoteFolderFromEditor();
 else if(action==='cancel-note-folder')cancelNoteFolderCreate();
 else if(action==='new-folder')openFolderManager(true);
 else if(action==='manage-folders')openFolderManager();
 else if(action==='rename-folder')renameFolder(id);
 else if(action==='delete-folder')deleteFolder(id);
 else if(action==='new-note')openNote();
 else if(action==='open-note')openNoteReader(id);
 else if(action==='edit-note')openNote(id);
 else if(action==='note-copy')copyNote(id);
 else if(action==='new-linked-note')openNote(null,button.dataset.kind,id);
 else if(action==='note-open-related'){if($('#editDialog').open)$('#editDialog').close();showDetails(button.dataset.kind,id)}
 else if(action==='note-pin'){const n=state.notes.find(x=>x.id===id);if(n)patchNote(id,{pinned:!n.pinned})}
 else if(action==='note-archive'){const n=state.notes.find(x=>x.id===id);if(n)patchNote(id,{archived:!n.archived})}
 else if(action==='note-delete')deleteNote(id);
 else if(action==='note-mode'){state.noteMode=button.dataset.mode;render()}
 else if(action==='note-view'){state.noteView=button.dataset.view;render()}
 else if(action==='note-format')noteFormat(button.dataset.format);
 else if(action==='new-ticket')openEditor('ticket',null,projectId);
 else if(action==='new-project')openEditor('project');
 else if(action==='new-task')openEditor('task',null,projectId);
 else if(action==='new-task-for-ticket')openEditor('task',null,undefined,id);
 else if(action==='new-phase')openEditor('phase',null,id);
 else if(action==='edit-ticket')openEditor('ticket',id);
 else if(action==='edit-project')openEditor('project',id);
 else if(action==='edit-task')openEditor('task',id);
 else if(action==='edit-phase')openEditor('phase',id);
 else if(action.startsWith('updates-'))openUpdates(action.slice(8),id);
 else if(action.startsWith('delete-'))handleDelete(action.slice(7),id);
 else if(action==='view-project')showDetails('project',id);
   else if(action==='view-ticket')showDetails('ticket',id);
   else if(action==='view-task')showDetails('task',id);
 else if(action==='back-projects'){state.detailKind=null;state.detailId=null;render()}
 else if(action==='filter-ticket-status'){state.ticketStatus=button.dataset.status;state.page='tickets';state.detailKind=null;render();}
 else if(action==='filter-project'){state.projectStatus=button.dataset.status;render()}
 else if(action==='task-view'){state.taskView=button.dataset.view;render()}
 else if(action==='task-status-preset'){
   state.taskStatuses=button.dataset.preset==='active'?['todo','in_progress']:['todo','in_progress','done'];render()
 }
 else if(action==='calendar-mode'){state.calendarMode=button.dataset.mode;render()}
   else if(action==='calendar-filter'){state.calendarFilter=button.dataset.filter;render()}
   else if(action==='calendar-today'){state.calendarDate=calendarToday();render()}
   else if(action==='calendar-prev'||action==='calendar-next'){const d=calendarTarget(),step=action==='calendar-prev'?-1:1;if(state.calendarMode==='month'){d.setDate(1);d.setMonth(d.getMonth()+step)}else d.setDate(d.getDate()+step*7);state.calendarDate=isoLocal(d);render()}
   else if(action==='calendar-open'){const kind=button.dataset.kind;if(kind==='phase'){const ph=state.phases.find(x=>x.id===id);if(ph)showDetails('project',ph.project_id)}else showDetails(kind,id)}
   else if(action==='manual-refresh')loadManuals();
   else if(action==='manual-open')openManual(Number(button.dataset.index));
   else if(action==='create-backup')createBackup();
 else if(action==='weekly-prev'||action==='weekly-next'){
   const step=action==='weekly-prev'?-1:1;
   if(state.reportPeriod==='monthly'){const d=new Date(reportStart()+'T12:00:00');d.setMonth(d.getMonth()+step);state.reportWeek=isoLocal(d)}
   else state.reportWeek=weekShift(reportStart(),step);
   loadWeeklyReport();}
 else if(action==='weekly-current'){state.reportWeek=state.reportPeriod==='monthly'?state.overview.today.slice(0,7)+'-01':mondayISO();loadWeeklyReport()}
 else if(action==='print-report')window.print();
}
function changeEvent(ev){
 if(ev.target.matches('[data-task-status]')){
   const picked=new Set(state.taskStatuses);
   if(ev.target.checked)picked.add(ev.target.dataset.taskStatus);
   else picked.delete(ev.target.dataset.taskStatus);
   state.taskStatuses=STATUSES.task.filter(status=>picked.has(status));
   render();return;
 }
 if(ev.target.id==='manualType'){state.manualType=ev.target.value;render();return}
 if(ev.target.id==='notesFolder'){state.noteFolder=ev.target.value;render();return}
 if(ev.target.id==='noteLinkedKind'){updateNoteLinkOptions();return}
 if(ev.target.id==='calendarShowCompleted'){state.calendarShowCompleted=ev.target.checked;render();return}
 if(ev.target.id==='reportPeriod'){state.reportPeriod=ev.target.value;state.reportWeek=state.overview.today;loadWeeklyReport();return}
 if(ev.target.id==='weeklyDate'){state.reportWeek=state.reportPeriod==='monthly'?ev.target.value.slice(0,7)+'-01':mondayISO(ev.target.value);loadWeeklyReport();return}
 if(ev.target.matches('[data-weekly-module]')){state.reportModules[ev.target.dataset.weeklyModule]=ev.target.checked;loadWeeklyReport();return}
 if(ev.target.id==='ticketStatus'){state.ticketStatus=ev.target.value;render()}
 else if(ev.target.id==='field_status'&&ev.target.closest('#recordForm')?.dataset.endpoint==='tickets'){
   const panel=$('#ticketTransferFields');if(panel)panel.classList.toggle('hidden',ev.target.value!=='transferred');
 }
 else if(ev.target.matches('[data-quick-kind]'))setQuickStatus(ev.target.dataset.quickKind,Number(ev.target.dataset.id),ev.target.value)
 else if(ev.target.matches('[data-action="toggle-task"]'))toggleTask(Number(ev.target.dataset.id),ev.target.checked);
}
function inputEvent(ev){
 if(ev.target.id==='manualSearch'){state.manualSearch=ev.target.value;const pos=ev.target.selectionStart;render();const input=$('#manualSearch');if(input){input.focus();input.setSelectionRange(pos,pos)}return}
 if(ev.target.id==='noteBody'){updateNotePreview();return}
 if(ev.target.id==='notesSearch'){state.noteSearch=ev.target.value;const pos=ev.target.selectionStart;render();const el=$('#notesSearch');if(el){el.focus();el.setSelectionRange(pos,pos)}return}
 if(ev.target.id==='ticketSearch'){
   state.search=ev.target.value;
   const position=ev.target.selectionStart;
   render();const input=$('#ticketSearch');if(input){input.focus();input.setSelectionRange(position,position)}
 }
}
window.addEventListener('DOMContentLoaded',async()=>{
  const globalInput=$('#globalSearch');
  globalInput.addEventListener('focus',()=>{
    renderGlobalSearch();
    const elapsed=Date.now()-new Date(state.manualLastUpdated||0).getTime();
    if(elapsed>15000)loadManuals({quiet:true});
  });
  globalInput.addEventListener('input',()=>{globalSearchActive=0;renderGlobalSearch()});
  globalInput.addEventListener('keydown',ev=>{
    const panel=$('#globalSearchResults');
    if(ev.key==='Escape'){ev.preventDefault();hideGlobalSearch();globalInput.blur();return}
    if(ev.key==='ArrowDown'||ev.key==='ArrowUp'){
      ev.preventDefault();if(panel.hidden)renderGlobalSearch();
      if(globalSearchItems.length)setGlobalSearchActive(globalSearchActive+(ev.key==='ArrowDown'?1:-1));return;
    }
    if(ev.key==='Enter'&&globalSearchItems.length){ev.preventDefault();const item=globalSearchItems[globalSearchActive];openGlobalResult(item.kind,item.id);}
  });
  document.addEventListener('keydown',ev=>{
    if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='k'){
      ev.preventDefault();globalInput.focus();globalInput.select();renderGlobalSearch();
    }
  });
  document.addEventListener('click',ev=>{
    if(!ev.target.closest('#globalSearchContainer'))hideGlobalSearch();
  });

  let previousCalendarDay=calendarToday();
  // Recompute urgency after midnight or when returning to an old browser tab.
  setInterval(()=>{if(!document.hidden && (state.page==='manuals' || ($('#globalSearch')?.value.trim() && !$('#globalSearchResults')?.hidden)))loadManuals({quiet:true})},20000);
  const updateCalendarDay=()=>{const now=calendarToday();if(previousCalendarDay!==now){previousCalendarDay=now;if(state.page==='calendar')render()}};
  setInterval(updateCalendarDay,60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateCalendarDay()});
  document.addEventListener('click',actionClick);
  document.addEventListener('paste',onScreenshotPaste);
  $('#page').addEventListener('change',changeEvent);
  $('#page').addEventListener('input',inputEvent);
  $('#dialogContent').addEventListener('submit',event=>event.target.id==='transferForm'?saveTransfer(event):event.target.id==='updateForm'?saveUpdate(event):event.target.id==='noteForm'?saveNote(event):event.target.id==='createFolderForm'?createFolder(event):saveForm(event));
  $('#dialogContent').addEventListener('keydown',ev=>{
    if(ev.target.id==='newNoteFolderName'&&ev.key==='Enter'){ev.preventDefault();saveNoteFolderFromEditor()}
  });
  $('#dialogContent').addEventListener('change',changeEvent);
  $('#dialogContent').addEventListener('input',inputEvent);
  $('#editDialog').addEventListener('close',()=>$('#editDialog').classList.remove('note-editor-dialog','note-reader-dialog','folder-manager-dialog'));
   $('#page').addEventListener('submit',event=>{if(event.target.id==='inlineUpdateForm')saveInlineUpdate(event)});
  try{await refresh();render()}catch(e){$('#page').innerHTML=`<section class="panel"><div class="panel-body"><h2>Unable to load Work Tracker</h2><p>${esc(e.message)}</p><p>Make sure the Python app is still running, then refresh this browser tab.</p></div></section>`}
});
