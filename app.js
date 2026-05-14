// ========== DataManager ==========
const DataManager = {
  _load(key) {
    try { return JSON.parse(localStorage.getItem('dt_' + key)) || null; }
    catch { return null; }
  },
  _save(key, data) {
    localStorage.setItem('dt_' + key, JSON.stringify(data));
  },

  getGroups() {
    return (this._load('groups') || []).sort((a, b) => a.sortOrder - b.sortOrder);
  },
  addGroup(name) {
    const groups = this.getGroups();
    const g = { id: Date.now(), name, sortOrder: groups.length };
    groups.push(g);
    this._save('groups', groups);
    return g;
  },
  deleteGroup(id) {
    const groups = this.getGroups().filter(g => g.id !== id);
    const items = this.getAllItemsRaw();
    items.forEach(i => { if (i.groupId === id) i.groupId = null; });
    this._save('items', items);
    this._save('groups', groups);
  },

  getItems() {
    return (this._load('items') || []).filter(i => !i.deleted);
  },
  getAllItemsRaw() {
    return this._load('items') || [];
  },
  addItem(item) {
    const items = this.getAllItemsRaw();
    item.id = Date.now();
    item.createdAt = new Date().toISOString();
    item.sortOrder = items.length;
    item.deleted = false;
    items.push(item);
    this._save('items', items);
    return item;
  },
  deleteItem(id) {
    const items = this.getAllItemsRaw();
    const found = items.find(i => i.id === id);
    if (found) found.deleted = true;
    this._save('items', items);
  },
  updateItem(id, updates) {
    const items = this.getAllItemsRaw();
    const found = items.find(i => i.id === id);
    if (found) Object.assign(found, updates);
    this._save('items', items);
  },

  getChecks(date) {
    const all = this._load('checks') || [];
    return date ? all.filter(c => c.date === date) : all;
  },
  saveCheck(check) {
    const all = this._load('checks') || [];
    const idx = all.findIndex(c => c.itemId === check.itemId && c.date === check.date);
    if (idx >= 0) all[idx] = check;
    else { check.id = Date.now(); all.push(check); }
    this._save('checks', all);
  },
  getChecksRange(from, to, itemId) {
    let all = this._load('checks') || [];
    if (from) all = all.filter(c => c.date >= from);
    if (to) all = all.filter(c => c.date <= to);
    if (itemId) all = all.filter(c => c.itemId === itemId);
    return all.sort((a, b) => b.date.localeCompare(a.date));
  },

  getDiary(date) {
    const all = this._load('diaries') || [];
    return all.find(d => d.date === date) || null;
  },
  saveDiary(date, content) {
    const all = this._load('diaries') || [];
    const idx = all.findIndex(d => d.date === date);
    const now = new Date().toISOString();
    if (idx >= 0) { all[idx].content = content; all[idx].updatedAt = now; }
    else all.push({ id: Date.now(), date, content, updatedAt: now });
    this._save('diaries', all);
  },
  getDiariesRange(from, to) {
    let all = this._load('diaries') || [];
    if (from) all = all.filter(d => d.date >= from);
    if (to) all = all.filter(d => d.date <= to);
    return all.sort((a, b) => a.date.localeCompare(b.date));
  },

  getSummary(weekStart) {
    const all = this._load('summaries') || [];
    return all.find(s => s.weekStart === weekStart) || null;
  },
  saveSummary(summary) {
    const all = this._load('summaries') || [];
    const idx = all.findIndex(s => s.weekStart === summary.weekStart);
    if (idx >= 0) all[idx] = summary;
    else all.push(summary);
    this._save('summaries', all);
  },

  getSettings() { return this._load('settings') || {}; },
  saveSettings(settings) {
    const existing = this.getSettings();
    this._save('settings', Object.assign(existing, settings));
  },
};

// ========== IndexedDB for Images ==========
const ImageStore = (() => {
  const DB_NAME = 'dt_images', STORE = 'images';
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  return {
    async save(diaryDate, file) {
      const store = (await open()).transaction(STORE, 'readwrite').objectStore(STORE);
      const record = {
        id: Date.now(), diaryDate, originalName: file.name,
        type: file.type, size: file.size,
        data: await file.arrayBuffer(), createdAt: new Date().toISOString(),
      };
      return new Promise((resolve, reject) => {
        const req = store.add(record);
        req.onsuccess = () => resolve(record.id);
        req.onerror = () => reject(req.error);
      });
    },
    async getByDate(diaryDate) {
      const store = (await open()).transaction(STORE, 'readonly').objectStore(STORE);
      return new Promise((resolve) => {
        const results = [];
        store.openCursor().onsuccess = e => {
          const cursor = e.target.result;
          if (cursor) { if (cursor.value.diaryDate === diaryDate) results.push(cursor.value); cursor.continue(); }
          else resolve(results);
        };
      });
    },
    async remove(id) {
      const store = (await open()).transaction(STORE, 'readwrite').objectStore(STORE);
      return new Promise((resolve) => { store.delete(id).onsuccess = resolve; });
    },
    async getAll() {
      const store = (await open()).transaction(STORE, 'readonly').objectStore(STORE);
      return new Promise((resolve) => {
        const results = [];
        store.openCursor().onsuccess = e => {
          const cursor = e.target.result;
          if (cursor) { results.push(cursor.value); cursor.continue(); }
          else resolve(results);
        };
      });
    },
    async clearAll() {
      const store = (await open()).transaction(STORE, 'readwrite').objectStore(STORE);
      return new Promise((resolve) => { store.clear().onsuccess = resolve; });
    },
  };
})();

// ========== Helpers ==========
function todayStr() { return new Date().toISOString().slice(0, 10); }

