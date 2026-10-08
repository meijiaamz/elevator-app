/**
 * 路线规划模块 - 按月分组展示维保路线，贪心最近邻排序
 */

function renderRoutePlanning() {
  const container = document.getElementById('tab-route');
  const routeDates = {};

  DataManager.schedule.forEach(day => {
    // 只对今天及未来的待办维保规划路线，历史/已过去的记录不参与
    const planned = (day.devices || []).filter(d => !d.historical);
    if (planned.length > 0) {
      const devs = planned.map(d => {
        const loc = DataManager.locations.find(l => l.reg_code === d.reg_code);
        return {
          ...d,
          lat: loc?.lat || 22.65,
          lng: loc?.lng || 114.10
        };
      });
      routeDates[day.date] = DataManager.planRoute(devs);
    }
  });

  const sortedDates = Object.keys(routeDates).sort();
  if (sortedDates.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:#999;padding:40px">暂无路线数据</p>';
    return;
  }

  const months = {};
  sortedDates.forEach(date => {
    const month = parseInt(date.split('-')[1]);
    const monthKey = month + '月';
    if (!months[monthKey]) months[monthKey] = [];
    months[monthKey].push(date);
  });

  const routePaths = {};
  sortedDates.forEach(date => {
    const route = routeDates[date];
    if (route.length > 0) {
      const points = route.map(r => DataManager.latlngToSvg(r.lat, r.lng));
      let pathD = `M ${points[0].x},${points[0].y}`;
      for (let i = 1; i < points.length; i++) {
        pathD += ` L ${points[i].x},${points[i].y}`;
      }
      routePaths[date] = pathD;
    }
  });

  const now = new Date();
  const curMon = now.getMonth() + 1;
  const curYear = DataManager.currentYear();
  const monthEntries = Object.entries(months)
    .filter(([name]) => parseInt(name) >= curMon)
    .sort(([a], [b]) => parseInt(a) - parseInt(b));

  let monthGroupsHTML = '';
  monthEntries.forEach(([monthName, dateList], mIdx) => {
    const totalDays = dateList.length;
    const totalDevices = dateList.reduce((sum, d) => sum + routeDates[d].length, 0);
    const collapsed = mIdx === 0 ? '' : 'collapsed';

    let buttonsHTML = '';
    dateList.forEach((date, idx) => {
      const count = routeDates[date].length;
      const dateDisplay = date.replace(curYear + '-', '').replace('-', '/');
      const active = (mIdx === 0 && idx === 0) ? 'active' : '';
      buttonsHTML += `<button class="route-date-btn ${active}" onclick="showRoute('${date}')">${dateDisplay} (${count})</button>`;
    });

    let panelsHTML = '';
    dateList.forEach((date, idx) => {
      const route = routeDates[date];
      const dayData = DataManager.schedule.find(s => s.date === date);
      const weekday = dayData?.weekday || '';
      const total = route.length;
      const display = (mIdx === 0 && idx === 0) ? 'block' : 'none';

      let rowsHTML = '';
      route.forEach((r, j) => {
        const color = DataManager.distColors[r.district] || '#888';
        const arrow = j < route.length - 1 ? '<div class="route-arrow">&#8595;</div>' : '';
        rowsHTML += `<tr>
          <td>${j + 1}</td>
          <td>${r.unit_name || '-'}</td>
          <td><span class="dist-tag" style="background:${color}">${r.district || '-'}</span></td>
          <td style="font-size:11px;color:#888">${r.address || '-'}</td>
          <td style="text-align:center">${arrow}</td>
          <td>
            <span class="nav-btn nav-primary" onclick="navigateToDevice('${r.reg_code}')" title="一键导航"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg></span>
            <span class="nav-btn nav-locate" onclick="openLocateModal('${r.reg_code}')" title="定位校准"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg></span>
          </td>
        </tr>`;
      });

      const dateDisplay = date.replace(curYear + '-', '').replace('-', '/');
      panelsHTML += `<div class="route-panel" id="route-${date}" style="display:${display}">
        <div class="route-summary">${dateDisplay} ${weekday} | 共 ${total} 台电梯</div>
        <table class="data-table">
          <thead><tr><th style="width:40px">序号</th><th>使用单位</th><th style="width:80px">区域</th><th>地址</th><th style="width:30px"></th><th style="width:70px">操作</th></tr></thead>
          <tbody>${rowsHTML}</tbody>
        </table>
      </div>`;
    });

    monthGroupsHTML += `<div class="route-month-group ${collapsed}">
      <div class="route-month-header" onclick="toggleRouteMonth(this)">
        <h4>
          <span class="collapse-arrow">&#9660;</span>
          ${monthName}
        </h4>
        <span class="month-summary">${totalDays} 天 / ${totalDevices} 台</span>
      </div>
      <div class="route-month-body">
        <div class="route-date-selector">${buttonsHTML}</div>
        ${panelsHTML}
      </div>
    </div>`;
  });

  container.innerHTML = `
    <div class="route-section">
      <div class="route-header">
        <h2>维保路线规划</h2>
        <p>按月分组，点击月份展开/收起；选择日期查看当日路线</p>
      </div>
      <div style="padding:16px 0 20px">${monthGroupsHTML}</div>
    </div>
  `;

  window._routePaths = routePaths;

  if (sortedDates.length > 0) {
    const firstDate = sortedDates[0];
    const pathEl = document.getElementById('routeSvgPath');
    if (pathEl && routePaths[firstDate]) {
      pathEl.setAttribute('d', routePaths[firstDate]);
      pathEl.classList.add('show');
    }
  }
}

function toggleRouteMonth(headerEl) {
  const group = headerEl.closest('.route-month-group');
  if (group) group.classList.toggle('collapsed');
}

function showRoute(date) {
  document.querySelectorAll('.route-panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById('route-' + date);
  if (panel) panel.style.display = 'block';

  document.querySelectorAll('.route-date-btn').forEach(b => b.classList.remove('active'));
  const btns = document.querySelectorAll('.route-date-btn');
  btns.forEach(b => {
    if (b.textContent.startsWith(date.replace(DataManager.currentYear() + '-', '').replace('-', '/'))) {
      b.classList.add('active');
    }
  });

  const pathEl = document.getElementById('routeSvgPath');
  if (pathEl) {
    if (window._routePaths && window._routePaths[date]) {
      pathEl.setAttribute('d', window._routePaths[date]);
      pathEl.classList.add('show');
    } else {
      pathEl.classList.remove('show');
    }
  }
}
