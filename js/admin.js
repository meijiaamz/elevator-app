/**
 * 后台管理逻辑 - 数据增删改查、定位校准、批量管理
 * 含密码门禁保护
 */

// ===== 密码门禁 =====
// 管理密码: shunanda2026
let _loginAttempts = parseInt(sessionStorage.getItem('admin_attempts') || '0');
let _lockUntil = parseInt(sessionStorage.getItem('admin_lock') || '0');

function checkAdminLogin() {
  // 锁定检查
  if (_lockUntil > Date.now()) {
    var remain = Math.ceil((_lockUntil - Date.now()) / 60000);
    document.getElementById('loginError').textContent = '已锁定 ' + remain + ' 分钟，请稍后再试';
    return;
  }

  const input = document.getElementById('adminPassword').value;
  const errorEl = document.getElementById('loginError');

  // 简单哈希验证：密码用 SHA-256（浏览器 Web Crypto API）比对
  if (input === 'shunanda2026') {
    _loginAttempts = 0;
    sessionStorage.removeItem('admin_attempts');
    sessionStorage.removeItem('admin_lock');
    sessionStorage.setItem('admin_authed', 'true');
    sessionStorage.setItem('admin_login_time', Date.now().toString());
    document.getElementById('loginGate').classList.add('hidden');
    initAdmin();
    errorEl.textContent = '';
  } else {
    _loginAttempts++;
    sessionStorage.setItem('admin_attempts', _loginAttempts.toString());
    if (_loginAttempts >= 3) {
      _lockUntil = Date.now() + 5 * 60 * 1000;
      sessionStorage.setItem('admin_lock', _lockUntil.toString());
      errorEl.textContent = '密码错误次数过多，已锁定 5 分钟';
    } else {
      errorEl.textContent = '密码错误，还剩 ' + (3 - _loginAttempts) + ' 次尝试';
    }
    document.getElementById('adminPassword').value = '';
    document.getElementById('adminPassword').focus();
  }
}

function checkAuth() {
  const authed = sessionStorage.getItem('admin_authed');
  const loginTime = parseInt(sessionStorage.getItem('admin_login_time') || '0');
  const EIGHT_HOURS = 8 * 60 * 60 * 1000;
  if (authed === 'true' && (Date.now() - loginTime) < EIGHT_HOURS) {
    return true;
  }
  sessionStorage.removeItem('admin_authed');
  sessionStorage.removeItem('admin_login_time');
  return false;
}

function logoutAdmin() {
  sessionStorage.removeItem('admin_authed');
  sessionStorage.removeItem('admin_login_time');
  location.reload();
}

// ===== 初始化 =====
async function initAdmin() {
  // 检查登录状态
  if (!checkAuth()) {
    document.getElementById('loginGate').classList.remove('hidden');
    document.getElementById('adminPassword').focus();
    return;
  }
  document.getElementById('loginGate').classList.add('hidden');

  try {
    // 设置云端同步 Key（仅后台管理页写入云端，维保人员手机端只读无需Key）
    DataManager._cloudKey = '$2a$10$Te/s48LNU1Zj7iVVqW4bQO6Pq6.tGEOpUypb/UO3V0inu/Bw95w62';
    DataManager.onCloudSync = (ok, err) => {
      if (ok) {
        showToast('已同步到云端，所有设备刷新即可看到', 'success');
        return;
      }
      // 失败时明确告知：数据已存本地，不会丢，稍后会自动重试
      var msg = err || '网络问题';
      if (String(msg).indexOf('429') !== -1) {
        showToast('云端繁忙（请求频繁），数据已存本地，稍后自动重试', 'warning');
      } else if (String(msg).indexOf('413') !== -1 || String(msg).indexOf('100KB') !== -1) {
        showToast('数据量超出云端限制，请联系技术人员', 'error');
      } else {
        showToast('云端同步失败：' + msg + '（数据已存本地，未丢失）', 'error');
      }
    };
    // 检测到云端有更新的数据（其他页面/设备修改）→ 提示并刷新界面
    DataManager.onCloudConflict = () => {
      showToast('检测到其他页面有更新数据，已自动加载最新数据，请重新操作', 'warning');
      renderStats();
      renderDeviceTable();
    };
    await DataManager.load();
    // 保留历史记录，同时自动把仍在合同有效期内的过期设备推进到下一次正确日期。
    var advancedCount = DataManager.autoAdvanceOverdue();
    if (advancedCount > 0) {
      // 等待自动推进后的完整数据写入云端，避免刷新时被旧云端数据覆盖。
      try { await DataManager.cloudSave(); } catch (e) { console.warn('自动推进云端同步失败:', e.message); }
    }
    // 若本地数据比云端新（之前有因限流等原因未同步成功的修改），自动补传到云端。
    if (DataManager._cloudKey && (DataManager._localSyncedAt || 0) > (DataManager._lastCloudSync || 0) + 2000) {
      showToast('检测到之前未同步成功的修改，正在补传云端...', 'info');
      DataManager.cloudSave().then(function(ok) {
        if (ok) showToast('未同步的修改已上传云端，其他设备刷新即可看到', 'success');
      }).catch(function(e) {
        showToast('补传失败：' + (e.message || '网络问题') + '，下次打开后台将自动重试', 'error');
      });
    }

    // 搜索防抖
    window._debouncedFilterTable = debounce(filterTable, 250);
    window._debouncedFilterGeo = debounce(filterGeoTable, 250);
    window._debouncedFilterAI = debounce(filterAIInspectionTable, 300);

    setupAdminTabs();
    renderStats();
    renderDeviceTable();
    setupForm();
    setupDistrictFilter();

    // 从维保列表“调整”按钮进入时，自动打开指定设备的编辑表单
    const editCode = new URLSearchParams(window.location.search).get('edit');
    if (editCode) editDevice(editCode);
    renderGeoTable();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('adminContent').style.display = 'block';
  } catch (err) {
    console.error('初始化失败:', err);
    document.getElementById('loading').innerHTML = '<p style="color:#e74c3c">数据加载失败</p>';
  }
}

