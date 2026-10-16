import {
  projectConversation,
  executionLabel
} from './presentation.mjs';
import {
  PendingRequests
} from './request-identity.mjs';
const $ = id => document.getElementById(id);
const S = {
  token: sessionStorage.getItem('phunbot-token') || '',
  chats: [],
  goals: [],
  folders: [],
  current: null,
  page: 'chat',
  goal: null,
  filter: 'all',
  folded: new Set(),
  opened: new Set(),
  files: [],
  refreshing: false,
  nav: 0
};
const esc = v => String(v ?? '');
const icon = (name, cls = '') => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  if (cls) svg.classList.add(cls);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#' + name);
  svg.append(use);
  return svg;
};
const el = (tag, value = '', cls = '') => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (value !== undefined) n.textContent = esc(value);
  return n;
};
const makeButton = (label, name, fn) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-button';
  b.setAttribute('aria-label', label);
  b.append(icon(name));
  b.onclick = fn;
  return b;
};
async function api(path, method = 'GET', body) {
  const headers = {
    Authorization: 'Bearer ' + S.token
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch('/api/' + path, {
    method,
    headers,
    ...(body === undefined ? {} : {
      body: JSON.stringify(body)
    })
  });
  let data;
  try {
    data = await r.json();
  } catch {}
  if (!r.ok) throw Error(data?.error || `Request failed (${r.status})`);
  if (method !== 'GET') notice('');
  return data;
}

function folderName(c) {
  return c.folderId ? S.folders.find(f => f.id === c.folderId)?.name || c.folder || '' : c.folder || '';
}

function normalizeGoal(g) {
  const persistent = String(g.persistentStatus || g.status || 'idle').toLowerCase();
  const live = String(g.liveExecution?.state || 'idle').toLowerCase();
  return {
    ...g,
    id: String(g.id),
    persistentStatus: persistent,
    liveExecution: g.liveExecution || {
      state: 'idle'
    },
    status: persistent,
    chat: String(g.session?.id || g.conversationId || ''),
    title: g.title || g.request || 'Untitled goal',
    description: g.description || g.request || g.title || '',
    acceptanceCriteria: Array.isArray(g.acceptanceCriteria) ? g.acceptanceCriteria : [],
    planChanges: Array.isArray(g.planChanges) ? g.planChanges : Array.isArray(g.plan?.changes) ? g.plan.changes : [],
    completionKind: String(g.completionKind || g.completion?.kind || '').toLowerCase() || null,
    completionBasis: typeof (g.completionBasis || g.completion?.basis) === 'string' ? (g.completionBasis || g.completion?.basis) : null,
    activity: g.activity || {
      count: 0,
      items: []
    }
  };
}

function status(g) {
  const p = String(g.persistentStatus || '').toLowerCase();
  if (p === 'completed') return 'completed';
  if (p === 'cancelled') return 'cancelled';
  // A durable pause is authoritative even when an older live/execution
  // projection still reports queued, blocked, or waiting.
  if (p === 'paused' || String(g.liveExecution?.state || '').toLowerCase() === 'paused' || String(g.execution?.state || '').toLowerCase() === 'paused') return 'paused';
  if (g.blocker?.kind === 'dependency') return 'waiting';
  if (g.blocker || (g.authorizations || []).some(a => a.state === 'pending')) return 'blocked';
  if (active(g)) return 'working';
  if (g.execution?.nextRunAt > Date.now() || ['waiting_capacity', 'transient_failure', 'ineffective_strategy', 'yielded'].includes(g.execution?.state)) return 'waiting';
  return 'queued';
}

function active(g) {
  return g.liveExecution?.state === 'running';
}

function label(g) {
  return ({
    working: 'Working',
    blocked: 'Needs you',
    waiting: 'Waiting',
    completed: 'Completed',
    queued: 'Queued',
    paused: 'Paused',
    cancelled: 'Cancelled'
  })[status(g)];
}

function signal(kind) {
  const n = document.createElement('i');
  n.className = 'signal ' + kind;
  if (kind === 'blocked') n.textContent = '!';
  if (kind === 'waiting') n.append(icon('clock'));
  n.title = kind === 'blocked' ? 'Needs your response' : kind === 'working' ? 'Goal working' : 'Unread response';
  return n;
}

function chat(id) {
  return S.chats.find(c => String(c.id) === String(id));
}

function goalChat(id) {
  return S.goals.filter(g => g.chat === String(id));
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('scrim').classList.remove('visible');
  document.body.classList.remove('drawer-open');
}

function renderSidebar() {
  const signature = JSON.stringify([S.chats, S.folders, S.goals.map(g => [g.id, status(g), active(g)]), S.current, S.page, [...S.folded], $('show-validation').checked]);
  if (S.sidebarSignature === signature) return;
  S.sidebarSignature = signature;
  const folders = $('folders'),
    recents = $('recents');
  folders.replaceChildren();
  recents.replaceChildren();
  const visible = S.chats.filter(c => $('show-validation').checked || !/^(validation|tests?)$/i.test(folderName(c)));
  const names = [...new Set([...S.folders.map(f => f.name).filter(name => $('show-validation').checked || !/^(validation|tests?)$/i.test(name)), ...visible.map(folderName).filter(Boolean)])];
  for (const name of names) {
    const folder = S.folders.find(f => f.name === name);
    const head = document.createElement('div');
    head.className = 'folder-row';
    const toggle = document.createElement('button');
    toggle.className = 'folder' + (S.folded.has(name) ? ' closed' : '');
    toggle.append(icon('folder'), el('span', name), icon('chevron', 'folder-arrow'));
    toggle.onclick = () => {
      S.folded.has(name) ? S.folded.delete(name) : S.folded.add(name);
      renderSidebar();
    };
    head.append(toggle);
    if (folder) {
      head.append(makeButton('Rename ' + name, 'wrench', () => editFolder(folder)));
      head.append(makeButton('Delete ' + name, 'x', () => deleteFolder(folder)));
    }
    folders.append(head);
    if (!S.folded.has(name)) {
      const group = document.createElement('div');
      group.className = 'folder-group';
      visible.filter(c => folderName(c) === name).forEach(c => group.append(chatButton(c)));
      if (!group.children.length) group.append(el('p', 'No conversations yet', 'empty-folder'));
      folders.append(group);
    }
  }
  visible.filter(c => !folderName(c)).forEach(c => recents.append(chatButton(c)));
  const work = S.goals.filter(active).length,
    need = S.goals.filter(g => status(g) === 'blocked').length;
  $('navcount').replaceChildren(...(work ? [signal('working'), el('span', work)] : []), ...(need ? [signal('blocked'), el('span', need)] : []));
  $('goalsnav').classList.toggle('active', S.page !== 'chat');
}

function chatButton(c) {
  const b = document.createElement('button');
  b.className = 'chatlink' + (String(c.id) === S.current && S.page === 'chat' ? ' selected' : '') + (c.unread ? ' unread' : '');
  b.append(icon('chat', 'bubble-icon'), el('span', c.title || c.name || 'Untitled conversation', 'name'));
  const signs = document.createElement('span');
  signs.className = 'signals';
  if (c.unread) signs.append(signal('unread'));
  if (c.busy || goalChat(c.id).some(active)) signs.append(signal('working'));
  if (goalChat(c.id).some(g => status(g) === 'blocked')) signs.append(signal('blocked'));
  b.append(signs);
  b.onclick = () => showChat(String(c.id)).catch(notice);
  return b;
}

function showPage(page) {
  if (S.page !== page) ++S.nav;
  S.page = page;
  $('chatview').hidden = page !== 'chat';
  $('goalsview').hidden = page !== 'goals';
  $('detailview').hidden = page !== 'detail';
  $('goalsnav').classList.toggle('active', page !== 'chat');
  $('organize').hidden = page !== 'chat' || !S.current;
  const hash = page === 'chat' ? '#chat/' + encodeURIComponent(S.current || '') : page === 'goals' ? '#goals/' + S.filter : '#goal/' + encodeURIComponent(S.goal || '');
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const buffer = el('textarea', value, 'copy-buffer');
  document.body.append(buffer);
  buffer.select();
  try {
    if (!document.execCommand('copy')) throw Error('Copy failed. Select the text to copy it.');
  } finally {
    buffer.remove();
  }
}

function renderMessage(m) {
  const n = el('div', '', `message ${m.role}`);
  if (m.role === 'user') {
    n.textContent = m.text;
    for (const a of m.images || []) {
      if (!/^image\/(png|jpeg|gif|webp)$/.test(a.mimeType || '') || !/^[A-Za-z0-9+/=]+$/.test(a.data || '')) continue;
      const img = document.createElement('img');
      img.className = 'attachment-image';
      img.alt = 'Attached image';
      img.src = `data:${a.mimeType};base64,${a.data}`;
      n.append(img);
    }
    return n;
  }
  const body = document.createElement('div');
  if (window.marked && window.DOMPurify) body.innerHTML = window.DOMPurify.sanitize(window.marked.parse(m.text || '', {
    gfm: true
  }), {
    USE_PROFILES: {
      html: true
    },
    FORBID_TAGS: ['style', 'script', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'img'],
    FORBID_ATTR: ['style', 'id']
  });
  else body.textContent = m.text || '';
  for (const link of body.querySelectorAll('a')) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  n.append(body);
  const copy = el('button', 'Copy', 'copy-message');
  copy.setAttribute('aria-label', 'Copy message');
  copy.onclick = () => copyText(m.text).catch(notice);
  n.append(copy);
  for (const pre of body.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    if (!code) continue;
    const copyCode = el('button', 'Copy', 'copy-code');
    copyCode.setAttribute('aria-label', 'Copy code');
    copyCode.onclick = () => copyText(code.textContent).catch(notice);
    pre.append(copyCode);
  }
  return n;
}
async function showChat(id, {
  navigate = true
} = {}) {
  const c = chat(id);
  if (!c) return;
  if (navigate && S.current !== id) {
    S.drafts ||= new Map();
    if (S.current) S.drafts.set(S.current, {
      text: $('composeinput').value,
      files: S.files
    });
    const draft = S.drafts.get(id);
    $('composeinput').value = draft?.text || '';
    S.files = draft?.files || [];
    renderAttachments();
  }
  S.current = id;
  c.unread = false;
  if (navigate) {
    ++S.nav;
    closeSidebar();
  }
  showPage('chat');
  const seq = S.nav;
  $('model').value = c.model || '';
  $('model').disabled = Boolean(c.busy || S.sending);
  $('viewtitle').textContent = c.title || c.name || 'New conversation';
  $('headstatus').replaceChildren();
  if (goalChat(id).some(active)) $('headstatus').append(signal('working'), el('span', 'Working'));
  const data = await api(`sessions/${encodeURIComponent(id)}/messages`);
  if (seq !== S.nav || S.current !== id || S.page !== 'chat') return;
  const signature = JSON.stringify([id, data.messages, data.busy, goalChat(id).some(active)]);
  if (data.lastResponseId && c.readResponseId !== data.lastResponseId) {
    await api(`sessions/${encodeURIComponent(id)}/read`, 'POST', {
      responseId: data.lastResponseId
    });
    c.readResponseId = data.lastResponseId;
  }
  if (seq !== S.nav || S.current !== id || S.page !== 'chat') return;
  if (!navigate && S.messageSignature === signature) return;
  S.messageSignature = signature;
  const projected = projectConversation(data.messages || []),
    box = $('messages'),
    scroll = $('chatscroll'),
    atBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 100;
  box.replaceChildren(...projected.messages.map(renderMessage));
  $('trace-panel').hidden = !projected.traces.length;
  if (navigate) $('trace-panel').open = false;
  renderTrace(projected.traces);
  if (!projected.messages.length) box.append(el('p', 'No messages yet', 'empty'));
  if (data.busy || goalChat(id).some(active)) {
    const t = el('div', '', 'typing');
    t.setAttribute('aria-label', 'PhunBot is working');
    for (let i = 0; i < 3; i++) t.append(document.createElement('i'));
    box.append(t);
  }
  renderSidebar();
  if (navigate) closeSidebar();
  if (navigate || atBottom) requestAnimationFrame(() => scroll.scrollTop = scroll.scrollHeight);
}

function renderTrace(traces) {
  const panel = $('trace-panel');
  if (!panel) return;
  panel.hidden = !traces.length;
  $('trace-count').textContent = `Execution details (${traces.length})`;
  const out = $('traces');
  const opened = new Set([...out.querySelectorAll('details[open]')].map(d => d.dataset.key));
  out.replaceChildren(...traces.map(t => {
    const d = document.createElement('details');
    d.dataset.key = t.key;
    d.open = opened.has(t.key);
    const s = document.createElement('summary');
    s.textContent = t.label;
    d.append(s, el('pre', t.text));
    return d;
  }));
}
async function renderGoals() {
  const seq = ++S.nav;
  await loadData();
  if (seq !== S.nav) return;
  showPage('goals');
  $('viewtitle').textContent = 'Goals';
  $('headstatus').replaceChildren();
  const fs = [
    ['all', 'All'],
    ['working', 'Working'],
    ['blocked', 'Needs you'],
    ['waiting', 'Waiting'],
    ['completed', 'Completed'],
    ['paused', 'Paused'],
    ['cancelled', 'Cancelled']
  ];
  const f = $('filters');
  f.replaceChildren();
  fs.forEach(([key, name]) => {
    const b = el('button', name, 'filter' + (S.filter === key ? ' current' : ''));
    b.onclick = () => {
      S.filter = key;
      renderGoals().catch(notice);
    };
    f.append(b);
  });
  renderGoalList();
  closeSidebar();
}

function renderGoalList() {
  const list = $('goallist');
  list.replaceChildren();
  const gs = S.goals.filter(g => S.filter === 'all' || status(g) === S.filter || (S.filter === 'working' && active(g)));
  gs.forEach(g => {
    const b = document.createElement('button');
    b.className = 'goalrow';
    const gi = el('span', '', `goal-icon ${active(g)?'working':status(g)}`);
    if (status(g) === 'completed') gi.append(icon('check'));
    else if (status(g) === 'waiting') gi.append(icon('clock'));
    const wrap = el('span', '');
    wrap.className = 'goal-primary';
    wrap.append(el('span', g.title, 'primary-text'), el('span', `${chat(g.chat)?.title||chat(g.chat)?.name||'Autonomous'} · ${label(g)}`, 'minor'));
    b.append(gi, wrap, icon('chevron', 'right'));
    b.onclick = () => showGoal(g.id);
    list.append(b);
  });
  if (!gs.length) list.append(el('p', 'No goals in this view.', 'empty'));
  renderSidebar();
}
async function fetchHistory(id, next = false) {
  S.histories ||= new Map();
  const prior = S.histories.get(id);
  const offset = next ? prior?.nextOffset : 0;
  if (next && offset == null) return prior;
  const page = await api(`ui/goals/${encodeURIComponent(id)}/history?expand=1&limit=100&offset=${offset || 0}`);
  const history = {
    ...page,
    items: next ? [...(prior?.items || []), ...page.items] : page.items
  };
  S.histories.set(id, history);
  return history;
}

function eventsFor(g, criterion) {
  const history = S.histories?.get(g.id);
  if (!criterion) return history?.items || g.activity.items;
  if (!history) return criterion.activity?.items || [];
  const ids = new Set(criterion.evidence?.evidenceIds || []);
  return history.items.filter(e => ids.has(e.id) || e.args?.taskId === criterion.id || e.args?.criterionId === criterion.id);
}

function eventToggle(g, criterion) {
  const activity = criterion?.activity || g.activity;
  if (!activity?.count) return null;
  const key = g.id + ':' + (criterion?.id || 'activity');
  const opened = S.opened.has(key),
    fragment = document.createDocumentFragment();
  const toggle = el('button', '', 'details-toggle');
  toggle.setAttribute('aria-expanded', String(opened));
  toggle.append(icon('chevron'), el('span', `${opened ? 'Hide' : 'Show'} execution (${activity.count})`));
  toggle.onclick = async () => {
    try {
      if (!opened) await fetchHistory(g.id);
      opened ? S.opened.delete(key) : S.opened.add(key);
      S.goalSignature = null;
      if (S.page === 'detail' && S.goal === g.id) await showGoal(g.id);
    } catch (error) {
      notice(error);
    }
  };
  fragment.append(toggle);
  if (opened) {
    const events = el('div', '', 'events');
    eventsFor(g, criterion).forEach(event => events.append(renderActivity(event)));
    const history = S.histories?.get(g.id);
    if (history?.hasMore) {
      const more = el('button', 'Load more activity', 'load-history');
      more.onclick = async () => {
        try {
          await fetchHistory(g.id, true);
          S.goalSignature = null;
          if (S.page === 'detail' && S.goal === g.id) await showGoal(g.id);
        } catch (error) {
          notice(error);
        }
      };
      events.append(more);
    }
    fragment.append(events);
  }
  return fragment;
}
async function lifecycleAction(g, action) {
  if ((action === 'cancel' || action === 'complete') && !confirm(`${action[0].toUpperCase() + action.slice(1)} this goal?`)) return;
  try {
    await api(`sessions/${encodeURIComponent(g.chat)}/${action}`, 'POST', { goalId: g.id });
    await loadData();
    await showGoal(g.id);
  } catch (error) {
    notice(error);
  }
}
async function showGoal(id, {
  navigate = true
} = {}) {
  const g = S.goals.find(x => x.id === String(id));
  if (!g) return;
  if (navigate) ++S.nav;
  S.goal = g.id;
  showPage('detail');
  const signature = JSON.stringify([g, [...S.opened], S.histories?.get(g.id)]);
  if (!navigate && signature === S.goalSignature) return;
  S.goalSignature = signature;
  const content = $('goalcontent'),
    scroll = content.scrollTop;
  const openEvents = new Set([...content.querySelectorAll('details[open]')].map(d => d.dataset.key));
  $('viewtitle').textContent = 'Goals';
  $('headstatus').replaceChildren();
  $('goalheading').textContent = g.title;
  const meta = $('goalmeta');
  meta.replaceChildren(el('span', label(g), 'status ' + status(g)), el('span', '·'));
  const c = chat(g.chat);
  if (c) {
    const link = el('button', c.title || c.name);
    link.onclick = () => showChat(String(c.id)).catch(notice);
    meta.append(link);
  }
  content.replaceChildren();
  if (g.description && g.description !== g.title) {
    const description = el('section', '', 'gsection goal-description');
    description.append(el('h3', 'Current description'), el('p', g.description));
    content.append(description);
  }
  if (g.blocker || status(g) === 'waiting') {
    const strip = el('div', '', 'wait-strip'),
      message = el('span');
    strip.append(icon(status(g) === 'waiting' ? 'clock' : 'chat'));
    if (status(g) === 'waiting') message.textContent = g.blocker?.reason || `${executionLabel(g.execution?.state)}; retrying automatically.`;
    else {
      message.append(document.createTextNode((g.blocker?.kind === 'authorization' ? 'Waiting for your approval' : 'Waiting for your answer') + ' in '));
      if (c) {
        const link = el('button', c.title || c.name);
        link.onclick = () => showChat(String(c.id)).catch(notice);
        message.append(link);
      }
    }
    strip.append(message);
    content.append(strip);
  }
  const criteria = el('section', '', 'gsection');
  criteria.append(el('h3', 'Acceptance criteria'));
  if (!g.acceptanceCriteria.length) criteria.append(el('p', 'No criteria have been planned yet.', 'empty'));
  for (const criterion of g.acceptanceCriteria) {
    const item = el('div', '', 'child'),
      top = el('div', '', 'childtop');
    const ci = el('span', '', `goal-icon ${criterion.accepted?'completed':'queued'}`);
    if (criterion.accepted) ci.append(icon('check'));
    const words = el('div', '', 'child-label');
    words.append(el('div', criterion.title, 'childtitle'), el('div', criterion.accepted ? 'Completed' : 'Not yet accepted', 'childstatus'));
    top.append(ci, words);
    item.append(top);
    const execution = eventToggle(g, criterion);
    if (execution) item.append(execution);
    criteria.append(item);
  }
  content.append(criteria);
  if (g.planChanges.length) {
    const changes = el('section', '', 'gsection plan-history');
    changes.append(el('h3', 'Plan changes'));
    for (const change of g.planChanges) {
      const text = typeof change === 'string' ? change : change.summary || change.description || JSON.stringify(change);
      changes.append(el('p', text, 'plan-change'));
    }
    content.append(changes);
  }
  if (g.planRevisions?.length) {
    const revisions = document.createElement('details');
    revisions.className = 'gsection';
    revisions.dataset.key = g.id + ':revisions';
    revisions.append(el('summary', 'Previous plans'));
    for (const revision of g.planRevisions) {
      const record = el('section');
      record.append(el('h4', 'Revision ' + revision.revision), el('p', revision.previousDescription));
      for (const criterion of revision.criteria || []) record.append(el('p', `${criterion.title} · ${criterion.disposition} · ${criterion.accepted ? 'Verified' : 'Not verified'}`));
      revisions.append(record);
    }
    content.append(revisions);
  }
  if (g.childGoals?.length) {
    const children = el('section', '', 'gsection');
    children.append(el('h3', 'Child goals'));
    for (const child of g.childGoals) {
      const row = el('button', child.title, 'goalrow');
      row.onclick = () => showGoal(child.id).catch(notice);
      children.append(row);
    }
    content.append(children);
  }
  const associated = new Set(g.acceptanceCriteria.flatMap(c => (c.activity?.items || []).map(e => e.id)));
  if (g.activity.count > associated.size || !g.acceptanceCriteria.length) {
    const section = el('section', '', 'gsection');
    section.append(el('h3', 'Execution history'));
    const execution = eventToggle(g);
    if (execution) section.append(execution);
    else section.append(el('p', 'No execution activity yet.', 'empty'));
    content.append(section);
  }
  const approvals = (g.authorizations || []).filter(a => a.state === 'pending');
  if (approvals.length) {
    const section = el('section', '', 'gsection');
    section.append(el('h3', 'Pending authorization'));
    approvals.forEach(a => section.append(authorization(g, a)));
    content.append(section);
  }
  const lifecycle = status(g);
  if (lifecycle === 'completed') {
    const basis = g.completionBasis || (g.completionKind === 'verified' ? 'Acceptance criteria verified' : g.completionKind === 'user-directed' ? 'Completed at user direction' : 'Completion recorded');
    const section = el('section', '', 'gsection completion-basis');
    section.append(el('h3', 'Completion basis'), el('p', basis));
    content.append(section);
  }
  if (c && !['completed', 'cancelled'].includes(lifecycle)) {
    const actions = el('div', '', 'goal-actions');
    const addAction = (name, action) => {
      const button = el('button', name);
      button.onclick = () => lifecycleAction(g, action);
      actions.append(button);
    };
    if (lifecycle === 'paused') addAction('Resume', 'resume');
    else addAction('Pause', 'pause');
    addAction('Cancel', 'cancel');
    addAction('Complete', 'complete');
    content.append(actions);
  }
  content.querySelectorAll('details').forEach(d => d.open = openEvents.has(d.dataset.key));
  content.scrollTop = navigate ? 0 : scroll;
  renderSidebar();
  if (navigate) closeSidebar();
}

function renderActivity(event) {
  const row = el('div', '', 'event'),
    details = document.createElement('details'),
    heading = document.createElement('summary');
  details.dataset.key = event.id;
  const kind = /memory/.test(event.tool || '') ? 'book' : /goal_verify/.test(event.tool || '') ? 'check' : 'wrench';
  const time = event.at ? new Date(event.at) : null;
  heading.append(icon(kind), el('span', `${event.tool || 'Execution'}${event.error?' · failed':''}`, 'label'), el('time', time && !Number.isNaN(+time) ? time.toISOString().slice(11, 16) : ''));
  details.append(heading, el('div', event.summary || '', 'event-desc'));
  if (event.args !== undefined) {
    const raw = document.createElement('details');
    raw.className = 'raw-event';
    raw.dataset.key = event.id + ':payload';
    raw.append(el('summary', 'Arguments and result'), el('pre', JSON.stringify({
      args: event.args,
      result: event.result
    }, null, 2)));
    details.append(raw);
  }
  row.append(details);
  return row;
}

function authorization(g, a) {
  const section = el('div', '', 'authorization');
  section.append(el('strong', a.tool || 'Requested operation'), el('pre', JSON.stringify(a.args || {}, null, 2)));
  section.append(el('p', 'Approval requires the separate owner command. Your conversation access token cannot authorize this operation.'));
  const actions = el('div', '', 'dialog-actions');
  if (/^[a-zA-Z0-9-]{1,200}$/.test(g.id) && /^[a-zA-Z0-9-]{1,200}$/.test(a.id)) {
    const command = `node src/owner-cli.mjs approve ${g.id} ${a.id}${a.risk==='sensitive'?' --ack-sensitive':''}`;
    section.append(el('pre', command));
    const copy = el('button', 'Copy owner command');
    copy.onclick = () => copyText(command).catch(notice);
    actions.append(copy);
  }
  const deny = el('button', 'Deny');
  deny.onclick = () => decideAuth(g, a, false);
  actions.append(deny);
  section.append(actions);
  return section;
}
async function decideAuth(g, a, approve) {
  try {
    await api(`sessions/${encodeURIComponent(g.chat)}/authorizations`, 'POST', {
      goalId: g.id,
      requestId: a.id,
      approve
    });
    await loadData();
    await showGoal(g.id);
  } catch (e) {
    notice(e);
  }
}
async function loadData() {
  const seq = S.dataSeq = (S.dataSeq || 0) + 1;
  const [chats, goals, folders] = await Promise.all([api('sessions'), api('ui/goals'), api('folders')]);
  if (seq !== S.dataSeq) return;
  S.chats = Array.isArray(chats) ? chats : [];
  S.goals = (Array.isArray(goals) ? goals : goals.goals || []).map(normalizeGoal);
  S.folders = (Array.isArray(folders) ? folders : folders.folders || []);
  renderSidebar();
}

function notice(e) {
  $('notice').textContent = e ? String(e.message || e) : '';
}
async function send(e) {
  e.preventDefault();
  const input = $('composeinput');
  if (!input.value.trim() || !S.current || S.sending) return;
  const id = S.current,
    sentText = input.value,
    sentFiles = [...S.files],
    model = chat(id)?.model;
  S.sending = true;
  $('composer').querySelector('.send').disabled = true;
  try {
    const images = await Promise.all(sentFiles.map(f => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve({
        type: 'image',
        mimeType: f.type,
        data: String(r.result).split(',')[1]
      });
      r.onerror = reject;
      r.readAsDataURL(f);
    })));
    const payload = {
      text: sentText,
      images
    };
    const pending = new PendingRequests(localStorage, window.sha256(S.token), window.sha256),
      request = pending.prepare(id, {
        ...payload,
        model
      });
    const accepted = await api(`sessions/${encodeURIComponent(id)}/send`, 'POST', {
      ...payload,
      requestId: request.requestId
    });
    if (accepted.accepted !== true) throw Error('The request was not accepted');
    pending.acknowledge(request);
    if (S.current === id && input.value === sentText) {
      input.value = '';
      S.files = [];
      renderAttachments();
      S.drafts?.delete(id);
    }
    await loadData();
    if (S.current === id && S.page === 'chat') await showChat(id, {
      navigate: false
    });
  } catch (e) {
    notice(e);
  } finally {
    S.sending = false;
    $('composer').querySelector('.send').disabled = false;
  }
}
async function newChat() {
  try {
    const row = await api('sessions', 'POST', {
      folderId: null
    });
    await loadData();
    await showChat(String(row.id));
    $('composeinput').focus();
  } catch (e) {
    notice(e);
  }
}
async function folderCreate() {
  const name = prompt('Folder name');
  if (!name?.trim()) return;
  try {
    await api('folders', 'POST', {
      name: name.trim()
    });
    await loadData();
  } catch (e) {
    notice(e);
  }
}
async function organize(c) {
  const name = prompt('Rename conversation', c.title || c.name || '');
  if (name === null) return;
  try {
    const folderNameValue = prompt('Folder name (blank for Recent)', folderName(c));
    if (folderNameValue === null) return;
    const f = S.folders.find(x => x.name.toLowerCase() === folderNameValue.trim().toLowerCase());
    if (folderNameValue.trim() && !f) throw Error('Create that folder before moving the conversation.');
    await api(`sessions/${encodeURIComponent(c.id)}`, 'PATCH', {
      title: name.trim() || c.title,
      folderId: f?.id || null,
      folder: f?.name || ''
    });
    await loadData();
    if (S.current === c.id) await showChat(c.id, {
      navigate: false
    });
  } catch (e) {
    notice(e);
  }
}
async function editFolder(f) {
  const name = prompt('Rename folder', f.name);
  if (name === null) return;
  try {
    await api(`folders/${encodeURIComponent(f.id)}`, 'PATCH', {
      name: name.trim()
    });
    await loadData();
  } catch (e) {
    notice(e);
  }
}
async function deleteFolder(f) {
  if (!confirm(`Delete folder ${f.name}?`)) return;
  try {
    await api(`folders/${encodeURIComponent(f.id)}`, 'DELETE');
    await loadData();
  } catch (e) {
    notice(e);
  }
}

