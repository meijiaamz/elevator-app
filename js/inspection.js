/**
 * 年审计划模块：参考日期、部门分组建议、确认与改期
 * 仅 annual_inspection_manual === true 的日期进入维保日历。
 */
// 默认显示当前月份，确保当月待办的年审/定检任务一进页面就能看到。
// （原为 +2，9 月时会跳到 10 月，导致当月定检设备看不到建议）
let inspectionPlanMonth = Math.min(12, new Date().getMonth() + 1);

function getInspectionDepartment(d) {
  const district = d.district || '';
  const street = d.street || d.address || '';
  if (district === '福田区') return '机电一部';
  if (district === '龙岗区') return (street.includes('布吉') || street.includes('吉华')) ? '机电一部' : '机电三部';
  if (['罗湖区', '盐田区', '大鹏新区', '坪山区'].includes(district)) return '机电二部';
  if (district === '南山区') return '机电四部';
  if (district === '龙华区') return '机电五部';
  if (district === '光明区') return '机电六部';
  if (district === '宝安区') return (street.includes('福永') || street.includes('沙井') || street.includes('松岗')) ? '机电七部' : '机电六部';
  return '待人工确认';
}

// 年审日历与维保日历共用 DataManager.schedule，禁止自行推算周期，避免两边数据不一致。
function getMaintenanceScheduleByDay(year, month) {
  const result = {};
  const days = new Date(year, month, 0).getDate();
  for (let day = 1; day <= days; day++) result[day] = { total: 0, devices: [] };
  const prefix = year + '-' + String(month).padStart(2, '0') + '-';
  (DataManager.schedule || []).forEach(function(entry) {
    if (!entry.date || !entry.date.startsWith(prefix)) return;
    const day = Number(entry.date.slice(-2));
    if (!result[day]) return;
    result[day] = { total: entry.total || 0, devices: entry.devices || [] };
  });
  return result;
}

function getMaintenanceLoad(year, month) {
  const scheduleByDay = getMaintenanceScheduleByDay(year, month);
  const loads = {};
  Object.keys(scheduleByDay).forEach(function(day) { loads[day] = scheduleByDay[day].total; });
  return loads;
}

function getInspectionSuggestions(year, month) {
  const prefix = year + '-' + String(month).padStart(2, '0');
  const refs = DataManager.devices.filter(d => String(d.annual_inspection_date || '').startsWith(prefix) && d.annual_inspection_manual !== true);
  // 按「部门 + 真实年审日期」分组。
  // 定期检验是特检院规定的法定日期，不能为了错开维保量而擅自改期；
  // 这里保留每台设备的真实检验日期，仅在日历上提示当日维保量，由管理员自行决定是否改期。
  const groups = {};
  refs.forEach(d => {
    const department = getInspectionDepartment(d);
    const day = Number(String(d.annual_inspection_date).slice(-2));
    const key = department + '|' + day;
    if (!groups[key]) groups[key] = { department: department, day: day, devices: [] };
    groups[key].devices.push(d);
  });
  const loads = getMaintenanceLoad(year, month);
  return Object.keys(groups).sort().map(function(key) {
    const g = groups[key];
    return { department: g.department, devices: g.devices, day: g.day, load: loads[g.day] || 0 };
  });
}