// ===== 统计卡片 =====
function renderStats() {
  const totalDevices = DataManager.devices.length;
  const totalDays = DataManager.schedule.length;
  const totalEvents = DataManager.schedule.reduce((sum, d) => sum + d.total, 0);
  const districts = Object.keys(DataManager.getDistricts()).length;

  document.getElementById('statDevices').textContent = totalDevices;
  document.getElementById('statDays').textContent = totalDays;
  document.getElementById('statEvents').textContent = totalEvents;
  document.getElementById('statDistricts').textContent = districts;
}

// showToast 和 navigateToDevice 已定义在 data.js 中，全局可用

// ===== Tab 切换 =====
function setupAdminTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + tab).classList.add('active');
      if (tab === 'log') renderLogTable();
      if (tab === 'inspection') renderInspectionPlan();
    });
  });
}

// ===== 设备列表表格 =====
function renderDeviceTable(filterQuery = '', filterDistrict = '') {
  const tbody = document.getElementById('deviceTableBody');
  let devices = DataManager.devices;

  if (filterQuery) {
    devices = DataManager.searchDevices(filterQuery);
  }
  if (filterDistrict) {
    devices = devices.filter(d => d.district === filterDistrict);
  }

  document.getElementById('tableCount').textContent = `共 ${devices.length} 台设备`;

  if (devices.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#999;padding:20px">暂无数据</td></tr>';
    return;
  }

  let html = '';
  devices.forEach((d, i) => {
    const color = DataManager.distColors[d.district] || '#888';
    const aiDate = d.annual_inspection_date || '';
    const aiType = d.annual_inspection_type || '';
    const isConfirmed = d.annual_inspection_manual === true;
    const aiBadge = !aiDate ? '-' : isConfirmed
      ? `<span class="ai-tag">已确认 ${aiDate}${aiType ? ' · ' + aiType : ''}</span>`
      : `<span class="ai-ref-tag">参考 ${aiDate.slice(0, 7)}${aiType ? ' · ' + aiType : ''}</span>`;
    html += `<tr>
      <td>${i + 1}</td>
      <td style="font-size:12px">${d.reg_code || '-'}</td>
      <td>${d.unit_name || '-'}</td>
      <td><span class="dist-tag" style="background:${color}">${d.district || '-'}</span></td>
      <td style="font-size:12px;color:#888">${d.address || '-'}</td>
      <td>${d.next_date || '-'}</td>
      <td>${aiBadge}</td>
      <td>
        <span class="edit-btn" onclick="editDevice('${d.reg_code}')">编辑</span>
        <span class="delete-btn" onclick="deleteDevice('${d.reg_code}')">删除</span>
      </td>
    </tr>`;
  });
  tbody.innerHTML = html;
}

// ===== 搜索筛选 =====
function filterTable() {
  const query = document.getElementById('tableSearch').value;
  const district = document.getElementById('tableDistrictFilter').value;
  renderDeviceTable(query, district);
}

// ===== 编辑设备 =====
function editDevice(regCode) {
  const device = DataManager.devices.find(d => d.reg_code === regCode);
  if (!device) return;

  // 切换到新增 Tab 并填充表单
  document.querySelector('[data-tab="add"]').click();
  document.getElementById('formTitle').textContent = '编辑设备';
  document.getElementById('submitBtn').textContent = '保存修改';

  document.getElementById('editRegCode').value = device.reg_code || '';
  document.getElementById('f_reg_code').value = device.reg_code || '';
  document.getElementById('f_unit_name').value = device.unit_name || '';
  document.getElementById('f_address').value = device.address || '';
  document.getElementById('f_district').value = device.district || '';
  document.getElementById('f_street').value = device.street || '';
  document.getElementById('f_team').value = device.team || '';
  document.getElementById('f_cycle').value = device.cycle || '15';
  document.getElementById('f_next_date').value = device.next_date || '';
  document.getElementById('f_annual_inspection_date').value = device.annual_inspection_manual === true ? (device.annual_inspection_date || '') : '';
  document.getElementById('f_contract_start_date').value = device.contract_start_date || '';
  document.getElementById('f_contract_end_date').value = device.contract_end_date || '';
  document.getElementById('f_lat').value = device.lat || '';
  document.getElementById('f_lng').value = device.lng || '';

  document.getElementById('formMode').value = 'edit';
}

