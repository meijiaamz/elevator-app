/**
 * 维保e站导出表导入模块
 * ------------------------------------------------------------
 * 定位：以「维保e站」导出的设备表为唯一权威数据源（合同文件夹仅作参考）。
 * 能力：
 *   1) 解析 .xlsx/.xls 导出表（按表头名取列，不依赖列顺序）
 *   2) 与现有设备库比对：可新增 / 可更新 / 无变化
 *   3) 新设备无维保日期时自动按「合同开始日」排首次维保 → 避免备案后漏排
 *   4) 保护人工数据：已排的维保日期、已确认的年审日期、维保历史、经纬度不覆盖
 * 依赖：SheetJS（首次点击时才从 CDN 懒加载，不拖慢后台打开速度）
 */

var SITE_SZ_DISTRICTS = ['福田区', '罗湖区', '南山区', '宝安区', '龙岗区', '龙华区',
  '盐田区', '坪山区', '光明区', '大鹏新区'];

// 表头 → 字段（按"包含"匹配，兼容字段名带 * 前缀、带括号说明的各种导出版本）
var SITE_HEADER_MAP = [
  ['设备注册代码', 'reg_code'],
  ['注册代码', 'reg_code'],
  ['使用单位名称', 'unit_name'],
  ['使用单位', 'unit_name'],
  ['设备使用地点', 'address'],
  ['使用地点', 'address'],
  ['设备使用区域名称', 'area_raw'],
  ['使用区域', 'area_raw'],
  ['维保小组名称', 'team'],
  ['维保小组', 'team'],
  ['维保周期', 'cycle'],
  ['下次维保日期', 'next_date'],
  ['维保合同开始日期', 'contract_start_date'],
  ['维保合同结束日期', 'contract_end_date'],
  ['设备状态', 'status'],
  ['下次检验日期', 'next_inspection_date'],
  ['下次检测日期', 'next_detect_date']
];

// 允许用e站数据更正的字段（人工维护的字段不在此列）
var SITE_UPDATE_FIELDS = ['unit_name', 'address', 'district', 'street', 'team',
  'contract_start_date', 'contract_end_date', 'cycle', 'status',
  'next_inspection_date', 'next_detect_date'];