function renderInspectionPlan(month) {
  if (month) inspectionPlanMonth = month;
  const container = document.getElementById('inspectionPlanContainer');
  if (!container) return;
  const year = DataManager.currentYear();
  const days = new Date(year, inspectionPlanMonth, 0).getDate();
  const firstWeekday = new Date(year, inspectionPlanMonth - 1, 1).getDay();
  const confirmed = DataManager.devices.filter(d => d.annual_inspection_manual === true && (d.annual_inspection_date || '').startsWith(year + '-' + String(inspectionPlanMonth).padStart(2, '0')));
  const suggestions = getInspectionSuggestions(year, inspectionPlanMonth);
  const suggestionsByDay = {};
  suggestions.forEach(g => { if (!suggestionsByDay[g.day]) suggestionsByDay[g.day] = []; suggestionsByDay[g.day].push(g); });
  const confirmedByDay = {};
  confirmed.forEach(d => { const day = Number(d.annual_inspection_date.slice(-2)); if (!confirmedByDay[day]) confirmedByDay[day] = []; confirmedByDay[day].push(d); });
  const maintenanceScheduleByDay = getMaintenanceScheduleByDay(year, inspectionPlanMonth);
  const maintenanceLoads = {};
  const maintenanceByDay = {};
  Object.keys(maintenanceScheduleByDay).forEach(function(day) {
    maintenanceLoads[day] = maintenanceScheduleByDay[day].total;
    maintenanceByDay[day] = maintenanceScheduleByDay[day].devices;
  });
  let html = '<div class="inspection-toolbar"><div class="month-tabs">';
  // 12 个月全部显示，便于回看历史年审安排（原逻辑只从当前月生成，历史月份无法切换）
  for (let m = 1; m <= 12; m++) html += '<div class="month-tab ' + (m === inspectionPlanMonth ? 'active' : '') + '" onclick="renderInspectionPlan(' + m + ')">' + m + '月</div>';
  html += '</div><div class="inspection-summary">建议 ' + suggestions.reduce((n, g) => n + g.devices.length, 0) + ' 台 ｜ 已确认 ' + confirmed.length + ' 台</div></div>';
  html += '<div class="inspection-legend"><span class="inspection-dot suggestion"></span>参考建议（未确认） <span class="inspection-dot confirmed"></span>已确认年审 <span class="inspection-dot load"></span>括号内为当日维保量</div>';
  html += '<div class="calendar-grid inspection-grid">';
  ['日','一','二','三','四','五','六'].forEach(w => html += '<div class="cal-weekday">周' + w + '</div>');
  for (let i = 0; i < firstWeekday; i++) html += '<div class="cal-day empty"></div>';
  for (let day = 1; day <= days; day++) {
    const dateStr = year + '-' + String(inspectionPlanMonth).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const groups = suggestionsByDay[day] || [];
    const fixed = confirmedByDay[day] || [];
    const load = maintenanceLoads[day];
    const maintDevices = maintenanceByDay[day] || [];
    const districtCounts = {};
    maintDevices.forEach(function(d) {
      const district = d.district || '未分区';
      districtCounts[district] = (districtCounts[district] || 0) + 1;
    });
    const districtText = Object.keys(districtCounts).sort(function(a, b) { return districtCounts[b] - districtCounts[a] || a.localeCompare(b); })
      .map(function(district) { return district + ' ' + districtCounts[district] + '台'; }).join('、');
    const suggestedCount = groups.reduce((total, g) => total + g.devices.length, 0);
    const confirmedCount = fixed.length;
    const hasContent = maintDevices.length || suggestedCount || confirmedCount;
    html += '<div class="cal-day inspection-day ' + (hasContent ? 'has-plan' : '') + '" onclick="showInspectionDayDetail(\'' + dateStr + '\')"><div class="day-num">' + day + '</div>';
    if (load > 0) html += '<div class="inspection-load">维保 ' + load + ' 台</div>';
    if (districtText) html += '<div class="inspection-districts" title="当天维保地区：' + escapeHtml(districtText) + '">' + escapeHtml(districtText) + '</div>';
    if (suggestedCount) html += '<div class="inspection-summary-chip suggestion">年审建议 ' + suggestedCount + ' 台</div>';
    if (confirmedCount) html += '<div class="inspection-summary-chip confirmed">年审确认 ' + confirmedCount + ' 台</div>';
    html += '</div>';
  }
  html += '</div>';
  if (!suggestions.length && !confirmed.length) html += '<p class="empty-plan">本月没有年审参考或已确认计划。</p>';
  container.innerHTML = html;
}