function openSearch() {
  $('searchmodal').hidden = false;
  $('searchinput').value = '';
  searchNow();
  $('searchinput').focus();
  closeSidebar();
}

function closeSearch() {
  $('searchmodal').hidden = true;
}
async function searchNow() {
  const q = $('searchinput').value.trim();
  const out = $('searchresults');
  const seq = S.searchSeq = (S.searchSeq || 0) + 1;
  out.replaceChildren();
  try {
    const matches = await api('search?q=' + encodeURIComponent(q));
    if (seq !== S.searchSeq) return;
    (Array.isArray(matches) ? matches : matches.results || []).slice(0, 15).forEach(m => {
      const b = document.createElement('button');
      b.className = 'searchresult';
      b.append(icon(m.kind === 'chat' ? 'chat' : 'target'), el('span', m.name), el('small', m.kind === 'chat' ? 'Conversation' : 'Goal'));
      b.onclick = () => {
        closeSearch();
        m.kind === 'chat' ? showChat(String(m.id)) : showGoal(m.id);
      };
      out.append(b);
    });
    if (!out.children.length) out.append(el('p', 'No matches.', 'empty'));
  } catch (e) {
    if (seq === S.searchSeq) notice(e);
  }
}
$('login-form').onsubmit = async e => {
  e.preventDefault();
  S.token = $('token').value || S.token;
  try {
    sessionStorage.setItem('phunbot-token', S.token);
    await loadData();
    const models = await api('models');
    $('model').replaceChildren(...models.map(m => {
      const o = el('option', m.id);
      o.value = m.id;
      return o;
    }));
    $('login').hidden = true;
    S.connected = true;
    const route = location.hash;
    const id = route.startsWith('#goal/') ? decodeURIComponent(route.slice(6)) : route.startsWith('#chat/') ? decodeURIComponent(route.slice(6)) : S.current || S.chats[0]?.id;
    if (route.startsWith('#goals')) {
      S.filter = route.split('/')[1] || 'all';
      await renderGoals();
    } else if (id && route.startsWith('#goal/')) await showGoal(id);
    else if (id) await showChat(String(id));
    else {
      $('viewtitle').textContent = 'New conversation';
    }
  } catch (e) {
    S.connected = false;
    $('login').hidden = false;
    $('loginerror').textContent = e.message;
  }
};
$('new-chat').onclick = newChat;
$('organize').onclick = () => {
  if (S.current) {
    const c = chat(S.current);
    if (c) organize(c);
  }
};
$('new-folder').onclick = folderCreate;
$('goalsnav').onclick = () => renderGoals().catch(notice);
$('back-goals').onclick = () => renderGoals().catch(notice);
$('composer').onsubmit = send;
$('attach-button').onclick = () => $('attachment-input').click();