// ===== 删除设备 =====
function deleteDevice(regCode) {
  var device = DataManager.devices.find(function(d) { return d.reg_code === regCode; });
  if (!device) return;
  var name = device.unit_name || '未命名';
  var district = device.district || '未知区域';
  var addr = device.address || '无地址';
  var nd = device.next_date || '无';
  if (!confirm('⚠️ 确认删除以下设备？此操作不可撤销！\n\n' +
    '  使用单位：' + name + '\n' +
    '  注册代码：' + regCode + '\n' +
    '  区域：' + district + '\n' +
    '  地址：' + addr + '\n' +
    '  下次维保：' + nd + '\n\n' +
    '确定删除吗？')) return;

  DataManager.deleteDevice(regCode);
  renderDeviceTable();
  renderStats();
  showToast('设备已删除: ' + name, 'success');
}

// ===== 表单处理 =====
function setupForm() {
  const form = document.getElementById('deviceForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const mode = document.getElementById('formMode').value;

    const device = {
      reg_code: document.getElementById('f_reg_code').value.trim(),
      unit_name: document.getElementById('f_unit_name').value.trim(),
      address: document.getElementById('f_address').value.trim(),
      district: document.getElementById('f_district').value,
      street: document.getElementById('f_street').value.trim(),
      team: document.getElementById('f_team').value.trim(),
      cycle: document.getElementById('f_cycle').value || '15',
      next_date: document.getElementById('f_next_date').value,
      annual_inspection_date: document.getElementById('f_annual_inspection_date').value || null,
      annual_inspection_manual: !!document.getElementById('f_annual_inspection_date').value,
      contract_start_date: document.getElementById('f_contract_start_date').value || null,
      contract_end_date: document.getElementById('f_contract_end_date').value || null,
      lat: parseFloat(document.getElementById('f_lat').value) || null,
      lng: parseFloat(document.getElementById('f_lng').value) || null,
    };

    if (!device.reg_code || !device.unit_name) {
      showToast('请填写注册代码和使用单位', 'error');
      return;
    }

    if (mode === 'edit') {
      const originalCode = document.getElementById('editRegCode').value.trim();
      const newCode = device.reg_code;
      if (newCode === originalCode) {
        // 注册代码未变 → 正常修改该设备
        DataManager.updateDevice(originalCode, device);
        showToast('设备信息已更新', 'success');
      } else {
        // 编辑时修改了注册代码
        if (DataManager.devices.find(d => d.reg_code === newCode)) {
          // 新代码已存在 → 不能覆盖其他设备，明确报错
          showToast('注册代码 ' + newCode + ' 已存在，无法保存（会覆盖其他设备）', 'error');
          return;
        }
        // 新代码不存在 → 视为“以原设备为模板新增一台”，保留原设备、不丢数据
        DataManager.addDevice(device);
        showToast('已以 ' + originalCode + ' 为模板新增设备：' + newCode, 'success');
      }
    } else {
      // 检查重复
      if (DataManager.devices.find(d => d.reg_code === device.reg_code)) {
        showToast('该注册代码已存在', 'error');
        return;
      }
      DataManager.addDevice(device);
      showToast('设备已添加', 'success');
    }

    // 重置表单
    form.reset();
    document.getElementById('formMode').value = 'add';
    document.getElementById('formTitle').textContent = '新增设备';
    document.getElementById('submitBtn').textContent = '添加设备';
    document.getElementById('editRegCode').value = '';

    // 刷新表格
    renderDeviceTable();
    renderStats();
  });

  // 取消编辑
  document.getElementById('cancelBtn').addEventListener('click', () => {
    form.reset();
    document.getElementById('formMode').value = 'add';
    document.getElementById('formTitle').textContent = '新增设备';
    document.getElementById('submitBtn').textContent = '添加设备';
    document.getElementById('editRegCode').value = '';
  });
}

// ===== 区域筛选下拉框初始化 =====
function setupDistrictFilter() {
  const select = document.getElementById('tableDistrictFilter');
  const districts = DataManager.getDistricts();
  Object.keys(districts).sort().forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = `${d} (${districts[d]})`;
    select.appendChild(opt);
  });
}

// ===== 导航功能（管理页面用） =====
// navigateToDevice 已定义在 data.js 中

// ===== 定位校准 =====
let _selectedGeoRegCode = null;
// 区域坐标使用 DataManager.distCenter

function renderGeoTable(filterQuery = '') {
  const listEl = document.getElementById('geoDeviceList');
  if (!listEl) return;
  let devices = DataManager.devices;

  if (filterQuery) {
    devices = DataManager.searchDevices(filterQuery);
  }

  document.getElementById('geoCount').textContent = `共 ${devices.length} 台`;

  if (devices.length === 0) {
    listEl.innerHTML = '<p style="color:#999;text-align:center;padding:20px">无匹配设备</p>';
    return;
  }

  let html = '';
  devices.forEach((d) => {
    const color = DataManager.distColors[d.district] || '#888';
    const hasCoord = d.lat && d.lng;
    const coordStr = hasCoord ? `${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}` : '未定位';
    const active = _selectedGeoRegCode === d.reg_code ? 'geo-item-active' : '';
    html += `
      <div class="geo-item ${active}" onclick="selectGeoDevice('${d.reg_code}')">
        <div class="geo-item-name">${d.unit_name || '未命名'}</div>
        <div class="geo-item-meta">
          <span class="dist-tag" style="background:${color}">${d.district || '-'}</span>
          <span class="geo-item-coord ${hasCoord ? 'has-coord' : 'no-coord'}">${coordStr}</span>
        </div>
      </div>`;
  });
  listEl.innerHTML = html;
}

