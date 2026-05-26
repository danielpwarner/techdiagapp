/* ═══════════════════════════════════════════════════════════════
   DIAG-101 App Logic
   - Auto-save to localStorage (keyed by worksheet ID)
   - History drawer (list/load/delete saved worksheets)
   - Shareable read-only URL (base64+deflate encoded state)
   - Dynamic DTC & PPT rows
   - Step progress tracking
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────
  const STORAGE_PREFIX = 'diag101_';
  const INDEX_KEY      = 'diag101_index';
  const CURRENT_KEY    = 'diag101_current';
  let   currentId      = null;
  let   saveTimer      = null;
  let   isViewMode     = false;

  // ── State ────────────────────────────────────────────────────
  let state = {
    id: null,
    createdAt: null,
    dtcRows: [],
    pptRows: [],
    fields: {}
  };

  // ── Init ─────────────────────────────────────────────────────
  function init() {
    // Check for ?view= param (expert share link)
    const params = new URLSearchParams(window.location.search);
    if (params.has('view')) {
      loadFromShareParam(params.get('view'));
      return;
    }

    // Load last active worksheet or create new
    const lastId = localStorage.getItem(CURRENT_KEY);
    if (lastId && localStorage.getItem(STORAGE_PREFIX + lastId)) {
      loadWorksheet(lastId);
    } else {
      newWorksheet();
    }

    bindEvents();
    updateStepPips();
    setTodayDate();
  }

  // ── Worksheet lifecycle ───────────────────────────────────────
  function newWorksheet() {
    const id = 'ws_' + Date.now();
    state = {
      id,
      createdAt: new Date().toISOString(),
      dtcRows: defaultDtcRows(),
      pptRows: defaultPptRows(),
      fields: {}
    };
    currentId = id;
    localStorage.setItem(CURRENT_KEY, id);
    renderDtcTable();
    renderPptTable();
    populateFields();
    updateStepPips();
    setTodayDate();
    saveNow();
    addToIndex(id);
  }

  function loadWorksheet(id) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + id);
      if (!raw) return newWorksheet();
      const saved = JSON.parse(raw);
      state = saved;
      currentId = id;
      localStorage.setItem(CURRENT_KEY, id);
      renderDtcTable();
      renderPptTable();
      populateFields();
      updateStepPips();
    } catch(e) {
      newWorksheet();
    }
  }

  function saveNow() {
    if (isViewMode) return;
    const dot = document.querySelector('.save-dot');
    const ind = document.getElementById('save-indicator');
    if (dot) dot.classList.add('saving');
    if (ind) ind.textContent = '';

    state.savedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_PREFIX + currentId, JSON.stringify(state));
    localStorage.setItem(CURRENT_KEY, currentId);

    setTimeout(() => {
      if (dot) { dot.className = 'save-dot'; ind.innerHTML = '<span class="save-dot"></span> Saved'; }
    }, 600);
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 800);
  }

  function addToIndex(id) {
    let index = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]');
    if (!index.includes(id)) { index.unshift(id); }
    // keep max 50
    index = index.slice(0, 50);
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  }

  function deleteWorksheet(id) {
    localStorage.removeItem(STORAGE_PREFIX + id);
    let index = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]');
    index = index.filter(i => i !== id);
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
    if (currentId === id) {
      const remaining = index[0];
      if (remaining) { loadWorksheet(remaining); }
      else { newWorksheet(); }
    }
    renderHistoryList();
  }

  // ── Defaults ──────────────────────────────────────────────────
  function defaultDtcRows() {
    return Array.from({length: 4}, () => ({ module:'', code:'', desc:'', status:'', related: false }));
  }

  function defaultPptRows() {
    return Array.from({length: 6}, () => ({ stepId:'', action:'', expected:'', actual:'' }));
  }

  // ── Render DTC Table ──────────────────────────────────────────
  function renderDtcTable() {
    const tbody = document.getElementById('dtc-body');
    tbody.innerHTML = '';
    state.dtcRows.forEach((row, i) => {
      tbody.appendChild(buildDtcRow(row, i));
    });
  }

  function buildDtcRow(row, i) {
    const tr = document.createElement('tr');
    tr.dataset.index = i;

    // Row num
    const tdNum = document.createElement('td');
    tdNum.className = 'row-num';
    tdNum.textContent = i + 1;
    tr.appendChild(tdNum);

    // Text cells
    ['module','code','desc'].forEach(key => {
      const td = document.createElement('td');
      const inp = document.createElement('input');
      inp.type = 'text';
      if (key === 'code') inp.classList.add('mono');
      inp.value = row[key] || '';
      inp.placeholder = key === 'module' ? 'e.g. ABS' : key === 'code' ? 'U0401:00' : 'Description…';
      inp.addEventListener('input', e => {
        state.dtcRows[i][key] = e.target.value;
        scheduleSave();
        updateStepPips();
      });
      td.appendChild(inp);
      tr.appendChild(td);
    });

    // Status select
    const tdStatus = document.createElement('td');
    const sel = document.createElement('select');
    sel.className = 'status-select';
    [['','—'],['A','Active'],['P','Pending'],['H','Historical']].forEach(([v,l]) => {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = l;
      if (row.status === v) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', e => {
      state.dtcRows[i].status = e.target.value;
      scheduleSave();
    });
    tdStatus.appendChild(sel);
    tr.appendChild(tdStatus);

    // Related checkbox
    const tdRel = document.createElement('td');
    tdRel.className = 'related-cell';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!row.related;
    chk.addEventListener('change', e => {
      state.dtcRows[i].related = e.target.checked;
      scheduleSave();
    });
    tdRel.appendChild(chk);
    tr.appendChild(tdRel);

    // Delete button
    const tdDel = document.createElement('td');
    tdDel.className = 'del-cell no-print';
    const btn = document.createElement('button');
    btn.className = 'btn btn-danger';
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    btn.title = 'Remove row';
    btn.addEventListener('click', () => {
      state.dtcRows.splice(i, 1);
      renderDtcTable();
      scheduleSave();
    });
    tdDel.appendChild(btn);
    tr.appendChild(tdDel);

    return tr;
  }

  // ── Render PPT Table ──────────────────────────────────────────
  function renderPptTable() {
    const tbody = document.getElementById('ppt-body');
    tbody.innerHTML = '';
    state.pptRows.forEach((row, i) => {
      tbody.appendChild(buildPptRow(row, i));
    });
  }

  function buildPptRow(row, i) {
    const tr = document.createElement('tr');
    tr.dataset.index = i;

    const cols = [
      { key: 'stepId',   placeholder: 'e.g. AI1', mono: true, textarea: false },
      { key: 'action',   placeholder: 'Describe the action performed…', textarea: true },
      { key: 'expected', placeholder: 'OEM expected result…', textarea: true },
      { key: 'actual',   placeholder: 'What did you find?', textarea: true },
    ];

    cols.forEach(col => {
      const td = document.createElement('td');
      let el;
      if (col.textarea) {
        el = document.createElement('textarea');
        el.rows = 2;
      } else {
        el = document.createElement('input');
        el.type = 'text';
      }
      if (col.mono) el.classList.add('mono');
      el.value = row[col.key] || '';
      el.placeholder = col.placeholder;
      el.addEventListener('input', e => {
        state.pptRows[i][col.key] = e.target.value;
        scheduleSave();
        updateStepPips();
      });
      td.appendChild(el);
      tr.appendChild(td);
    });

    // Delete
    const tdDel = document.createElement('td');
    tdDel.className = 'del-cell no-print';
    const btn = document.createElement('button');
    btn.className = 'btn btn-danger';
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    btn.title = 'Remove row';
    btn.addEventListener('click', () => {
      state.pptRows.splice(i, 1);
      renderPptTable();
      scheduleSave();
    });
    tdDel.appendChild(btn);
    tr.appendChild(tdDel);

    return tr;
  }

  // ── Populate fields from state ────────────────────────────────
  function populateFields() {
    document.querySelectorAll('[data-key]').forEach(el => {
      const key = el.dataset.key;
      const val = state.fields[key];
      if (val === undefined) return;
      if (el.type === 'checkbox') {
        el.checked = !!val;
      } else if (el.type === 'radio') {
        el.checked = (el.value === val);
      } else {
        el.value = val;
      }
    });
  }

  // ── Bind global field changes ─────────────────────────────────
  function bindFieldListeners() {
    document.querySelectorAll('[data-key]').forEach(el => {
      const key = el.dataset.key;
      const evtName = (el.type === 'checkbox' || el.type === 'radio') ? 'change' : 'input';
      el.addEventListener(evtName, () => {
        if (el.type === 'checkbox') {
          state.fields[key] = el.checked;
        } else if (el.type === 'radio') {
          if (el.checked) state.fields[key] = el.value;
        } else {
          state.fields[key] = el.value;
        }
        scheduleSave();
        updateStepPips();
      });
    });
  }

  // ── Step progress pips ────────────────────────────────────────
  function updateStepPips() {
    const f = state.fields;
    const hasDtcs = state.dtcRows.some(r => r.code);
    const hasPpts = state.pptRows.some(r => r.stepId || r.actual);

    const completion = [
      f.s1_status || f.s1_description,
      hasDtcs,
      f.s3_tsb || f.s3_ssm || f.s3_gsb || f.s3_none || f.s3_summary,
      hasPpts || f.s4_start_dtc,
      f.s5_required,
      f.s6_root_cause || f.s6_repair,
    ];

    document.querySelectorAll('.step-pip').forEach((pip, i) => {
      const done = !!completion[i];
      const isNext = !completion.slice(0, i).every(Boolean) ? false : !done;
      pip.classList.toggle('done', done);
      pip.classList.toggle('active', !done && i === completion.findIndex(v => !v));
    });
  }

  // ── Set today's date default ──────────────────────────────────
  function setTodayDate() {
    const dateField = document.getElementById('f-date');
    if (dateField && !dateField.value) {
      const today = new Date().toISOString().split('T')[0];
      dateField.value = today;
      state.fields['date'] = today;
    }
  }

  // ── History Drawer ────────────────────────────────────────────
  function renderHistoryList() {
    const list = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');
    const index = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]');
    const valid = index.filter(id => localStorage.getItem(STORAGE_PREFIX + id));

    list.innerHTML = '';

    if (valid.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    valid.forEach(id => {
      try {
        const ws = JSON.parse(localStorage.getItem(STORAGE_PREFIX + id));
        const vehicle = [ws.fields?.year, ws.fields?.make, ws.fields?.model].filter(Boolean).join(' ') || 'Unknown Vehicle';
        const ro = ws.fields?.ro ? `RO #${ws.fields.ro}` : '';
        const tech = ws.fields?.tech || '';
        const date = ws.savedAt ? new Date(ws.savedAt).toLocaleDateString() : '';

        const item = document.createElement('div');
        item.className = 'history-item' + (id === currentId ? ' current' : '');
        item.innerHTML = `
          <div class="history-item-info">
            <div class="history-item-title">${escHtml(vehicle)}</div>
            <div class="history-item-meta">${[ro, tech, date].filter(Boolean).join(' · ')}</div>
          </div>
          <div class="history-item-actions">
            <button class="btn btn-sm btn-danger del-ws-btn" data-id="${id}" title="Delete">
              <svg width="11" height="11" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </div>
        `;
        item.addEventListener('click', e => {
          if (e.target.closest('.del-ws-btn')) return;
          loadWorksheet(id);
          closeDrawer();
        });
        item.querySelector('.del-ws-btn').addEventListener('click', e => {
          e.stopPropagation();
          if (confirm('Delete this worksheet? This cannot be undone.')) {
            deleteWorksheet(id);
          }
        });
        list.appendChild(item);
      } catch(e) {}
    });
  }

  function openDrawer() {
    renderHistoryList();
    document.getElementById('history-overlay').classList.remove('hidden');
    document.getElementById('history-drawer').classList.remove('hidden');
  }

  function closeDrawer() {
    document.getElementById('history-overlay').classList.add('hidden');
    document.getElementById('history-drawer').classList.add('hidden');
  }

  // ── Share / View Mode ─────────────────────────────────────────
  function encodeState() {
    const payload = JSON.stringify(state);
    // base64 encode
    try {
      return btoa(unescape(encodeURIComponent(payload)));
    } catch(e) {
      return btoa(payload);
    }
  }

  function decodeState(encoded) {
    try {
      const json = decodeURIComponent(escape(atob(encoded)));
      return JSON.parse(json);
    } catch(e) {
      try { return JSON.parse(atob(encoded)); } catch(e2) { return null; }
    }
  }

  function buildShareUrl() {
    const encoded = encodeState();
    const base = window.location.origin + window.location.pathname;
    return `${base}?view=${encoded}`;
  }

  function openShareModal() {
    saveNow();
    const url = buildShareUrl();
    document.getElementById('share-url-input').value = url;
    document.getElementById('share-overlay').classList.remove('hidden');
    document.getElementById('share-modal').classList.remove('hidden');
  }

  function closeShareModal() {
    document.getElementById('share-overlay').classList.add('hidden');
    document.getElementById('share-modal').classList.add('hidden');
  }

  function loadFromShareParam(encoded) {
    const loaded = decodeState(encoded);
    if (!loaded) {
      showToast('Invalid share link.');
      newWorksheet();
      bindEvents();
      return;
    }
    state = loaded;
    isViewMode = true;
    document.body.classList.add('view-mode');
    document.getElementById('view-mode-banner').classList.remove('hidden');

    // Hide edit-only UI
    document.querySelectorAll('.no-print').forEach(el => {
      if (!el.classList.contains('btn-copy-view')) el.style.display = 'none';
    });

    renderDtcTable();
    renderPptTable();
    populateFields();
    updateStepPips();

    document.getElementById('btn-copy-view')?.addEventListener('click', () => {
      navigator.clipboard.writeText(window.location.href).then(() => showToast('Link copied!'));
    });
  }

  // ── Events ────────────────────────────────────────────────────
  function bindEvents() {
    bindFieldListeners();

    // New worksheet
    document.getElementById('btn-new').addEventListener('click', () => {
      if (confirm('Start a new worksheet? Your current work is saved.')) {
        saveNow();
        newWorksheet();
      }
    });

    // History
    document.getElementById('btn-history').addEventListener('click', openDrawer);
    document.getElementById('close-history').addEventListener('click', closeDrawer);
    document.getElementById('history-overlay').addEventListener('click', closeDrawer);

    // Share
    document.getElementById('btn-share').addEventListener('click', openShareModal);
    document.getElementById('btn-escalate-share').addEventListener('click', openShareModal);
    document.getElementById('close-share').addEventListener('click', closeShareModal);
    document.getElementById('share-overlay').addEventListener('click', closeShareModal);
    document.getElementById('copy-share-url').addEventListener('click', () => {
      const url = document.getElementById('share-url-input').value;
      navigator.clipboard.writeText(url).then(() => {
        showToast('Share link copied to clipboard!');
        closeShareModal();
      });
    });

    // Print
    document.getElementById('btn-print').addEventListener('click', () => {
      saveNow();
      window.print();
    });

    // Add DTC row
    document.getElementById('add-dtc-row').addEventListener('click', () => {
      state.dtcRows.push({ module:'', code:'', desc:'', status:'', related: false });
      renderDtcTable();
      scheduleSave();
      // focus first cell of new row
      const rows = document.querySelectorAll('#dtc-body tr');
      const lastRow = rows[rows.length - 1];
      lastRow?.querySelector('input')?.focus();
    });

    // Add PPT row
    document.getElementById('add-ppt-row').addEventListener('click', () => {
      state.pptRows.push({ stepId:'', action:'', expected:'', actual:'' });
      renderPptTable();
      scheduleSave();
      const rows = document.querySelectorAll('#ppt-body tr');
      const lastRow = rows[rows.length - 1];
      lastRow?.querySelector('input, textarea')?.focus();
    });

    // Auto-resize textareas
    document.addEventListener('input', e => {
      if (e.target.tagName === 'TEXTAREA') {
        e.target.style.height = 'auto';
        e.target.style.height = e.target.scrollHeight + 'px';
      }
    });

    // Keyboard shortcut: Ctrl+S / Cmd+S
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveNow();
        showToast('Saved!');
      }
    });

    // Warn before leaving with unsaved changes
    window.addEventListener('beforeunload', e => {
      if (saveTimer) {
        saveNow();
      }
    });
  }

  // ── Toast ─────────────────────────────────────────────────────
  let toastTimer = null;
  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2500);
  }

  // ── Utils ─────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Boot ──────────────────────────────────────────────────────
  init();

})();