function showInspectionDayDetail(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  // 与首页维保日历弹窗使用同一份排期中的设备清单
  const scheduleDay = (DataManager.schedule || []).find(function(entry) { return entry.date === dateStr; });
  const maintDevices = scheduleDay ? (scheduleDay.devices || []) : [];
  const confirmed = DataManager.devices.filter(d => d.annual_inspection_manual === true && d.annual_inspection_date === dateStr);
  const suggestionGroups = getInspectionSuggestions(year, month).filter(g => g.day === day);
  const overlay = document.getElementById('adminInspectionOverlay');
  const title = document.getElementById('adminInspectionTitle');
  const body = document.getElementById('adminInspectionBody');
  const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
  title.textContent = month + '月' + day + '日 ' + weekdays[date.getDay()] + ' · 年审与维保安排';
  let html = '';
  html += '<section class="inspection-detail-section maint"><h4>当日维保设备（' + maintDevices.length + ' 台）</h4>';
  if (maintDevices.length) {
    html += '<table class="data-table"><thead><tr><th>使用单位</th><th>注册代码</th><th>区域</th><th>地址</th></tr></thead><tbody>';
    maintDevices.forEach(d => { html += '<tr><td>' + escapeHtml(d.unit_name || '-') + '</td><td style="font-size:12px">' + escapeHtml(d.reg_code || '-') + '</td><td>' + escapeHtml(d.district || '-') + '</td><td style="font-size:12px">' + escapeHtml(d.address || '-') + '</td></tr>'; });
    html += '</tbody></table>';
  } else html += '<p class="inspection-empty">当天没有维保项目，可优先安排年审。</p>';
  html += '</section>';
  html += '<section class="inspection-detail-section suggestion"><h4>参考年审建议（' + suggestionGroups.reduce((n,g) => n + g.devices.length, 0) + ' 台）</h4>';
  if (suggestionGroups.length) {
    suggestionGroups.forEach(g => {
      html += '<div class="inspection-group-detail"><div class="inspection-group-head"><b>' + escapeHtml(g.department) + '</b><span>建议 ' + g.devices.length + ' 台集中年审</span></div>';
      html += '<table class="data-table"><thead><tr><th>使用单位</th><th>注册代码</th><th>区域</th><th>年审类型</th><th>参考月份</th></tr></thead><tbody>';
      g.devices.forEach(d => { html += '<tr><td>' + escapeHtml(d.unit_name || '-') + '</td><td style="font-size:12px">' + escapeHtml(d.reg_code || '-') + '</td><td>' + escapeHtml(d.district || '-') + '</td><td><span class="inspection-type ' + (d.annual_inspection_type === '自行检测' ? 'self' : '') + '">' + escapeHtml(d.annual_inspection_type || '未分类') + '</span></td><td>' + escapeHtml((d.annual_inspection_date || '').slice(0, 7) || '-') + '</td></tr>'; });
      html += '</tbody></table><div class="inspection-group-actions"><button class="btn btn-primary" onclick="acceptInspectionSuggestion(\'' + g.department + '\',' + month + ')">同意此建议</button><button class="btn btn-warning" onclick="changeSuggestionDate(\'' + g.department + '\',' + month + ',' + g.day + ')">改日期后确认</button></div></div>';
    });
  } else html += '<p class="inspection-empty">当天没有待确认的年审建议。</p>';
  html += '</section>';
  html += '<section class="inspection-detail-section confirmed"><h4>已确认年审（' + confirmed.length + ' 台）</h4>';
  if (confirmed.length) {
    html += '<table class="data-table"><thead><tr><th>使用单位</th><th>注册代码</th><th>区域</th><th>年审类型</th><th>操作</th></tr></thead><tbody>';
    confirmed.forEach(d => { html += '<tr><td>' + escapeHtml(d.unit_name || '-') + '</td><td style="font-size:12px">' + escapeHtml(d.reg_code || '-') + '</td><td>' + escapeHtml(d.district || '-') + '</td><td><span class="inspection-type ' + (d.annual_inspection_type === '自行检测' ? 'self' : '') + '">' + escapeHtml(d.annual_inspection_type || '未分类') + '</span></td><td><button class="btn btn-warning btn-sm" onclick="changeConfirmedInspection(\'' + d.reg_code + '\',\'' + dateStr + '\')">改期</button></td></tr>'; });
    html += '</tbody></table>';
  } else html += '<p class="inspection-empty">当天没有已确认的年审计划。</p>';
  html += '</section>';
  body.innerHTML = html;
  overlay.classList.add('show');
}

function closeInspectionDetail() { document.getElementById('adminInspectionOverlay').classList.remove('show'); }