var SiteImporter = {
  _result: null,
  _fileName: '',

  /** 懒加载 SheetJS */
  loadLib: function () {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (window._xlsxLoading) return window._xlsxLoading;
    var urls = [
      'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
      'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js'
    ];
    window._xlsxLoading = new Promise(function (resolve, reject) {
      var i = 0;
      function tryNext() {
        if (i >= urls.length) { reject(new Error('Excel 解析库加载失败，请检查网络')); return; }
        var s = document.createElement('script');
        s.src = urls[i++];
        s.onload = function () { resolve(window.XLSX); };
        s.onerror = tryNext;
        document.head.appendChild(s);
      }
      tryNext();
    });
    return window._xlsxLoading;
  },

  _pad: function (n) { return String(n).padStart(2, '0'); },

  _toDateStr: function (v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date) {
      return v.getFullYear() + '-' + this._pad(v.getMonth() + 1) + '-' + this._pad(v.getDate());
    }
    var s = String(v).trim();
    var m = s.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
    if (m) return m[1] + '-' + this._pad(m[2]) + '-' + this._pad(m[3]);
    return s;
  },

  normDistrict: function (v) {
    var s = String(v || '').trim();
    if (!s) return '';
    for (var i = 0; i < SITE_SZ_DISTRICTS.length; i++) {
      if (s.indexOf(SITE_SZ_DISTRICTS[i]) !== -1) return SITE_SZ_DISTRICTS[i];
    }
    var m = s.match(/([\u4e00-\u9fa5]{2,4}区)/);
    return m ? m[1] : s;
  },

  /** 解析整个工作簿 → 设备数组 */
  parseWorkbook: function (wb) {
    var self = this;
    var out = [];
    wb.SheetNames.forEach(function (name) {
      var ws = wb.Sheets[name];
      if (!ws) return;
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
      if (!rows || !rows.length) return;

      // 定位表头行（前 8 行里含"注册代码"的那一行）
      var hi = -1;
      for (var i = 0; i < Math.min(8, rows.length); i++) {
        var joined = (rows[i] || []).map(function (c) { return c == null ? '' : String(c); }).join('');
        if (joined.indexOf('注册代码') !== -1) { hi = i; break; }
      }
      if (hi === -1) return;

      var headers = rows[hi] || [];
      var colmap = {};
      headers.forEach(function (h, idx) {
        var hs = String(h == null ? '' : h).replace(/\s/g, '');
        for (var k = 0; k < SITE_HEADER_MAP.length; k++) {
          var key = SITE_HEADER_MAP[k][0];
          if (hs === key || (key.length > 4 && hs.indexOf(key) !== -1)) {
            if (colmap[SITE_HEADER_MAP[k][1]] === undefined) colmap[SITE_HEADER_MAP[k][1]] = idx;
            break;
          }
        }
      });
      if (colmap.reg_code === undefined) return;

      for (var r = hi + 1; r < rows.length; r++) {
        var row = rows[r] || [];
        var code = String(row[colmap.reg_code] == null ? '' : row[colmap.reg_code]).trim();
        // 注册代码可能含字母（如 3430130272026Q8029），不能只允许纯数字
        if (!/^[0-9A-Za-z]{12,22}$/.test(code)) continue;

        var dev = { reg_code: code };
        Object.keys(colmap).forEach(function (field) {
          if (field === 'reg_code') return;
          var idx = colmap[field];
          var val = row[idx];
          if (val === null || val === undefined || String(val).trim() === '') return;

          if (field === 'cycle') {
            var n = parseFloat(String(val));
            dev.cycle = isNaN(n) ? 15 : Math.round(n);
          } else if (field === 'area_raw') {
            var raw = String(val).trim();
            dev.district = self.normDistrict(raw);
            // 只取街道名（去掉"深圳市XX区"前缀），供部门归属判断使用
            var sm = raw.match(/深圳市.*?区(.+?)(?:街道|办事处)/);
            if (sm) dev.street = sm[1];
          } else if (/_date$/.test(field)) {
            var ds = self._toDateStr(val);
            if (ds.indexOf('2099') === 0) return;   // 2099 = 导出表"无需检验/检测"占位
            if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) dev[field] = ds;
          } else {
            dev[field] = String(val).trim();
          }
        });

        if (!dev.cycle) dev.cycle = 15;
        dev.annual_inspection_manual = false;
        // 年审参考日：取"下次检验/下次检测"中较早的一个，导入后年审页即可给出建议
        var cand = [dev.next_inspection_date, dev.next_detect_date].filter(Boolean).sort();
        if (cand.length) dev.annual_inspection_date = cand[0];
        dev.source = 'e站';
        out.push(dev);
      }
    });
    return out;
  },

  /** 与现有设备库比对 */
  diff: function (incoming, updateExisting) {
    var have = {};
    DataManager.devices.forEach(function (d) { if (d.reg_code) have[d.reg_code] = d; });

    var seen = {};
    var news = [], updates = [], same = 0;

    incoming.forEach(function (d) {
      if (seen[d.reg_code]) return;
      seen[d.reg_code] = true;

      var old = have[d.reg_code];
      if (!old) { news.push(d); return; }

      if (!updateExisting) { same++; return; }

      var changes = {};
      SITE_UPDATE_FIELDS.forEach(function (f) {
        var v = d[f];
        if (v === null || v === undefined || String(v).trim() === '') return;
        // 合同结束日不允许被"改早"（防止误用旧导出表覆盖新合同）
        if (f === 'contract_end_date' && /^\d{4}-\d{2}-\d{2}$/.test(String(old[f] || ''))
            && String(v) < String(old[f])) return;
        if (String(old[f] == null ? '' : old[f]) !== String(v)) changes[f] = v;
      });
      // 维保日期只在原本为空时补，人工调过的一律保留
      if (!old.next_date && d.next_date) changes.next_date = d.next_date;
      // 年审参考日：未在后台确认过才随e站刷新
      if (d.annual_inspection_date && old.annual_inspection_manual !== true
          && String(old.annual_inspection_date || '') !== String(d.annual_inspection_date)) {
        changes.annual_inspection_date = d.annual_inspection_date;
      }

      if (Object.keys(changes).length) updates.push({ dev: old, src: d, changes: changes });
      else same++;
    });

    return { news: news, updates: updates, same: same };
  }
};

// ===== 界面 =====
function openSiteImport() {
  var ov = document.getElementById('siteImportOverlay');
  if (!ov) return;
  SiteImporter._result = null;
  document.getElementById('siteImportSummary').innerHTML = '';
  document.getElementById('siteImportTableWrap').style.display = 'none';
  document.getElementById('siteImportConfirmBtn').style.display = 'none';
  var fi = document.getElementById('siteFileInput');
  if (fi) fi.value = '';
  ov.classList.add('show');
}

function closeSiteImport() {
  var ov = document.getElementById('siteImportOverlay');
  if (ov) ov.classList.remove('show');
}

function onSiteFileSelected(ev) {
  var file = ev.target.files && ev.target.files[0];
  if (!file) return;
  var summary = document.getElementById('siteImportSummary');
  summary.innerHTML = '正在解析 <b>' + _escPending(file.name) + '</b> ...';

  SiteImporter.loadLib().then(function () {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var wb = XLSX.read(new Uint8Array(reader.result), { type: 'array', cellDates: true });
        var incoming = SiteImporter.parseWorkbook(wb);
        if (!incoming.length) {
          summary.innerHTML = '<span style="color:#e74c3c">没解析到设备记录。请确认这是「维保e站」导出的设备清单表（表头需含"注册代码"）。</span>';
          return;
        }
        var updateExisting = document.getElementById('siteUpdateExisting').checked;
        var res = SiteImporter.diff(incoming, updateExisting);
        res.srcName = file.name;
        SiteImporter._result = res;
        SiteImporter._fileName = file.name;
        renderSiteImportPreview(res, incoming.length);
      } catch (e) {
        summary.innerHTML = '<span style="color:#e74c3c">解析失败：' + _escPending(e.message) + '</span>';
      }
    };
    reader.readAsArrayBuffer(file);
  }).catch(function (e) {
    summary.innerHTML = '<span style="color:#e74c3c">' + _escPending(e.message) + '</span>';
  });
}

