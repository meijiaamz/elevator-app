/**
 * 地图与定位模块 - SVG 地图、搜索筛选、定位校准弹窗
 */

// ===== SVG 地图 =====
function renderMap() {
  const container = document.getElementById('mapContainer');
  const districts = DataManager.getDistricts();
  const districtCenters = DataManager.distCenter;

  let dotsHTML = '';
  DataManager.devices.forEach((d, i) => {
    if (d.lat == null || d.lng == null) return;
    const { x, y } = DataManager.latlngToSvg(d.lat, d.lng);
    const color = DataManager.distColors[d.district] || '#888';
    dotsHTML += `<circle class="elev-dot" data-index="${i}" cx="${x}" cy="${y}" r="4" fill="${color}" stroke="#fff" stroke-width="1" opacity="0.85"/>`;
  });

  let labelsHTML = '';
  for (const [dist, [lat, lng]] of Object.entries(districtCenters)) {
    const { x, y } = DataManager.latlngToSvg(lat, lng);
    const count = districts[dist] || 0;
    const color = DataManager.distColors[dist] || '#888';
    labelsHTML += `<text x="${x}" y="${y - 15}" text-anchor="middle" font-size="11" fill="${color}" font-weight="bold">${dist}</text>`;
    labelsHTML += `<text x="${x}" y="${y - 2}" text-anchor="middle" font-size="9" fill="#aaa">${count}台</text>`;
  }

  let chipsHTML = '';
  for (const [dist, count] of Object.entries(districts).sort((a, b) => b[1] - a[1])) {
    const color = DataManager.distColors[dist] || '#888';
    chipsHTML += `<span class="filter-chip" style="background:${color}" onclick="filterByDistrict('${dist}')" id="mapChip-${dist}">${dist} (${count})</span>`;
  }

  let legendHTML = '';
  for (const [dist, color] of Object.entries(DataManager.distColors)) {
    if (districts[dist]) {
      legendHTML += `<div class="legend-item"><div class="legend-dot" style="background:${color}"></div>${dist} (${districts[dist]})</div>`;
    }
  }

  let overdueCount = 0, noCoordCount = 0;
  const todayStr = fmtDate(new Date());
  DataManager.devices.forEach(function(d) {
    if (!d.lat || !d.lng) noCoordCount++;
    if (d.next_date && d.next_date < todayStr) overdueCount++;
  });

  container.innerHTML = `
    <div class="map-header">
      <h2>电梯分布地图 & 搜索</h2>
      <p>共 ${DataManager.devices.length} 台电梯，点击标记查看详情，使用搜索框快速查找
        ${noCoordCount > 0 ? ' <span style="color:#e74c3c">| 未定位：' + noCoordCount + ' 台</span>' : ''}
        ${overdueCount > 0 ? ' <span style="color:#e74c3c">| 过期维保：' + overdueCount + ' 台</span>' : ''}
      </p>
      <div class="search-bar" style="margin-top:12px">
        <input type="text" class="search-input" id="mapSearch" placeholder="搜索：使用单位 / 注册代码 / 地址 / 区域..." oninput="window._debouncedSearchOnMap ? _debouncedSearchOnMap() : searchOnMap()" />
        <button class="btn btn-danger" onclick="clearMapSearch()">清除</button>
      </div>
      <div class="filter-chips">${chipsHTML}</div>
    </div>
    <div class="map-body">
      <div class="svg-map-container" id="svgMapContainer">
        <svg viewBox="0 0 ${DataManager.SVG_W} ${DataManager.SVG_H}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${DataManager.SVG_W}" height="${DataManager.SVG_H}" fill="#e8f4f8"/>
          <path d="M 20,80 Q 60,60 120,70 L 180,50 Q 250,40 300,60 L 380,45 Q 450,35 520,55 L 600,40 Q 680,30 750,50 L 780,80 L 780,500 L 750,520 Q 680,510 600,515 L 520,500 Q 450,520 380,505 L 300,520 Q 250,510 180,500 L 120,485 Q 60,490 20,470 Z" fill="#d4e6f1" stroke="#a9cce3" stroke-width="1.5"/>
          <line x1="400" y1="100" x2="380" y2="280" stroke="#c5cae9" stroke-width="1" stroke-dasharray="3,3"/>
          <line x1="380" y1="280" x2="450" y2="400" stroke="#c5cae9" stroke-width="1" stroke-dasharray="3,3"/>
          <line x1="500" y1="120" x2="550" y2="350" stroke="#c5cae9" stroke-width="1" stroke-dasharray="3,3"/>
          <line x1="300" y1="200" x2="350" y2="380" stroke="#c5cae9" stroke-width="1" stroke-dasharray="3,3"/>
          <path id="routeSvgPath" class="route-path" d=""/>
          ${labelsHTML}
          ${dotsHTML}
        </svg>
        <div class="map-tooltip" id="mapTooltip"></div>
      </div>
      <div class="search-results" id="mapSearchResults" style="display:none"></div>
    </div>
    <div class="map-legend">${legendHTML}</div>
  `;

  setupMapInteractions();
}

