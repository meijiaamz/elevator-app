/**
 * 故障报修模块
 * - 记录师傅在微信群报修的故障，归档到具体设备
 * - 统计：单台电梯故障档案、故障类型分布、师傅工作量
 * - 数据存独立的云端 bin（与设备数据分开，避免挤爆设备库 100KB 配额）
 */

const FaultManager = {
  BIN_ID: '6af671e2ffd5d16053bd99f4',
  STORAGE_KEY: 'elevator_faults',
  TYPES: ['困人', '关门不走', '门刀/门锁', '异响/抖动', '平层不准', '按钮/显示', '电气/控制', '其他'],
  faults: [],
  syncedAt: '',
  _filter: { month: '', type: '', handler: '', reg: '', keyword: '' },
  _loaded: false,

  async load() {
    let local = null;
    try { local = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || 'null'); } catch (e) { local = null; }
    let cloud = null;
    try {
      const resp = await fetch('https://api.jsonbin.io/v3/b/' + this.BIN_ID + '/latest?t=' + Date.now());
      if (resp.ok) {
        const j = await resp.json();
        cloud = j.record || null;
      }
    } catch (e) {
      console.warn('故障数据云端读取失败:', e.message);
    }
    const lt = local && local.syncedAt ? new Date(local.syncedAt).getTime() : 0;
    const ct = cloud && cloud.syncedAt ? new Date(cloud.syncedAt).getTime() : 0;
    if (cloud && ct >= lt) {
      this.faults = Array.isArray(cloud.faults) ? cloud.faults : [];
      this.syncedAt = cloud.syncedAt || '';
    } else if (local) {
      this.faults = Array.isArray(local.faults) ? local.faults : [];
      this.syncedAt = local.syncedAt || '';
    }
    this._sort();
    this._persistLocal();
    this._loaded = true;
    return this.faults;
  },

  _sort() {
    this.faults.sort((a, b) => {
      const d = String(b.d || '').localeCompare(String(a.d || ''));
      if (d !== 0) return d;
      return String(b.ct || '').localeCompare(String(a.ct || ''));
    });
  },

  _persistLocal() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ faults: this.faults, syncedAt: this.syncedAt }));
    } catch (e) {
      console.warn('故障数据本地保存失败:', e.message);
    }
  },

  async save() {
    this.syncedAt = new Date().toISOString();
    this._persistLocal();
    if (!DataManager._cloudKey) return false;
    const payload = JSON.stringify({ faults: this.faults, syncedAt: this.syncedAt });
    const bytes = new TextEncoder().encode(payload).length;
    if (bytes > 100000) {
      showToast('故障记录已达云端容量上限（' + Math.round(bytes / 1024) + 'KB），请先导出备份再清理旧记录', 'error');
      return false;
    }
    const resp = await fetch('https://api.jsonbin.io/v3/b/' + this.BIN_ID, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': DataManager._cloudKey },
      body: payload
    });
    if (!resp.ok) throw new Error('云端保存失败 ' + resp.status);
    return true;
  },

  add(data) {
    const now = new Date().toISOString();
    const f = {
      id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      d: data.d || fmtToday(),
      t: data.t || '其他',
      reg: data.reg || '',
      h: data.h || '',
      st: data.st ? 1 : 0,
      n: data.n || '',
      ct: now
    };
    this.faults.unshift(f);
    this._sort();
    return f;
  },

  update(id, data) {
    const f = this.faults.find(x => x.id === id);
    if (!f) return null;
    f.d = data.d || f.d;
    f.t = data.t || f.t;
    f.reg = data.reg || f.reg;
    f.h = data.h || '';
    f.st = data.st ? 1 : 0;
    f.n = data.n || '';
    this._sort();
    return f;
  },

  remove(id) {
    const i = this.faults.findIndex(x => x.id === id);
    if (i >= 0) this.faults.splice(i, 1);
  },

  byDevice(reg) {
    return this.faults.filter(f => f.reg === reg);
  },

  deviceInfo(reg) {
    const d = (DataManager.devices || []).find(x => x.reg_code === reg);
    return d ? { unit_name: d.unit_name || reg, district: d.district || '' } : { unit_name: '(设备已删除) ' + reg, district: '' };
  },

  /** 当前筛选条件下的记录 */
  filtered() {
    const f = this._filter;
    return this.faults.filter(it => {
      if (f.month && String(it.d || '').slice(0, 7) !== f.month) return false;
      if (f.type && it.t !== f.type) return false;
      if (f.handler && it.h !== f.handler) return false;
      if (f.reg && it.reg !== f.reg) return false;
      if (f.keyword) {
        const kw = f.keyword.toLowerCase();
        const info = this.deviceInfo(it.reg);
        const hay = (it.n || '') + ' ' + (it.h || '') + ' ' + info.unit_name + ' ' + it.reg + ' ' + (it.t || '');
        if (hay.toLowerCase().indexOf(kw) === -1) return false;
      }
      return true;
    });
  }
};