// UTC-safe date arithmetic: add N days to a YYYY-MM-DD string, returns YYYY-MM-DD
function utcAddDays(dateStr, n) {
  const d = new Date(dateStr); // date-only format → UTC
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(from, to) {
  return Math.floor((new Date(to) - new Date(from)) / 86400000) + 1;
}
function fmtDate(dateStr) {
  // Use local time for display (weekday must be correct for user's timezone)
  const parts = dateStr.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const wd = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${wd[d.getDay()]}`;
}
function getMonday(dateStr) {
  const d = new Date(dateStr); // UTC
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10); // return YYYY-MM-DD string
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ========== App State ==========
let currentDate = todayStr();
let currentTab = 'checkin';
let expandAll = false;
let filterCheckedOnly = false;

// ========== Tab Switching ==========
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + tab));
  if (tab === 'checkin') renderCheckin();
  else if (tab === 'diary') renderDiary();
  else if (tab === 'stats') renderStats();
  else if (tab === 'history') renderHistory();
  else if (tab === 'split') renderSplit();
}

// ========== Tab 1: Checkin ==========
function renderCheckin() {
  document.getElementById('checkin-date').value = currentDate;

  const filterText = (document.getElementById('checkin-filter').value || '').toLowerCase().trim();
  let items = DataManager.getItems();
  if (filterText) {
    if (filterText.startsWith('#')) {
      const groupName = filterText.slice(1);
      const groups = DataManager.getGroups();
      const matchedGroups = groups.filter(g => g.name.toLowerCase().includes(groupName));
      const groupIds = new Set(matchedGroups.map(g => g.id));
      items = items.filter(i => i.groupId && groupIds.has(i.groupId));
    } else {
      items = items.filter(i =>
        i.name.toLowerCase().includes(filterText) ||
        i.icon.includes(filterText)
      );
    }
  }

  const checks = DataManager.getChecks(currentDate);
  const checksMap = {};
  checks.forEach(c => { checksMap[c.itemId] = c; });

  if (filterCheckedOnly) {
    items = items.filter(i => {
      const c = checksMap[i.id];
      return c && c.value > 0;
    });
  }

  const groups = DataManager.getGroups();
  const groupMap = {};
  const ungroupedItems = [];
  groups.forEach(g => { groupMap[g.id] = []; });
  items.forEach(item => {
    if (item.groupId && groupMap[item.groupId]) {
      groupMap[item.groupId].push(item);
    } else {
      ungroupedItems.push(item);
    }
  });

  function renderGroupSection(label, groupId, groupItems) {
    const itemsHtml = groupItems.map(item => renderCheckinCard(item, checksMap)).join('') ||
      '<div class="group-empty-hint">暂无打卡，将打卡添加到该分组即可在此显示</div>';
    return `
      <div class="group-section" data-group="${groupId || 'none'}">
        <div class="group-header">
          <span class="group-toggle">▼</span>
          <span class="group-name">${escapeHtml(label)}</span>
          <span class="group-count">${groupItems.length}项</span>
          ${groupId ? `
          <span class="group-menu-wrap">
            <button class="btn-icon-sm btn-group-menu" data-group="${groupId}" title="分组设置" onclick="event.stopPropagation()">⚙</button>
            <div class="group-dropdown hidden" id="gmenu-${groupId}">
              <button onclick="event.stopPropagation();renameGroupPrompt('${groupId}')">✏️ 重命名</button>
              <button onclick="event.stopPropagation();showMovePanel('${groupId}')">📥 管理分组</button>
            </div>
          </span>
          <button class="btn-icon-sm btn-del-group" data-group="${groupId}" title="删除分组">×</button>
          ` : ''}
        </div>
        ${groupId ? `<div class="move-panel hidden" id="movepanel-${groupId}"></div>` : ''}
        <div class="group-items">${itemsHtml}</div>
      </div>`;
  }

  let html = '';
  groups.forEach(g => {
    const groupItems = groupMap[g.id] || [];
    html += renderGroupSection(g.name, g.id, groupItems);
  });
  html += renderGroupSection('未分组', null, ungroupedItems);

  if (items.length === 0) {
    html = '<div class="empty-state">还没有打卡打卡，点击下方按钮添加</div>';
  } else if (!html.trim()) {
    html = '<div class="empty-state">所有打卡都在分组中</div>';
  }

  const container = document.getElementById('checkin-items');
  container.innerHTML = html;

  // Group toggle
  container.querySelectorAll('.group-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.btn-del-group')) return;
      const section = header.closest('.group-section');
      section.classList.toggle('collapsed');
      const toggle = header.querySelector('.group-toggle');
      toggle.textContent = section.classList.contains('collapsed') ? '▶' : '▼';
    });
  });

  if (expandAll) {
    container.querySelectorAll('.group-section').forEach(s => s.classList.remove('collapsed'));
  }

  // Value input
  container.querySelectorAll('.checkin-val-input').forEach(input => {
    input.addEventListener('input', () => {
      const itemId = parseInt(input.dataset.item);
      const max = parseInt(input.dataset.max);
      let val = parseInt(input.value) || 0;
      val = Math.max(0, Math.min(val, max));
      updateEmojiDisplay(input.closest('.checkin-card'), val, itemId);
    });
    input.addEventListener('change', () => {
      const itemId = parseInt(input.dataset.item);
      const max = parseInt(input.dataset.max);
      let val = parseInt(input.value) || 0;
      val = Math.max(0, Math.min(val, max));
      input.value = val;
      const card = input.closest('.checkin-card');
      updateEmojiDisplay(card, val, itemId);
      const notesEl = card.querySelector('.checkin-notes');
      DataManager.saveCheck({ itemId, date: currentDate, value: val, notes: notesEl ? notesEl.value.trim() : '' });
    });
  });

  // Edit button
  container.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => toggleEditMode(btn.closest('.checkin-card'), true));
  });
  container.querySelectorAll('.btn-edit-done').forEach(btn => {
    btn.addEventListener('click', () => saveEditAndClose(btn.closest('.checkin-card')));
  });
  container.querySelectorAll('.edit-name-input').forEach(input => {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveEditAndClose(input.closest('.checkin-card')); });
  });

  // Notes autosave
  container.querySelectorAll('.checkin-notes').forEach(input => {
    input.addEventListener('blur', () => {
      const itemId = parseInt(input.dataset.item);
      const card = input.closest('.checkin-card');
      const valInput = card.querySelector('.checkin-val-input');
      const val = valInput ? (parseInt(valInput.value) || 0) : 0;
      DataManager.saveCheck({ itemId, date: currentDate, value: val, notes: input.value.trim() });
    });
  });

  // Delete item
  container.querySelectorAll('.btn-del-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('确定删除这个打卡打卡？历史记录会保留。')) {
        DataManager.deleteItem(parseInt(btn.dataset.item));
        renderCheckin();
      }
    });
  });

  // Group menu toggle
  container.querySelectorAll('.btn-group-menu').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const gid = btn.dataset.group;
      // Close all other menus first
      document.querySelectorAll('.group-dropdown').forEach(d => {
        if (d.id !== 'gmenu-' + gid) d.classList.add('hidden');
      });
      document.getElementById('gmenu-' + gid).classList.toggle('hidden');
    });
  });

  // Delete group
  container.querySelectorAll('.btn-del-group').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const gid = parseInt(btn.dataset.group);
      const group = groups.find(g => g.id === gid);
      if (group && confirm(`确定删除分组"${group.name}"？其中的打卡将变为未分组。`)) {
        DataManager.deleteGroup(gid);
        renderCheckin();
      }
    });
  });
}

function renderCheckinCard(item, checksMap) {
  const check = checksMap[item.id];
  const value = check ? check.value : 0;
  const notes = check ? (check.notes || '') : '';
  const emojiCount = Math.min(value, 20);
  const emojiDisplay = value > 0
    ? item.icon.repeat(emojiCount) + (value > 20 ? ` ×${value}` : '')
    : `<span class="emoji-zero">${item.icon}</span>`;
  const groups = DataManager.getGroups();
  const groupOpts = '<option value="">无分组</option>' +
    groups.map(g => `<option value="${g.id}" ${item.groupId === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('');
  return `
    <div class="checkin-card" data-item-id="${item.id}">
      <div class="checkin-card-header">
        <span class="checkin-emoji-display" data-val="${value}">${emojiDisplay}</span>
        <span class="checkin-name">${item.name}</span>
        <button class="btn-icon btn-edit" data-item="${item.id}" title="编辑打卡">⚙</button>
        <div class="edit-controls">
          <input type="text" class="edit-emoji-input" value="${item.icon}" maxlength="4" placeholder="图标" title="emoji图标">
          <input type="text" class="edit-name-input" value="${escapeHtml(item.name)}" placeholder="名称">
          <select class="edit-group-select">${groupOpts}</select>
          <input type="number" class="edit-max-input" value="${item.scaleMax}" min="1" max="99" step="1" placeholder="上限">
          <button class="btn-icon-sm btn-edit-done" title="确认">✓</button>
        </div>
        <button class="btn-icon btn-del-item" data-item="${item.id}" title="删除">×</button>
      </div>
      <div class="checkin-input-row">
        <label class="val-label">数量</label>
        <input type="number" class="checkin-val-input" data-item="${item.id}" data-max="${item.scaleMax}"
               value="${value}" min="0" max="${item.scaleMax}" placeholder="0">
        <input type="text" class="checkin-notes" data-item="${item.id}"
               placeholder="备注（可选）" value="${escapeHtml(notes)}">
      </div>
    </div>`;
}

function updateEmojiDisplay(card, val, itemId) {
  const item = DataManager.getItems().find(i => i.id === itemId);
  if (!item) return;
  const display = card.querySelector('.checkin-emoji-display');
  if (!display) return;
  const cnt = Math.min(val, 20);
  display.innerHTML = val > 0
    ? item.icon.repeat(cnt) + (val > 20 ? ` ×${val}` : '')
    : `<span class="emoji-zero">${item.icon}</span>`;
  display.dataset.val = val;
}

function toggleEditMode(card, editing) { card.classList.toggle('is-editing', editing); }

function saveEditAndClose(card) {
  const itemId = parseInt(card.dataset.itemId);
  const emojiInput = card.querySelector('.edit-emoji-input');
  const newEmoji = emojiInput ? emojiInput.value.trim() : '';
  const nameInput = card.querySelector('.edit-name-input');
  const newName = nameInput ? nameInput.value.trim() : '';
  const maxInput = card.querySelector('.edit-max-input');
  const newMax = maxInput ? Math.max(1, parseInt(maxInput.value) || 1) : 1;
  const groupSel = card.querySelector('.edit-group-select');
  const newGroupId = groupSel ? (groupSel.value ? parseInt(groupSel.value) : null) : undefined;

  const updates = {};
  if (newEmoji) updates.icon = newEmoji;
  if (newName) updates.name = newName;
  if (newGroupId !== undefined) updates.groupId = newGroupId;
  updates.scaleMax = newMax;
  DataManager.updateItem(itemId, updates);

  const valInput = card.querySelector('.checkin-val-input');
  if (valInput) {
    valInput.max = newMax;
    valInput.dataset.max = newMax;
    let val = parseInt(valInput.value) || 0;
    val = Math.min(val, newMax);
    valInput.value = val;
    updateEmojiDisplay(card, val, itemId);
  }
  const nameSpan = card.querySelector('.checkin-name');
  if (nameSpan && newName) nameSpan.textContent = newName;
  if (newEmoji) {
    const display = card.querySelector('.checkin-emoji-display');
    if (display) {
      const valInput = card.querySelector('.checkin-val-input');
      const val = valInput ? (parseInt(valInput.value) || 0) : 0;
      const cnt = Math.min(val, 20);
      display.innerHTML = val > 0 ? newEmoji.repeat(cnt) + (val > 20 ? ` ×${val}` : '') : `<span class="emoji-zero">${newEmoji}</span>`;
    }
  }
  toggleEditMode(card, false);
  renderCheckin();
}

// ========== Date Nav ==========
let dateCdBusy = false;
function changeDate(delta) {
  if (dateCdBusy) return;
  dateCdBusy = true;
  currentDate = utcAddDays(currentDate, delta);
  syncDatePickers();
  if (currentTab === 'checkin') renderCheckin();
  else if (currentTab === 'diary') renderDiary();
  else if (currentTab === 'split') renderSplit();
  setTimeout(() => { dateCdBusy = false; }, 100);
}

function jumpToToday() {
  if (dateCdBusy) return;
  dateCdBusy = true;
  currentDate = todayStr();
  syncDatePickers();
  if (currentTab === 'checkin') renderCheckin();
  else if (currentTab === 'diary') renderDiary();
  else if (currentTab === 'split') renderSplit();
  setTimeout(() => { dateCdBusy = false; }, 100);
}

function syncDatePickers() {
  ['checkin-date', 'diary-date', 'split-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = currentDate;
  });
}

function onDatePicked(tab) {
  const el = document.getElementById(tab + '-date');
  const val = el ? el.value : '';
  if (!val) return;
  currentDate = val;
  if (tab === 'checkin') renderCheckin();
  else if (tab === 'diary') renderDiary();
  else if (tab === 'split') renderSplit();
}

// ========== Add Item Modal ==========
function pickEmoji(emoji, btn) {
  document.getElementById('new-item-icon').value = emoji;
  document.querySelectorAll('.emoji-opt').forEach(b => b.classList.remove('selected'));
  if (btn) btn.classList.add('selected');
}

function showAddItemModal() {
  document.getElementById('add-item-modal').classList.remove('hidden');
  document.getElementById('new-item-name').value = '';
  document.getElementById('new-item-icon').value = '✅';
  document.getElementById('new-item-max').value = '1';
  const sel = document.getElementById('new-item-group');
  sel.innerHTML = '<option value="">无分组</option>' +
    DataManager.getGroups().map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
  sel.value = '';
  document.getElementById('new-item-name').focus();
}
function hideAddItemModal() { document.getElementById('add-item-modal').classList.add('hidden'); }
function addNewItem() {
  const name = document.getElementById('new-item-name').value.trim();
  const icon = document.getElementById('new-item-icon').value.trim() || '✅';
  const scaleMax = parseInt(document.getElementById('new-item-max').value) || 1;
  const groupId = document.getElementById('new-item-group').value || null;
  if (!name) return;
  DataManager.addItem({ name, icon, scaleMax: Math.max(1, Math.min(99, scaleMax)), groupId: groupId ? parseInt(groupId) : null });
  hideAddItemModal();
  renderCheckin();
}

// ========== Group Modal ==========
function showGroupModal() {
  document.getElementById('group-modal').classList.remove('hidden');
  document.getElementById('new-group-name').value = '';
  document.getElementById('new-group-name').focus();
}
function hideGroupModal() { document.getElementById('group-modal').classList.add('hidden'); }
function addNewGroup() {
  const name = document.getElementById('new-group-name').value.trim();
  if (!name) return;
  DataManager.addGroup(name);
  hideGroupModal();
  renderCheckin();
}

// ========== Toolbar Toggles ==========
function toggleExpandAll() {
  expandAll = !expandAll;
  document.getElementById('btn-expand-all').classList.toggle('active', expandAll);
  renderCheckin();
}
function toggleFilterChecked() {
  filterCheckedOnly = !filterCheckedOnly;
  document.getElementById('btn-filter-checked').classList.toggle('active', filterCheckedOnly);
  renderCheckin();
}
function clearSearch() {
  document.getElementById('checkin-filter').value = '';
  renderCheckin();
}
function renameGroupPrompt(gid) {
  document.getElementById('gmenu-' + gid).classList.add('hidden');
  const group = DataManager.getGroups().find(g => g.id === parseInt(gid));
  if (!group) return;
  const newName = prompt('重命名分组：', group.name);
  if (newName && newName.trim()) {
    DataManager.renameGroup(parseInt(gid), newName.trim());
    renderCheckin();
  }
}
function showMovePanel(gid) {
  document.getElementById('gmenu-' + gid).classList.add('hidden');
  const panel = document.getElementById('movepanel-' + gid);
  const allItems = DataManager.getItems();
  if (allItems.length === 0) {
    panel.innerHTML = '<div class="move-panel-empty">没有任何打卡</div>';
  } else {
    panel.innerHTML = `
      <div class="move-panel-hint">☑️ 勾选 = 属于该分组，取消勾选 = 移出分组</div>
      ${allItems.map(item => {
        const inGroup = item.groupId === parseInt(gid);
        return `<label class="move-item-label">
          <input type="checkbox" value="${item.id}" ${inGroup ? 'checked' : ''}> ${item.icon} ${escapeHtml(item.name)}
        </label>`;
      }).join('')}
      <div class="move-panel-actions">
        <button onclick="confirmMoveToGroup('${gid}')">确认保存</button>
        <button onclick="hideMovePanel('${gid}')">取消</button>
      </div>`;
  }
  panel.classList.remove('hidden');
}
function hideMovePanel(gid) {
  document.getElementById('movepanel-' + gid).classList.add('hidden');
}
function confirmMoveToGroup(gid) {
  const panel = document.getElementById('movepanel-' + gid);
  const checks = panel.querySelectorAll('input[type=checkbox]');
  const items = DataManager.getAllItemsRaw();
  const gidNum = parseInt(gid);
  const checkedIds = new Set([...panel.querySelectorAll('input[type=checkbox]:checked')].map(cb => parseInt(cb.value)));
  items.forEach(item => {
    if (checkedIds.has(item.id)) {
      item.groupId = gidNum;
    } else if (item.groupId === gidNum) {
      item.groupId = null; // Remove from this group
    }
  });
  DataManager._save('items', items);
  panel.classList.add('hidden');
  renderCheckin();
}

// ========== Manage Modal ==========
function showManageModal() {
  const items = DataManager.getItems();
  const groups = DataManager.getGroups();
  const list = document.getElementById('manage-list');
  let html = '';
  groups.forEach(g => {
    const gItems = items.filter(i => i.groupId === g.id);
    html += `<div class="manage-group" data-gid="${g.id}">
      <span class="manage-toggle" onclick="toggleManageGroup(this.parentElement)">▼</span>
      <span class="manage-group-name" id="mgname-${g.id}">${escapeHtml(g.name)}</span>
      <span class="manage-group-count">(${gItems.length})</span>
      <input class="manage-edit-input hidden" id="mginput-${g.id}" value="${escapeHtml(g.name)}">
      <button class="btn-icon-sm mg-edit-btn" onclick="event.stopPropagation();startEditGroup(${g.id})" title="重命名">✏️</button>
      <button class="btn-icon-sm mg-save-btn hidden" onclick="event.stopPropagation();saveEditGroup(${g.id})" title="保存">✓</button>
      <button class="btn-icon-sm" onclick="event.stopPropagation();deleteGroupFromManage(${g.id})" title="删除分组">🗑</button>
    </div><div class="manage-group-items">`;
    if (gItems.length === 0) { html += '<div class="manage-item-empty">暂无打卡</div>'; }
    else { gItems.forEach(item => {
      html += `<div class="manage-item" data-iid="${item.id}">
        <span class="manage-item-display" onclick="jumpToManageItem(${item.id}, event)">
          <span class="mi-emoji">${item.icon}</span>
          <span class="mi-name" id="miname-${item.id}">${escapeHtml(item.name)}</span>
        </span>
        <span class="manage-item-edit hidden" id="miedit-${item.id}">
          <input class="mi-emoji-input" id="miemoji-${item.id}" value="${item.icon}" maxlength="4" size="2">
          <input class="mi-name-input" id="minput-${item.id}" value="${escapeHtml(item.name)}">
        </span>
        <button class="btn-icon-sm mg-edit-btn" onclick="event.stopPropagation();startEditItem(${item.id})" title="编辑">✏️</button>
        <button class="btn-icon-sm mg-save-btn hidden" onclick="event.stopPropagation();saveEditItem(${item.id})" title="保存">✓</button>
        <button class="btn-icon-sm" onclick="event.stopPropagation();deleteItemFromManage(${item.id})" title="删除">🗑</button>
      </div>`;
    });}
    html += '</div>';
  });
  const ungrouped = items.filter(i => !i.groupId || !groups.find(g => g.id === i.groupId));
  if (ungrouped.length > 0) {
    html += `<div class="manage-group"><span class="manage-toggle" onclick="toggleManageGroup(this.parentElement)">▼</span>
      <span class="manage-group-name">未分组</span><span class="manage-group-count">(${ungrouped.length})</span></div>
      <div class="manage-group-items">`;
    ungrouped.forEach(item => {
      html += `<div class="manage-item" data-iid="${item.id}">
        <span class="manage-item-display" onclick="jumpToManageItem(${item.id}, event)">
          <span class="mi-emoji">${item.icon}</span>
          <span class="mi-name" id="miname-${item.id}">${escapeHtml(item.name)}</span>
        </span>
        <span class="manage-item-edit hidden" id="miedit-${item.id}">
          <input class="mi-emoji-input" id="miemoji-${item.id}" value="${item.icon}" maxlength="4" size="2">
          <input class="mi-name-input" id="minput-${item.id}" value="${escapeHtml(item.name)}">
        </span>
        <button class="btn-icon-sm mg-edit-btn" onclick="event.stopPropagation();startEditItem(${item.id})" title="编辑">✏️</button>
        <button class="btn-icon-sm mg-save-btn hidden" onclick="event.stopPropagation();saveEditItem(${item.id})" title="保存">✓</button>
        <button class="btn-icon-sm" onclick="event.stopPropagation();deleteItemFromManage(${item.id})" title="删除">🗑</button>
      </div>`;
    });
    html += '</div>';
  }
  if (items.length === 0) html = '<div class="empty-state">还没有打卡打卡</div>';
  list.innerHTML = html;
  document.getElementById('manage-modal').classList.remove('hidden');
}

// ---- Manage: edit group ----
function startEditGroup(gid) {
  document.getElementById('mgname-' + gid).classList.add('hidden');
  document.getElementById('mginput-' + gid).classList.remove('hidden');
  document.querySelector(`.manage-group[data-gid="${gid}"] .mg-edit-btn`).classList.add('hidden');
  document.querySelector(`.manage-group[data-gid="${gid}"] .mg-save-btn`).classList.remove('hidden');
  const inp = document.getElementById('mginput-' + gid);
  inp.focus(); inp.select();
  inp.addEventListener('keydown', function h(e) { if (e.key === 'Enter') { inp.removeEventListener('keydown', h); saveEditGroup(gid); } });
}
function saveEditGroup(gid) {
  const name = document.getElementById('mginput-' + gid).value.trim();
  if (name) DataManager.renameGroup(gid, name);
  renderCheckin();
  showManageModal();
}
function renameGroupFromManage(gid, newName) {
  if (newName) DataManager.renameGroup(gid, newName);
}

// ---- Manage: edit item ----
function startEditItem(iid) {
  document.getElementById('miname-' + iid).classList.add('hidden');
  document.getElementById('miedit-' + iid).classList.remove('hidden');
  const row = document.querySelector(`.manage-item[data-iid="${iid}"]`);
  row.querySelector('.manage-item-display').classList.add('hidden');
  row.querySelector('.mg-edit-btn').classList.add('hidden');
  row.querySelector('.mg-save-btn').classList.remove('hidden');
  const inp = document.getElementById('minput-' + iid);
  inp.focus(); inp.select();
  inp.addEventListener('keydown', function h(e) { if (e.key === 'Enter') { inp.removeEventListener('keydown', h); saveEditItem(iid); } });
}
function saveEditItem(iid) {
  const name = document.getElementById('minput-' + iid).value.trim();
  const emoji = document.getElementById('miemoji-' + iid).value.trim() || '✅';
  if (name) DataManager.updateItem(iid, { name, icon: emoji });
  renderCheckin();
  showManageModal();
}
function toggleManageGroup(el) {
  el.classList.toggle('collapsed');
  const t = el.querySelector('.manage-toggle');
  if (t) t.textContent = el.classList.contains('collapsed') ? '▶' : '▼';
  const d = el.nextElementSibling;
  if (d && d.classList.contains('manage-group-items')) d.style.display = el.classList.contains('collapsed') ? 'none' : '';
}
function jumpToManageItem(itemId, e) {
  if (e && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON')) return;
  const item = DataManager.getItems().find(i => i.id === itemId);
  hideManageModal();
  if (item) {
    document.getElementById('checkin-filter').value = item.name;
    filterCheckedOnly = false;
    expandAll = true;
    document.getElementById('btn-filter-checked').classList.remove('active');
    document.getElementById('btn-expand-all').classList.add('active');
  }
  switchTab('checkin');
}
function jumpToManageGroup(groupId) {
  const group = DataManager.getGroups().find(g => g.id === groupId);
  hideManageModal();
  if (group) {
    document.getElementById('checkin-filter').value = '#' + group.name;
    filterCheckedOnly = false;
    expandAll = true;
    document.getElementById('btn-filter-checked').classList.remove('active');
    document.getElementById('btn-expand-all').classList.add('active');
  }
  switchTab('checkin');
}
function hideManageModal() { document.getElementById('manage-modal').classList.add('hidden'); }
function deleteItemFromManage(id) {
  if (confirm('确定删除该打卡？')) { DataManager.deleteItem(id); showManageModal(); renderCheckin(); }
}
function deleteGroupFromManage(id) {
  if (confirm('确定删除该分组？打卡将变为未分组。')) { DataManager.deleteGroup(id); showManageModal(); renderCheckin(); }
}

// ========== Tab 2: Diary ==========
function renderDiary() {
  document.getElementById('diary-date').value = currentDate;
  const diary = DataManager.getDiary(currentDate);
  document.getElementById('diary-content').value = diary ? diary.content : '';
  renderDiaryImages();
  // Show cached diary summary
  const from = getMonday(currentDate) + '_diary';
  const cached = DataManager.getSummary(from);
  const sc = document.getElementById('diary-ai-content');
  if (cached) {
    sc.innerHTML = `<div class="summary-text">${cached.summary.replace(/\n/g, '<br>')}</div><div class="summary-meta">知心姐姐 · ${new Date(cached.createdAt).toLocaleString()}</div>`;
  } else {
    sc.innerHTML = '';
  }
}

let diarySaveTimer = null;
function onDiaryInput() {
  clearTimeout(diarySaveTimer);
  diarySaveTimer = setTimeout(() => {
    DataManager.saveDiary(currentDate, document.getElementById('diary-content').value);
  }, 800);
}

async function renderDiaryImages() {
  const container = document.getElementById('diary-images');
  const images = await ImageStore.getByDate(currentDate);
  if (images.length === 0) {
    container.innerHTML = '<div class="img-hint">点击或拖拽上传图片</div>';
    return;
  }
  container.innerHTML = images.map(img => {
    const url = URL.createObjectURL(new Blob([img.data], { type: img.type }));
    return `<div class="img-thumb" data-id="${img.id}">
      <img src="${url}" alt="${img.originalName}">
      <button class="btn-img-del" data-id="${img.id}">×</button></div>`;
  }).join('');
  container.querySelectorAll('.btn-img-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await ImageStore.remove(parseInt(btn.dataset.id));
      renderDiaryImages();
    });
  });
}