function renderAttachments() {
  $('attachments').replaceChildren(...S.files.map((file, index) => {
    const chip = el('span', file.name, 'attachment-chip');
    chip.append(makeButton('Remove ' + file.name, 'x', () => {
      S.files = S.files.filter((_, i) => i !== index);
      renderAttachments();
    }));
    return chip;
  }));
  $('attachment-input').value = '';
}
$('attachment-input').onchange = e => {
  const files = [...S.files, ...e.target.files];
  if (files.length > 8 || files.some(f => !/^image\/(png|jpeg|gif|webp)$/.test(f.type)) || files.reduce((n, f) => n + f.size, 0) > 5 * 1024 * 1024) {
    notice('Choose up to eight supported images, totaling no more than 5 MiB.');
    return;
  }
  S.files = files;
  renderAttachments();
};
$('model').onchange = async () => {
  const id = S.current,
    row = chat(id),
    selected = $('model').value;
  if (!row) return;
  try {
    await api(`sessions/${encodeURIComponent(id)}`, 'PATCH', {
      model: selected
    });
    row.model = selected;
  } catch (error) {
    if (S.current === id) $('model').value = row.model;
    notice(error);
  }
};
$('show-validation').onchange = () => {
  S.sidebarSignature = null;
  renderSidebar();
};
$('search-button').onclick = openSearch;
$('close-search').onclick = closeSearch;
$('searchinput').oninput = searchNow;
$('menu-button').onclick = () => {
  $('sidebar').classList.add('open');
  $('scrim').classList.add('visible');
  document.body.classList.add('drawer-open');
};
$('scrim').onclick = closeSidebar;
$('composeinput').onkeydown = e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('composer').requestSubmit();
  }
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-organize]');
  if (b) {
    const c = chat(b.dataset.organize);
    if (c) organize(c);
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeSearch();
    closeSidebar();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openSearch();
  }
});
async function refresh() {
  if (S.refreshing || !S.connected || document.hidden) return;
  S.refreshing = true;
  try {
    await loadData();
    if (S.page === 'chat' && S.current) await showChat(S.current, {
      navigate: false
    });
    else if (S.page === 'goals') renderGoalList();
    else if (S.page === 'detail' && S.goal) {
      const g = S.goals.find(g => g.id === S.goal),
        cached = S.histories?.get(S.goal);
      if (cached && cached.count !== g?.activity.count) await fetchHistory(S.goal);
      await showGoal(S.goal, {
        navigate: false
      });
    }
  } catch (e) {
    notice(e);
  } finally {
    S.refreshing = false;
  }
}
setInterval(refresh, 1500);
window.addEventListener('hashchange', async () => {
  if (!S.connected) return;
  try {
    const route = location.hash;
    if (route.startsWith('#goal/')) await showGoal(decodeURIComponent(route.slice(6)));
    else if (route.startsWith('#chat/')) await showChat(decodeURIComponent(route.slice(6)));
    else if (route.startsWith('#goals')) {
      S.filter = route.split('/')[1] || 'all';
      await renderGoals();
    }
  } catch (error) {
    notice(error);
  }
});
if (S.token) {
  $('login').hidden = true;
  $('login-form').dispatchEvent(new Event('submit'));
} else $('login').hidden = false;
