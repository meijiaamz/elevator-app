/**
 * 主应用编排 - 初始化、Tab切换、统计面板、隐藏过期月份
 * 依赖：data.js → calendar.js → detail.js → map.js → router.js → app.js
 */

// ===== 全局状态 =====
let currentMonth = Math.min(12, new Date().getMonth() + 1);
let currentFilter = null;

// 全部月份标签均可见（包含已过去的月份，可查看历史维保记录）
function hidePastMonthTabs() {
  const nowMonth = new Date().getMonth() + 1;
  document.querySelectorAll('.month-tab').forEach(tab => {
    tab.style.display = '';
  });
  const y = DataManager.currentYear();
  const subtitle = document.querySelector('.subtitle');
  if (subtitle) {
    subtitle.textContent = y + '年1月-' + y + '年12月 | 15天维保周期 | 深圳地区';
  }
}

// ===== 首页统计面板 =====
function renderHomeStats() {
  const statsEl = document.getElementById('homeStats');
  if (!statsEl) return;
  const todayStr = fmtDate(new Date());
  const total = DataManager.devices.length;
  let overdue = 0, todayMaint = 0, noCoord = 0;
  const districtCount = Object.keys(DataManager.getDistricts()).length;

  DataManager.devices.forEach(function(d) {
    if (d.next_date && d.next_date < todayStr) overdue++;
    if (d.next_date === todayStr) todayMaint++;
    if (!d.lat || !d.lng) noCoord++;
  });

  statsEl.innerHTML =
    '<div class="stats-row" style="margin-top:16px">' +
    '<div class="stat-card"><div class="stat-value">' + total + '</div><div class="stat-label">电梯总数</div></div>' +
    '<div class="stat-card accent"><div class="stat-value">' + todayMaint + '</div><div class="stat-label">今日维保</div></div>' +
    '<div class="stat-card ' + (overdue > 0 ? 'danger' : '') + '"><div class="stat-value">' + overdue + '</div><div class="stat-label">过期待维</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + districtCount + '</div><div class="stat-label">覆盖区域</div></div>' +
    (noCoord > 0 ? '<div class="stat-card warning"><div class="stat-value">' + noCoord + '</div><div class="stat-label">未定位设备 <a href="admin.html#geo" style="font-size:11px;color:#3498db">去校准</a></div></div>' : '') +
    '</div>';
}

// ===== 合同续约提醒 =====
function getContractRenewalAlerts() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thirtyDaysLater = new Date(today);
  thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
  return DataManager.devices.map(function(d) {
    if (!d.contract_end_date) return null;
    const end = new Date(d.contract_end_date + 'T00:00:00');
    if (Number.isNaN(end.getTime()) || end > thirtyDaysLater) return null;
    return { device: d, days: Math.round((end - today) / 86400000) };
  }).filter(Boolean).sort(function(a, b) { return a.days - b.days; });
}

function renderContractRenewalAlert() {
  const el = document.getElementById('contractRenewalAlert');
  if (!el) return;
  const alerts = getContractRenewalAlerts();
  if (!alerts.length) { el.innerHTML = ''; return; }
  const expired = alerts.filter(function(x) { return x.days < 0; }).length;
  const urgent = alerts.filter(function(x) { return x.days >= 0 && x.days <= 7; }).length;
  const level = expired ? 'danger' : (urgent ? 'urgent' : 'warning');
  el.innerHTML = '<button class="contract-alert ' + level + '" onclick="showContractRenewalDetails()">' +
    '<span class="contract-alert-icon">!</span><span><b>' + (expired ? '合同已到期提醒' : '合同续约提醒') + '</b>：' + alerts.length + ' 台电梯合同' +
    (expired ? '已到期或即将到期' : '将在30天内到期') + '，点击查看续约明细</span><span class="contract-alert-arrow">查看 ›</span></button>';
}