async function handleImageUpload(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    await ImageStore.save(currentDate, file);
  }
  renderDiaryImages();
}

// ========== Tab 3: Stats ==========
let statsPeriod = 'week';
let lineChart = null;

function setStatsPeriod(p) {
  statsPeriod = p;
  document.querySelectorAll('[data-stats-period]').forEach(b => b.classList.toggle('active', b.dataset.statsPeriod === p));
  document.getElementById('stats-date-from').value = '';
  document.getElementById('stats-date-to').value = '';
  renderStats();
}
function resetStatsFilter() {
  statsPeriod = 'week';
  document.querySelectorAll('[data-stats-period]').forEach(b => b.classList.toggle('active', b.dataset.statsPeriod === 'week'));
  document.getElementById('stats-date-from').value = '';
  document.getElementById('stats-date-to').value = '';
  document.getElementById('stats-item-filter').value = '';
  renderStats();
}

function getPeriodRange(dateStr) {
  const d = new Date(dateStr); // UTC
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  let from, to;
  if (statsPeriod === 'week') {
    from = getMonday(dateStr);
    to = utcAddDays(from, 6);
  } else if (statsPeriod === 'month') {
    from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    to = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  } else if (statsPeriod === 'quarter') {
    const qs = Math.floor(m / 3) * 3;
    from = `${y}-${String(qs + 1).padStart(2, '0')}-01`;
    to = new Date(Date.UTC(y, qs + 3, 0)).toISOString().slice(0, 10);
  } else {
    from = `${y}-01-01`;
    to = `${y}-12-31`;
  }
  return [from, to];
}