function renderSiteImportPreview(res, parsed) {
  var todayStr = fmtDate(new Date());
  var summary = document.getElementById('siteImportSummary');
  var html = '文件解析 <b>' + parsed + '</b> 台 ｜ 可新增 <b style="color:#27ae60">' + res.news.length + '</b> 台'
    + ' ｜ 可更正 <b style="color:#e67e22">' + res.updates.length + '</b> 台'
    + ' ｜ 无变化 ' + res.same + ' 台';
  if (res.news.length) {
    var willAuto = res.news.filter(function (d) { return !d.next_date; }).length;
    if (willAuto) html += '<br>其中 <b>' + willAuto + '</b> 台没有维保日期，将自动按合同开始日排首次维保（已过则取今天），不会漏排。';
  }
  summary.innerHTML = html;

  var rows = [];
  res.news.forEach(function (d) {
    var start = d.contract_start_date || '';
    var next = d.next_date || ((/^\d{4}-\d{2}-\d{2}$/.test(start) && start > todayStr) ? start : todayStr);
    rows.push('<tr>'
      + '<td><span style="color:#27ae60;font-weight:600">新增</span></td>'
      + '<td>' + _escPending(d.unit_name || '(未填单位)') + '</td>'
      + '<td>' + _escPending(d.reg_code) + '</td>'
      + '<td>' + _escPending(d.district || '-') + '</td>'
      + '<td>' + _escPending((start || '?') + ' ~ ' + (d.contract_end_date || '?')) + '</td>'
      + '<td>' + _escPending(next) + '</td></tr>');
  });
  res.updates.forEach(function (u) {
    var d = u.dev;
    var keys = Object.keys(u.changes);
    var tip = keys.slice(0, 3).map(function (k) { return k + '→' + u.changes[k]; }).join('，');
    if (keys.length > 3) tip += ' 等' + keys.length + '项';
    rows.push('<tr>'
      + '<td><span style="color:#e67e22;font-weight:600">更正</span></td>'
      + '<td>' + _escPending(d.unit_name || '(未填单位)') + '<br><span style="font-size:11px;color:#95a5a6">' + _escPending(tip) + '</span></td>'
      + '<td>' + _escPending(d.reg_code) + '</td>'
      + '<td>' + _escPending(d.district || '-') + '</td>'
      + '<td>' + _escPending((d.contract_start_date || '?') + ' ~ ' + (d.contract_end_date || '?')) + '</td>'
      + '<td>' + _escPending(d.next_date || '未排') + '</td></tr>');
  });

  var body = document.getElementById('siteImportBody');
  body.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="6"><div class="pending-empty">表内设备都已在系统中，且没有需要更正的信息</div></td></tr>';
  document.getElementById('siteImportTableWrap').style.display = rows.length ? 'block' : 'none';

  var btn = document.getElementById('siteImportConfirmBtn');
  btn.style.display = (res.news.length || res.updates.length) ? 'inline-block' : 'none';
  btn.textContent = '确认导入（新增 ' + res.news.length + ' / 更正 ' + res.updates.length + '）';
}

function confirmSiteImport() {
  var res = SiteImporter._result;
  if (!res) return;
  if (!confirm('确认导入？\n新增 ' + res.news.length + ' 台，更正 ' + res.updates.length + ' 台。\n导入后会同步到云端，所有设备刷新即可看到。')) return;

  var todayStr = fmtDate(new Date());
  var added = 0, updated = 0;

  res.news.forEach(function (d) {
    var dev = {};
    Object.keys(d).forEach(function (k) { dev[k] = d[k]; });
    if (!dev.next_date) {
      var start = dev.contract_start_date || '';
      dev.next_date = (/^\d{4}-\d{2}-\d{2}$/.test(start) && start > todayStr) ? start : todayStr;
    }
    dev.index = DataManager.devices.length;
    if ((!dev.lat || !dev.lng) && dev.district && DataManager.distCenter && DataManager.distCenter[dev.district]) {
      dev.lat = DataManager.distCenter[dev.district][0];
      dev.lng = DataManager.distCenter[dev.district][1];
    }
    DataManager.devices.push(dev);
    added++;
  });

  res.updates.forEach(function (u) {
    Object.keys(u.changes).forEach(function (k) { u.dev[k] = u.changes[k]; });
    updated++;
  });

  DataManager._buildLocationsFromDevices();
  DataManager.regenerateSchedule();
  // 先写操作日志再保存，保存失败也留痕
  OperationLog.add('批量导入', added + '新增/' + updated + '更正', '维保e站导出表：' + (res.srcName || ''));
  DataManager.save();

  closeSiteImport();
  renderStats();
  renderDeviceTable();
  showToast('导入完成：新增 ' + added + ' 台，更正 ' + updated + ' 台，维保日历已更新', 'success');
}