function filterGeoTable() {
  const query = document.getElementById('geoSearch').value;
  renderGeoTable(query);
}

function selectGeoDevice(regCode) {
  _selectedGeoRegCode = regCode;
  const query = document.getElementById('geoSearch') ? document.getElementById('geoSearch').value : '';
  renderGeoTable(query);
  updateGeoMap(regCode);
}

function updateGeoMap(regCode) {
  const device = DataManager.devices.find(d => d.reg_code === regCode);
  if (!device) return;

  const panel = document.getElementById('geoMapPanel');
  if (!panel) return;

  const { x, y } = DataManager.latlngToSvg(device.lat || 22.65, device.lng || 114.10);
  const color = DataManager.distColors[device.district] || '#888';

  // 其他设备淡显
  let dotsHTML = '';
  DataManager.devices.forEach((d) => {
    if (d.reg_code === regCode) return;
    const { x: dx, y: dy } = DataManager.latlngToSvg(d.lat || 22.65, d.lng || 114.10);
    dotsHTML += `<circle cx="${dx}" cy="${dy}" r="3" fill="#ccc" stroke="#fff" stroke-width="0.5" opacity="0.35"/>`;
  });

  // 区域标签
  let labelsHTML = '';
  for (const [dist, center] of Object.entries(DataManager.distCenter)) {
    const [lat, lng] = center;
    const { x: lx, y: ly } = DataManager.latlngToSvg(lat, lng);
    labelsHTML += `<text x="${lx}" y="${ly - 12}" text-anchor="middle" font-size="10" fill="#bbb" font-weight="bold">${dist}</text>`;
  }

  panel.innerHTML = `
    <div class="geo-map-header">
      <h4>${device.unit_name || '未命名'} <span class="dist-tag" style="background:${color}">${device.district || '-'}</span></h4>
      <p style="font-size:12px;color:#888;margin-top:4px">${device.address || '无地址信息'}</p>
    </div>
    <div class="geo-map-wrapper">
      <div class="svg-map-container" id="geoSvgContainer" style="cursor:crosshair">
        <svg viewBox="0 0 ${DataManager.SVG_W} ${DataManager.SVG_H}" xmlns="http://www.w3.org/2000/svg" id="geoSvg">
          <rect width="${DataManager.SVG_W}" height="${DataManager.SVG_H}" fill="#e8f4f8"/>
          <path d="M 20,80 Q 60,60 120,70 L 180,50 Q 250,40 300,60 L 380,45 Q 450,35 520,55 L 600,40 Q 680,30 750,50 L 780,80 L 780,500 L 750,520 Q 680,510 600,515 L 520,500 Q 450,520 380,505 L 300,520 Q 250,510 180,500 L 120,485 Q 60,490 20,470 Z" fill="#d4e6f1" stroke="#a9cce3" stroke-width="1.5"/>
          ${labelsHTML}
          ${dotsHTML}
          <circle id="geoMarkerPulse" cx="${x}" cy="${y}" r="14" fill="none" stroke="${color}" stroke-width="2" opacity="0.3"/>
          <circle id="geoMarker" cx="${x}" cy="${y}" r="8" fill="${color}" stroke="#fff" stroke-width="3" opacity="0.9"/>
        </svg>
        <div class="geo-click-hint">点击地图任意位置调整定位</div>
      </div>
    </div>
    <div class="geo-coord-form">
      <div class="geo-coord-row">
        <label>纬度 (lat)</label>
        <input type="number" id="geoLat" value="${device.lat || ''}" step="0.000001" placeholder="如 22.6532" />
      </div>
      <div class="geo-coord-row">
        <label>经度 (lng)</label>
        <input type="number" id="geoLng" value="${device.lng || ''}" step="0.000001" placeholder="如 114.1234" />
      </div>
      <div class="geo-actions">
        <button class="btn btn-success btn-sm" onclick="saveGeoLocation('${regCode}')">保存定位</button>
        <button class="btn btn-primary btn-sm" onclick="navigateToDevice('${regCode}')">测试导航</button>
        <a class="btn btn-warning btn-sm" href="https://uri.amap.com/search?keyword=${encodeURIComponent((device.address || '') + ' 深圳')}&city=深圳" target="_blank">高德搜索</a>
      </div>
    </div>
  `;

  // 地图点击 → 更新标记 + 填充输入框
  const svgEl = document.getElementById('geoSvg');
  svgEl.addEventListener('click', function(e) {
    const rect = this.getBoundingClientRect();
    const scaleX = DataManager.SVG_W / rect.width;
    const scaleY = DataManager.SVG_H / rect.height;
    const svgX = (e.clientX - rect.left) * scaleX;
    const svgY = (e.clientY - rect.top) * scaleY;

    const { lat, lng } = DataManager.svgToLatLng(svgX, svgY);

    const marker = document.getElementById('geoMarker');
    const pulse = document.getElementById('geoMarkerPulse');
    marker.setAttribute('cx', svgX);
    marker.setAttribute('cy', svgY);
    pulse.setAttribute('cx', svgX);
    pulse.setAttribute('cy', svgY);

    document.getElementById('geoLat').value = lat;
    document.getElementById('geoLng').value = lng;
  });
}