function itemStats(itemId, checks, dateLabels) {
  let checkedDays = 0, streak = 0, maxStreak = 0;
  for (const date of dateLabels) {
    const c = checks[date] && checks[date][itemId];
    if (c && c.value > 0) { checkedDays++; streak++; maxStreak = Math.max(maxStreak, streak); }
    else { streak = 0; }
  }
  return { rate: dateLabels.length > 0 ? Math.round(checkedDays / dateLabels.length * 100) : 0, streak: maxStreak, days: checkedDays, totalDays: dateLabels.length };
}

function drawLineChart(dateLabels, items, checksByDate) {
  const ctx = document.getElementById('stats-line-chart').getContext('2d');
  if (lineChart) lineChart.destroy();
  if (items.length === 0) { document.getElementById('line-chart-wrap').style.display = 'none'; return; }
  document.getElementById('line-chart-wrap').style.display = '';

  const colors = ['#FF6384','#36A2EB','#FFCE56','#4BC0C0','#9966FF','#FF9F40','#7CB342','#E91E63'];
  const datasets = items.map((item, i) => ({
    label: item.icon + ' ' + item.name,
    data: dateLabels.map(d => {
      const c = checksByDate[d] && checksByDate[d][item.id];
      return c ? c.value : 0;
    }),
    borderColor: colors[i % colors.length],
    backgroundColor: colors[i % colors.length] + '22',
    tension: 0.3,
    fill: false,
    pointRadius: 3,
    pointHoverRadius: 6,
  }));

  lineChart = new Chart(ctx, {
    type: 'line',
    data: { labels: dateLabels.map(d => d.slice(5)), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, padding: 12 } } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 }, title: { display: true, text: '数值' } },
        x: { title: { display: true, text: '日期' } },
      },
    },
  });
}