function showContractRenewalDetails() {
  const alerts = getContractRenewalAlerts();
  if (!alerts.length) return;
  let html = '<div class="contract-modal-note">合同结束日前 30 天开始提醒；请及时联系客户续约。</div>';
  html += '<table class="data-table contract-table"><thead><tr><th>状态</th><th>合同到期日</th><th>剩余</th><th>使用单位</th><th>注册代码</th><th>区域</th><th>操作</th></tr></thead><tbody>';
  alerts.forEach(function(item) {
    const d = item.device;
    const status = item.days < 0 ? '已到期' : (item.days === 0 ? '今日到期' : '待续约');
    const remain = item.days < 0 ? ('超期 ' + Math.abs(item.days) + ' 天') : (item.days === 0 ? '今天' : item.days + ' 天');
    html += '<tr class="contract-row-' + (item.days < 0 ? 'expired' : 'due') + '"><td><span class="contract-status">' + status + '</span></td><td>' + d.contract_end_date + '</td><td>' + remain + '</td><td>' + escapeHtml(d.unit_name || '-') + '</td><td>' + escapeHtml(d.reg_code || '-') + '</td><td>' + escapeHtml(d.district || '-') + '</td><td><button class="detail-edit-btn" onclick="window.location.href=\'admin.html?edit=' + encodeURIComponent(d.reg_code) + '\'">调整合同</button></td></tr>';
  });
  html += '</tbody></table>';
  document.getElementById('modalTitle').textContent = '合同续约提醒（' + alerts.length + ' 台）';
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('show');
}

// ===== Tab 切换 =====
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + tab).classList.add('active');
    });
  });
}

// ===== 从后台跳转到指定日期的维保列表 =====
function openScheduledDateFromUrl() {
  const dateStr = new URLSearchParams(window.location.search).get('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return;
  const target = parseLocalDate(dateStr);
  if (isNaN(target.getTime()) || target.getFullYear() !== DataManager.currentYear()) return;

  currentMonth = target.getMonth() + 1;
  renderCalendar(currentMonth);
  showDayDetail(dateStr);
  // 用 replace 清理参数，避免用户刷新时重复弹出。
  window.history.replaceState({}, '', 'index.html');
}

// ===== 初始化 =====
async function initApp() {
  try {
    await DataManager.load();
    // 自动推进过期日期，但保留历史记录；合同已结束设备不会生成新的维保计划。
    var advancedCount = DataManager.autoAdvanceOverdue();
    if (advancedCount > 0) {
      try { await DataManager.cloudSave(); } catch (e) { console.warn('自动推进云端同步失败:', e.message); }
    }
    hidePastMonthTabs();
    renderCalendar(currentMonth);
    renderDetailTables();
    renderMap();
    renderRoutePlanning();
    setupTabs();
    setupModal();
    openScheduledDateFromUrl();

    // 搜索防抖
    window._debouncedSearchOnMap = debounce(searchOnMap, 250);
    window._debouncedFilterDetail = debounce(filterDetailTable, 250);

    // 页面重新可见时，自动从云端刷新数据
    document.addEventListener('visibilitychange', async () => {
      if (!document.hidden) {
        await DataManager.load();
        renderCalendar(currentMonth);
        renderDetailTables();
        renderMap();
        renderRoutePlanning();
      }
    });
    document.getElementById('loading').style.display = 'none';
    document.getElementById('appContent').style.display = 'block';
    renderHomeStats();
    renderContractRenewalAlert();
  } catch (err) {
    console.error('初始化失败:', err);
    const msg = err.message || String(err);
    document.getElementById('loading').innerHTML =
      '<div style="text-align:center;padding:40px">' +
      '<p style="color:#e74c3c;font-size:16px;margin-bottom:10px">⚠ 数据加载失败</p>' +
      '<p style="color:#666;font-size:13px;margin-bottom:15px">' + msg + '</p>' +
      '<p style="color:#999;font-size:12px">请尝试：<br>1. 按 <b>Ctrl+Shift+R</b>（或 Cmd+Shift+R）强制刷新页面<br>2. 清除浏览器缓存后重试<br>3. 检查网络连接是否正常</p>' +
      '</div>';
  }
}

// 启动
initApp();