function setupMapInteractions() {
  const tooltip = document.getElementById('mapTooltip');
  const svgContainer = document.getElementById('svgMapContainer');

  document.querySelectorAll('.elev-dot').forEach(dot => {
    dot.addEventListener('mouseenter', function() {
      const idx = parseInt(this.getAttribute('data-index'));
      const d = DataManager.devices[idx];
      if (!d) return;
      const color = DataManager.distColors[d.district] || '#888';
      tooltip.innerHTML = `
        <div class="tt-name">${escapeHtml(d.unit_name || '未命名')}</div>
        <div class="tt-row">代码：${escapeHtml(d.reg_code || '-')}</div>
        <div class="tt-row">地址：${escapeHtml(d.address || '-')}</div>
        <div class="tt-row">区域：<span class="dist-tag" style="background:${color}">${escapeHtml(d.district || '-')}</span></div>
        <div class="tt-row">下次维保：${escapeHtml(d.next_date || '-')}</div>
      `;
      tooltip.style.display = 'block';
    });
    dot.addEventListener('mousemove', function(e) {
      const rect = svgContainer.getBoundingClientRect();
      tooltip.style.left = (e.clientX - rect.left + 10) + 'px';
      tooltip.style.top = (e.clientY - rect.top + 10) + 'px';
    });
    dot.addEventListener('mouseleave', function() {
      tooltip.style.display = 'none';
    });
  });
}

function searchOnMap() {
  const query = document.getElementById('mapSearch').value.toLowerCase().trim();
  const results = document.getElementById('mapSearchResults');
  const dots = document.querySelectorAll('.elev-dot');

  if (!query) {
    results.style.display = 'none';
    results.innerHTML = '';
    dots.forEach(d => { d.style.opacity = '0.85'; d.setAttribute('r', '4'); });
    return;
  }

  const filtered = DataManager.searchDevices(query);
  const matchIdx = filtered.map(d => d.index);

  dots.forEach(dot => {
    const idx = parseInt(dot.getAttribute('data-index'));
    if (matchIdx.includes(idx)) {
      dot.style.opacity = '1';
      dot.setAttribute('r', '7');
    } else {
      dot.style.opacity = '0.15';
      dot.setAttribute('r', '3');
    }
  });

  if (filtered.length > 0) {
    results.style.display = 'block';
    results.innerHTML = `<div style="font-size:13px;color:#888;margin-bottom:10px">找到 ${filtered.length} 台电梯</div>` +
      filtered.map(d => {
        const color = DataManager.distColors[d.district] || '#888';
        return `<div class="result-item" onclick="focusDevice(${d.index})">
          <div class="result-name">${d.unit_name || '未命名'}
            <span class="dist-tag" style="background:${color}">${d.district || '-'}</span>
          </div>
          <div class="result-meta">${d.reg_code || '-'} | ${d.address || '-'} | 维保：${d.next_date || '-'}</div>
        </div>`;
      }).join('');
  } else {
    results.style.display = 'block';
    results.innerHTML = '<div style="text-align:center;color:#999;padding:20px">未找到匹配的电梯</div>';
  }
}

function focusDevice(index) {
  const dots = document.querySelectorAll('.elev-dot');
  dots.forEach(dot => {
    const idx = parseInt(dot.getAttribute('data-index'));
    if (idx === index) {
      dot.setAttribute('r', '10');
      dot.style.opacity = '1';
      dot.dispatchEvent(new Event('mouseenter'));
    }
  });
}

function clearMapSearch() {
  document.getElementById('mapSearch').value = '';
  searchOnMap();
}

function filterByDistrict(district) {
  const dots = document.querySelectorAll('.elev-dot');
  const chip = document.getElementById('mapChip-' + district);

  if (currentFilter === district) {
    currentFilter = null;
    dots.forEach(d => { d.style.opacity = '0.85'; d.setAttribute('r', '4'); });
    chip.classList.remove('active');
    return;
  }

  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  currentFilter = district;
  chip.classList.add('active');

  dots.forEach(dot => {
    const idx = parseInt(dot.getAttribute('data-index'));
    const d = DataManager.devices[idx];
    if (d && d.district === district) {
      dot.style.opacity = '1';
      dot.setAttribute('r', '6');
    } else {
      dot.style.opacity = '0.1';
      dot.setAttribute('r', '3');
    }
  });
}