function applyInspectionDates(devices, dateStr, label) {
  devices.forEach(d => { d.annual_inspection_date = dateStr; d.annual_inspection_manual = true; });
  DataManager.regenerateSchedule();
  DataManager.save();
  OperationLog.add('确认年审计划', label, devices.length + ' 台确认至 ' + dateStr);
  DataManager.cloudSave().then(() => { showToast('已确认 ' + devices.length + ' 台年审：' + dateStr, 'success'); renderInspectionPlan(); renderDeviceTable(); }).catch(() => { showToast('本地已保存，云端同步失败', 'warning'); });
}

function acceptInspectionSuggestion(department, month) {
  const groups = getInspectionSuggestions(DataManager.currentYear(), month);
  const group = groups.find(g => g.department === department);
  if (!group) return showToast('没有可确认的建议', 'warning');
  const dateStr = DataManager.currentYear() + '-' + String(month).padStart(2, '0') + '-' + String(group.day).padStart(2, '0');
  if (!confirm('确认将 ' + department + ' 的 ' + group.devices.length + ' 台设备安排在 ' + dateStr + ' 年审吗？\n确认后将显示在维保日历。')) return;
  applyInspectionDates(group.devices, dateStr, department);
}

function changeSuggestionDate(department, month, defaultDay) {
  const dateStr = prompt('请输入新的年审日期（YYYY-MM-DD）', DataManager.currentYear() + '-' + String(month).padStart(2, '0') + '-' + String(defaultDay).padStart(2, '0'));
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
  const group = getInspectionSuggestions(DataManager.currentYear(), month).find(g => g.department === department);
  if (group && confirm('确认将 ' + department + ' 的 ' + group.devices.length + ' 台设备安排在 ' + dateStr + '？')) applyInspectionDates(group.devices, dateStr, department + '（改期）');
}

function changeConfirmedInspection(regCode, currentDate) {
  const newDate = prompt('请输入新的确认年审日期（YYYY-MM-DD）', currentDate);
  if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;
  const device = DataManager.devices.find(d => d.reg_code === regCode);
  if (device && confirm('确认将 ' + (device.unit_name || regCode) + ' 改期到 ' + newDate + '？')) applyInspectionDates([device], newDate, device.unit_name || regCode);
}

// ===== 年审安排分享表（发给同事） =====
let _shareYear = 0, _shareMonth = 0;

function getConfirmedInspectionsByMonth(year, month) {
  const prefix = year + '-' + String(month).padStart(2, '0');
  return DataManager.devices.filter(d => d.annual_inspection_manual === true && String(d.annual_inspection_date || '').startsWith(prefix));
}