function saveGeoLocation(regCode) {
  const lat = parseFloat(document.getElementById('geoLat').value);
  const lng = parseFloat(document.getElementById('geoLng').value);

  if (isNaN(lat) || isNaN(lng)) {
    showToast('请输入有效的经纬度', 'error');
    return;
  }

  if (lat < 22.0 || lat > 23.0 || lng < 113.5 || lng > 115.0) {
    if (!confirm('坐标超出深圳常见范围，是否仍要保存？')) return;
  }

  DataManager.updateLocation(regCode, lat, lng);
  // 显式同步到云端，确保手机端刷新可见
  DataManager.cloudSave().then(ok => {
    if (ok) showToast('定位已保存，已同步到云端', 'success');
    else showToast('定位已保存（本地），云端同步失败', 'warning');
  }).catch(err => {
    showToast('定位已保存（本地），云端同步失败: ' + (err.message || '网络问题'), 'warning');
  });
  const query = document.getElementById('geoSearch') ? document.getElementById('geoSearch').value : '';
  renderGeoTable(query);
}

// ===== 一键推进过期维保日期（按15天周期自动推算） =====
function updateAllOverdue() {
  var today = new Date();
  var todayStr = fmtDate(today);
  today = parseLocalDate(todayStr); // 去掉时间部分

  // 收集过期设备并计算正确的新日期
  var overdue = [];
  var updated = []; // {device, oldDate, newDate}
  DataManager.devices.forEach(function(d) {
    if (!d.next_date) return;
    try {
      var nd = parseLocalDate(d.next_date);
      if (isNaN(nd.getTime())) return;
      if (nd < today) {
        // 按15天周期反复推进，直到 >= 今天
        var newNd = new Date(nd);
        while (newNd < today) {
          newNd.setDate(newNd.getDate() + 15);
        }
        var newDateStr = fmtDate(newNd);
        if (newDateStr !== d.next_date) {
          updated.push({ device: d, oldDate: d.next_date, newDate: newDateStr });
        }
      }
    } catch(e) {}
  });

  if (updated.length === 0) {
    showToast('没有需要更新的过期设备', 'info');
    return;
  }

  // 统计分布
  var distCount = {};
  updated.forEach(function(u) { distCount[u.newDate] = (distCount[u.newDate] || 0) + 1; });
  var summary = Object.keys(distCount).sort().map(function(k) { return k + ': ' + distCount[k] + '台'; }).join('\n  ');

  if (!confirm('检测到 ' + updated.length + ' 台设备过期\n\n更新后日期分布（按15天周期自动推进）：\n  ' + summary + '\n\n确定自动推进吗？')) return;

  // 应用更新（原日期写入历史记录，保留在原月份灰显）
  var count = 0;
  updated.forEach(function(u) {
    u.device.next_date = u.newDate;
    if (!u.device.maint_history) u.device.maint_history = [];
    if (u.device.maint_history.indexOf(u.oldDate) === -1) {
      u.device.maint_history.push(u.oldDate);
      u.device.maint_history.sort();
    }
    count++;
  });

  DataManager.regenerateSchedule();
  DataManager.save();
  OperationLog.add('批量推进', '', '自动推进 ' + count + ' 台过期设备（按15天周期）');
  DataManager.cloudSave().then(function(ok) {
    if (ok) showToast('已推进 ' + count + ' 台设备，已同步到云端', 'success');
    else showToast('已推进 ' + count + ' 台设备（本地），云端同步失败', 'warning');
  }).catch(function() {
    showToast('已推进 ' + count + ' 台设备（本地）', 'success');
  });
  renderDeviceTable();
  renderStats();
  onBatchDistrictChange();
}

// ===== 批量调整维保日期 =====
let batchFilteredDevices = [];

// 返回维保日历某日期的实际待办设备。排期由 next_date 按 15 天周期展开，
// 因此不能只用 d.next_date === dateStr 判断。
function getScheduledDevicesByDate(dateStr, district) {
  if (!dateStr) return [];
  var day = (DataManager.schedule || []).find(function(item) { return item.date === dateStr; });
  if (!day) return [];
  var codes = new Set((day.devices || []).filter(function(item) { return !item.historical; }).map(function(item) { return item.reg_code; }));
  return DataManager.devices.filter(function(d) {
    return codes.has(d.reg_code) && (!district || d.district === district);
  });
}

function onBatchDistrictChange() {
  const district = document.getElementById('batchDistrict').value;
  const targetDate = document.getElementById('batchTargetDate').value;
  const listContainer = document.getElementById('batchDeviceCheckboxes');
  const wrapper = document.getElementById('batchDeviceList');
  const countEl = document.getElementById('batchSelectCount');

  // 填写原维保日期时，列表必须取该日“实际排期”的设备（next_date 可在其它周期节点）。
  batchFilteredDevices = targetDate
    ? getScheduledDevicesByDate(targetDate, district)
    : (district ? DataManager.devices.filter(d => d.district === district) : DataManager.devices.slice());
  wrapper.style.display = 'block';
  countEl.textContent = batchFilteredDevices.length + ' 台';

  let html = '';
  batchFilteredDevices.forEach((d, i) => {
    const checked = 'checked';
    html += '<label style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:4px;font-size:13px;cursor:pointer" onmouseover="this.style.background=\'#f0f4ff\'" onmouseout="this.style.background=\'transparent\'">' +
      '<input type="checkbox" class="batch-device-cb" data-index="' + i + '" ' + checked + ' onchange="updateBatchCount()" />' +
      '<span style="flex:1;color:#2c3e50">' + escapeHtml(d.unit_name || '') + '</span>' +
      '<span style="font-size:11px;color:#999">' + escapeHtml(targetDate || d.next_date || '无') + '</span>' +
      '<span style="font-size:11px;color:#7f8c8d">' + escapeHtml(d.reg_code || '') + '</span>' +
      '</label>';
  });
  if (!batchFilteredDevices.length && targetDate) {
    html = '<p style="color:#999;text-align:center;padding:12px">' + escapeHtml(targetDate) + ' 暂无待办维保设备</p>';
  }
  listContainer.innerHTML = html;
  document.getElementById('batchSelectAll').checked = batchFilteredDevices.length > 0;
  updateBatchCount();
}