// ===== 定位校准弹窗 =====
const AMAP_KEY = 'e6249ece85ed6e839835f8b0bef72b55';
let _locateMarker = null;
let _locateRegCode = null;
let _locateMap = null;
let _locateSatellite = false;
let _locateStreetLayer = null;
let _locateSatLayer = null;

function openLocateModal(regCode) {
  const device = DataManager.devices.find(d => d.reg_code === regCode);
  if (!device) return;

  _locateRegCode = regCode;
  const overlay = document.getElementById('locateOverlay');
  const title = document.getElementById('locateTitle');
  const body = document.getElementById('locateBody');

  title.textContent = `${device.unit_name || '未命名'} - 定位校准`;
  const color = DataManager.distColors[device.district] || '#888';
  const hasCoord = device.lat && device.lng;
  const coordDisplay = hasCoord ? `${device.lat.toFixed(5)}, ${device.lng.toFixed(5)}` : '未定位';

  const center = _pickLocateCenter(device);

  body.innerHTML = `
    <div style="margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-weight:600;color:#2c3e50;font-size:15px">${device.unit_name || '未命名'}</span>
        <span class="dist-tag" style="background:${color}">${device.district || '-'}</span>
        <span class="geo-item-coord ${hasCoord ? 'has-coord' : 'no-coord'}" style="font-size:12px" id="locateCoordBadge">${coordDisplay}</span>
      </div>
      <div style="font-size:12px;color:#888;margin-top:4px">${device.address || '无地址信息'}</div>
    </div>
    <div class="locate-search-bar">
      <input type="text" id="locateSearchInput" placeholder="输入地名搜索，如：深圳北站、xx小区、xx路" onkeydown="if(event.key==='Enter')searchLocatePlace()" />
      <button class="btn btn-sm btn-info" onclick="searchLocatePlace()">搜索</button>
      <button class="btn btn-sm btn-info" onclick="locateToMe()">定位到我</button>
      <button class="btn btn-sm" id="locateLayerBtn" onclick="toggleLocateLayer()">卫星图</button>
    </div>
    <div id="locateSearchResults" class="locate-search-results"></div>
    <div id="locateLeafletMap" style="width:100%;height:360px;border-radius:8px;overflow:hidden;border:1px solid #d0d7de;margin-top:8px"></div>
    <div class="locate-coord-display">
      当前坐标：<span id="locateCoordText" style="font-family:'Courier New',monospace;color:#2c3e50">${hasCoord ? device.lat.toFixed(6)+', '+device.lng.toFixed(6) : '未定位（点击地图或搜索地名）'}</span>
      <input type="hidden" id="locateLat" value="${device.lat || ''}" />
      <input type="hidden" id="locateLng" value="${device.lng || ''}" />
    </div>
    <div class="locate-actions">
      <button class="btn btn-success" onclick="saveLocateFromModal('${regCode}')">保存定位</button>
      <button class="btn btn-primary" onclick="navigateToDevice('${regCode}');closeLocateModal()">一键导航</button>
    </div>
  `;

  overlay.classList.add('show');

  setTimeout(() => {
    _initLocateLeaflet(center, device);
    if (!hasCoord && device.address) {
      const si = document.getElementById('locateSearchInput');
      if (si) { si.value = device.address; searchLocatePlace(); }
    }
  }, 60);
}

function _pickLocateCenter(device) {
  if (device.lat && device.lng) return [device.lat, device.lng];
  if (device.district && DataManager.distCenter[device.district]) return DataManager.distCenter[device.district];
  return [22.65, 114.10];
}

function _initLocateLeaflet(center, device) {
  if (_locateMap) { _locateMap.remove(); _locateMap = null; }

  _locateMap = L.map('locateLeafletMap', {
    zoomControl: true,
    attributionControl: false
  }).setView(center, 16);

  _locateStreetLayer = L.tileLayer(
    'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    { subdomains: ['1','2','3','4'], maxZoom: 19 }
  ).addTo(_locateMap);

  _locateSatLayer = L.tileLayer(
    'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    { subdomains: ['1','2','3','4'], maxZoom: 18 }
  );

  const icon = L.divIcon({
    className: 'locate-pin',
    html: `<div style="width:28px;height:28px;background:${DataManager.distColors[device.district]||'#e74c3c'};border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`,
    iconSize: [28,28],
    iconAnchor: [14,28]
  });
  _locateMarker = L.marker(center, { draggable: true, icon }).addTo(_locateMap);

  _locateMap.on('click', (e) => {
    _locateMarker.setLatLng(e.latlng);
    _fillLocateInputs(e.latlng.lat, e.latlng.lng);
  });
  _locateMarker.on('dragend', (e) => {
    const ll = e.target.getLatLng();
    _fillLocateInputs(ll.lat, ll.lng);
  });

  _locateSatellite = false;
  _locateMap.invalidateSize();
}