function renderStats() {
  const customFrom = document.getElementById('stats-date-from').value;
  const customTo = document.getElementById('stats-date-to').value;
  let from, to;
  if (customFrom && customTo) {
    from = customFrom; to = customTo;
    document.querySelectorAll('[data-stats-period]').forEach(b => b.classList.remove('active'));
  } else {
    [from, to] = getPeriodRange(currentDate);
    document.querySelectorAll('[data-stats-period]').forEach(b => b.classList.toggle('active', b.dataset.statsPeriod === statsPeriod));
  }
  document.getElementById('stats-range').textContent = `${from} ~ ${to}`;

  let items = DataManager.getItems();
  const statsFilterSel = document.getElementById('stats-item-filter');
  const curFilterVal = statsFilterSel.value;
  statsFilterSel.innerHTML = '<option value="">全部打卡</option>' +
    DataManager.getItems().map(i => `<option value="${i.id}">${i.icon} ${escapeHtml(i.name)}</option>`).join('');
  statsFilterSel.value = curFilterVal;
  const filterItemId = parseInt(statsFilterSel.value) || null;
  if (filterItemId) items = items.filter(i => i.id === filterItemId);

  const itemIds = new Set(items.map(i => i.id));
  const allChecks = DataManager.getChecksRange(from, to, null);
  const checks = allChecks.filter(c => itemIds.has(c.itemId));
  const checksByDate = {};
  checks.forEach(c => {
    if (!checksByDate[c.date]) checksByDate[c.date] = {};
    checksByDate[c.date][c.itemId] = c;
  });

  const dateLabels = [];
  let cursor = from;
  while (cursor <= to) { dateLabels.push(cursor); cursor = utcAddDays(cursor, 1); }

  let cardsHtml = `<div class="stats-section-header" onclick="toggleStatsSection(this)">
    <span class="hm-toggle">▼</span> 各打卡统计
  </div><div class="stats-section-body">`;
  items.forEach(item => {
    const s = itemStats(item.id, checksByDate, dateLabels);
    cardsHtml += `<div class="stat-card stat-card-item">
      <div class="stat-card-item-header">${item.icon} ${item.name}</div>
      <div class="stat-card-item-row"><span>打卡率 <b>${s.rate}%</b></span><span>连续 <b>${s.streak}</b>天</span><span>共 <b>${s.days}/${s.totalDays}</b>天</span></div>
    </div>`;
  });
  cardsHtml += `</div>`;
  document.getElementById('stats-cards').innerHTML = cardsHtml;

  // Line chart
  drawLineChart(dateLabels, items, checksByDate);

  let heatHtml = '';
  if (items.length > 0) {
    heatHtml += `<div class="heatmap-section"><div class="heatmap-title" onclick="toggleHeatmapSection(this)"><span class="hm-toggle">▼</span> 📊 全部汇总</div>${buildAggregateHeatmap(items, from, to, checksByDate)}</div>`;
    items.forEach(item => {
      heatHtml += `<div class="heatmap-section"><div class="heatmap-title" onclick="toggleHeatmapSection(this)"><span class="hm-toggle">▼</span> ${item.icon} ${item.name}</div><div class="heatmap-legend"><span>少</span><div class="legend-bar"></div><span>多</span></div>${buildHeatmap(item, from, to, checksByDate)}</div>`;
    });
  } else {
    heatHtml = '<div class="empty-state">还没有打卡打卡</div>';
  }
  const container = document.getElementById('heatmaps-container');
  container.innerHTML = heatHtml;

  container.querySelectorAll('.hm-cell:not(.hm-empty):not(.hm-agg-cell)').forEach(cell => {
    cell.addEventListener('click', () => {
      const date = cell.dataset.date;
      const itemId = parseInt(cell.dataset.item);
      const value = parseInt(cell.dataset.value) || 0;
      if (!itemId) return;
      const item = items.find(i => i.id === itemId);
      const check = checksByDate[date] && checksByDate[date][itemId];
      showCellDetail(item, date, value, check ? (check.notes || '') : '');
    });
  });
  container.querySelectorAll('.hm-agg-cell').forEach(cell => {
    cell.addEventListener('click', () => showAggregateDay(items, checksByDate, cell.dataset.date));
  });

  const weekFrom = getMonday(currentDate);
  const existingSummary = DataManager.getSummary(weekFrom);
  const sc = document.getElementById('ai-summary-content');
  if (existingSummary) {
    sc.innerHTML = `<div class="summary-text">${existingSummary.summary.replace(/\n/g, '<br>')}</div><div class="summary-meta">生成于 ${new Date(existingSummary.createdAt).toLocaleString()}</div>`;
  } else {
    sc.innerHTML = '<div class="empty-state">还没有周总结</div>';
  }
}

function buildAggregateHeatmap(items, from, to, checksByDate) {
  const maxVal = Math.max(1, ...items.map(i => i.scaleMax));
  const totalDays = daysBetween(from, to);

  if (totalDays <= 7) {
    const cells = [];
    for (let col = 0; col < totalDays; col++) {
      const ds = utcAddDays(from, col);
      let totalVal = 0, emojis = '';
      items.forEach(item => {
        const c = checksByDate[ds] && checksByDate[ds][item.id];
        const v = c ? c.value : 0;
        totalVal += v;
        if (v > 0) emojis += item.icon.repeat(Math.min(v, 5));
      });
      const intensity = maxVal > 0 ? Math.min(1, totalVal / (maxVal * items.length || 1)) : 0;
      cells.push(`<div class="hm-cell hm-agg-cell" data-date="${ds}" data-value="${totalVal}"
        style="--intensity:${intensity.toFixed(2)}" title="${ds}: ${emojis || '无'}">
        <span class="hm-date-label">${ds.slice(5)}</span><span class="hm-value">${emojis || '-'}</span></div>`);
    }
    return `<div class="heatmap-grid week-mode agg-mode" style="grid-template-columns:repeat(${totalDays},1fr)">${cells.join('')}</div>`;
  }

  const fromD = new Date(from); // UTC
  let startCol = fromD.getUTCDay() - 1; if (startCol < 0) startCol = 6;
  const rangeDays = daysBetween(from, to);
  const dayLabels = ['一', '二', '三', '四', '五', '六', '日'];
  let html = '<div class="heatmap-grid month-mode agg-mode">';
  html += dayLabels.map(l => `<div class="hm-col-header">${l}</div>`).join('');
  let cellIdx = 0;
  const numRows = Math.ceil((startCol + rangeDays) / 7);
  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < 7; col++) {
      if (row === 0 && col < startCol) { html += '<div class="hm-cell hm-empty"></div>'; }
      else if (cellIdx >= rangeDays) { html += '<div class="hm-cell hm-empty"></div>'; }
      else {
        const ds = utcAddDays(from, cellIdx);
        const dayNum = parseInt(ds.slice(8), 10);
        let totalVal = 0, emojis = '';
        items.forEach(item => {
          const c = checksByDate[ds] && checksByDate[ds][item.id];
          const v = c ? c.value : 0;
          totalVal += v;
          if (v > 0) emojis += item.icon.repeat(Math.min(v, 3));
        });
        const intensity = maxVal > 0 ? Math.min(1, totalVal / (maxVal * Math.max(1, items.length))) : 0;
        const isToday = ds === todayStr();
        html += `<div class="hm-cell hm-agg-cell ${isToday ? 'hm-today' : ''}" data-date="${ds}" data-value="${totalVal}"
          style="--intensity:${intensity.toFixed(2)}" title="${ds}: ${emojis || '无'}">
          <span class="hm-date-num">${dayNum}</span><span class="hm-agg-emojis">${emojis || ''}</span></div>`;
        cellIdx++;
      }
    }
  }
  html += '</div>'; return html;
}

function buildHeatmap(item, from, to, checksByDate) {
  const maxVal = item.scaleMax;
  const totalDays = daysBetween(from, to);

  if (totalDays <= 7) {
    const cells = [];
    const dayLabels = ['一', '二', '三', '四', '五', '六', '日'];
    for (let col = 0; col < totalDays; col++) {
      const dateStr = utcAddDays(from, col);
      const check = checksByDate[dateStr] && checksByDate[dateStr][item.id];
      const val = check ? check.value : 0;
      const intensity = maxVal > 0 ? val / maxVal : 0;
      cells.push(`<div class="hm-cell" data-date="${dateStr}" data-item="${item.id}" data-value="${val}"
        style="--intensity:${intensity.toFixed(2)}" title="${dateStr}: ${val}">
        <span class="hm-day-label">${dayLabels[col]}</span><span class="hm-date-label">${dateStr.slice(5)}</span>
        <span class="hm-value">${val > 0 ? item.icon.repeat(val) : ''}</span></div>`);
    }
    return `<div class="heatmap-grid week-mode" style="grid-template-columns:repeat(${totalDays},1fr)">${cells.join('')}</div>`;
  }

  const fromD = new Date(from); // UTC
  let startCol = fromD.getUTCDay() - 1; if (startCol < 0) startCol = 6;
  const rangeDays = daysBetween(from, to);
  const dayLabels = ['一', '二', '三', '四', '五', '六', '日'];
  let html = '<div class="heatmap-grid month-mode">';
  html += dayLabels.map(l => `<div class="hm-col-header">${l}</div>`).join('');
  let cellIdx = 0;
  const numRows = Math.ceil((startCol + rangeDays) / 7);
  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < 7; col++) {
      if (row === 0 && col < startCol) { html += '<div class="hm-cell hm-empty"></div>'; }
      else if (cellIdx >= rangeDays) { html += '<div class="hm-cell hm-empty"></div>'; }
      else {
        const dateStr = utcAddDays(from, cellIdx);
        const dayNum = parseInt(dateStr.slice(8), 10);
        const check = checksByDate[dateStr] && checksByDate[dateStr][item.id];
        const val = check ? check.value : 0;
        const intensity = maxVal > 0 ? val / maxVal : 0;
        const isToday = dateStr === todayStr();
        html += `<div class="hm-cell ${isToday ? 'hm-today' : ''}" data-date="${dateStr}" data-item="${item.id}" data-value="${val}"
          style="--intensity:${intensity.toFixed(2)}" title="${dateStr}: ${val}"><span class="hm-date-num">${dayNum}</span></div>`;
        cellIdx++;
      }
    }
  }
  html += '</div>'; return html;
}

function toggleStatsSection(el) {
  el.classList.toggle('collapsed');
  const t = el.querySelector('.hm-toggle');
  if (t) t.textContent = el.classList.contains('collapsed') ? '▶' : '▼';
  const body = el.nextElementSibling;
  if (body) body.style.display = el.classList.contains('collapsed') ? 'none' : '';
}
function toggleHeatmapSection(titleEl) {
  const section = titleEl.closest('.heatmap-section');
  section.classList.toggle('hm-collapsed');
  const t = titleEl.querySelector('.hm-toggle');
  if (t) t.textContent = section.classList.contains('hm-collapsed') ? '▶' : '▼';
}

