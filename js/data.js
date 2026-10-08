/**
 * 数据管理模块 - 负责数据加载、存储、增删改查
 * 数据来源：优先从 localStorage 读取用户修改后的数据，否则从 JSON 文件加载
 */
const DataManager = {
  DATA_VERSION: '2026-09-18-v40',
  // 云端同步配置（jsonbin.io 公开读取，无需Key；写入需后台设置 _cloudKey）
  CLOUD_BIN_ID: '6a6d4c4ef5f4af5e29dc5981',
  _cloudKey: null,      // 后台管理页设置此值后，save() 自动同步到云端
  _lastCloudSync: 0,    // 最近一次已知云端数据时间戳（用于冲突检测）
  _localSyncedAt: 0,    // 本地数据的时间戳；大于 _lastCloudSync 表示有未同步成功的修改
  _conflictCache: null, // 冲突检测结果缓存 { at, latestTime, devices }，5 秒内复用减少请求
  _loading: false,      // 加载中标记，防止 load 内的 save 触发云端写入
  onCloudSync: null,    // 云端同步回调（后台可用作提示）
  devices: [],
  schedule: [],
  locations: [],
  distColors: {
    "龙华区": "#3498DB", "宝安区": "#E74C3C", "龙岗区": "#9B59B6",
    "福田区": "#F39C12", "南山区": "#1ABC9C", "罗湖区": "#2ECC71",
    "光明区": "#E67E22", "坪山区": "#D35400", "盐田区": "#16A085", "大鹏新区": "#95A5A6"
  },
  // 区域默���中心坐标（新增设备无坐标时自动使用）
  distCenter: {
    "宝安区": [22.67, 113.88], "光明区": [22.78, 113.93],
    "龙华区": [22.72, 114.05], "南山区": [22.53, 113.93],
    "福田区": [22.54, 114.06], "罗湖区": [22.56, 114.13],
    "龙岗区": [22.72, 114.25], "坪山区": [22.69, 114.35],
    "盐田区": [22.56, 114.24], "大鹏新区": [22.60, 114.48]
  },
  // 深圳经纬度边界
  LAT_MIN: 22.35, LAT_MAX: 22.85,
  LNG_MIN: 113.75, LNG_MAX: 114.65,
  SVG_W: 800, SVG_H: 550,

  /** 加载数据：本地优先，但云端有更新时自动覆盖 */
  async load() {
    this._loading = true;
    try {
      // 1. 优先读 localStorage（本设备的最新修改）
      let localData = null;
      const local = localStorage.getItem('elevator_data');
      if (local) {
        try {
          const parsed = JSON.parse(local);
          if (parsed.devices && parsed.devices.length > 0) {
            localData = parsed;
          }
        } catch (e) {
          console.warn('localStorage 数据损坏', e);
        }
      }

      // 2. 尝试云端（其他设备可能有更新）
      let cloudData = null;
      try {
        cloudData = await this.cloudLoad();
      } catch (e) {
        console.warn('云端加载失败:', e.message);
      }

      // 3. 判断哪个更新：优先比较 syncedAt 时间戳；没有时间戳再比较设备数
      const localTime = localData && localData.syncedAt ? new Date(localData.syncedAt).getTime() : 0;
      const cloudTime = cloudData && cloudData.syncedAt ? new Date(cloudData.syncedAt).getTime() : 0;
      const cloudNewer = cloudTime > localTime;
      const localNewer = localTime > cloudTime;

      if (cloudNewer && cloudData && cloudData.devices && cloudData.devices.length > 0) {
        this.devices = cloudData.devices;
        this._buildLocationsFromDevices();
        this._mergeLocations();
        this.regenerateSchedule();
        this._lastCloudSync = cloudTime;
        this.save();
        console.log('数据从云端加载（云端更新）:', cloudData.devices.length, '台设备, 同步于:', cloudData.syncedAt);
        return;
      }

      if (localData && (localNewer || !cloudNewer)) {
        if (localData.version !== this.DATA_VERSION) {
          console.log('本地缓存版本升级: ' + localData.version + ' → ' + this.DATA_VERSION);
          // 版本升级时若本地数据比云端新 → 说明有未同步成功的修改（如曾被限流保存失败），
          // 必须保留本地数据（仅升级版本号重写缓存），绝不能清缓存用云端旧数据覆盖。
          if (localNewer && cloudData && cloudData.devices && cloudData.devices.length > 0) {
            this.devices = localData.devices;
            this.schedule = localData.schedule || [];
            this.locations = localData.locations || [];
            this._mergeLocations();
            this.regenerateSchedule();
            this._lastCloudSync = cloudTime;
            this._localSyncedAt = localTime;   // 标记本地较新，后台加载后会自动补传云端
            this.save();
            console.log('版本升级但本地较新（含未同步修改），已保留:', this.devices.length, '台，待推送云端');
            return;
          }
          // 本地不比云端新 → 才允许清缓存切换到云端
          localStorage.removeItem('elevator_data');
          if (cloudData && cloudData.devices && cloudData.devices.length > 0) {
            this.devices = cloudData.devices;
            this._buildLocationsFromDevices();
            this._mergeLocations();
            this.regenerateSchedule();
            this._lastCloudSync = cloudTime;
            this.save();
            console.log('版本不匹配，已切换到云端数据:', cloudData.devices.length, '台');
            return;
          }
        }
        this.devices = localData.devices;
        this.schedule = localData.schedule || [];
        this.locations = localData.locations || [];
        this._mergeLocations();
        this.regenerateSchedule();
        this._lastCloudSync = cloudTime;
        this._localSyncedAt = localTime;   // 记录本地数据时间，供后台检测“本地比云端新”并补传
        this.save();
        console.log('数据从本地加载:', this.devices.length, '台设备');
        return;
      }

      if (cloudData && cloudData.devices && cloudData.devices.length > 0) {
        this.devices = cloudData.devices;
        this._buildLocationsFromDevices();
        this._mergeLocations();
        this.regenerateSchedule();
        this._lastCloudSync = cloudTime;
        this._localSyncedAt = 0;
        this.save();
        console.log('数据从云端加载:', cloudData.devices.length, '台设备, 同步于:', cloudData.syncedAt || '未知');
        return;
      }

      // 4. 本地 JSON 文件（首次加载兜底）
      const [devRes, schedRes, locRes] = await Promise.all([
        fetch('data/devices.json').then(r => r.json()),
        fetch('data/schedule.json').then(r => r.json()),
        fetch('data/locations.json').then(r => r.json())
      ]);
      this.devices = devRes;
      this.schedule = schedRes.schedule || schedRes;
      this.locations = locRes.devices || locRes;
      this._mergeLocations();
      this._lastCloudSync = 0;
      this.save();
    } finally {
      this._loading = false;
    }
  },

  /** 将经纬度信息合并到设备数据中（仅填充缺失的，不覆盖已校准坐标） */
  _mergeLocations() {
    const locMap = {};
    this.locations.forEach(l => { locMap[l.reg_code] = l; });
    this.devices.forEach(d => {
      const loc = locMap[d.reg_code];
      if (loc && (!d.lat || !d.lng)) {
        d.lat = loc.lat;
        d.lng = loc.lng;
      } else if (!d.lat) {
        d.lat = 22.65;
        d.lng = 114.10;
      }
    });
  },

  /** 保存到 localStorage（后台有 Key 时自动同步云端）
   *  注意：不再写入 schedule —— 它体积约 1.2MB 且每次加载都由 regenerateSchedule() 重算，
   *  存它会把手机/微信浏览器的 localStorage 撑爆（配额常仅 1~2MB），
   *  导致设备与操作日志都写不进去。去掉后本地占用从约 1.3MB 降到约 85KB。 */
  save(syncCloud = true) {
    const syncedAt = new Date().toISOString();
    const dataStr = JSON.stringify({
      version: this.DATA_VERSION,
      devices: this.devices,
      locations: this.locations,
      syncedAt: syncedAt
    });
    try {
      localStorage.setItem('elevator_data', dataStr);
    } catch (e) {
      console.warn('localStorage 写入失败（可能容量已满）:', e.message);
      // 旧版本曾在本地存了体积巨大的 schedule，可能占满配额 → 清掉旧记录后重试一次
      try {
        localStorage.removeItem('elevator_data');
        localStorage.setItem('elevator_data', dataStr);
        console.log('已清理旧缓存（含巨型 schedule）后重新写入成功');
      } catch (e2) {
        console.warn('清理后仍写入失败:', e2.message);
        if (typeof showToast === 'function') showToast('本地存储空间不足，请清理浏览器缓存', 'error');
      }
    }
    // 后台管理页设置了 Key 且非加载中 → 异步同步到云端
    if (syncCloud && this._cloudKey && !this._loading) {
      console.log('save: 触发云端同步，设备数=' + this.devices.length);
      this.cloudSave().then(ok => {
        console.log('save: 云端同步完成=' + ok);
      }).catch(e => {
        console.warn('save: 云端同步失败:', e.message);
        if (typeof this.onCloudSync === 'function') this.onCloudSync(false, e.message);
      });
    } else {
      console.log('save: 跳过云端同步 (cloudKey=' + !!this._cloudKey + ', loading=' + this._loading + ')');
    }
  },

  /** 从云端读取数据（公开 bin，无需 Key；带时间戳绕过缓存） */
  async cloudLoad() {
    const url = 'https://api.jsonbin.io/v3/b/' + this.CLOUD_BIN_ID + '/latest?t=' + Date.now();
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('云端读取失败: ' + resp.status);
    const data = await resp.json();
    return data.record || null;
  },

  /** 写入数据到云端（需 _cloudKey，仅后台管理页调用；最多重试3次）
   *  写入前先读云端时间戳：若云端在本次页面加载之后被其他页面/设备更新过，
   *  说明当前页面持有的是旧数据，直接覆盖会把别人的修改冲掉 —— 此时改为采用云端数据并提示。
   *  注意：jsonbin 免费版有请求频率限制，连续新增设备时容易触发 429，
   *  因此冲突检测加了 5 秒节流复用、429 用更长退避，避免误报同步失败。 */
  async cloudSave(retries = 3) {
    if (!this._cloudKey) return false;

    // 冲突检测：5 秒内复用上次读取结果，减少请求数（避免频繁 GET 触发限流）
    const nowMs = Date.now();
    let latestTime = 0;
    let latestDevices = null;
    if (this._conflictCache && (nowMs - this._conflictCache.at) < 5000) {
      latestTime = this._conflictCache.latestTime;
      latestDevices = this._conflictCache.devices;
    } else {
      try {
        const latest = await this.cloudLoad();
        latestTime = latest && latest.syncedAt ? new Date(latest.syncedAt).getTime() : 0;
        latestDevices = latest && latest.devices ? latest.devices : null;
        this._conflictCache = { at: nowMs, latestTime: latestTime, devices: latestDevices };
      } catch (e) {
        // 冲突检测失败（网络问题）→ 继续尝试保存
        console.warn('云端冲突检测失败，继续保存:', e.message);
      }
    }

    const knownTime = this._lastCloudSync || 0;
    if (latestTime > knownTime + 2000 && latestDevices && latestDevices.length > 0) {
      // 云端有更新的数据 → 采用云端，放弃本次覆盖，避免旧数据回写
      this.devices = latestDevices;
      this._buildLocationsFromDevices();
      this._mergeLocations();
      this.regenerateSchedule();
      this._lastCloudSync = latestTime;
      this.save(false);
      if (typeof this.onCloudConflict === 'function') this.onCloudConflict();
      return false;
    }

    const syncedAt = new Date().toISOString();
    const payload = JSON.stringify({
      version: this.DATA_VERSION,
      devices: this.devices,
      syncedAt: syncedAt
    });
    // 提前发现超限，给出明确提示。
    // 注意：jsonbin 免费版按 UTF-8 字节计费（中文每字 3 字节），不能用 payload.length（字符数）判断！
    var payloadBytes = new TextEncoder().encode(payload).length;
    if (payloadBytes > 100000) {
      throw new Error('数据量 ' + Math.round(payloadBytes / 1024) + 'KB 超出云端 100KB 限制，请联系技术人员清理');
    }
    let lastErr = null;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const resp = await fetch('https://api.jsonbin.io/v3/b/' + this.CLOUD_BIN_ID, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Master-Key': this._cloudKey
          },
          body: payload
        });
        if (resp.ok) {
          this._lastCloudSync = new Date(syncedAt).getTime();
          // 更新冲突缓存，避免紧接着的操作重复读取
          this._conflictCache = { at: Date.now(), latestTime: this._lastCloudSync, devices: this.devices.slice() };
          if (typeof this.onCloudSync === 'function') this.onCloudSync(true);
          return true;
        }
        if (resp.status === 429) {
          // 限流：等待更久再重试（3s / 6s），通常能成功
          lastErr = new Error('云端请求过于频繁（429），正在重试');
          if (attempt < retries - 1) {
            await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); // 2s / 4s
            continue;
          }
        } else if (resp.status === 413) {
          lastErr = new Error('数据量超出云端限制（413），请联系技术人员');
          break;
        } else {
          lastErr = new Error('云端保存失败: ' + resp.status);
        }
      } catch (e) {
        lastErr = e;
      }
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // 1s / 2s 退避
      }
    }
    throw lastErr || new Error('云端保存失败');
  },

  /** 强制从云端同步（覆盖本地数据） */
  async forceCloudSync() {
    const cloudData = await this.cloudLoad();
    if (cloudData && cloudData.devices && cloudData.devices.length > 0) {
      this.devices = cloudData.devices;
      this._buildLocationsFromDevices();
      this._mergeLocations();
      this.regenerateSchedule();
      this.save();
      return { ok: true, count: cloudData.devices.length, syncedAt: cloudData.syncedAt };
    }
    return { ok: false, message: '云端没有可用数据' };
  },

  /** 批量更新某个区域/全部设备的 next_date */
  batchUpdateNextDate(options) {
    const { district, targetDate, newDate, all = false } = options;
    let count = 0;
    this.devices.forEach(d => {
      if (all || (district && d.district === district)) {
        // 指定日期时按完整排期匹配，而不是只比较设备的 next_date 节点。
        if (targetDate) {
          const day = (this.schedule || []).find(item => item.date === targetDate);
          const scheduled = day && (day.devices || []).some(item => item.reg_code === d.reg_code && !item.historical);
          if (!scheduled) return;
        }
        d.next_date = newDate;
        count++;
      }
    });
    if (count > 0) {
      this.regenerateSchedule();
      this.save();
    }
    return count;
  },

  /** 从设备数据重建 locations（云端加载后使用） */
  _buildLocationsFromDevices() {
    this.locations = this.devices.map((d, i) => ({
      reg_code: d.reg_code,
      unit_name: d.unit_name,
      address: d.address,
      district: d.district,
      street: d.street || '',
      next_date: d.next_date || '',
      lat: d.lat,
      lng: d.lng,
      color: this.distColors[d.district] || '#888',
      index: i
    }));
  },

  /** 经纬度转 SVG 坐标 */
  latlngToSvg(lat, lng) {
    const x = ((lng - this.LNG_MIN) / (this.LNG_MAX - this.LNG_MIN)) * this.SVG_W;
    const y = ((this.LAT_MAX - lat) / (this.LAT_MAX - this.LAT_MIN)) * this.SVG_H;
    return { x: Math.round(x, 1), y: Math.round(y, 1) };
  },

  /** SVG 坐标逆转经纬度（用于定位校准界面） */
  svgToLatLng(x, y) {
    const lng = (x / this.SVG_W) * (this.LNG_MAX - this.LNG_MIN) + this.LNG_MIN;
    const lat = this.LAT_MAX - (y / this.SVG_H) * (this.LAT_MAX - this.LAT_MIN);
    return { lat: Math.round(lat, 6), lng: Math.round(lng, 6) };
  },

  /** 获取所有区域列表 */
  getDistricts() {
    const districts = {};
    this.devices.forEach(d => {
      const dist = d.district || '未分类';
      districts[dist] = (districts[dist] || 0) + 1;
    });
    return districts;
  },

  /** 按日期获取设备列表 */
  getDevicesByDate(date) {
    const day = this.schedule.find(s => s.date === date);
    return day ? day.devices : [];
  },

  /** 按区域获取设备列表 */
  getDevicesByDistrict(district) {
    return this.devices.filter(d => d.district === district);
  },

  /** 搜索设备 */
  searchDevices(query) {
    if (!query) return this.devices;
    const q = query.toLowerCase().trim();
    return this.devices.filter(d =>
      (d.unit_name && d.unit_name.toLowerCase().includes(q)) ||
      (d.reg_code && d.reg_code.toLowerCase().includes(q)) ||
      (d.address && d.address.toLowerCase().includes(q)) ||
      (d.district && d.district.toLowerCase().includes(q)) ||
      (d.street && d.street.toLowerCase().includes(q)) ||
      (d.team && d.team.toLowerCase().includes(q))
    );
  },

  /** 添加设备 */
  addDevice(device) {
    device.index = this.devices.length;
    // 无坐标时，自动使用区域中心坐标
    if ((!device.lat || !device.lng) && device.district && this.distCenter[device.district]) {
      const [lat, lng] = this.distCenter[device.district];
      device.lat = lat;
      device.lng = lng;
    }
    this.devices.push(device);
    // 添加位置信息
    if (device.lat && device.lng) {
      this.locations.push({
        reg_code: device.reg_code,
        unit_name: device.unit_name,
        address: device.address,
        district: device.district,
        street: device.street || '',
        next_date: device.next_date || '',
        lat: device.lat,
        lng: device.lng,
        color: this.distColors[device.district] || '#888',
        index: this.locations.length
      });
    }
    this.regenerateSchedule();
    // 先记录操作日志再保存：万一本机存储写满导致保存失败，也能留下操作痕迹便于追溯
    OperationLog.add('新增', device.reg_code, device.unit_name + ' (' + (device.district || '') + ')');
    this.save();
  },

  /** 更新设备 */
  updateDevice(regCode, updates) {
    const idx = this.devices.findIndex(d => d.reg_code === regCode);
    if (idx >= 0) {
      this.devices[idx] = { ...this.devices[idx], ...updates };
      // 更新位置信息
      const locIdx = this.locations.findIndex(l => l.reg_code === regCode);
      if (locIdx >= 0) {
        this.locations[locIdx] = { ...this.locations[locIdx], ...updates };
      }
      this.regenerateSchedule();
      var changed = Object.keys(updates).filter(function(k) { return k !== 'index'; }).join(', ');
      // 先记录日志再保存，保存失败也留有痕迹
      OperationLog.add('修改', regCode, (this.devices[idx].unit_name || '') + ' → ' + changed);
      this.save();
    }
  },

  /** 更新设备定位坐标 */
  updateLocation(regCode, lat, lng) {
    const dev = this.devices.find(d => d.reg_code === regCode);
    if (!dev) return;
    dev.lat = lat;
    dev.lng = lng;
    // 同步到 locations
    const loc = this.locations.find(l => l.reg_code === regCode);
    if (loc) {
      loc.lat = lat;
      loc.lng = lng;
    } else {
      // 如果 locations 中没有，创建一条
      this.locations.push({
        reg_code: regCode,
        unit_name: dev.unit_name,
        address: dev.address,
        district: dev.district,
        lat: lat,
        lng: lng,
        index: this.locations.length
      });
    }
    this.save();
  },

  /** 删除设备 */
  deleteDevice(regCode) {
    var dev = this.devices.find(function(d) { return d.reg_code === regCode; });
    var name = dev ? (dev.unit_name || '') : '';
    this.devices = this.devices.filter(d => d.reg_code !== regCode);
    this.locations = this.locations.filter(l => l.reg_code !== regCode);
    // 重新索引
    this.devices.forEach((d, i) => { d.index = i; });
    this.locations.forEach((l, i) => { l.index = i; });
    this.regenerateSchedule();
    // 先记录日志再保存，保存失败也留有痕迹
    OperationLog.add('删除', regCode, name);
    this.save();
  },

  /**
   * 重新生成维保排期（15天周期）
   * 从每台设备的 next_date 按 15 天周期向“年初”和“年底”两个方向展开，
   * 过去日期（< 今天）标记 historical 灰显保留在原月份，今天及以后为待办计划。
   * 不再把过去记录推进到当月，历史月份始终完整保留。
   */
  regenerateSchedule() {
    const schedule = {};
    const y = this.currentYear();
    const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
    const yearStart = new Date(y, 0, 1);                 // 当年 1-1
    const endDate = new Date(y, 11, 31);                 // 当年 12-31
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // 今天零点（本地时区）

    function ensureDay(dateStr, cur) {
      if (!schedule[dateStr]) {
        schedule[dateStr] = {
          date: dateStr,
          weekday: weekdays[cur.getDay()],
          total: 0,
          hist_total: 0,
          districts: '',
          devices: []
        };
      }
      return schedule[dateStr];
    }

    function pushDevice(day, d, historical) {
      // 同一设备同一天只保留一条
      if (day.devices.find(dd => dd.reg_code === d.reg_code)) return;
      day.devices.push({
        reg_code: d.reg_code,
        unit_name: d.unit_name,
        address: d.address,
        district: d.district,
        street: d.street || '',
        team: d.team || '',
        weekday: day.weekday,
        historical: !!historical,
        annual_inspection_date: d.annual_inspection_manual === true ? (d.annual_inspection_date || null) : null
      });
      if (historical) day.hist_total = (day.hist_total || 0) + 1;
      else day.total++;
    }

    /** 计算单台设备全年周期：{ dateStr: historical }（历史日期 = 早于今天） */
    function buildDevicePlan(d) {
      const plan = {};
      if (!d.next_date) return plan;
      const base = parseLocalDate(d.next_date);
      if (isNaN(base.getTime())) return plan;
      // 设备列表中的下一次维保日期若已超过合同结束日，视为无效，不进入排期。
      const contractEnd = d.contract_end_date ? parseLocalDate(d.contract_end_date) : null;
      if (contractEnd && !isNaN(contractEnd.getTime()) && base > contractEnd) return plan;
      // 合同结束后不再安排未来维保；合同结束日当日仍可执行已安排的维保。
      const hasValidContractEnd = contractEnd && !isNaN(contractEnd.getTime());
      function isAfterContractEnd(date) {
        return hasValidContractEnd && date > contractEnd;
      }
      // 过去周期：保留历史，便于追溯实际维保记录。
      let cur = new Date(base);
      while (cur >= yearStart) {
        if (cur < today || !isAfterContractEnd(cur)) plan[fmtDate(cur)] = cur < today;
        cur.setDate(cur.getDate() - 15);
      }
      // 未来周期：仅生成合同有效期内的计划。
      cur = new Date(base);
      cur.setDate(cur.getDate() + 15);
      while (cur <= endDate) {
        if (isAfterContractEnd(cur)) break;
        plan[fmtDate(cur)] = cur < today;
        cur.setDate(cur.getDate() + 15);
      }
      // 历史维保记录补充（设备日期被手动改过时，旧日期仍保留在原月）
      (d.maint_history || []).forEach(hd => {
        const h = parseLocalDate(hd);
        if (!isNaN(h.getTime()) && h >= yearStart) plan[hd] = true;
      });
      return plan;
    }

    this.devices.forEach(d => {
      const plan = buildDevicePlan(d);
      Object.keys(plan).sort().forEach(ds => {
        const cur = parseLocalDate(ds);
        const day = ensureDay(ds, cur);
        pushDevice(day, d, plan[ds]);
      });
    });
    // 转换为数组并排序
    this.schedule = Object.values(schedule).sort((a, b) => a.date.localeCompare(b.date));
    // 更新 districts 字段（仅统计未完成排期），并预计算年审列表
    this.schedule.forEach(day => {
      const active = day.devices.filter(dd => !dd.historical);
      const dists = [...new Set(active.map(dd => dd.district))];
      day.districts = dists.join(', ');
      day.annual_inspections = day.devices
        .filter(dd => dd.annual_inspection_date === day.date && !dd.historical)
        .map(dd => ({
          reg_code: dd.reg_code,
          unit_name: dd.unit_name,
          district: dd.district,
          address: dd.address
        }));
    });

    // 仅将管理员确认后的年审日期（annual_inspection_manual=true）写入日历
    this.devices.forEach(d => {
      if (!d.annual_inspection_date || d.annual_inspection_manual !== true) return;
      const dateStr = d.annual_inspection_date;
      let day = schedule[dateStr];
      if (!day) {
        const cur = parseLocalDate(dateStr);
        day = {
          date: dateStr,
          weekday: weekdays[cur.getDay()],
          total: 0,
          hist_total: 0,
          districts: '',
          devices: []
        };
        schedule[dateStr] = day;
      }
      // 避免重复添加年审设备
      if (!day.annual_inspections) day.annual_inspections = [];
      if (!day.annual_inspections.find(ai => ai.reg_code === d.reg_code)) {
        day.annual_inspections.push({
          reg_code: d.reg_code,
          unit_name: d.unit_name,
          district: d.district,
          address: d.address
        });
      }
    });

    // 重新排序
    this.schedule = Object.values(schedule).sort((a, b) => a.date.localeCompare(b.date));
  },

  /** 贪心最近邻路线规划 */
  planRoute(devices) {
    if (devices.length <= 1) return devices;
    const locMap = {};
    this.locations.forEach(l => { locMap[l.reg_code] = l; });
    const devs = devices.map(d => ({
      ...d,
      lat: locMap[d.reg_code]?.lat || d.lat || 22.65,
      lng: locMap[d.reg_code]?.lng || d.lng || 114.10
    }));
    const sorted = [devs[0]];
    const remaining = devs.slice(1);
    while (remaining.length > 0) {
      const last = sorted[sorted.length - 1];
      let nearestIdx = 0;
      let nearestDist = Infinity;
      for (let j = 0; j < remaining.length; j++) {
        const dist = Math.sqrt(
          (last.lat - remaining[j].lat) ** 2 + (last.lng - remaining[j].lng) ** 2
        );
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = j;
        }
      }
      sorted.push(remaining.splice(nearestIdx, 1)[0]);
    }
    return sorted;
  },

  /** 检查是否有本地修改 */
  hasLocalChanges() {
    return localStorage.getItem('elevator_data') !== null;
  },

  /** 获取当前年份 */
  currentYear() {
    return new Date().getFullYear();
  },

  /** 过期自动推进（保留历史，并将下一次维保推进到今天之后） */
  autoAdvanceOverdue() {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var count = 0;
    var names = [];
    this.devices.forEach(function(d) {
      if (!d.next_date) return;
      var contractEnd = null;
      if (d.contract_end_date) {
        contractEnd = parseLocalDate(d.contract_end_date);
        if (isNaN(contractEnd.getTime())) contractEnd = null;
      }
      var nd = parseLocalDate(d.next_date);
      if (isNaN(nd.getTime())) return;
      var oldDate = d.next_date;
      // 无论日期本身是否已到，超过合同结束日的下一次维保都已失效。
      if (contractEnd && nd > contractEnd) {
        if (!d.maint_history) d.maint_history = [];
        if (d.maint_history.indexOf(oldDate) === -1) {
          d.maint_history.push(oldDate);
          d.maint_history.sort();
        }
        d.next_date = null;
        count++;
        names.push((d.unit_name || d.reg_code) + ' ' + oldDate + '\u2192合同期结束');
        return;
      }
      if (nd < today) {
        if (!d.maint_history) d.maint_history = [];
        if (oldDate && d.maint_history.indexOf(oldDate) === -1) {
          d.maint_history.push(oldDate);
          d.maint_history.sort();
        }
        // 合同已结束，或剩余合同期不足以覆盖下一个15天周期：清空下一次日期，
        // 避免设备列表继续显示过去日期，也避免生成合同结束后的维保计划。
        if (contractEnd && contractEnd < today) {
          d.next_date = null;
          count++;
          names.push((d.unit_name || d.reg_code) + ' ' + oldDate + '\u2192合同已结束');
          return;
        }
        while (nd < today) {
          nd.setDate(nd.getDate() + 15);
        }
        if (contractEnd && nd > contractEnd) {
          d.next_date = null;
          count++;
          names.push((d.unit_name || d.reg_code) + ' ' + oldDate + '\u2192合同期内无下一次排期');
          return;
        }
        d.next_date = fmtDate(nd);
        count++;
        names.push((d.unit_name || d.reg_code) + ' ' + oldDate + '\u2192' + d.next_date);
      }
    });
    if (count > 0) {
      this.regenerateSchedule();
      // 由调用方决定何时等待云端同步，避免产生并行 PUT 请求。
      this.save(false);
      OperationLog.add('\u81ea\u52a8\u63a8\u8fdb', count + '\u53f0', names.join('; '));
    }
    return count;
  }
};