function openShareInspection() {
  const year = DataManager.currentYear();
  const month = inspectionPlanMonth;
  _shareYear = year; _shareMonth = month;
  const card = document.getElementById('shareInspectionCard');
  const confirmed = getConfirmedInspectionsByMonth(year, month);
  confirmed.sort((a, b) => String(a.annual_inspection_date).localeCompare(String(b.annual_inspection_date)));
  if (!confirmed.length) {
    card.innerHTML = '<div class="share-empty">本月（' + year + '年' + month + '月）还没有已确认的年审安排。<br>请在日历中确认年审后再生成分享表。</div>';
  } else {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const byDay = {};
    confirmed.forEach(d => { const k = d.annual_inspection_date; (byDay[k] = byDay[k] || []).push(d); });
    const now = new Date();
    const pad = x => String(x).padStart(2, '0');
    const genTime = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
    let html = '';
    html += '<div class="sc-head"><h2>顺安达电梯 · ' + year + '年' + month + '月年审安排</h2><div class="sc-sub">已确认年审计划（定期检验 / 自行检测）</div></div>';
    html += '<div class="sc-meta"><span>共 <b>' + confirmed.length + '</b> 台</span><span>分布在 <b>' + Object.keys(byDay).length + '</b> 天</span><span>生成时间：' + genTime + '</span></div>';
    html += '<div class="sc-body">';
    Object.keys(byDay).sort().forEach(day => {
      const dt = new Date(day + 'T00:00:00');
      const list = byDay[day];
      html += '<div class="sc-day"><div class="sc-day-head"><span class="d">' + month + '月' + dt.getDate() + '日</span><span class="w">' + weekdays[dt.getDay()] + '</span><span class="n">' + list.length + ' 台</span></div>';
      html += '<table class="sc-tbl"><thead><tr><th>使用单位</th><th>注册代码</th><th>区域</th><th>类型</th><th>负责部门</th></tr></thead><tbody>';
      list.forEach(d => {
        const isSelf = d.annual_inspection_type === '自行检测';
        const typeText = d.annual_inspection_type || '未分类';
        const dept = getInspectionDepartment(d);
        html += '<tr><td>' + escapeHtml(d.unit_name || '-') + '</td><td style="font-size:11px;color:#666">' + escapeHtml(d.reg_code || '-') + '</td><td>' + escapeHtml(d.district || '-') + '</td><td><span class="sc-type ' + (isSelf ? 'self' : '') + '">' + escapeHtml(typeText) + '</span></td><td>' + escapeHtml(dept) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    });
    html += '</div>';
    html += '<div class="sc-foot">顺安达电梯维保管理系统 · 仅供内部安排参考，请以特检院通知为准</div>';
    card.innerHTML = html;
  }
  document.getElementById('shareInspectionOverlay').classList.add('show');
}

function closeShareInspection() {
  document.getElementById('shareInspectionOverlay').classList.remove('show');
}

function downloadShareImage() {
  const card = document.getElementById('shareInspectionCard');
  if (typeof html2canvas !== 'function') {
    showToast('图片组件未加载，请改用“打印 / 存为PDF”', 'warning');
    return;
  }
  showToast('正在生成图片...', 'info');
  html2canvas(card, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false }).then(canvas => {
    const link = document.createElement('a');
    link.download = '年审安排_' + _shareYear + String(_shareMonth).padStart(2, '0') + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('图片已生成，保存后可发给同事', 'success');
  }).catch(e => {
    showToast('生成失败：' + e.message + '，请改用打印', 'error');
  });
}

function printShareCard() {
  const card = document.getElementById('shareInspectionCard');
  const w = window.open('', '_blank');
  if (!w) { showToast('浏览器拦截了打印窗口，请允许弹窗后重试', 'warning'); return; }
  w.document.write('<html><head><meta charset="utf-8"><title>年审安排表</title><style>' +
    'body{margin:0;font-family:-apple-system,"Microsoft YaHei",sans-serif;}' +
    '.share-card{width:760px;max-width:100%;color:#2c3e50;}' +
    '.sc-head{background:#1f6fb2;color:#fff;padding:18px 22px;}.sc-head h2{margin:0;font-size:20px;}.sc-sub{margin-top:4px;font-size:13px;opacity:.92;}' +
    '.sc-meta{display:flex;gap:18px;flex-wrap:wrap;padding:12px 22px;background:#f3f8fc;border-bottom:1px solid #e3ebf2;font-size:13px;color:#3a4a57;}.sc-meta b{color:#1f6fb2;}' +
    '.sc-body{padding:8px 22px 18px;}.sc-day{margin-top:16px;}' +
    '.sc-day-head{display:flex;align-items:baseline;gap:10px;border-left:4px solid #1f6fb2;padding-left:10px;margin-bottom:8px;}.sc-day-head .d{font-size:17px;font-weight:700;}.sc-day-head .w{font-size:13px;color:#7f8c8d;}.sc-day-head .n{margin-left:auto;font-size:12px;color:#1f6fb2;background:#e7f2fb;border-radius:10px;padding:2px 10px;}' +
    'table.sc-tbl{width:100%;border-collapse:collapse;font-size:12.5px;}.sc-tbl th{background:#eef4f9;color:#5a6b78;text-align:left;padding:7px 8px;border-bottom:2px solid #d7e3ee;}.sc-tbl td{padding:7px 8px;border-bottom:1px solid #eef1f4;}' +
    '.sc-type{display:inline-block;padding:1px 7px;border-radius:4px;font-size:11px;background:#e8f4ff;color:#236a9a;}.sc-type.self{background:#f2eafb;color:#7545a5;}' +
    '.sc-foot{padding:12px 22px;color:#9aa7b1;font-size:11px;border-top:1px solid #eef1f4;}' +
    '@media print{body{margin:0}}' +
    '</style></head><body>' + card.outerHTML + '</body></html>');
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 350);
}