function showCellDetail(item, date, value, notes) {
  const max = item.scaleMax;
  const icons = item.icon.repeat(value > 0 ? value : 0) || '无';
  const html = `<div class="cell-detail-overlay" id="cell-detail-overlay">
    <div class="cell-detail-card">
      <div class="cell-detail-header"><span>${item.icon} ${item.name}</span><button class="btn-close-detail" onclick="closeCellDetail()">×</button></div>
      <div class="cell-detail-body">
        <div class="cd-row"><span class="cd-label">日期</span><span>${fmtDate(date)} (${date})</span></div>
        <div class="cd-row"><span class="cd-label">数值</span><span class="cd-value">${icons} (${value}/${max})</span></div>
        <div class="cd-row"><span class="cd-label">备注</span><span>${escapeHtml(notes || '(无)')}</span></div>
      </div>
      <div class="cell-detail-actions"><button class="btn-jump-date" onclick="jumpToDateFromDetail('${date}')">跳转到该日期编辑</button></div>
    </div></div>`;
  const existing = document.getElementById('cell-detail-overlay');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('cell-detail-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'cell-detail-overlay') closeCellDetail();
  });
}

function showAggregateDay(items, checksByDate, date) {
  let rows = '';
  items.forEach(item => {
    const c = checksByDate[date] && checksByDate[date][item.id];
    const v = c ? c.value : 0;
    rows += `<div class="cd-row"><span>${item.icon} ${item.name}</span><span>${item.icon.repeat(v > 0 ? v : 0) || '-'} (${v})</span></div>`;
  });
  const html = `<div class="cell-detail-overlay" id="cell-detail-overlay">
    <div class="cell-detail-card">
      <div class="cell-detail-header"><span>📅 ${fmtDate(date)}</span><button class="btn-close-detail" onclick="closeCellDetail()">×</button></div>
      <div class="cell-detail-body">${rows}</div>
      <div class="cell-detail-actions"><button class="btn-jump-date" onclick="jumpToDateFromDetail('${date}')">跳转到该日期</button></div>
    </div></div>`;
  const existing = document.getElementById('cell-detail-overlay');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('cell-detail-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'cell-detail-overlay') closeCellDetail();
  });
}

function closeCellDetail() { const el = document.getElementById('cell-detail-overlay'); if (el) el.remove(); }
function jumpToDateFromDetail(date) { closeCellDetail(); currentDate = date; switchTab('checkin'); }

async function generateAISummary() {
  const settings = DataManager.getSettings();
  let apiKey = settings.anthropicApiKey || '';
  if (!apiKey) { const key = prompt('请输入 Anthropic API Key：'); if (!key) return; DataManager.saveSettings({ anthropicApiKey: key }); apiKey = key; }
  if (!apiKey) return;
  const from = getMonday(currentDate);
  const to = utcAddDays(from, 6);
  const cached = DataManager.getSummary(from);
  if (cached && !confirm('本周已有总结，是否重新生成？')) return;
  const summaryEl = document.getElementById('ai-summary-content');
  summaryEl.innerHTML = '<div class="loading">AI 正在生成周总结...</div>';
  const diaries = DataManager.getDiariesRange(from, to);
  const items = DataManager.getItems();
  const checks = DataManager.getChecksRange(from, to, null);
  let diaryText = diaries.map(d => `### ${fmtDate(d.date)}\n${d.content}`).join('\n\n') || '（本周没有写日记）';
  let checkSummary = items.map(item => {
    const total = checks.filter(c => c.itemId === item.id && c.value > 0).length;
    return `${item.icon} ${item.name}: 打卡 ${total} 天`;
  }).join('\n');
  const prompt = `请用中文写一段不超过100字的周总结。简洁概括本周打卡亮点和日记心情。语气温暖。\n【本周打卡统计】\n${checkSummary}\n【本周日记内容】\n${diaryText}\n请直接输出总结，不要标题，严格100字以内。`;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new Error(err.error?.message || `HTTP ${resp.status}`); }
    const data = await resp.json();
    const summary = data.content[0].text;
    DataManager.saveSummary({ weekStart: from, weekEnd: to, summary, createdAt: new Date().toISOString() });
    summaryEl.innerHTML = `<div class="summary-text">${summary.replace(/\n/g, '<br>')}</div><div class="summary-meta">生成于 ${new Date().toLocaleString()}</div>`;
  } catch (e) { summaryEl.innerHTML = `<div class="error-msg">生成失败: ${escapeHtml(e.message)}</div>`; }
}

// ========== Diary AI Summary (知心姐姐) ==========
async function generateDiaryAISummary() {
  const settings = DataManager.getSettings();
  let apiKey = settings.anthropicApiKey || '';
  if (!apiKey) { const key = prompt('请输入 Anthropic API Key：'); if (!key) return; DataManager.saveSettings({ anthropicApiKey: key }); apiKey = key; }
  if (!apiKey) return;
  const from = getMonday(currentDate);
  const to = utcAddDays(from, 6);
  const summaryEl = document.getElementById('diary-ai-content');
  summaryEl.innerHTML = '<div class="loading">知心姐姐正在回顾你的一周...</div>';
  const diaries = DataManager.getDiariesRange(from, to);
  const items = DataManager.getItems();
  const checks = DataManager.getChecksRange(from, to, null);
  let diaryText = diaries.map(d => `### ${fmtDate(d.date)}\n${d.content}`).join('\n\n') || '（本周没有写日记）';
  let checkSummary = items.map(item => {
    const total = checks.filter(c => c.itemId === item.id && c.value > 0).length;
    return `${item.icon} ${item.name}: 打卡 ${total} 天`;
  }).join('\n');
  const prompt = `你是一个知心大姐姐，幽默风趣又温暖。请根据以下用户一周的打卡记录和日记，写一段周总结。要求：1.语气轻松幽默，像闺蜜聊天 2.夸夸做得好的地方 3.对不足的地方给温柔的建议 4.结尾来一句暖心的话。\n【本周打卡】\n${checkSummary}\n【本周日记】\n${diaryText}`;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new Error(err.error?.message || `HTTP ${resp.status}`); }
    const data = await resp.json();
    const summary = data.content[0].text;
    DataManager.saveSummary({ weekStart: from + '_diary', weekEnd: to, summary, createdAt: new Date().toISOString() });
    summaryEl.innerHTML = `<div class="summary-text">${summary.replace(/\n/g, '<br>')}</div><div class="summary-meta">知心姐姐 · ${new Date().toLocaleString()}</div>`;
  } catch (e) { summaryEl.innerHTML = `<div class="error-msg">生成失败: ${escapeHtml(e.message)}</div>`; }
}