function _fillLocateInputs(lat, lng) {
  document.getElementById('locateLat').value = lat.toFixed(6);
  document.getElementById('locateLng').value = lng.toFixed(6);
  const txt = document.getElementById('locateCoordText');
  if (txt) txt.textContent = lat.toFixed(6) + ', ' + lng.toFixed(6);
  const badge = document.getElementById('locateCoordBadge');
  if (badge) { badge.textContent = lat.toFixed(5) + ', ' + lng.toFixed(5); badge.classList.remove('no-coord'); badge.classList.add('has-coord'); }
}

async function searchLocatePlace() {
  const input = document.getElementById('locateSearchInput');
  const resultsBox = document.getElementById('locateSearchResults');
  const kw = (input.value || '').trim();
  if (!kw) { showToast('请输入搜索关键词', 'error'); return; }

  resultsBox.innerHTML = '<div class="locate-searching">搜索中...</div>';
  try {
    const url = `https://restapi.amap.com/v3/place/text?keywords=${encodeURIComponent(kw)}&city=深圳&citylimit=true&offset=10&page=1&key=${AMAP_KEY}`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.status !== '1' || !data.pois || data.pois.length === 0) {
      resultsBox.innerHTML = '<div class="locate-searching">未搜到结果，请换个关键词试试</div>';
      return;
    }

    let html = '';
    data.pois.forEach((p) => {
      if (!p.location) return;
      const [lng, lat] = p.location.split(',');
      html += `<div class="locate-result-item" onclick="selectLocateResult(${lat},${lng})">
        <div style="font-weight:600">${p.name || '未命名'}</div>
        <div style="font-size:11px;color:#999;margin-top:2px">${p.adname || ''} ${p.address || ''}</div>
      </div>`;
    });
    resultsBox.innerHTML = html || '<div class="locate-searching">未搜到有效结果</div>';
  } catch (err) {
    resultsBox.innerHTML = '<div class="locate-searching">搜索失败（网络问题），请重试</div>';
  }
}

function selectLocateResult(lat, lng) {
  if (_locateMap && _locateMarker) {
    _locateMap.setView([lat, lng], 17);
    _locateMarker.setLatLng([lat, lng]);
    _fillLocateInputs(lat, lng);
  }
  document.getElementById('locateSearchResults').innerHTML = '';
  document.getElementById('locateSearchInput').value = '';
  showToast('已跳转，可在地图上微调后保存', 'success');
}

function toggleLocateLayer() {
  if (!_locateMap) return;
  if (_locateSatellite) {
    _locateMap.removeLayer(_locateSatLayer);
    _locateStreetLayer.addTo(_locateMap);
    _locateSatellite = false;
    document.getElementById('locateLayerBtn').textContent = '切换卫星图';
  } else {
    _locateMap.removeLayer(_locateStreetLayer);
    _locateSatLayer.addTo(_locateMap);
    _locateSatellite = true;
    document.getElementById('locateLayerBtn').textContent = '切换街道图';
  }
}

function locateToMe() {
  if (!navigator.geolocation) { showToast('浏览器不支持定位', 'error'); return; }
  showToast('正在获取您的位置...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      if (_locateMap && _locateMarker) {
        _locateMap.setView([lat, lng], 17);
        _locateMarker.setLatLng([lat, lng]);
        _fillLocateInputs(lat, lng);
        showToast('已定位到您的位置', 'success');
      }
    },
    (err) => { showToast('定位失败：' + err.message, 'error'); },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function closeLocateModal() {
  document.getElementById('locateOverlay').classList.remove('show');
  if (_locateMap) { _locateMap.remove(); _locateMap = null; _locateMarker = null; }
}

function saveLocateFromModal(regCode) {
  const lat = parseFloat(document.getElementById('locateLat').value);
  const lng = parseFloat(document.getElementById('locateLng').value);

  if (isNaN(lat) || isNaN(lng)) {
    showToast('请先在地图上点击、搜索地名或定位到我', 'error');
    return;
  }

  if (lat < 22.0 || lat > 23.0 || lng < 113.5 || lng > 115.0) {
    if (!confirm('坐标超出深圳常见范围，是否仍要保存？')) return;
  }

  DataManager.updateLocation(regCode, lat, lng);
  showToast('定位已保存，下次导航将使用新坐标', 'success');
  closeLocateModal();
}