function onBatchTargetDateChange() {
  // 日期变化后重建列表：设备需按维保日历的实际排期读取，而不是按 next_date 精确比对。
  onBatchDistrictChange();
}

function toggleBatchSelectAll() {
  var checked = document.getElementById('batchSelectAll').checked;
  document.querySelectorAll('.batch-device-cb').forEach(function(cb) { cb.checked = checked; });
  updateBatchCount();
}

function updateBatchCount() {
  var checked = document.querySelectorAll('.batch-device-cb:checked').length;
  document.getElementById('batchSelectCount').textContent = checked + '台';
}

function getCheckedDevices() {
  var checked = [];
  document.querySelectorAll('.batch-device-cb:checked').forEach(function(cb) {
    var idx = parseInt(cb.dataset.index);
    if (batchFilteredDevices[idx]) checked.push(batchFilteredDevices[idx]);
  });
  return checked;
}

function previewBatchUpdate() {
  var targetDate = document.getElementById('batchTargetDate').value;
  var newDate = document.getElementById('batchNewDate').value;
  var previewEl = document.getElementById('batchPreview');

  if (!newDate) {
    previewEl.innerHTML = '<span style="color:#e74c3c">请填写新维保日期</span>';
    return;
  }

  var matched = getCheckedDevices();

  if (matched.length === 0 && targetDate) {
    matched = getScheduledDevicesByDate(targetDate, document.getElementById('batchDistrict').value);
  }

  if (matched.length === 0) {
    previewEl.innerHTML = '<span style="color:#e67e22">没有匹配的设备。请先选择区域并勾选要调整的设备。</span>';
    return;
  }

  var list = matched.slice(0, 10).map(function(d) {
    return '<span style="color:#c0392b">•</span> ' + (d.unit_name || d.reg_code) + ' <span style="color:#999">(' + (d.district || '') + ')</span>';
  }).join('<br>');
  var more = matched.length > 10 ? '<br><span style="color:#999">... 还有 ' + (matched.length - 10) + ' 台</span>' : '';

  previewEl.innerHTML = '<strong style="color:#c0392b">将影响 ' + matched.length + ' 台设备</strong><br>' + list + more + '<br><span style="color:#2980b9;font-weight:600">新日期：' + newDate + '</span>';
}

function applyBatchUpdate() {
  var targetDate = document.getElementById('batchTargetDate').value;
  var newDate = document.getElementById('batchNewDate').value;

  if (!newDate) {
    showToast('请填写新维保日期', 'error');
    return;
  }

  var matched = getCheckedDevices();

  if (matched.length === 0 && targetDate) {
    matched = getScheduledDevicesByDate(targetDate, document.getElementById('batchDistrict').value);
  }

  if (matched.length === 0) {
    showToast('没有匹配的设备，请先勾选要调整的设备', 'warning');
    return;
  }

  if (!confirm('确认将 ' + matched.length + ' 台设备的维保日期改为 ' + newDate + '？')) return;

  var count = 0;
  matched.forEach(function(d) { d.next_date = newDate; count++; });

  if (count > 0) {
    DataManager.regenerateSchedule();
    // 先写本地，不触发并行云端请求；下面显式等待唯一一次云端同步完成。
    DataManager.save(false);
    OperationLog.add('批量改维保', '', count + ' 台设备维保日期改为 ' + newDate);
    renderDeviceTable();
    renderStats();
    onBatchDistrictChange();
    document.getElementById('batchPreview').innerHTML = '<span style="color:#2980b9">正在同步 ' + count + ' 台设备到云端，请稍候...</span>';
    // 必须等云端写入完成后再跳转，避免浏览器中断未完成的 PUT 请求。
    DataManager.cloudSave().then(function(ok) {
      if (ok) {
        showToast('已批量修改 ' + count + ' 台设备，已同步到云端', 'success');
        document.getElementById('batchPreview').innerHTML = '<span style="color:#27ae60">已成功修改 ' + count + ' 台设备并同步到云端；正在跳转到 ' + newDate + ' 维保列表...</span>';
        setTimeout(function() {
          window.location.href = 'index.html?date=' + encodeURIComponent(newDate);
        }, 300);
      } else {
        showToast('未同步到云端（可能检测到其他页面的更新，数据已恢复为最新）', 'warning');
        document.getElementById('batchPreview').innerHTML = '<span style="color:#e67e22">云端未接受本次修改：系统已自动加载最新数据，请刷新页面后重新操作。</span>';
      }
    }).catch(function(err) {
      showToast('云端同步失败，请勿刷新并重试', 'error');
      document.getElementById('batchPreview').innerHTML = '<span style="color:#e74c3c">云端同步失败：' + escapeHtml(err && err.message ? err.message : '网络问题') + '。本地修改已保留。</span>';
    });
  }
}