// ===== 工具 =====
function fmtToday() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== 渲染 =====
function renderFaultTab() {
  const box = document.getElementById('faultContent');
  if (!box) return;
  if (!FaultManager._loaded) {
    box.innerHTML = '<div class="fault-card">正在加载故障记录...</div>';
    FaultManager.load().then(renderFaultTab).catch(e => {
      box.innerHTML = '<div class="fault-card">故障记录加载失败：' + escHtml(e.message) + '</div>';
    });
    return;
  }
  const all = FaultManager.faults;
  const month = fmtToday().slice(0, 7);
  const thisMonth = all.filter(f => String(f.d || '').slice(0, 7) === month);
  const pending = all.filter(f => !f.st);
  const done = all.filter(f => f.st);
  const devCount = new Set(all.map(f => f.reg)).size;

  // 类型分布
  const typeCount = {};
  all.forEach(f => { const k = f.t || '其他'; typeCount[k] = (typeCount[k] || 0) + 1; });
  const typeArr = Object.keys(typeCount).map(k => ({ k, v: typeCount[k] })).sort((a, b) => b.v - a.v);
  const typeMax = typeArr.length ? typeArr[0].v : 1;

  // 师傅工作量
  const hCount = {}, hDone = {};
  all.forEach(f => {
    const k = f.h || '未填写';
    hCount[k] = (hCount[k] || 0) + 1;
    if (f.st) hDone[k] = (hDone[k] || 0) + 1;
  });
  const hArr = Object.keys(hCount).map(k => ({ k, v: hCount[k], d: hDone[k] || 0 })).sort((a, b) => b.v - a.v);
  const hMax = hArr.length ? hArr[0].v : 1;

  // 高频故障设备
  const devCountMap = {};
  all.forEach(f => { devCountMap[f.reg] = (devCountMap[f.reg] || 0) + 1; });
  const devArr = Object.keys(devCountMap).map(k => ({ reg: k, v: devCountMap[k] })).sort((a, b) => b.v - a.v).slice(0, 10);

  // 记录表
  const list = FaultManager.filtered();
  const handlers = [...new Set(all.map(f => f.h).filter(Boolean))];

  box.innerHTML =
    '<div class="fault-head">' +
      '<div><h3>故障报修登记</h3><p>师傅在群里报修后在这里登记一条，系统自动归到对应设备档案，维保检查时可回看这台梯的历史故障。</p></div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-primary" onclick="openFaultModal()">+ 登记报修</button>' +
        '<button class="btn btn-success" onclick="exportFaultStatsImage()">导出统计图片</button>' +
      '</div>' +
    '</div>' +
    '<div id="faultStatsArea">' +
      '<div class="fault-stats">' +
        '<div class="fault-stat"><div class="num">' + thisMonth.length + '</div><div class="lbl">本月报修（' + month + '）</div></div>' +
        '<div class="fault-stat warn"><div class="num">' + pending.length + '</div><div class="lbl">待处理</div></div>' +
        '<div class="fault-stat ok"><div class="num">' + done.length + '</div><div class="lbl">已处理</div></div>' +
        '<div class="fault-stat gray"><div class="num">' + devCount + '</div><div class="lbl">累计涉及设备</div></div>' +
      '</div>' +
      '<div class="fault-grid">' +
        '<div class="fault-card"><h4>故障类型分布 <span>共 ' + all.length + ' 条</span></h4>' + renderBars(typeArr, typeMax, '暂无记录') + '</div>' +
        '<div class="fault-card"><h4>师傅工作量 <span>处理 / 报修</span></h4>' + renderHandlerBars(hArr, hMax) + '</div>' +
      '</div>' +
      '<div class="fault-card" style="margin-bottom:16px"><h4>高频故障设备 Top 10 <span>点击查看该设备档案</span></h4>' + renderTopDevices(devArr) + '</div>' +
    '</div>' +
    '<div class="fault-toolbar">' +
      '<select onchange="setFaultFilter(\'month\', this.value)">' + monthOptions(all) + '</select>' +
      '<select onchange="setFaultFilter(\'type\', this.value)">' + typeOptions(all) + '</select>' +
      '<select onchange="setFaultFilter(\'handler\', this.value)">' + handlerOptions(handlers) + '</select>' +
      '<input type="text" placeholder="搜索单位 / 注册代码 / 描述" value="' + escHtml(FaultManager._filter.keyword) + '" oninput="setFaultFilter(\'keyword\', this.value)">' +
      '<span style="color:#95a5a6;font-size:13px">共 ' + list.length + ' 条</span>' +
    '</div>' +
    '<div class="fault-table-wrap">' + renderFaultTable(list) + '</div>';
}

