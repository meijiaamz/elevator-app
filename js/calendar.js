/**
 * 月度日历模块 - 渲染日历、日期详情弹窗
 */

// ===== 月度日历 =====
function renderCalendar(month) {
  currentMonth = month;
  document.querySelectorAll('.month-tab').forEach(t => {
    t.classList.toggle('active', parseInt(t.dataset.month) === month);
  });

  const year = DataManager.currentYear();
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const today = fmtDate(new Date());

  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  // 今日维保汇总条（标注今天多少台保养）
  const todayData = DataManager.schedule.find(s => s.date === today);
  const todayPlanned = todayData ? todayData.total : 0;
  const todayHist = todayData ? (todayData.hist_total || 0) : 0;
  let html = `<div class="today-summary">今日（${today.replace(year + '-', '').replace('-', '/')}）维保计划 <b>${todayPlanned}</b> 台${todayHist ? ' ｜ 已完成/历史 ' + todayHist + ' 台' : ''}</div>`;
  html += '<div class="cal-legend">';
  html += '<span class="legend-item"><span class="legend-dot maint"></span>维保计划</span>';
  html += '<span class="legend-item"><span class="legend-dot ai"></span>年审</span>';
  html += '<span class="legend-item"><span class="legend-dot hist"></span>已完成维保</span>';
  html += '</div>';
  html += '<div class="calendar-grid">';
  weekdays.forEach(w => {
    html += `<div class="cal-weekday">周${w}</div>`;
  });

  for (let i = 0; i < startWeekday; i++) {
    html += '<div class="cal-day empty"></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayData = DataManager.schedule.find(s => s.date === dateStr);
    const count = dayData ? dayData.total : 0;
    const histCount = dayData ? (dayData.hist_total || 0) : 0;
    const isToday = dateStr === today;
    const hasMaint = count > 0;
    const hasHist = histCount > 0;
    const aiCount = dayData ? (dayData.annual_inspections || []).length : 0;
    // 维保区域（计划+历史去重汇总）
    let districts = '';
    if (dayData) {
      const distSet = new Set(dayData.devices.map(dd => dd.district).filter(Boolean));
      districts = [...distSet].join('、');
    }

    // 格子显示：日期 + 圆点(维保/年审/历史) + 维保区域 + 年审标记，详情点击弹窗查看
    html += `<div class="cal-day ${hasMaint ? 'has-maintenance' : ''} ${isToday ? 'today' : ''} ${aiCount > 0 ? 'has-ai' : ''} ${hasHist && !hasMaint ? 'has-history' : ''}" onclick="showDayDetail('${dateStr}')">`;
    html += `<div class="day-num">${d}${isToday ? `<span class="today-count">今日 ${count}台</span>` : ''}</div>`;
    if (hasMaint || aiCount > 0 || hasHist) {
      html += '<div class="day-dots">';
      if (hasMaint) html += `<span class="dot dot-maint" title="${count}台维保"></span>`;
      if (aiCount > 0) html += `<span class="dot dot-ai" title="${aiCount}台年审"></span>`;
      if (hasHist) html += `<span class="dot dot-hist" title="${histCount}台已完成维保"></span>`;
      html += '</div>';
    }
    if (districts) {
      html += `<div class="day-districts">${escapeHtml(districts)}</div>`;
    }
    if (aiCount > 0) {
      html += '<div class="ai-badge">年审</div>';
    }
    html += '</div>';
  }

  html += '</div>';
  document.getElementById('calendarGrid').innerHTML = html;
}

// ===== 日期详情弹窗 =====
function setupModal() {
  const overlay = document.getElementById('modalOverlay');
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('show');
  });
  document.querySelector('.modal-close').addEventListener('click', () => {
    overlay.classList.remove('show');
  });
  const locateOverlay = document.getElementById('locateOverlay');
  locateOverlay.addEventListener('click', (e) => {
    if (e.target === locateOverlay) closeLocateModal();
  });
}