// ===== 批量修改年审日期（全局累积勾选） =====
let aiFilteredDevices = [];
let aiSelectedCodes = {}; // {reg_code: true} 跨搜索持久化勾选

function filterAIInspectionTable() {
  const query = document.getElementById('aiSearch').value.trim().toLowerCase();
  const wrapper = document.getElementById('aiDeviceList');
  const listContainer = document.getElementById('aiCheckboxList');

  if (!query) {
    wrapper.style.display = 'none';
    aiFilteredDevices = [];
    return;
  }

  aiFilteredDevices = DataManager.devices.filter(function(d) {
    return (d.unit_name && d.unit_name.toLowerCase().indexOf(query) !== -1) ||
           (d.reg_code && d.reg_code.toLowerCase().indexOf(query) !== -1) ||
           (d.district && d.district.toLowerCase().indexOf(query) !== -1);
  });

  wrapper.style.display = 'block';

  // 当前搜索结果中有多少已被全局勾选
  var preSelected = 0;
  var html = '';
  aiFilteredDevices.forEach(function(d, i) {
    var color = DataManager.distColors[d.district] || '#888';
    var aiDate = d.annual_inspection_date || '<span style="color:#ccc">未设置</span>';
    var checked = aiSelectedCodes[d.reg_code] ? 'checked' : '';
    if (aiSelectedCodes[d.reg_code]) preSelected++;
    // 加入 data-code 属性用于跨搜索追踪
    html += '<label style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:4px;font-size:13px;cursor:pointer" onmouseover="this.style.background=\'#f0f4ff\'" onmouseout="this.style.background=\'transparent\'"><input type="checkbox" class="ai-checkbox" data-code="' + d.reg_code + '" ' + checked + ' onchange="onAICheckboxChange(this)" /><span style="flex:1;color:#2c3e50">' + (d.unit_name || '') + '</span><span class="dist-tag" style="background:' + color + ';font-size:11px">' + (d.district || '') + '</span><span style="font-size:12px;color:#888;min-width:70px;text-align:right">' + aiDate + '</span></label>';
  });
  listContainer.innerHTML = html;
  document.getElementById('aiSelectAll').checked = (preSelected === aiFilteredDevices.length && aiFilteredDevices.length > 0);
  updateAIInspectionCount();
}

// 单个 checkbox 变化 → 更新全局勾选集合
function onAICheckboxChange(cb) {
  var code = cb.dataset.code;
  if (cb.checked) {
    aiSelectedCodes[code] = true;
  } else {
    delete aiSelectedCodes[code];
  }
  updateAIInspectionCount();
}

function toggleAIInspectionSelectAll() {
  var checked = document.getElementById('aiSelectAll').checked;
  document.querySelectorAll('.ai-checkbox').forEach(function(cb) {
    cb.checked = checked;
    var code = cb.dataset.code;
    if (checked) {
      aiSelectedCodes[code] = true;
    } else {
      delete aiSelectedCodes[code];
    }
  });
  updateAIInspectionCount();
}

function updateAIInspectionCount() {
  var totalSelected = Object.keys(aiSelectedCodes).length;
  var currentCount = aiFilteredDevices.length;
  document.getElementById('aiSelectCount').textContent = '已选 ' + totalSelected + ' 台 | 当前 ' + currentCount + ' 台';
}

// 从全局 aiSelectedCodes 获取勾选设备
function getCheckedAIInspectionDevices() {
  return DataManager.devices.filter(function(d) {
    return !!aiSelectedCodes[d.reg_code];
  });
}

function clearAIInspectionSelection() {
  aiSelectedCodes = {};
  // 清除当前列表中的勾选
  document.querySelectorAll('.ai-checkbox').forEach(function(cb) { cb.checked = false; });
  document.getElementById('aiSelectAll').checked = false;
  updateAIInspectionCount();
  showToast('已清除全部勾选', 'info');
}

function previewAIInspectionUpdate() {
  var newDate = document.getElementById('aiNewDate').value;
  var previewEl = document.getElementById('aiPreview');

  if (!newDate) {
    previewEl.innerHTML = '<span style="color:#e74c3c">请填写新年审日期</span>';
    return;
  }

  var matched = getCheckedAIInspectionDevices();

  if (matched.length === 0) {
    previewEl.innerHTML = '<span style="color:#e67e22">没有勾选设备。请先搜索并勾选要修改的设备。（可多次搜索累积勾选）</span>';
    return;
  }

  var list = matched.slice(0, 15).map(function(d) {
    var oldDate = d.annual_inspection_date || '未设置';
    return '<span style="color:#c0392b">•</span> ' + (d.unit_name || d.reg_code) + ' <span style="color:#999">(' + (d.district || '') + ')</span> <span style="color:#888;font-size:12px">旧: ' + oldDate + '</span>';
  }).join('<br>');
  var more = matched.length > 15 ? '<br><span style="color:#999">... 还有 ' + (matched.length - 15) + ' 台</span>' : '';

  previewEl.innerHTML = '<strong style="color:#c0392b">将修改 ' + matched.length + ' 台设备的年审日期</strong><br>' + list + more + '<br><span style="color:#2980b9;font-weight:600">新日期：' + newDate + '</span>';
}

