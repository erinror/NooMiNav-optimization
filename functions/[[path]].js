// ============================================================================
// NooMiNav V13.2 UI Refresh Pro - Patched Full
// 双擎驱动适配器：支持 Cloudflare Workers 和 Pages
// ============================================================================

export default {
  async fetch(request, env, ctx) {
    const app = new NooMiNav(request, env, ctx);
    return app.handle();
  }
};

export async function onRequest(context) {
  const app = new NooMiNav(context.request, context.env, context);
  return app.handle();
}

// ============================================================================
// 核心应用类
// ============================================================================
class NooMiNav {
  constructor(request, env, ctx) {
    this.request = request;
    this.env = env;
    this.ctx = ctx;
    this.url = new URL(request.url);

    this.COOKIE_NAME = "nav_session_v13_pro";
    this.DEFAULT_IMG = "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=2073";
    this.FONT_STACK = `'SF Pro Display', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

    // ✅ 修复：明确上海时区，避免硬 +8 导致跨天异常
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    const y = now.getFullYear().toString();
    const mo = (now.getMonth() + 1).toString().padStart(2, '0');
    const d = now.getDate().toString().padStart(2, '0');
    const hh = now.getHours().toString().padStart(2, '0');
    const mm = now.getMinutes().toString().padStart(2, '0');
    const ss = now.getSeconds().toString().padStart(2, '0');

    this.time = {
      now: now,
      year: y,
      month: mo,
      todayStr: `${y}-${mo}-${d}`,
      fullStr: `${y}-${mo}-${d} ${hh}:${mm}:${ss}`,
      dateKey: `${y}_${mo}`
    };
  }

  // ------------------------------------------------------------------------
  // [模块 1] 初始化配置加载
  // ------------------------------------------------------------------------
  async initConfig() {
  this.dbSettings = {};
  if (this.env.db) {
    try {
      await this.env.db.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)").run();
      await this.env.db.prepare(`
        CREATE TABLE IF NOT EXISTS logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          link_id TEXT,
          click_time TEXT,
          month_key TEXT,
          ip_address TEXT,
          user_agent TEXT
        )
      `).run();
      await this.env.db.prepare(`
        CREATE TABLE IF NOT EXISTS stats (
          id TEXT PRIMARY KEY,
          name TEXT,
          type TEXT,
          total_clicks INTEGER DEFAULT 0,
          year_clicks INTEGER DEFAULT 0,
          month_clicks INTEGER DEFAULT 0,
          day_clicks INTEGER DEFAULT 0,
          last_year TEXT,
          last_month TEXT,
          last_day TEXT,
          last_time TEXT
        )
      `).run();

      const res = await this.env.db.prepare("SELECT * FROM settings").all();
      (res.results || []).forEach(r => this.dbSettings[r.key] = r.value);
    } catch (e) {
      console.error("initConfig DB error:", e);
    }
  }

  this.ADMIN_PATH = '/' + (this.env.admin || 'admin').replace(/^\//, '');

  this.config = {
    admin_pass: this.dbSettings.admin_pass || "123456",
    title: this.dbSettings.title || this.env.TITLE || "云端加速 · 精选导航",
    subtitle: this.dbSettings.subtitle || this.env.SUBTITLE || "优质资源推荐 · 随时畅联",
    contact_url: this.dbSettings.contact_url || this.env.CONTACT_URL || "",
    mail: this.dbSettings.mail !== undefined ? this.dbSettings.mail : (this.env.mail || ""),
    push: this.dbSettings.push !== undefined ? this.dbSettings.push : (this.env.push || ""),
    host: (this.dbSettings.host || this.env.host || this.url.origin).replace(/\/$/, ''),
    notice: this.dbSettings.notice !== undefined
      ? this.dbSettings.notice
      : (this.env.notice || "<div style=\"margin-bottom:8px\">🎉 欢迎使用 FlarePortal 极简导航！</div><div class=\"notice-sub\">您可以在后台「系统设置」中修改此处的公告内容，支持 HTML 标签。如果清空内容，公告板将自动隐藏。</div>"),

    promo_enable: this.dbSettings.promo_enable !== undefined ? this.dbSettings.promo_enable : (this.env.promo_enable || "1"),
    promo_badge: this.dbSettings.promo_badge !== undefined ? this.dbSettings.promo_badge : (this.env.promo_badge || "免费域名可托管 CF"),
    promo_title: this.dbSettings.promo_title !== undefined ? this.dbSettings.promo_title : (this.env.promo_title || "本站域名服务由 DigitalPlat FreeDomain 提供支持"),
    promo_desc: this.dbSettings.promo_desc !== undefined ? this.dbSettings.promo_desc : (this.env.promo_desc || "可免费申请域名，支持 Cloudflare 托管接入，适合导航站与个人项目使用。"),
    promo_url: this.dbSettings.promo_url !== undefined ? this.dbSettings.promo_url : (this.env.promo_url || "https://dash.domain.digitalplat.org/signup?ref=s8ywnMQRkL"),
    promo_format: this.dbSettings.promo_format !== undefined ? this.dbSettings.promo_format : (this.env.promo_format || "markdown"),

    // ✅ 新版右侧账号广告：直接支持 HTML / Markdown
    account_enable: this.dbSettings.account_enable !== undefined ? this.dbSettings.account_enable : (this.env.account_enable || "0"),
    account_format: this.dbSettings.account_format !== undefined ? this.dbSettings.account_format : (this.env.account_format || "markdown"),
    account_content: this.dbSettings.account_content !== undefined ? this.dbSettings.account_content : (this.env.account_content || "")
  };

  if (this.config.push && !this.config.push.endsWith('/contact')) {
    this.config.push = this.config.push.replace(/\/$/, '') + '/contact';
  }

  this.config.img = this.DEFAULT_IMG;
  const imgSource = this.dbSettings.img || this.env.img;
  if (imgSource) {
    const imgStr = imgSource.trim();
    if (imgStr.startsWith('data:')) {
      this.config.img = imgStr;
    } else {
      const list = imgStr.split(',').map(s => s.trim()).filter(s => s);
      if (list.length > 0) {
        const dayIndex = Math.floor((this.time.now.getTime()) / 86400000);
        this.config.img = list[dayIndex % list.length];
      }
    }
  }
}

  // ✅ 新增：JSON 安全解析
  parseJsonArraySafe(raw, fallback = []) {
    try {
      const x = JSON.parse(raw);
      return Array.isArray(x) ? x : fallback;
    } catch (e) {
      return fallback;
    }
  }

  loadJsonData() {
    const getJsonEnv = (k) => {
      try {
        if (!this.env[k]) return [];
        const v = JSON.parse(this.env[k]);
        return Array.isArray(v) ? v : [];
      } catch (e) {
        return [];
      }
    };

    // ✅ 修复：DB JSON 也做容错，避免坏 JSON 直接崩
    this.LINKS_DATA = this.dbSettings.links !== undefined
      ? this.parseJsonArraySafe(this.dbSettings.links, getJsonEnv('LINKS'))
      : getJsonEnv('LINKS');

    this.FRIENDS_DATA = this.dbSettings.friends !== undefined
      ? this.parseJsonArraySafe(this.dbSettings.friends, getJsonEnv('FRIENDS'))
      : getJsonEnv('FRIENDS');
  }

  // ------------------------------------------------------------------------
  // [模块 2] 路由
  // ------------------------------------------------------------------------
  async handle() {
    await this.initConfig();
    const path = this.url.pathname;

    if (path === '/message') return this.route_MessageDetail();
    if (path === '/contact') return this.route_Contact();
    if (path === `${this.ADMIN_PATH}/api/logs`) return this.api_GetLogs();
    if (path === `${this.ADMIN_PATH}/api/settings`) return this.api_SaveSettings();
    if (path === `${this.ADMIN_PATH}/logout`) return this.route_AdminLogout();
    if (path === this.ADMIN_PATH) return this.route_AdminPage();

    if (path.startsWith('/go/') || path.startsWith('/fgo/')) {
      this.loadJsonData();
      return this.route_Redirect(path);
    }

    this.loadJsonData();
    return this.route_HomePage();
  }

  // ------------------------------------------------------------------------
  // [模块 3] 路由控制器
  // ------------------------------------------------------------------------
  async route_Redirect(path) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2) return new Response('Invalid URL', { status: 400 });

    const type = parts[0] === 'go' ? 'link' : 'friend';
    const id = parts[1];
    const isBackup = parts[2] === "backup";

    const dataSet = type === 'link' ? this.LINKS_DATA : this.FRIENDS_DATA;
    const item = dataSet.find(l => l.id === id);

    if (!item) return new Response('Target not found', { status: 404 });

    let targetUrl = item.url;
    let logName = item.name;

    if (type === 'link' && isBackup && item.backup_url) {
      targetUrl = item.backup_url;
      logName += "(备用)";
    }

    if (!targetUrl) return new Response('No valid URL available', { status: 400 });

    if (this.env.db) {
      this.ctx.waitUntil(this.db_recordClick(isBackup ? `${id}_backup` : id, logName, type));
    }

    return Response.redirect(targetUrl, 302);
  }

  route_MessageDetail() {
    const dataStr = this.url.searchParams.get('d');
    let msgData = { c: '未知', m: '内容解析失败或已损坏', t: this.time.fullStr };
    if (dataStr) { try { msgData = JSON.parse(decodeURIComponent(atob(dataStr))); } catch (e) {} }
    return new Response(this.render_MessageDetail(msgData), { headers: { "content-type": "text/html;charset=UTF-8" } });
  }

  async route_Contact() {
    if (this.request.method === 'GET') {
      return new Response(this.render_ContactPage(), { headers: { "content-type": "text/html;charset=UTF-8" } });
    }
    if (this.request.method === 'POST') {
      try {
        const formData = await this.request.formData();
        const contactInfo = String(formData.get('guest_contact') || '匿名访客').slice(0, 120);
        const messageContent = String(formData.get('message') || '无内容').slice(0, 5000);

        if (!this.config.push) return new Response('⚠️ 站长尚未配置接收通道', { status: 500 });

        const payload = JSON.stringify({ c: contactInfo, m: messageContent, t: this.time.fullStr });
        const detailUrl = `${this.config.host}/message?d=${btoa(encodeURIComponent(payload))}`;
        const shortMsg = messageContent.length > 60 ? messageContent.substring(0, 60) + '...' : messageContent;

        await fetch(this.config.push, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `💬 导航站留言: ${contactInfo}`,
            content: `时间: ${this.time.fullStr}\n内容: ${shortMsg}\n\n👉 点击卡片查看完整详情`,
            url: detailUrl
          })
        });
        return new Response('✅ 发送成功！站长已收到你的留言', { status: 200 });
      } catch (e) {
        return new Response('❌ 发送失败，请稍后重试', { status: 500 });
      }
    }
    // ✅ 修复：避免 undefined
    return new Response('Method not allowed', { status: 405 });
  }

  route_HomePage() {
    return new Response(this.render_HomePage(), { headers: { "content-type": "text/html;charset=UTF-8" } });
  }

  // ✅ 新增：Cookie 解析 + 鉴权
  parseCookies() {
    const raw = this.request.headers.get('Cookie') || '';
    const out = {};
    raw.split(';').forEach(p => {
      const i = p.indexOf('=');
      if (i > -1) {
        const k = p.slice(0, i).trim();
        const v = p.slice(i + 1).trim();
        out[k] = decodeURIComponent(v);
      }
    });
    return out;
  }

  isAuthed() {
    const c = this.parseCookies();
    return c[this.COOKIE_NAME] === 'true';
  }

  async route_AdminPage() {
    if (this.request.method === 'POST') {
      const formData = await this.request.formData();
      const password = formData.get('password') || '';
      if (password.length > 100) {
        return new Response(this.render_LoginPage('密码长度异常'), { headers: { "content-type": "text/html;charset=UTF-8" } });
      }
      if (password === this.config.admin_pass) {
        return new Response(null, {
          status: 302,
          headers: {
            'Location': this.ADMIN_PATH,
            'Set-Cookie': `${this.COOKIE_NAME}=true; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict`
          }
        });
      } else {
        return new Response(this.render_LoginPage('密码错误'), { headers: { "content-type": "text/html;charset=UTF-8" } });
      }
    }

    if (!this.isAuthed()) {
      return new Response(this.render_LoginPage(''), { headers: { "content-type": "text/html;charset=UTF-8" } });
    }

    this.loadJsonData();
    const selectedDateOrMonth = this.getSafeParam(this.url.searchParams, 'm', this.time.dateKey);

    try {
      const dashboardData = await this.db_getDashboardData(selectedDateOrMonth);
      return new Response(this.render_AdminDashboard(dashboardData, selectedDateOrMonth), {
        headers: { "content-type": "text/html;charset=UTF-8" }
      });
    } catch (dbErr) {
      return new Response(`Data Error: ${dbErr.message}`, { status: 500 });
    }
  }

  route_AdminLogout() {
    return new Response(null, {
      status: 302,
      headers: {
        'Location': this.ADMIN_PATH,
        'Set-Cookie': `${this.COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
      }
    });
  }

  async api_GetLogs() {
    if (this.request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    if (!this.isAuthed()) return new Response('Unauthorized', { status: 401 });

    const id = this.getSafeParam(this.url.searchParams, 'id');
    const m = this.getSafeParam(this.url.searchParams, 'm', this.time.dateKey);

    if (!this.env.db) return new Response('Database not available', { status: 500 });

    try {
      let normalized = m.replace('_', '-').substring(0, 7);
      const queryParam = /^\d{4}-\d{2}$/.test(normalized) ? m.replace('_', '-') : this.time.dateKey.replace('_', '-');
      const { results } = await this.env.db.prepare("SELECT click_time, ip_address, user_agent FROM logs WHERE link_id = ? AND click_time LIKE ? || '%' ORDER BY id DESC LIMIT 50").bind(id, queryParam).all();
      return new Response(JSON.stringify(results || []), { headers: { "content-type": "application/json" } });
    } catch (dbErr) {
      return new Response('Failed to fetch logs', { status: 500 });
    }
  }

  async api_SaveSettings() {
  if (this.request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!this.isAuthed()) return new Response('Unauthorized', { status: 401 });
  if (!this.env.db) return new Response('Database not available', { status: 500 });

  try {
    const body = await this.request.json();

    const allowed = new Set([
      "admin_pass", "title", "subtitle", "img", "contact_url", "mail", "push", "host", "notice",
      "promo_enable", "promo_badge", "promo_title", "promo_desc", "promo_url", "promo_format",

      // ✅ 新版右侧账号广告
      "account_enable", "account_format", "account_content",

      "links", "friends"
    ]);

    const stmts = Object.keys(body)
      .filter(k => allowed.has(k))
      .map(k => this.env.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(k, String(body[k] ?? '')));

    if (stmts.length > 0) {
      await this.env.db.batch(stmts);
    }

    return new Response('OK', {
      headers: { "content-type": "text/plain;charset=UTF-8" }
    });
  } catch (e) {
    console.error("api_SaveSettings error:", e);
    return new Response('Save failed', { status: 500 });
  }
}

  // ------------------------------------------------------------------------
  // [模块 4] 数据库
  // ------------------------------------------------------------------------
  async db_recordClick(id, name, type) {
    try {
      const ip = this.request.headers.get('CF-Connecting-IP') || 'unknown';
      const userAgent = this.request.headers.get('User-Agent') || 'unknown';
      const { dateKey, fullStr, year, todayStr } = this.time;

      await this.env.db.prepare("INSERT INTO logs (link_id, click_time, month_key, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)").bind(id, fullStr, dateKey, ip, userAgent).run();
      await this.env.db.prepare(`INSERT INTO stats (id, name, type, total_clicks, year_clicks, month_clicks, day_clicks, last_year, last_month, last_day, last_time) VALUES (?1, ?2, ?3, 1, 1, 1, 1, ?4, ?5, ?7, ?6) ON CONFLICT(id) DO UPDATE SET total_clicks = total_clicks + 1, year_clicks = CASE WHEN last_year = ?4 THEN year_clicks + 1 ELSE 1 END, month_clicks = CASE WHEN last_month = ?5 THEN month_clicks + 1 ELSE 1 END, day_clicks = CASE WHEN last_day = ?7 THEN day_clicks + 1 ELSE 1 END, last_year = ?4, last_month = ?5, last_day = ?7, last_time = ?6, name = ?2, type = ?3`).bind(id, name, type, year, dateKey, fullStr, todayStr).run();
    } catch (e) {
      console.error("DB Record Error:", e);
    }
  }

  async db_getDashboardData(selectedDateOrMonth) {
    if (!this.env.db) throw new Error('Database not bound');

    const currentMonthKey = selectedDateOrMonth.replace('-', '_').substring(0, 7);
    const queryParam = selectedDateOrMonth.replace('_', '-');
    const isDayMode = selectedDateOrMonth.length > 7 && /^\d{4}-\d{2}-\d{2}$/.test(selectedDateOrMonth);

    const queries = [
      this.env.db.prepare("SELECT id, total_clicks, last_time FROM stats").all().catch(() => ({ results: [] })),
      this.env.db.prepare("SELECT link_id, COUNT(*) as count FROM logs WHERE click_time LIKE ? || '%' GROUP BY link_id").bind(this.time.todayStr).all().catch(() => ({ results: [] })),
      this.env.db.prepare("SELECT link_id, COUNT(*) as count FROM logs WHERE click_time LIKE ? || '%' GROUP BY link_id").bind(queryParam).all().catch(() => ({ results: [] }))
    ];

    if (isDayMode) {
      queries.push(this.env.db.prepare("SELECT link_id, COUNT(*) as count FROM logs WHERE month_key = ? GROUP BY link_id").bind(currentMonthKey).all().catch(() => ({ results: [] })));
    } else {
      queries.push(Promise.resolve({ results: [] }));
    }
    queries.push(this.env.db.prepare("SELECT COUNT(*) as total FROM logs WHERE month_key = ?").bind(currentMonthKey).all().catch(() => ({ results: [{ total: 0 }] })));

    const [statsResult, dailyResult, periodResult, monthContextResult, monthTotalResult] = await Promise.all(queries);

    const statsMap = new Map(); if (statsResult?.results) statsResult.results.forEach(r => statsMap.set(r.id, r));
    const dailyMap = new Map(); if (dailyResult?.results) dailyResult.results.forEach(r => dailyMap.set(r.link_id, r.count));
    const periodMap = new Map(); if (periodResult?.results) periodResult.results.forEach(r => periodMap.set(r.link_id, r.count));
    const monthContextMap = new Map(); if (monthContextResult?.results) monthContextResult.results.forEach(r => monthContextMap.set(r.link_id, r.count));
    const monthTotalClicks = monthTotalResult?.results?.[0]?.total || 0;

    return { statsMap, dailyMap, periodMap, monthContextMap, monthTotalClicks, isDayMode };
  }

  getSafeParam(sp, key, def = '') { return sp.get(key)?.trim() || def; }

  safeCssUrl(url) {
    return String(url || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  safeScriptJson(obj) {
    return JSON.stringify(obj)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
  }

  getBgShellStyle() {
    return `background-color:#0f172a;background-size:cover;background-position:center;background-repeat:no-repeat;`;
  }

  render_BgRuntimeScript() {
    const primary = this.safeCssUrl(this.config.img);
    const fallback = this.safeCssUrl(this.DEFAULT_IMG);
    return `<script>
(function(){
  if(window.__bgInitDone) return;
  window.__bgInitDone = true;
  const body = document.body;
  const primary = '${primary}';
  const fallback = '${fallback}';
  function applyBg(url){
    body.style.backgroundImage = "linear-gradient(rgba(2,6,23,0.30), rgba(2,6,23,0.40)), url('" + url + "')";
  }
  function loadImage(url, ok, fail){
    if(!url){ fail && fail(); return; }
    const img = new Image();
    img.onload = () => ok && ok(url);
    img.onerror = () => fail && fail();
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  }
  applyBg(fallback);
  if(primary && primary !== fallback){
    loadImage(primary, applyBg, () => loadImage(fallback, applyBg));
  } else {
    loadImage(fallback, applyBg);
  }
})();
</script>`;
  }

  escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ✅ 新增：属性场景转义
  escapeAttr(str = '') {
    return this.escapeHtml(str).replace(/`/g, '&#96;');
  }

  renderRichContent(content = '', format = 'html') {
    const raw = String(content || '');
    const mode = String(format || 'html').toLowerCase();

    if (mode === 'html') {
      return raw;
    }

    let s = this.escapeHtml(raw);

    s = s.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
    s = s.replace(/^##\s+(.*)$/gm, '<h2>$1</h2>');
    s = s.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');

    s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*(.*?)\*/g, '<em>$1</em>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    const lines = s.split('\n');
    let html = [];
    let inList = false;

    for (let line of lines) {
      if (/^\s*[-*]\s+/.test(line)) {
        if (!inList) {
          html.push('<ul>');
          inList = true;
        }
        html.push('<li>' + line.replace(/^\s*[-*]\s+/, '') + '</li>');
      } else {
        if (inList) {
          html.push('</ul>');
          inList = false;
        }
        if (line.trim() === '') {
          html.push('');
        } else if (/^<h[1-3]>/.test(line)) {
          html.push(line);
        } else {
          html.push('<p>' + line + '</p>');
        }
      }
    }
    if (inList) html.push('</ul>');

    return html.join('\n');
  }

  // ------------------------------------------------------------------------
  // [模块 5] 渲染
  // ------------------------------------------------------------------------
  render_Head(t) {
    return `<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${this.escapeHtml(t)}</title><style>
        :root{
          --glass:rgba(15,23,42,0.58);
          --border:rgba(255,255,255,0.15);
          --text-shadow:0 2px 4px rgba(0,0,0,0.7);
        }
        *{box-sizing:border-box}
        body{
          margin:0;
          min-height:100vh;
          font-family:${this.FONT_STACK};
          color:#fff;
          display:flex;
          justify-content:center;
          align-items:center;
        }
        .glass-panel{
          background:var(--glass);
          backdrop-filter:blur(16px);
          -webkit-backdrop-filter:blur(16px);
          border:1px solid var(--border);
          box-shadow:0 8px 24px rgba(0,0,0,0.18);
          border-radius:20px;
        }
        h1,div,span,a,p,h2,h3,label,button,input,textarea{text-shadow:var(--text-shadow)}
        </style>`;
  }

  render_MessageDetail(data) {
    // ✅ 修复：留言详情输出转义，防止 XSS
    const t = this.escapeHtml(data?.t || '');
    const c = this.escapeHtml(data?.c || '');
    const m = this.escapeHtml(data?.m || '');

    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>留言详情</title><style>
        body { font-family: ${this.FONT_STACK}; background: #f3f4f6; margin: 0; padding: 20px; display: flex; justify-content: center; min-height: 100vh; box-sizing: border-box; }
        .ticket-card { background: #ffffff; border-radius: 18px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); width: 100%; max-width: 600px; padding: 40px; margin-top: 5vh; height: fit-content; border-top: 6px solid #8b5cf6; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 25px; }
        .badge { background: #ede9fe; color: #7c3aed; padding: 6px 12px; border-radius: 20px; font-size: 0.85rem; font-weight: 700; letter-spacing: 0.5px; }
        .time { color: #94a3b8; font-size: 0.9rem; font-family: monospace; }
        .sender-box { margin-bottom: 25px; }
        .label { font-size: 0.85rem; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 1px; margin-bottom: 5px; }
        .sender { font-size: 1.5rem; color: #0f172a; font-weight: 800; margin: 0; word-break: break-all; }
        .divider { height: 1px; background: #e2e8f0; margin: 25px 0; }
        .message { font-size: 1.1rem; line-height: 1.8; color: #334155; white-space: pre-wrap; word-break: break-word; }
        .footer { margin-top: 40px; text-align: center; color: #cbd5e1; font-size: 0.85rem; }
        @media (max-width: 600px) {
          .ticket-card { padding: 25px; }
          .sender { font-size: 1.2rem; }
          .message { font-size: 1rem; }
        }
        </style></head><body><div class="ticket-card"><div class="header"><span class="badge">INBOX MESSAGE</span><span class="time">${t}</span></div><div class="sender-box"><div class="label">Contact / 发件人</div><h2 class="sender">${c}</h2></div><div class="divider"></div><div class="label">Message / 内容</div><div class="message">${m}</div><div class="footer">🔒 Encrypted transmission powered by Cloudflare</div></div></body></html>`;
  }

  render_ContactPage() {
    return `<!DOCTYPE html><html><head>${this.render_Head(this.config.title)}<style>
        .box { padding: 40px; width: 380px; text-align: left; }
        h2 { font-size: 1.6rem; margin: 0 0 10px 0; display: flex; align-items: center; gap: 8px; }
        p.desc { color: #cbd5e1; font-size: 0.92rem; margin-bottom: 25px; line-height: 1.65; }
        form { display: flex; flex-direction: column; width: 100%; }
        label { font-size: 0.85rem; color: #f1f5f9; margin-bottom: 8px; font-weight: 600; }
        input, textarea {
          width: 100%;
          padding: 14px;
          background: rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 14px;
          color: #fff;
          margin-bottom: 20px;
          outline: none;
          transition: 0.2s;
          font-size: 0.95rem;
          box-sizing: border-box;
          font-family: inherit;
        }
        input:focus, textarea:focus {
          border-color: #60a5fa;
          background: rgba(0,0,0,0.5);
          box-shadow: 0 0 0 4px rgba(96,165,250,0.18);
        }
        input::placeholder, textarea::placeholder { color: rgba(255,255,255,0.4); }
        textarea { resize: vertical; min-height: 100px; }
        button {
          width: 100%;
          padding: 16px;
          background: linear-gradient(135deg, #3b82f6, #8b5cf6);
          color: #fff;
          border: none;
          border-radius: 14px;
          font-weight: 800;
          cursor: pointer;
          font-size: 1rem;
          transition: 0.2s;
          box-shadow: 0 4px 12px rgba(59,130,246,0.26);
        }
        button:hover { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(59,130,246,0.35); }
        button:disabled { opacity: 0.7; cursor: not-allowed; transform: none; }
        .status { margin-top: 15px; font-size: 0.9rem; font-weight: 600; text-align: center; min-height: 20px; }
        .back { text-align: center; margin-top: 20px; }
        .back a { color: #94a3b8; text-decoration: none; font-size: 0.85rem; transition: 0.2s; }
        .back a:hover { color: #fff; }
        </style></head><body style="${this.getBgShellStyle()} display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0;"><div class="glass-panel box"><h2>📝 给我留言</h2><p class="desc">有任何问题、疑问？<br>留下联系方式，看到了就会联系，优先邮箱或者QQ。</p><form id="msgForm"><label>留下你的联系方式？</label><input type="text" name="guest_contact" placeholder="邮箱或者QQ" required><label>你想说什么？</label><textarea name="message" placeholder="写下你的留言内容..." required></textarea><button type="submit" id="submitBtn">发送留言</button></form><div id="status" class="status"></div><div class="back"><a href="/">← 返回导航主页</a></div></div>${this.render_BgRuntimeScript()}<script>document.getElementById('msgForm').addEventListener('submit', async (e) => { e.preventDefault(); const btn = document.getElementById('submitBtn'); const status = document.getElementById('status'); btn.disabled = true; btn.innerText = '发送中...'; status.innerText = ''; try { const res = await fetch('/contact', { method: 'POST', body: new FormData(e.target) }); const text = await res.text(); status.style.color = res.ok ? '#34d399' : '#f87171'; status.innerText = text; if(res.ok) e.target.reset(); } catch(err) { status.style.color = '#f87171'; status.innerText = '网络错误，请稍后重试'; } finally { btn.disabled = false; btn.innerText = '发送留言'; } });</script></body></html>`;
  }

  render_LoginPage(errorMsg = '') {
    return `<!DOCTYPE html><html><head>${this.render_Head(this.config.title)}<style>
        .box { padding: 50px 40px; text-align: center; width: 340px; display: flex; flex-direction: column; align-items: center; }
        h1 { font-size: 1.8rem; margin-bottom: 30px; }
        form { width: 100%; display: flex; flex-direction: column; align-items: center; }
        input {
          width: 100%;
          padding: 16px;
          background: rgba(0,0,0,0.25);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 14px;
          color: #fff;
          margin-bottom: 20px;
          outline: none;
          transition: 0.2s;
          font-size: 1rem;
          box-sizing: border-box;
          text-align: center;
        }
        input:focus {
          border-color: #60a5fa;
          background: rgba(0,0,0,0.5);
          transform: scale(1.01);
          box-shadow: 0 0 0 4px rgba(96,165,250,0.18);
        }
        input::placeholder { color: rgba(255,255,255,0.5); }
        button {
          width: 100%;
          padding: 16px;
          background: linear-gradient(135deg,#3b82f6,#8b5cf6);
          color: #fff;
          border: none;
          border-radius: 14px;
          font-weight: 800;
          cursor: pointer;
          font-size: 1rem;
          transition: 0.2s;
          box-shadow: 0 4px 12px rgba(59,130,246,0.25);
        }
        button:hover { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(59,130,246,0.35); }
        .error-msg { color: #f87171; margin-bottom: 15px; font-size: 0.9rem; min-height: 20px; }
        </style></head><body style="${this.getBgShellStyle()} display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0;"><div class="glass-panel box"><h1>🔐 管理后台</h1>${errorMsg ? `<div class="error-msg">❌ ${this.escapeHtml(errorMsg)}</div>` : ''}<form method="POST" action="${this.ADMIN_PATH}"><input type="password" name="password" placeholder="请输入访问口令" required autofocus><button type="submit">立即登录</button></form></div>${this.render_BgRuntimeScript()}</body></html>`;
  }

      render_HomePage() {
    const safeLinks = Array.isArray(this.LINKS_DATA) ? this.LINKS_DATA : [];
    const safeFriends = Array.isArray(this.FRIENDS_DATA) ? this.FRIENDS_DATA : [];

    const promoEnabled = String(this.config.promo_enable || '0') === '1';
    const promoUrl = this.config.promo_url || '';
    const promoBadge = this.config.promo_badge || '推广支持';
    const promoTitle = this.config.promo_title || '推广支持';
    const promoDesc = this.config.promo_desc || '';

    const accountEnabled = String(this.config.account_enable || '0') === '1';
    const accountFormat = this.config.account_format || 'markdown';
    const accountContent = (this.config.account_content || '').trim();

    const cardsHtml = safeLinks.map(item => {
      const itemId = this.escapeAttr(item.id || '');
      const mainUrl = `/go/${itemId}`;
      const backupHtml = item.backup_url ? `<a href="/go/${itemId}/backup" class="tag-backup" title="备用线路">备用</a>` : '';
      const customTagHtml = item.tag ? `<span class="tag-special">${this.escapeHtml(item.tag)}</span>` : '';
      return `<div class="glass-card resource-card-wrap"><a href="${mainUrl}" class="resource-main-link"><div class="card-icon">${this.escapeHtml(item.emoji || '🔗')}</div><div class="card-info"><h3 style="display:flex;align-items:center;flex-wrap:wrap;">${this.escapeHtml(item.name || '')}${customTagHtml}</h3><p>⚠️ ${this.escapeHtml(item.note || '无说明')}</p></div></a>${backupHtml}</div>`;
    }).join('');

    const friendsHtml = safeFriends.map(f => `<a href="/fgo/${this.escapeAttr(f.id || '')}" target="_blank" class="glass-card partner-card">${this.escapeHtml(f.name || '')}</a>`).join('');

    let fabHtml = `<div class="fab-container">`;
    if (this.config.contact_url) fabHtml += `<a href="${this.escapeAttr(this.config.contact_url)}" target="_blank" class="fab-btn fab-telegram">💬 获取支持</a>`;
    if (this.config.mail) fabHtml += `<a href="mailto:${this.escapeAttr(this.config.mail)}" class="fab-btn fab-mail">📧 发送邮件</a>`;
    if (this.config.push) fabHtml += `<a href="/contact" class="fab-btn fab-push">📝 给我留言</a>`;
    fabHtml += `</div>`;

    let noticeHtml = '';
    if (this.config.notice && this.config.notice.trim() !== '') {
      noticeHtml = `<div class="glass-card notice-card"><div class="notice-title"><span>❤️</span> 温馨提示</div><div class="notice-content">${this.config.notice}</div></div>`;
    }

    let accountCardHtml = '';
    if (accountEnabled && accountContent) {
      let accountRendered = this.renderRichContent(accountContent, accountFormat);
      accountRendered = accountRendered.replace(/<div class="ad-badge">[\s\S]*?<\/div>/i, '');

      let accountUrl = '';
      const mdMatch = accountContent.match(/\[.*?\]\((https?:\/\/[^\s)]+)\)/i);
      const htmlMatch = accountContent.match(/href=["'](https?:\/\/[^"']+)["']/i);
      if (mdMatch?.[1]) accountUrl = mdMatch[1];
      if (!accountUrl && htmlMatch?.[1]) accountUrl = htmlMatch[1];

      const badgeHtml = `<div class="promo-badge">账号购买</div>`;
      const contentHtml = `<div class="promo-content"><div class="promo-desc rich-content">${accountRendered}</div></div>`;

      accountCardHtml = accountUrl
        ? `<a href="${this.escapeAttr(accountUrl)}" target="_blank" rel="noopener noreferrer" class="glass-card promo-card account-promo-card">${badgeHtml}${contentHtml}</a>`
        : `<section class="glass-card promo-card account-promo-card">${badgeHtml}${contentHtml}</section>`;
    }

    let promoHtml = '';
    if (promoEnabled && promoUrl) {
      const promoRendered = this.renderRichContent(promoDesc, this.config.promo_format);
      promoHtml = `<a href="${this.escapeAttr(promoUrl)}" target="_blank" rel="noopener noreferrer" class="glass-card promo-card"><div class="promo-badge">${this.escapeHtml(promoBadge)}</div><div class="promo-content"><div class="promo-title">${this.escapeHtml(promoTitle)}</div><div class="promo-desc rich-content">${promoRendered}</div></div></a>`;
    }

    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${this.escapeHtml(this.config.title)}</title><style>
      :root{--glass:rgba(255,255,255,.14);--border:rgba(255,255,255,.16);--text-main:#fff;--text-sub:rgba(226,232,240,.92);--backdrop-blur:12px;--shadow-soft:0 8px 20px rgba(15,23,42,.14);--shadow-hover:0 14px 28px rgba(15,23,42,.18);--transition:.22s ease}
      .dark-theme{--glass:rgba(15,23,42,.82);--border:rgba(255,255,255,.10);--text-main:#f8fafc;--text-sub:rgba(226,232,240,.88)}
      *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
      body{font-family:${this.FONT_STACK};color:var(--text-main);${this.getBgShellStyle()}min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 20px 100px;position:relative}
      .container{width:100%;max-width:1200px}
      .glass-card{background:linear-gradient(135deg,rgba(255,255,255,.14),rgba(255,255,255,.08));backdrop-filter:blur(var(--backdrop-blur));-webkit-backdrop-filter:blur(var(--backdrop-blur));border:1px solid var(--border);border-radius:20px;box-shadow:var(--shadow-soft);transition:var(--transition)}
      .dark-theme .glass-card{background:linear-gradient(135deg,rgba(15,23,42,.82),rgba(15,23,42,.68))}
      .header{text-align:center;padding:48px 28px;margin-bottom:28px}
      .header h1{font-size:clamp(2.1rem,5vw,3.3rem);font-weight:800;line-height:1.08;letter-spacing:-.035em;margin-bottom:12px;text-shadow:0 6px 18px rgba(0,0,0,.28)}
      .header p{max-width:720px;margin:0 auto;font-size:1rem;line-height:1.75;color:var(--text-sub)}
      .section-title{font-size:.95rem;font-weight:800;color:#7dd3fc;margin:0 0 15px 6px;text-transform:uppercase;letter-spacing:.06em;text-shadow:0 2px 4px rgba(0,0,0,.35)}
      .search-container{margin-bottom:28px;width:100%}
      .search-wrap{position:relative;width:100%;max-width:560px;margin:0 auto}
      .search-icon{position:absolute;left:18px;top:50%;transform:translateY(-50%);opacity:.8;font-size:1rem;pointer-events:none}
      .search-box{width:100%;height:56px;padding:0 20px 0 48px;border-radius:18px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.14);backdrop-filter:blur(6px);color:#fff;font-size:1rem;box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 4px 14px rgba(0,0,0,.10);transition:var(--transition)}
      .search-box::placeholder{color:rgba(255,255,255,.64)}
      .search-box:focus{outline:none;background:rgba(255,255,255,.2);border-color:rgba(125,211,252,.4);box-shadow:0 0 0 4px rgba(56,189,248,.10),0 8px 18px rgba(0,0,0,.12)}
      .grid-resources{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;margin-bottom:40px}
      .resource-card-wrap{display:flex;position:relative;overflow:hidden;min-height:112px}
      .resource-card-wrap:hover,.partner-card:hover{background:rgba(255,255,255,.22);transform:translateY(-2px);box-shadow:var(--shadow-hover)}
      .resource-main-link{flex:1;display:flex;align-items:center;gap:16px;text-decoration:none;color:#fff;padding:22px 20px;text-shadow:0 2px 4px rgba(0,0,0,.42)}
      .card-icon{width:52px;display:flex;align-items:center;justify-content:center;font-size:2.2rem;flex-shrink:0;filter:drop-shadow(0 2px 4px rgba(0,0,0,.25))}
      .card-info h3{font-size:1.06rem;font-weight:700;line-height:1.35;margin-bottom:6px}
      .card-info p{font-size:.84rem;color:rgba(252,211,77,.92);font-weight:500;line-height:1.5}
      .tag-special{display:inline-flex;align-items:center;margin-left:8px;padding:3px 8px;font-size:.65rem;font-weight:800;color:#ecfdf5;background:linear-gradient(135deg,rgba(16,185,129,.78),rgba(5,150,105,.88));border:1px solid rgba(52,211,153,.35);border-radius:999px;box-shadow:0 2px 8px rgba(16,185,129,.18);transform:translateY(-1px);text-shadow:0 1px 2px rgba(0,0,0,.35);white-space:nowrap}
      .tag-backup{position:absolute;top:12px;right:12px;padding:4px 9px;border-radius:999px;background:rgba(15,23,42,.35);border:1px solid rgba(255,255,255,.12);font-size:11px;color:#e2e8f0;text-decoration:none;transition:var(--transition)}
      .tag-backup:hover{background:rgba(139,92,246,.88);color:#fff}
      .grid-partners{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;margin-bottom:40px}
      .partner-card{text-decoration:none;color:#fff;text-align:center;padding:16px 14px;font-size:.92rem;font-weight:600;border-radius:16px;text-shadow:0 1px 3px rgba(0,0,0,.45);transition:var(--transition);min-height:68px;display:flex;align-items:center;justify-content:center}
      .fab-container{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);display:flex;gap:12px;z-index:100;flex-wrap:wrap;justify-content:center}
      .fab-btn{padding:11px 18px;border-radius:16px;text-decoration:none;font-weight:700;color:#fff;transition:var(--transition);box-shadow:0 6px 16px rgba(0,0,0,.16);white-space:nowrap;border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
      .fab-telegram{background:rgba(139,92,246,.66)} .fab-mail{background:rgba(59,130,246,.66)} .fab-push{background:rgba(244,63,94,.66)}
      .fab-btn:hover{transform:translateY(-2px);box-shadow:0 10px 20px rgba(0,0,0,.20)}
      .theme-toggle{position:fixed;top:20px;right:20px;width:44px;height:44px;border-radius:14px;background:rgba(255,255,255,.16);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:100;color:#fff}
      .no-result{text-align:center;padding:40px 0;color:var(--text-sub);font-size:1.06rem;display:none}
      .notice-card{margin-bottom:22px;padding:22px 28px;text-align:left;background:linear-gradient(135deg,rgba(244,63,94,.10),rgba(30,41,59,.32));border-left:4px solid #fb7185}
      .notice-title{font-size:1.1rem;font-weight:800;background:linear-gradient(to right,#fb7185,#c084fc);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:15px;display:flex;align-items:center;gap:10px;text-shadow:none}
      .notice-title span{-webkit-text-fill-color:initial}
      .notice-content{font-size:.95rem;line-height:1.8;color:rgba(255,255,255,.92)}
      .promo-card{display:flex;align-items:center;gap:18px;margin-bottom:30px;padding:22px 26px;text-decoration:none;color:var(--text-main);background:linear-gradient(135deg,rgba(255,255,255,.16),rgba(59,130,246,.10));border:1px solid rgba(125,211,252,.22);box-shadow:0 6px 18px rgba(15,23,42,.12)}
      .promo-card:hover{transform:translateY(-2px)}
      .promo-badge{flex-shrink:0;min-width:138px;padding:12px 16px;border-radius:999px;text-align:center;font-size:.95rem;font-weight:800;color:#dbeafe;background:linear-gradient(135deg,rgba(255,255,255,.28),rgba(191,219,254,.18));border:1px solid rgba(255,255,255,.22)}
      .promo-title{font-size:1rem;font-weight:800;color:#fff;line-height:1.45}
      .promo-desc{font-size:.95rem;color:rgba(226,232,240,.92);line-height:1.6}
      .rich-content p{margin:0 0 8px}.rich-content p:last-child{margin-bottom:0}
      .account-promo-card{margin-bottom:18px;background:linear-gradient(135deg,rgba(255,255,255,.16),rgba(16,185,129,.10));border:1px solid rgba(125,211,252,.22);text-decoration:none;color:var(--text-main)}
      .account-promo-card .promo-badge{color:#d1fae5;background:linear-gradient(135deg,rgba(16,185,129,.28),rgba(59,130,246,.18));border:1px solid rgba(167,243,208,.24)}
      .account-promo-card .promo-content{flex:1;min-width:0}
      .account-promo-card .promo-desc h1,.account-promo-card .promo-desc h2,.account-promo-card .promo-desc h3{margin:0 0 8px;line-height:1.35;color:#fff}
      .account-promo-card .promo-desc ul{margin:4px 0 0 18px;padding:0}
      .account-promo-card .promo-desc li{margin:4px 0}
      .account-promo-card .promo-desc code{padding:2px 6px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12)}
      .account-promo-card .promo-desc a{color:#93c5fd}
      .account-promo-card .promo-desc .ad-badge{display:none!important}
      .account-promo-card .promo-desc .ad-btn{display:inline-flex;align-items:center;justify-content:center;margin-top:8px;padding:9px 12px;border-radius:10px;text-decoration:none;color:#fff;font-weight:800;background:linear-gradient(135deg,#3b82f6,#8b5cf6);border:1px solid rgba(255,255,255,.12)}
      @media (max-width:768px){
        .header h1{font-size:2.2rem}
        .container{padding:0 10px}
        .grid-resources{grid-template-columns:1fr;gap:15px}
        .grid-partners{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}
        .fab-container{bottom:18px;gap:10px;width:calc(100% - 20px)}
        .fab-btn{padding:10px 14px;font-size:.85rem}
        .notice-card{padding:16px 18px}
        .promo-card{flex-direction:column;align-items:flex-start;gap:14px;padding:18px}
        .promo-badge{min-width:auto;width:auto;max-width:100%;font-size:.9rem}
      }
    </style><script>
      function initSearch(){
        const searchBox=document.querySelector('.search-box');
        const gridResources=document.querySelector('.grid-resources');
        const noResult=document.createElement('div');
        noResult.className='no-result';
        noResult.innerHTML='😕 暂无匹配结果';
        gridResources.after(noResult);
        if(!searchBox) return;
        let timer=null;
        searchBox.addEventListener('keydown',e=>e.key==='Enter'&&e.preventDefault());
        searchBox.addEventListener('input',function(e){
          clearTimeout(timer);
          timer=setTimeout(()=>{
            const searchTerm=e.target.value.toLowerCase().trim();
            const cards=document.querySelectorAll('.resource-card-wrap,.partner-card');
            let hasMatch=false;
            cards.forEach(card=>{
              const isMatch=!searchTerm||card.textContent.toLowerCase().includes(searchTerm);
              card.style.display=isMatch?'':'none';
              if(isMatch) hasMatch=true;
            });
            noResult.style.display=searchTerm&&!hasMatch?'block':'none';
          },120);
        });
      }
      function initThemeToggle(){
        const themeBtn=document.querySelector('.theme-toggle');
        if(!themeBtn) return;
        const toggleTheme=()=>{
          document.body.classList.toggle('dark-theme');
          const isDark=document.body.classList.contains('dark-theme');
          localStorage.setItem('theme',isDark?'dark':'light');
          themeBtn.textContent=isDark?'☀️':'🌙';
        };
        themeBtn.addEventListener('click',toggleTheme);
        const savedTheme=localStorage.getItem('theme');
        const prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;
        if(savedTheme==='dark'||(!savedTheme&&prefersDark)){document.body.classList.add('dark-theme');themeBtn.textContent='☀️';}
        else themeBtn.textContent='🌙';
      }
      document.addEventListener('DOMContentLoaded',()=>{initSearch();initThemeToggle();});
    </script></head><body>
      <button class="theme-toggle" title="切换主题">🌙</button>
      <div class="container">
        <div class="header glass-card"><h1>${this.escapeHtml(this.config.title)}</h1><p>${this.escapeHtml(this.config.subtitle)}</p></div>
        <div class="search-container"><div class="search-wrap"><span class="search-icon">🔎</span><input type="text" class="search-box" placeholder="搜索导航项目..." /></div></div>
        ${noticeHtml}
        ${accountCardHtml}
        ${promoHtml}
        <div class="section-title">💎 精选</div>
        <div class="grid-resources">${cardsHtml}</div>
        <div class="section-title">🔗 友链</div>
        <div class="grid-partners">${friendsHtml}</div>
      </div>
      ${fabHtml}
      ${this.render_BgRuntimeScript()}
    </body></html>`;
  }
}
  