function renderBars(arr, max, emptyText) {
  if (!arr.length) return '<div class="fault-empty">' + emptyText + '</div>';
  return arr.slice(0, 8).map((it, i) =>
    '<div class="fbar' + (i === 0 ? ' top' : '') + '">' +
      '<span title="' + escHtml(it.k) + '">' + escHtml(it.k) + '</span>' +
      '<span class="track"><span class="fill" style="width:' + Math.round(it.v / max * 100) + '%"></span></span>' +
      '<span class="val">' + it.v + '</span>' +
    '</div>'
  ).join('');
}

function renderHandlerBars(arr, max) {
  if (!arr.length) return '<div class="fault-empty">暂无记录</div>';
  return arr.slice(0, 8).map(it =>
    '<div class="fbar">' +
      '<span title="' + escHtml(it.k) + '">' + escHtml(it.k) + '</span>' +
      '<span class="track"><span class="fill" style="width:' + Math.round(it.v / max * 100) + '%"></span></span>' +
      '<span class="val">' + it.d + '/' + it.v + '</span>' +
    '</div>'
  ).join('');
}

function renderTopDevices(arr) {
  if (!arr.length) return '<div class="fault-empty">暂无记录</div>';
  return '<div style="display:flex;flex-wrap:wrap;gap:8px">' + arr.map((it, i) => {
    const info = FaultManager.deviceInfo(it.reg);
    return '<button class="link-btn" style="border:1px solid #e6ebef;border-radius:8px;padding:7px 11px;background:#fafcfe" onclick="setFaultFilter(\'reg\',\'' + escHtml(it.reg) + '\');scrollToFaultTable()">' +
      '<b style="color:#2c3e50">' + (i + 1) + '. ' + escHtml(info.unit_name) + '</b>' +
      '<span style="color:#e67e22;margin-left:8px">' + it.v + ' 次</span>' +
      (info.district ? '<span style="color:#95a5a6;margin-left:6px;font-size:12px">' + escHtml(info.district) + '</span>' : '') +
    '</button>';
  }).join('') + '</div>';
}