// ===== 日期工具（本地时区格式化，避免 toISOString 的 UTC 偏移导致日期早一天） =====
function fmtDate(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// 将 'YYYY-MM-DD' 字符串解析为本地时区零点日期（避免 UTC 解析偏移）
function parseLocalDate(str) {
  var parts = String(str).split('-');
  return new Date(+parts[0], +parts[1] - 1, +parts[2]);
}

// ===== HTML 安全工具 =====
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 防抖工具函数
function debounce(fn, delay) {
  var timer = null;
  return function() {
    var ctx = this, args = arguments;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(ctx, args); }, delay);
  };
}

// ===== 全局共享工具函数 =====
// Toast 提示（app.js / admin.js 共用）
function showToast(msg, type) {
  type = type || '';
  var toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  setTimeout(function() { toast.classList.remove('show'); }, 2500);
}

// ===== 操作日志模块（记录增/删/改/批量调整，存 localStorage） =====
const OperationLog = {
  MAX_ENTRIES: 200,
  STORAGE_KEY: 'elevator_oplog',

  /** 读取所有日志 */
  getAll() {
    try {
      return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
    } catch (e) { return []; }
  },

  /** 记录一条日志（时间使用本地时区，避免 UTC 显示偏移 8 小时） */
  add(action, regCode, detail) {
    var now = new Date();
    var pad = function(n) { return String(n).padStart(2, '0'); };
    var entry = {
      time: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
        ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()),
      action: action,       // '新增' / '修改' / '删除' / '完成维保' / '批量推进' / '批量改维保' / '批量改年审'
      reg_code: regCode,
      detail: detail        // 自由文本描述
    };
    var logs = this.getAll();
    logs.unshift(entry);
    // 保留最近200条
    if (logs.length > this.MAX_ENTRIES) logs = logs.slice(0, this.MAX_ENTRIES);
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(logs));
    } catch (e) {
      console.warn('操作日志写入失败:', e.message);
    }
  },

  /** 清空日志 */
  clear() {
    localStorage.removeItem(this.STORAGE_KEY);
  },

  /** 获取日志条数 */
  count() {
    return this.getAll().length;
  }
};

// 高德一键导航跳转（app.js / admin.js 共用）
function navigateToDevice(regCode) {
  var device = DataManager.devices.find(function(d) { return d.reg_code === regCode; });
  if (!device) return;
  var lat = device.lat;
  var lng = device.lng;
  var name = encodeURIComponent(device.unit_name || '电梯维保点');
  if (lat && lng) {
    window.open('https://uri.amap.com/navigation?to=' + lng + ',' + lat + ',' + name + '&mode=car', '_blank');
  } else {
    var address = encodeURIComponent((device.address || '') + ' 深圳');
    window.open('https://uri.amap.com/search?keyword=' + address + '&city=深圳', '_blank');
  }
}