// ========== Tab 4: History ==========
function renderHistory() {
  const from = document.getElementById('hist-from').value || '';
  const to = document.getElementById('hist-to').value || '';
  const itemId = parseInt(document.getElementById('hist-item').value) || null;
  const allChecks = DataManager.getChecksRange(from || undefined, to || undefined, itemId || undefined);
  const items = DataManager.getItems();
  const itemIds = new Set(items.map(i => i.id));
  const checks = allChecks.filter(c => itemIds.has(c.itemId));
  const itemsMap = {};
  items.forEach(i => { itemsMap[i.id] = i; });
  const groups = DataManager.getGroups();
  const groupsMap = {};
  groups.forEach(g => { groupsMap[g.id] = g; });
  items.forEach(i => { if (i.groupId) i._groupName = groupsMap[i.groupId]?.name || ''; });

  const tbody = document.getElementById('history-table-body');
  if (checks.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">暂无数据</td></tr>';
  } else {
    tbody.innerHTML = checks.map(c => {
      const item = itemsMap[c.itemId];
      const itemName = item ? `${item.icon} ${item.name}` : '';
      const groupName = item && item._groupName ? item._groupName : '-';
      const maxVal = item ? item.scaleMax : 99;
      return `<tr class="hist-row" data-date="${c.date}" data-item="${c.itemId}">
        <td class="hist-date">${c.date}</td><td>${groupName}</td><td>${itemName}</td>
        <td class="hist-val-cell"><input type="number" class="hist-val-input" value="${c.value}" min="0" max="${maxVal}" data-item="${c.itemId}" data-date="${c.date}" data-max="${maxVal}"></td>
        <td class="hist-val-cell"><input type="number" class="hist-max-input" value="${maxVal}" min="1" max="99" data-item="${c.itemId}"></td>
        <td>${escapeHtml(c.notes || '')}</td></tr>`;
    }).join('');
    tbody.querySelectorAll('.hist-row').forEach(row => {
      row.addEventListener('click', (e) => { if (e.target.tagName === 'INPUT') return; currentDate = row.dataset.date; switchTab('checkin'); });
      row.style.cursor = 'pointer';
    });
    tbody.querySelectorAll('.hist-val-input').forEach(input => {
      input.addEventListener('change', () => {
        const itemId = parseInt(input.dataset.item), date = input.dataset.date, max = parseInt(input.dataset.max);
        let val = parseInt(input.value) || 0; val = Math.max(0, Math.min(val, max)); input.value = val;
        DataManager.saveCheck({ itemId, date, value: val, notes: '' });
      });
    });
    tbody.querySelectorAll('.hist-max-input').forEach(input => {
      input.addEventListener('change', () => {
        const itemId = parseInt(input.dataset.item);
        let newMax = parseInt(input.value) || 1; newMax = Math.max(1, Math.min(99, newMax)); input.value = newMax;
        DataManager.updateItem(itemId, { scaleMax: newMax }); renderHistory();
      });
    });
  }
  const sel = document.getElementById('hist-item');
  const curVal = sel.value;
  sel.innerHTML = '<option value="">全部打卡</option>' + items.map(i => `<option value="${i.id}">${i.icon} ${i.name}</option>`).join('');
  sel.value = curVal;
}
function applyHistoryFilters() { renderHistory(); }
function exportHistoryCSV() {
  const from = document.getElementById('hist-from').value || '', to = document.getElementById('hist-to').value || '';
  const itemId = parseInt(document.getElementById('hist-item').value) || null;
  const allChecks = DataManager.getChecksRange(from || undefined, to || undefined, itemId || undefined);
  const items = DataManager.getItems(); const itemIds = new Set(items.map(i => i.id));
  const checks = allChecks.filter(c => itemIds.has(c.itemId)); const itemsMap = {};
  items.forEach(i => { itemsMap[i.id] = i; });
  let csv = '日期,分组,打卡,数值,备注\n';
  checks.forEach(c => {
    const item = itemsMap[c.itemId];
    csv += `${c.date},${item ? item.name : ''},${c.value},${(c.notes || '').replace(/,/g, '，')}\n`;
  });
  const blob = new Blob(['﻿' + csv], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `打卡历史_${from || 'all'}_${to || 'all'}.xls`;
  a.click(); URL.revokeObjectURL(url);
}

// ========== Tab 5: Split ==========
const SplitData = {
  getUsers() { return DataManager._load('split_users') || []; },
  saveUsers(users) { DataManager._save('split_users', users); },
  getBills() { return DataManager._load('split_bills') || []; },
  saveBills(bills) { DataManager._save('split_bills', bills); },
};

function renderSplit() {
  document.getElementById('split-date').value = currentDate;

  const users = SplitData.getUsers();
  const allBills = SplitData.getBills();
  // Filter bills for current date
  const bills = allBills.filter(b => b.date === currentDate);

  // Users list
  const ulist = document.getElementById('split-users-list');
  ulist.innerHTML = users.map(u => `
    <div class="split-user-row">
      <span>👤 ${escapeHtml(u.name)}</span>
      <button class="btn-icon-sm" onclick="deleteSplitUser(${u.id})" title="删除">×</button>
    </div>`).join('') || '<div class="empty-state" style="padding:16px">还没有成员</div>';

  // Bills list (filtered by date)
  const blist = document.getElementById('split-bills-list');
  blist.innerHTML = bills.map(b => {
    const payer = users.find(u => u.id === b.payerId);
    const parts = b.participants.map(p => users.find(u => u.id === p)).filter(Boolean);
    return `<div class="split-bill-row" onclick="showSplitBillModal(${b.id})">
      <div class="split-bill-info">
        <span class="split-bill-amount">¥${b.amount.toFixed(2)}</span>
        <span class="split-bill-desc">${escapeHtml(b.desc || '无说明')}</span>
        <span class="split-bill-meta">${payer ? payer.name : '?'} 付 · ${parts.map(p => p.name).join('、')} 人均 ¥${(b.amount / (b.participants.length || 1)).toFixed(2)}</span>
      </div>
      <button class="btn-icon-sm" onclick="event.stopPropagation();deleteSplitBill(${b.id})" title="删除">×</button>
    </div>`;
  }).join('') || `<div class="empty-state" style="padding:16px">${fmtDate(currentDate)} 没有账单</div>`;

  // Summary (all bills, not filtered)
  renderSplitSummary(users, allBills);
}

function renderSplitSummary(users, bills) {
  const summary = document.getElementById('split-summary');
  const exportBtn = document.getElementById('btn-export-split');
  if (users.length === 0 || bills.length === 0) {
    summary.innerHTML = '';
    exportBtn.style.display = 'none';
    return;
  }
  exportBtn.style.display = 'block';

  // Calculate net balance per user
  const balances = {};
  users.forEach(u => { balances[u.id] = { name: u.name, paid: 0, share: 0 }; });

  bills.forEach(b => {
    const n = b.participants.length || 1;
    const perPerson = b.amount / n;
    if (balances[b.payerId]) balances[b.payerId].paid += b.amount;
    b.participants.forEach(pid => {
      if (balances[pid]) balances[pid].share += perPerson;
    });
  });

  const rows = users.map(u => {
    const b = balances[u.id];
    const net = b.paid - b.share;
    const cls = net > 0.01 ? 'positive' : (net < -0.01 ? 'negative' : '');
    const sign = net > 0.01 ? '+' : '';
    return `<div class="split-summary-row">
      <span>👤 ${escapeHtml(b.name)}</span>
      <span class="split-net ${cls}">${sign}${net.toFixed(2)}</span>
      <span class="split-detail">付 ¥${b.paid.toFixed(2)} · 消费 ¥${b.share.toFixed(2)}</span>
    </div>`;
  }).join('');

  // Simplified settlement
  let settlement = '';
  const debtors = [], creditors = [];
  users.forEach(u => {
    const net = balances[u.id].paid - balances[u.id].share;
    if (net > 0.01) creditors.push({ ...balances[u.id], net });
    else if (net < -0.01) debtors.push({ ...balances[u.id], net: -net });
  });

  if (debtors.length > 0 && creditors.length > 0) {
    let dIdx = 0, cIdx = 0;
    const steps = [];
    while (dIdx < debtors.length && cIdx < creditors.length) {
      const amount = Math.min(debtors[dIdx].net, creditors[cIdx].net);
      steps.push(`${debtors[dIdx].name} → ${creditors[cIdx].name} ¥${amount.toFixed(2)}`);
      debtors[dIdx].net -= amount;
      creditors[cIdx].net -= amount;
      if (debtors[dIdx].net < 0.01) dIdx++;
      if (creditors[cIdx].net < 0.01) cIdx++;
    }
    settlement = `<div class="split-settlement">
      <div class="section-label">💡 结算建议</div>
      ${steps.map(s => `<div class="settlement-row">${s}</div>`).join('')}
    </div>`;
  }

  summary.innerHTML = `
    <div class="section-label">📊 余额总览</div>
    ${rows}
    ${settlement}`;
}

function addSplitUser() {
  const inp = document.getElementById('split-user-name');
  const name = inp.value.trim();
  if (!name) return;
  const users = SplitData.getUsers();
  users.push({ id: Date.now(), name });
  SplitData.saveUsers(users);
  inp.value = '';
  renderSplit();
}

function deleteSplitUser(id) {
  if (!confirm('删除该成员？相关账单不受影响。')) return;
  let users = SplitData.getUsers();
  users = users.filter(u => u.id !== id);
  SplitData.saveUsers(users);
  renderSplit();
}

let editingSplitBillId = null;

function showSplitBillModal(editId) {
  const users = SplitData.getUsers();
  if (users.length === 0) { alert('请先添加至少一个成员'); return; }
  editingSplitBillId = editId || null;
  const bills = SplitData.getBills();
  const bill = editId ? bills.find(b => b.id === editId) : null;

  document.getElementById('split-bill-amount').value = bill ? bill.amount : '';
  document.getElementById('split-bill-desc').value = bill ? bill.desc : '';
  document.getElementById('split-bill-modal').querySelector('h3').textContent = bill ? '编辑账单' : '记一笔';

  const payerSel = document.getElementById('split-bill-payer');
  payerSel.innerHTML = users.map(u => `<option value="${u.id}" ${bill && bill.payerId === u.id ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('');

  const participantIds = bill ? bill.participants : users.map(u => u.id);
  document.getElementById('split-bill-participants').innerHTML = users.map(u =>
    `<label class="move-item-label"><input type="checkbox" value="${u.id}" ${participantIds.includes(u.id) ? 'checked' : ''}> ${escapeHtml(u.name)}</label>`
  ).join('');
  document.getElementById('split-bill-modal').classList.remove('hidden');
}

function hideSplitBillModal() {
  document.getElementById('split-bill-modal').classList.add('hidden');
  editingSplitBillId = null;
}

function saveSplitBill() {
  const amount = parseFloat(document.getElementById('split-bill-amount').value) || 0;
  if (amount <= 0) return;
  const desc = document.getElementById('split-bill-desc').value.trim();
  const payerId = parseInt(document.getElementById('split-bill-payer').value);
  const checks = document.querySelectorAll('#split-bill-participants input[type=checkbox]:checked');
  let participants = [...checks].map(cb => parseInt(cb.value));
  // Always include payer
  if (!participants.includes(payerId)) participants.push(payerId);
  if (participants.length === 0) return;

  const bills = SplitData.getBills();
  if (editingSplitBillId) {
    const bill = bills.find(b => b.id === editingSplitBillId);
    if (bill) {
      bill.amount = amount; bill.desc = desc; bill.payerId = payerId; bill.participants = participants;
    }
  } else {
    bills.push({ id: Date.now(), amount, desc, payerId, participants, date: todayStr() });
  }
  SplitData.saveBills(bills);
  hideSplitBillModal();
  renderSplit();
}

// ========== Theme ==========
const THEMES = [
  { id: 'pink', name: '🌸 粉嫩', dot: 't' },
  { id: 'mint', name: '🌿 薄荷', dot: 'm' },
  { id: 'blue', name: '🌊 海洋', dot: 'b' },
  { id: 'warm', name: '🌅 暖橙', dot: 'w' },
  { id: 'dark', name: '🌙 暗夜', dot: 'd' },
];

function showThemeModal() {
  const current = document.documentElement.getAttribute('data-theme') || 'pink';
  document.getElementById('theme-options').innerHTML = THEMES.map(t => `
    <div class="theme-opt ${t.id === current ? 'active' : ''}" onclick="setTheme('${t.id}')">
      <div class="theme-swatch">
        <span class="theme-dot ${t.dot}1"></span>
        <span class="theme-dot ${t.dot}2"></span>
        <span class="theme-dot ${t.dot}3"></span>
      </div>
      ${t.name}
    </div>`).join('');
  document.getElementById('theme-modal').classList.remove('hidden');
}
function setTheme(id) {
  document.documentElement.setAttribute('data-theme', id);
  DataManager.saveSettings({ theme: id });
  document.getElementById('theme-modal').classList.add('hidden');
  document.querySelectorAll('.theme-opt').forEach(o => o.classList.toggle('active', o.textContent.includes(THEMES.find(t => t.id === id).name)));
}

async function exportAllData() {
  const backup = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('dt_')) backup[key] = localStorage.getItem(key);
  }
  // Include images as base64
  try {
    const images = await ImageStore.getAll();
    if (images.length > 0) {
      backup['__images__'] = images.map(img => ({
        id: img.id, diaryDate: img.diaryDate, originalName: img.originalName,
        type: img.type, data: arrayBufferToBase64(img.data), createdAt: img.createdAt,
      }));
    }
  } catch(e) { /* images optional */ }

  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `daily-tracker-backup-${todayStr()}.json`;
  a.click(); URL.revokeObjectURL(url);
  alert('数据已导出！包含打卡、日记、分账和图片。');
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function importAllData() {
  const file = document.getElementById('import-file-input').files[0];
  if (!file) return;
  if (!confirm('导入将覆盖当前全部数据，确定继续？')) { document.getElementById('import-file-input').value = ''; return; }
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const backup = JSON.parse(e.target.result);

      // Clear current dt_ data
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('dt_')) keysToRemove.push(key);
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));

      // Restore localStorage
      const imagesData = backup['__images__'];
      delete backup['__images__'];
      Object.entries(backup).forEach(([key, value]) => {
        if (key.startsWith('dt_')) localStorage.setItem(key, value);
      });

      // Restore images
      if (imagesData && imagesData.length > 0) {
        await ImageStore.clearAll();
        const store = (await (() => new Promise((resolve, reject) => {
          const req = indexedDB.open('dt_images', 1);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        }))()).transaction('images', 'readwrite').objectStore('images');

        for (const img of imagesData) {
          await new Promise((resolve) => {
            const record = { ...img, data: base64ToArrayBuffer(img.data) };
            store.add(record).onsuccess = resolve;
          });
        }
      }

      alert('数据已恢复！页面将重新加载。');
      location.reload();
    } catch (err) { alert('导入失败：' + err.message); }
  };
  reader.readAsText(file);
  document.getElementById('import-file-input').value = '';
}

async function exportDiary() {
  const backup = {};
  // Diaries
  const diaries = DataManager._load('diaries') || [];
  if (diaries.length > 0) backup.diaries = diaries;

  // Images for diaries
  try {
    const images = await ImageStore.getAll();
    if (images.length > 0) {
      backup.images = images.map(img => ({
        id: img.id, diaryDate: img.diaryDate, originalName: img.originalName,
        type: img.type, data: arrayBufferToBase64(img.data), createdAt: img.createdAt,
      }));
    }
  } catch(e) {}

  if (!backup.diaries && !backup.images) { alert('没有日记数据可导出'); return; }

  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `diary-backup-${todayStr()}.json`;
  a.click(); URL.revokeObjectURL(url);
  alert('日记已导出！包含文字和图片。');
}

async function importDiary() {
  const file = document.getElementById('import-diary-input').files[0];
  if (!file) return;
  if (!confirm('导入将覆盖当前日记数据，确定继续？')) { document.getElementById('import-diary-input').value = ''; return; }
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const backup = JSON.parse(e.target.result);

      // Restore diaries
      if (backup.diaries) DataManager._save('diaries', backup.diaries);

      // Restore images
      if (backup.images && backup.images.length > 0) {
        // Remove old images for imported dates
        const importedDates = new Set(backup.images.map(i => i.diaryDate));
        const existingImages = await ImageStore.getAll();
        for (const img of existingImages) {
          if (importedDates.has(img.diaryDate)) await ImageStore.remove(img.id);
        }
        // Add new images
        const store = (await (() => new Promise((resolve, reject) => {
          const req = indexedDB.open('dt_images', 1);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        }))()).transaction('images', 'readwrite').objectStore('images');

        for (const img of backup.images) {
          await new Promise((resolve) => {
            store.add({ ...img, data: base64ToArrayBuffer(img.data) }).onsuccess = resolve;
          });
        }
      }

      alert('日记已恢复！');
      renderDiary();
    } catch (err) { alert('导入失败：' + err.message); }
  };
  reader.readAsText(file);
  document.getElementById('import-diary-input').value = '';
}

function deleteSplitBill(id) {
  if (!confirm('删除这条账单？')) return;
  let bills = SplitData.getBills();
  bills = bills.filter(b => b.id !== id);
  SplitData.saveBills(bills);
  renderSplit();
}

function exportSplitExcel() {
  const users = SplitData.getUsers();
  const bills = SplitData.getBills();
  if (bills.length === 0) return;

  const userMap = {};
  users.forEach(u => { userMap[u.id] = u.name; });

  // Calculate balances
  const balances = {};
  users.forEach(u => { balances[u.id] = { paid: 0, share: 0 }; });
  bills.forEach(b => {
    const n = b.participants.length || 1;
    if (balances[b.payerId]) balances[b.payerId].paid += b.amount;
    b.participants.forEach(pid => {
      if (balances[pid]) balances[pid].share += b.amount / n;
    });
  });

  // Build CSV
  let csv = '日期,说明,金额,付款人,参与人,人均\n';
  bills.forEach(b => {
    const n = b.participants.length || 1;
    csv += `${b.date || ''},${(b.desc || '').replace(/,/g, '，')},${b.amount.toFixed(2)},${userMap[b.payerId] || ''},${b.participants.map(p => userMap[p] || '').join('、')},${(b.amount / n).toFixed(2)}\n`;
  });

  csv += '\n成员,已付,应摊,净额\n';
  users.forEach(u => {
    const bal = balances[u.id];
    const net = bal.paid - bal.share;
    csv += `${u.name},${bal.paid.toFixed(2)},${bal.share.toFixed(2)},${net >= 0 ? '+' : ''}${net.toFixed(2)}\n`;
  });

  const blob = new Blob(['﻿' + csv], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `分账记录_${todayStr()}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}

// ========== Init ==========
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  document.getElementById('checkin-filter').addEventListener('input', renderCheckin);
  document.getElementById('btn-clear-search').addEventListener('click', clearSearch);
  document.getElementById('btn-expand-all').addEventListener('click', toggleExpandAll);
  document.getElementById('btn-filter-checked').addEventListener('click', toggleFilterChecked);
  document.getElementById('btn-manage').addEventListener('click', showManageModal);
  document.getElementById('btn-manage-close').addEventListener('click', hideManageModal);
  document.getElementById('btn-add-item').addEventListener('click', showAddItemModal);
  document.getElementById('btn-modal-cancel').addEventListener('click', hideAddItemModal);
  document.getElementById('btn-modal-save').addEventListener('click', addNewItem);
  document.getElementById('btn-add-group').addEventListener('click', showGroupModal);
  document.getElementById('btn-group-cancel').addEventListener('click', hideGroupModal);
  document.getElementById('btn-group-save').addEventListener('click', addNewGroup);
  document.getElementById('diary-content').addEventListener('input', onDiaryInput);
  const dropZone = document.getElementById('diary-images');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); handleImageUpload(e.dataTransfer.files); });
  dropZone.addEventListener('click', () => {
    document.getElementById('diary-file-input').click();
  });
  document.getElementById('btn-ai-summary').addEventListener('click', generateAISummary);
  document.getElementById('btn-diary-ai').addEventListener('click', generateDiaryAISummary);
  document.getElementById('stats-item-filter').addEventListener('change', renderStats);
  document.getElementById('stats-date-from').addEventListener('change', renderStats);
  document.getElementById('stats-date-to').addEventListener('change', renderStats);
  document.getElementById('hist-from').addEventListener('change', applyHistoryFilters);
  document.getElementById('hist-to').addEventListener('change', applyHistoryFilters);
  document.getElementById('hist-item').addEventListener('change', applyHistoryFilters);
  document.getElementById('btn-export-csv').addEventListener('click', exportHistoryCSV);
  document.getElementById('new-item-name').addEventListener('keydown', e => { if (e.key === 'Enter') addNewItem(); });
  document.getElementById('new-group-name').addEventListener('keydown', e => { if (e.key === 'Enter') addNewGroup(); });

  // Split
  document.getElementById('btn-split-add-user').addEventListener('click', addSplitUser);
  document.getElementById('split-user-name').addEventListener('keydown', e => { if (e.key === 'Enter') addSplitUser(); });
  document.getElementById('btn-add-bill').addEventListener('click', () => showSplitBillModal(null));
  document.getElementById('btn-split-bill-cancel').addEventListener('click', hideSplitBillModal);
  document.getElementById('btn-split-bill-save').addEventListener('click', saveSplitBill);
  document.getElementById('btn-export-split').addEventListener('click', exportSplitExcel);

  // Theme
  document.getElementById('btn-theme').addEventListener('click', showThemeModal);
  document.getElementById('btn-theme-close').addEventListener('click', () => document.getElementById('theme-modal').classList.add('hidden'));

  // Backup
  document.getElementById('btn-export-all').addEventListener('click', exportAllData);
  document.getElementById('btn-import-all').addEventListener('click', () => document.getElementById('import-file-input').click());
  document.getElementById('import-file-input').addEventListener('change', importAllData);

  // Diary export/import
  document.getElementById('btn-export-diary').addEventListener('click', exportDiary);
  document.getElementById('btn-import-diary').addEventListener('click', () => document.getElementById('import-diary-input').click());
  document.getElementById('import-diary-input').addEventListener('change', importDiary);

  // Load saved theme
  const savedTheme = DataManager.getSettings().theme;
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

  switchTab('checkin');

  // Close group menus on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.group-menu-wrap')) {
      document.querySelectorAll('.group-dropdown').forEach(d => d.classList.add('hidden'));
    }
  });
});