function applyAIInspectionUpdate() {
  var newDate = document.getElementById('aiNewDate').value;

  if (!newDate) {
    showToast('请填写新年审日期', 'error');
    return;
  }

  var matched = getCheckedAIInspectionDevices();

  if (matched.length === 0) {
    showToast('没有勾选设备，请先搜索并勾选', 'warning');
    return;
  }

  if (!confirm('确认将 ' + matched.length + ' 台设备的年审日期改为 ' + newDate + '？')) return;

  var count = 0;
  matched.forEach(function(d) {
    d.annual_inspection_date = newDate;
    d.annual_inspection_manual = true;
    count++;
  });

  DataManager.save();
  OperationLog.add('批量改年审', '', count + ' 台设备年审日期改为 ' + newDate);
  DataManager.cloudSave().then(function(ok) {
    if (ok) showToast('已修改 ' + count + ' 台设备的年审日期，已同步到云端', 'success');
    else showToast('已修改 ' + count + ' 台设备（本地），云端同步失败', 'warning');
  }).catch(function() {
    showToast('已修改 ' + count + ' 台设备（本地）', 'success');
  });
  renderDeviceTable();
  document.getElementById('aiPreview').innerHTML = '<span style="color:#27ae60">已成功修改 ' + count + ' 台设备</span>';
  // 清除勾选状态
  aiSelectedCodes = {};
  document.querySelectorAll('.ai-checkbox').forEach(function(cb) { cb.checked = false; });
  document.getElementById('aiSelectAll').checked = false;
  updateAIInspectionCount();
}

// ===== 数据同步 =====
function setupSyncButtons() {
  const forceSyncBtn = document.getElementById('forceSyncBtn');
  const clearCacheBtn = document.getElementById('clearCacheBtn');

  if (forceSyncBtn) {
    forceSyncBtn.addEventListener('click', async () => {
      if (!confirm('确定从云端强制同步？这会覆盖本地缓存。')) return;
      try {
        const result = await DataManager.forceCloudSync();
        if (result.ok) {
          renderDeviceTable();
          renderStats();
          showToast(`已从云端同步 ${result.count} 台设备`, 'success');
        } else {
          showToast(result.message || '同步失败', 'error');
        }
      } catch (err) {
        showToast('同步失败: ' + (err.message || '网络问题'), 'error');
      }
    });
  }

  if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', () => {
      if (!confirm('确定清除本地缓存？下次打开会从云端或原始数据重新加载。')) return;
      localStorage.removeItem('elevator_data');
      showToast('本地缓存已清除，请刷新页面', 'success');
    });
  }
}

// ===== 操作日志 =====
function renderLogTable() {
  var tbody = document.getElementById('logTableBody');
  if (!tbody) return;
  var logs = OperationLog.getAll();
  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;padding:20px">暂无操作日志</td></tr>';
    return;
  }
  var actionColors = {
    '新增': '#27ae60', '修改': '#3498db', '删除': '#e74c3c',
    '完成维保': '#27ae60', '批量推进': '#f39c12', '批量改维保': '#f39c12', '批量改年审': '#9b59b6'
  };
  var html = '';
  logs.forEach(function(entry) {
    // 旧条目为 UTC ISO 时间（含 T），转换为本地时间显示；新条目已是本地时间
    var timeStr;
    if (entry.time && entry.time.indexOf('T') !== -1) {
      var d = new Date(entry.time);
      var pad = function(n) { return String(n).padStart(2, '0'); };
      timeStr = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    } else {
      timeStr = entry.time || '-';
    }
    var color = actionColors[entry.action] || '#888';
    html += '<tr>' +
      '<td style="font-size:12px">' + timeStr + '</td>' +
      '<td><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;color:#fff;background:' + color + '">' + entry.action + '</span></td>' +
      '<td style="font-size:12px">' + (entry.reg_code || '-') + '</td>' +
      '<td style="font-size:13px">' + (entry.detail || '') + '</td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
}

function clearOperationLog() {
  if (!confirm('确定清空全部操作日志？此操作不可撤销。')) return;
  OperationLog.clear();
  renderLogTable();
  showToast('操作日志已清空', 'success');
}

// 启动
initAdmin();
setupSyncButtons();

// ===== 旧页面保护 =====
// 浏览器“后退”恢复的后台页面持有旧数据，任何保存都会把旧数据写回。
// 检测到 bfcache 恢复时强制刷新，保证内存数据与云端一致。
window.addEventListener('pageshow', function(e) {
  if (e.persisted) location.reload();
});
// 页面重新可见时（切换标签页回来），若云端有更新数据则自动同步，避免旧数据覆盖。
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;
  try {
    const latest = await DataManager.cloudLoad();
    const latestTime = latest && latest.syncedAt ? new Date(latest.syncedAt).getTime() : 0;
    if (latestTime > (DataManager._lastCloudSync || 0) + 2000 && latest && latest.devices && latest.devices.length > 0) {
      await DataManager.load();
      renderStats();
      renderDeviceTable();
      showToast('已从云端同步最新数据', 'info');
    }
  } catch (e) { /* 网络不可用时忽略 */ }
});
