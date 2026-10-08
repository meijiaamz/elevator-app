/**
 * 维保明细模块 - 按区域分组展示设备列表、搜索筛选
 */

function renderDetailTables() {
  const container = document.getElementById('tab-detail');
  const districts = DataManager.getDistricts();
  let html = '';

  html += `<div class="search-bar">
    <input type="text" class="search-input" id="detailSearch" placeholder="搜索：使用单位 / 注册代码 / 地址 / 区域 / 班组..." oninput="window._debouncedFilterDetail ? _debouncedFilterDetail() : filterDetailTable()" />
    <button class="btn btn-danger" onclick="document.getElementById('detailSearch').value='';filterDetailTable()">清除</button>
  </div>`;

  const sortedDistricts = Object.entries(districts).sort((a, b) => b[1] - a[1]);
  for (const [dist, count] of sortedDistricts) {
    const color = DataManager.distColors[dist] || '#888';
    html += `<div class="district-section collapsed" data-district="${dist}">
      <div class="district-header" onclick="toggleDistrict(this)">
        <h3><span class="dist-tag" style="background:${color}">${dist}</span></h3>
        <span style="display:flex;align-items:center">
          <span class="count-badge">${count} 台</span>
          <span class="collapse-arrow">&#9660;</span>
        </span>
      </div>
      <div class="district-body">
        <table class="data-table">
          <thead><tr><th>序号</th><th>注册代码</th><th>使用单位</th><th>地址</th><th>下次维保</th><th>班组</th><th>年审</th><th style="width:130px">操作</th></tr></thead>
          <tbody>`;

    const devs = DataManager.getDevicesByDistrict(dist);
    devs.forEach((d, i) => {
      const aiDate = d.annual_inspection_date || '';
      const aiType = d.annual_inspection_type || '';
      const yr = DataManager.currentYear();
      const aiBadge = !aiDate ? '-' : d.annual_inspection_manual === true
        ? `<span class="ai-tag">已确认 ${aiDate.replace(yr + '-', '')}${aiType ? ' · ' + aiType : ''}</span>`
        : `<span class="ai-ref-tag">参考 ${aiDate.slice(0, 7).replace(yr + '-', '')}${aiType ? ' · ' + aiType : ''}</span>`;
      html += `<tr data-search="${(d.unit_name + d.reg_code + d.address + d.team + (aiDate || '')).toLowerCase()}">
        <td>${i + 1}</td>
        <td style="font-size:12px">${d.reg_code || '-'}</td>
        <td>${d.unit_name || '-'}</td>
        <td style="font-size:12px;color:#888">${d.address || '-'}</td>
        <td>${d.next_date || '-'}</td>
        <td>${d.team || '-'}</td>
        <td>${aiBadge}</td>
        <td>
          <span class="nav-btn nav-primary" onclick="navigateToDevice('${d.reg_code}')" title="一键导航"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg></span>
          <span class="nav-btn nav-locate" onclick="openLocateModal('${d.reg_code}')" title="定位校准"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg></span>
          <button class="detail-edit-btn" onclick="openMaintenanceEditor('${d.reg_code}')" title="调整设备维保信息">调整</button>
        </td>
      </tr>`;
    });

    html += `</tbody></table>
      </div>
    </div>`;
  }

  container.innerHTML = html;
}

// 在维保列表中直接进入后台对应设备的编辑表单
function openMaintenanceEditor(regCode) {
  window.location.href = 'admin.html?edit=' + encodeURIComponent(regCode);
}

function toggleDistrict(headerEl) {
  const section = headerEl.closest('.district-section');
  if (section) section.classList.toggle('collapsed');
}

function filterDetailTable() {
  const query = document.getElementById('detailSearch').value.toLowerCase().trim();
  document.querySelectorAll('#tab-detail .district-section').forEach(section => {
    let visibleCount = 0;
    section.querySelectorAll('tbody tr').forEach(tr => {
      const searchText = tr.dataset.search || '';
      if (!query || searchText.includes(query)) {
        tr.style.display = '';
        visibleCount++;
      } else {
        tr.style.display = 'none';
      }
    });
    if (visibleCount > 0) {
      section.style.display = '';
      if (query) section.classList.remove('collapsed');
    } else {
      section.style.display = 'none';
    }
  });
}