function monthOptions(all) {
  const months = [...new Set(all.map(f => String(f.d || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  let html = '<option value="">全部月份</option>';
  months.forEach(m => {
    html += '<option value="' + m + '"' + (FaultManager._filter.month === m ? ' selected' : '') + '>' + m + '</option>';
  });
  return html;
}

function typeOptions(all) {
  const types = [...new Set(all.map(f => f.t).filter(Boolean))];
  let html = '<option value="">全部类型</option>';
  FaultManager.TYPES.forEach(t => {
    if (types.indexOf(t) === -1) return;
    html += '<option value="' + escHtml(t) + '"' + (FaultManager._filter.type === t ? ' selected' : '') + '>' + escHtml(t) + '</option>';
  });
  return html;
}

function handlerOptions(handlers) {
  let html = '<option value="">全部师傅</option>';
  handlers.forEach(h => {
    html += '<option value="' + escHtml(h) + '"' + (FaultManager._filter.handler === h ? ' selected' : '') + '>' + escHtml(h) + '</option>';
  });
  return html;
}

function renderFaultTable(list) {
  if (!list.length) {
    return '<div class="fault-empty" style="padding:28px 0">暂无报修记录' +
      (FaultManager._filter.reg || FaultManager._filter.keyword ? '（当前筛选条件下）' : '，点右上角“登记报修”开始记录') + '</div>';
  }
  const rows = list.map(f => {
    const info = FaultManager.deviceInfo(f.reg);
    return '<tr>' +
      '<td style="white-space:nowrap">' + escHtml(f.d) + '</td>' +
      '<td><b>' + escHtml(info.unit_name) + '</b>' + (info.district ? '<div style="color:#95a5a6;font-size:12px">' + escHtml(info.district) + '</div>' : '') + '</td>' +
      '<td class="code">' + escHtml(f.reg) + '</td>' +
      '<td><span class="ftag">' + escHtml(f.t) + '</span></td>' +
      '<td>' + (f.h ? escHtml(f.h) : '<span style="color:#c0c7cc">未填</span>') + '</td>' +
      '<td><span class="ftag ' + (f.st ? 'done' : 'pending') + '">' + (f.st ? '已处理' : '待处理') + '</span></td>' +
      '<td class="note-cell">' + (f.n ? escHtml(f.n) : '<span style="color:#c0c7cc">—</span>') + '</td>' +
      '<td><div class="fault-actions">' +
        '<button class="link-btn" onclick="openFaultModal(\'' + f.id + '\')">编辑</button>' +
        '<button class="link-btn" onclick="toggleFaultStatus(\'' + f.id + '\')">' + (f.st ? '改待处理' : '标记已处理') + '</button>' +
        '<button class="link-btn danger" onclick="deleteFault(\'' + f.id + '\')">删除</button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
  return '<table class="fault-table"><thead><tr>' +
    '<th style="width:96px">报修日期</th><th>使用单位</th><th style="width:150px">注册代码</th>' +
    '<th style="width:100px">故障类型</th><th style="width:80px">处理师傅</th><th style="width:80px">状态</th>' +
    '<th>描述 / 处理情况</th><th style="width:150px">操作</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function setFaultFilter(key, val) {
  FaultManager._filter[key] = val;
  if (key === 'reg' && val) {
    FaultManager._filter.month = '';
    FaultManager._filter.type = '';
    FaultManager._filter.handler = '';
    FaultManager._filter.keyword = '';
  }
  renderFaultTab();
}

function scrollToFaultTable() {
  const el = document.querySelector('.fault-toolbar');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ===== 表单 =====
function openFaultModal(id) {
  const isEdit = !!id;
  const f = isEdit ? FaultManager.faults.find(x => x.id === id) : null;
  document.getElementById('faultModalTitle').textContent = isEdit ? '编辑报修记录' : '登记故障报修';
  document.getElementById('faultEditId').value = isEdit ? id : '';

  // 设备输入框：默认带出当前筛选的设备
  const regInput = document.getElementById('faultDeviceInput');
  regInput.value = f ? (FaultManager.deviceInfo(f.reg).unit_name + ' · ' + f.reg) : '';
  const dl = document.getElementById('faultDeviceList');
  dl.innerHTML = (DataManager.devices || []).map(d =>
    '<option value="' + escHtml((d.unit_name || '') + ' · ' + d.reg_code) + '">' + escHtml((d.district || '') + ' ' + (d.address || '')) + '</option>'
  ).join('');

  // 师傅候选
  const hdl = document.getElementById('faultHandlerList');
  hdl.innerHTML = [...new Set(FaultManager.faults.map(x => x.h).filter(Boolean))]
    .map(h => '<option value="' + escHtml(h) + '"></option>').join('');

  document.getElementById('faultDate').value = f ? f.d : fmtToday();
  document.getElementById('faultType').innerHTML = FaultManager.TYPES
    .map(t => '<option value="' + escHtml(t) + '"' + (f && f.t === t ? ' selected' : '') + '>' + escHtml(t) + '</option>').join('');
  document.getElementById('faultHandler').value = f ? (f.h || '') : '';
  document.getElementById('faultStatus').value = f ? (f.st ? '1' : '0') : '0';
  document.getElementById('faultNote').value = f ? (f.n || '') : '';
  document.getElementById('faultFormError').textContent = '';
  document.getElementById('faultModal').classList.add('show');
}

function closeFaultModal() {
  document.getElementById('faultModal').classList.remove('show');
}

async function submitFaultForm() {
  const errEl = document.getElementById('faultFormError');
  const id = document.getElementById('faultEditId').value;
  const raw = document.getElementById('faultDeviceInput').value.trim();
  const date = document.getElementById('faultDate').value;
  const type = document.getElementById('faultType').value;
  const handler = document.getElementById('faultHandler').value.trim();
  const status = document.getElementById('faultStatus').value === '1';
  const note = document.getElementById('faultNote').value.trim();

  // 解析设备：支持 "单位名 · 注册代码" 或直接输入注册代码
  let reg = '';
  if (raw) {
    if (raw.indexOf('·') !== -1) {
      reg = raw.split('·').pop().trim();
    } else if (/^[0-9A-Za-z]{8,}$/.test(raw)) {
      reg = raw;
    } else {
      const hit = (DataManager.devices || []).find(d => (d.unit_name || '') === raw);
      if (hit) reg = hit.reg_code;
    }
    if (!reg || !(DataManager.devices || []).some(d => d.reg_code === reg)) {
      errEl.textContent = '没找到这台设备，请从输入框的下拉提示里选择';
      return;
    }
  } else {
    errEl.textContent = '请选择报修设备';
    return;
  }
  if (!date) { errEl.textContent = '请选择报修日期'; return; }

  if (id) {
    FaultManager.update(id, { d: date, t: type, reg, h: handler, st: status, n: note });
  } else {
    FaultManager.add({ d: date, t: type, reg, h: handler, st: status, n: note });
  }
  closeFaultModal();
  renderFaultTab();
  try {
    const ok = await FaultManager.save();
    if (ok) showToast('已保存并同步云端', 'success');
    else showToast('已保存到本地（未配置云端写入权限）', 'warning');
  } catch (e) {
    showToast('已保存本地，云端同步失败：' + e.message, 'error');
  }
}

function toggleFaultStatus(id) {
  const f = FaultManager.faults.find(x => x.id === id);
  if (!f) return;
  f.st = f.st ? 0 : 1;
  renderFaultTab();
  FaultManager.save().then(() => showToast(f.st ? '已标记为已处理' : '已改回待处理', 'success'))
    .catch(e => showToast('云端同步失败：' + e.message, 'error'));
}

function deleteFault(id) {
  const f = FaultManager.faults.find(x => x.id === id);
  if (!f) return;
  const info = FaultManager.deviceInfo(f.reg);
  if (!confirm('确认删除这条报修记录？\n\n' + f.d + ' ' + info.unit_name + ' ' + f.t)) return;
  FaultManager.remove(id);
  renderFaultTab();
  FaultManager.save().then(() => showToast('已删除', 'success'))
    .catch(e => showToast('云端同步失败：' + e.message, 'error'));
}

// ===== 导出统计图片 =====
function exportFaultStatsImage() {
  const el = document.getElementById('faultStatsArea');
  if (!el) return;
  if (typeof html2canvas !== 'function') {
    showToast('图片组件未加载，请刷新页面后重试', 'error');
    return;
  }
  showToast('正在生成图片...', 'info');
  html2canvas(el, { scale: 2, backgroundColor: '#f4f6f8', useCORS: true }).then(canvas => {
    const a = document.createElement('a');
    a.download = '故障统计_' + fmtToday() + '.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
    showToast('图片已生成', 'success');
  }).catch(e => showToast('生成失败：' + e.message, 'error'));
}