function showDayDetail(dateStr) {
  const dayData = DataManager.schedule.find(s => s.date === dateStr);
  const devices = dayData ? dayData.devices.filter(dd => !dd.historical) : [];
  const histDevices = dayData ? dayData.devices.filter(dd => dd.historical) : [];
  const aiDevices = dayData ? (dayData.annual_inspections || []) : [];
  const overlay = document.getElementById('modalOverlay');
  const title = document.getElementById('modalTitle');
  const body = document.getElementById('modalBody');

  const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
  const wd = weekdays[new Date(dateStr).getDay()];
  const yr = DataManager.currentYear();
  title.textContent = `${dateStr.replace(yr + '-', '').replace('-', '/')} ${wd}`;

  let html = '';
  if (devices.length > 0) {
    html += '<div class="calendar-action-bar"><span>当日维保：' + devices.length + ' 台</span><button class="btn btn-warning btn-sm" onclick="changeMaintenanceDate(\'' + dateStr + '\')">调整当日全部日期</button></div>';
  }
  if (histDevices.length > 0) {
    html += '<div class="hist-notice">&#10003; 当日已完成维保 ' + histDevices.length + ' 台（历史记录）</div>';
  }

  if (devices.length === 0 && aiDevices.length === 0 && histDevices.length === 0) {
    body.innerHTML = '<p style="color:#999;text-align:center;padding:20px">当日无维保计划</p>';
    overlay.classList.add('show');
    return;
  }

  if (aiDevices.length > 0) {
    html += `<div class="ai-notice">&#9888; 本日有 ${aiDevices.length} 台电梯需年审：${aiDevices.map(d => d.unit_name || d.reg_code).join('、')}</div>`;
  }

  if (devices.length > 0) {
    html += '<div class="modal-table-wrap"><table class="data-table"><thead><tr><th>序号</th><th>注册代码</th><th>使用单位</th><th>区域</th><th>地址</th><th>班组</th><th style="width:150px">操作</th></tr></thead><tbody>';
    devices.forEach((d, i) => {
      const color = DataManager.distColors[d.district] || '#888';
      const isAI = d.annual_inspection_date === dateStr;
      html += `<tr class="${isAI ? 'ai-row' : ''}">
        <td data-label="序号">${i + 1}</td>
        <td data-label="注册代码" style="font-size:12px">${escapeHtml(d.reg_code || '-')}${isAI ? '<span class="ai-tag">年审</span>' : ''}</td>
        <td data-label="使用单位">${escapeHtml(d.unit_name || '-')}</td>
        <td data-label="区域"><span class="dist-tag" style="background:${color}">${escapeHtml(d.district || '-')}</span></td>
        <td data-label="地址" style="font-size:12px;color:#888">${escapeHtml(d.address || '-')}</td>
        <td data-label="班组">${escapeHtml(d.team || '-')}</td>
        <td data-label="操作">
          <span class="nav-btn nav-primary" onclick="navigateToDevice('${d.reg_code}')" title="一键导航"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg></span>
          <span class="nav-btn nav-locate" onclick="openLocateModal('${d.reg_code}')" title="定位校准"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg></span>
          <button class="detail-edit-btn" onclick="changeSingleDeviceDate('${d.reg_code}', '${dateStr}')" title="只调整这台设备的维保日期">改期</button>
        </td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  }

  if (histDevices.length > 0) {
    html += '<div class="hist-section"><div class="hist-title">当日已完成维保（历史记录）</div>';
    html += '<div class="modal-table-wrap"><table class="data-table hist-table"><thead><tr><th>序号</th><th>注册代码</th><th>使用单位</th><th>区域</th><th>班组</th></tr></thead><tbody>';
    histDevices.forEach((d, i) => {
      const color = DataManager.distColors[d.district] || '#888';
      html += `<tr class="hist-row">
        <td data-label="序号">${i + 1}</td>
        <td data-label="注册代码" style="font-size:12px">${escapeHtml(d.reg_code || '-')}</td>
        <td data-label="使用单位">${escapeHtml(d.unit_name || '-')}</td>
        <td data-label="区域"><span class="dist-tag" style="background:${color}">${escapeHtml(d.district || '-')}</span></td>
        <td data-label="班组">${escapeHtml(d.team || '-')}</td>
      </tr>`;
    });
    html += '</tbody></table></div></div>';
  }

  body.innerHTML = html;
  overlay.classList.add('show');
}

/** 取某日期“实际排期”的设备对象（可直接修改），避免只按 next_date 精确匹配导致漏设备 */
function getScheduledDevicesOnDate(dateStr) {
  const day = (DataManager.schedule || []).find(s => s.date === dateStr);
  if (!day) return [];
  const codes = new Set((day.devices || []).filter(x => !x.historical).map(x => x.reg_code));
  return DataManager.devices.filter(d => codes.has(d.reg_code));
}

/** 把设备原维保日期写入历史，便于日历保留已完成的记录 */
function pushMaintHistory(device, oldDate) {
  if (!oldDate) return;
  if (!device.maint_history) device.maint_history = [];
  if (device.maint_history.indexOf(oldDate) === -1) {
    device.maint_history.push(oldDate);
    device.maint_history.sort();
  }
}

/** 统一应用日期变更：写历史 → 改日期 → 重排 → 保存 → 同步云端 → 刷新界面 */
function applyMaintenanceDateChange(devices, oldDate, newDate) {
  devices.forEach(function(d) {
    pushMaintHistory(d, d.next_date || oldDate);
    d.next_date = newDate;
  });
  DataManager.regenerateSchedule();
  DataManager.save();
  OperationLog.add('日历调维保', oldDate, devices.length + ' 台 → ' + newDate);
  DataManager.cloudSave().then(() => {
    document.getElementById('modalOverlay').classList.remove('show');
    renderCalendar(currentMonth);
    renderDetailTables();
    renderRoutePlanning();
    renderHomeStats();
    showToast('已调整 ' + devices.length + ' 台维保日期', 'success');
  }).catch(() => showToast('本地已保存，云端同步失败', 'warning'));
}

/** 批量调整：当日全部设备一起改期 */
function changeMaintenanceDate(oldDate) {
  const newDate = prompt('请输入新的维保日期（YYYY-MM-DD）', oldDate);
  if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;
  const devices = getScheduledDevicesOnDate(oldDate);
  if (!devices.length) return showToast('未找到该日期的维保设备', 'warning');
  if (newDate === oldDate) return;
  if (!confirm('确认将当日全部 ' + devices.length + ' 台设备的维保日期从 ' + oldDate + ' 调整为 ' + newDate + '？\n\n（只想改其中一台，请在该设备行点“改期”）')) return;
  applyMaintenanceDateChange(devices, oldDate, newDate);
}

/** 单独调整：只改这一台设备，当日其他设备不受影响 */
function changeSingleDeviceDate(regCode, oldDate) {
  const device = DataManager.devices.find(d => d.reg_code === regCode);
  if (!device) return showToast('未找到该设备', 'error');
  const name = device.unit_name || regCode;
  const newDate = prompt('将「' + name + '」的维保日期从 ' + oldDate + ' 改为：', oldDate);
  if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;
  if (newDate === oldDate) return;
  if (!confirm('确认只将「' + name + '」的维保日期从 ' + oldDate + ' 调整为 ' + newDate + '？\n\n（当日其他设备保持不变）')) return;
  applyMaintenanceDateChange([device], oldDate, newDate);
}
