export default {
  async fetch(request, env, ctx) {
    return new NooMiNav(request, env, ctx).handle();
  }
};

export async function onRequest(context) {
  return new NooMiNav(context.request, context.env, context).handle();
}

class NooMiNav {
  constructor(request, env, ctx) {
    this.request = request;
    this.env = env;
    this.ctx = ctx;
    this.url = new URL(request.url);

    this.COOKIE_NAME = "nav_session_v13_pro";
    this.DEFAULT_IMG = "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=2073";
    this.FONT_STACK = `'SF Pro Display','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif`;

    const now = new Date(Date.now() + 8 * 3600000);
    this.time = {
      now,
      year: String(now.getFullYear()),
      month: String(now.getMonth() + 1).padStart(2, "0"),
      todayStr: now.toISOString().split("T")[0],
      fullStr: now.toISOString().replace("T", " ").substring(0, 19),
      dateKey: `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}`
    };
  }

  async handle() {
    await this.initConfig();
    const path = this.url.pathname;

    if (path === "/message") return this.route_MessageDetail();
    if (path === "/contact") return this.route_Contact();
    if (path === `${this.ADMIN_PATH}/api/logs`) return this.api_GetLogs();
    if (path === `${this.ADMIN_PATH}/api/settings`) return this.api_SaveSettings();
    if (path === `${this.ADMIN_PATH}/logout`) return this.route_AdminLogout();
    if (path === this.ADMIN_PATH) return this.route_AdminPage();

    if (path.startsWith("/go/") || path.startsWith("/fgo/")) {
      this.loadJsonData();
      return this.route_Redirect(path);
    }

    this.loadJsonData();
    return this.route_HomePage();
  }

  async initConfig() {
    this.dbSettings = {};
    if (this.env.db) {
      try {
        const res = await this.env.db.prepare("SELECT * FROM settings").all();
        res.results.forEach(r => this.dbSettings[r.key] = r.value);
      } catch (e) {
        if (e.message.includes("no such table")) {
          try {
            await this.env.db.prepare("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)").run();
          } catch {}
        }
      }
    }

    this.ADMIN_PATH = "/" + (this.env.admin || "admin").replace(/^\//, "");

    this.config = {
      admin_pass: this.dbSettings.admin_pass || "123456",
      title: this.dbSettings.title || this.env.TITLE || "云端加速 · 精选导航",
      subtitle: this.dbSettings.subtitle || this.env.SUBTITLE || "优质资源推荐 · 随时畅联",
      contact_url: this.dbSettings.contact_url || this.env.CONTACT_URL || "",
      mail: this.dbSettings.mail !== undefined ? this.dbSettings.mail : (this.env.mail || ""),
      push: this.dbSettings.push !== undefined ? this.dbSettings.push : (this.env.push || ""),
      host: (this.dbSettings.host || this.env.host || this.url.origin).replace(/\/$/, ""),
      notice: this.dbSettings.notice !== undefined
        ? this.dbSettings.notice
        : (this.env.notice || `<div style="margin-bottom:8px">🎉 欢迎使用 FlarePortal 极简导航！</div><div class="notice-sub">您可以在后台「系统设置」中修改此处的公告内容，支持 HTML 标签。如果清空内容，公告板将自动隐藏。</div>`),
      promo_enable: this.dbSettings.promo_enable !== undefined ? this.dbSettings.promo_enable : (this.env.promo_enable || "1"),
      promo_badge: this.dbSettings.promo_badge !== undefined ? this.dbSettings.promo_badge : (this.env.promo_badge || "免费域名可托管 CF"),
      promo_title: this.dbSettings.promo_title !== undefined ? this.dbSettings.promo_title : (this.env.promo_title || "本站域名服务由 DigitalPlat FreeDomain 提供支持"),
      promo_desc: this.dbSettings.promo_desc !== undefined ? this.dbSettings.promo_desc : (this.env.promo_desc || "可免费申请域名，支持 Cloudflare 托管接入，适合导航站与个人项目使用。"),
      promo_url: this.dbSettings.promo_url !== undefined ? this.dbSettings.promo_url : (this.env.promo_url || "https://dash.domain.digitalplat.org/signup?ref=s8ywnMQRkL"),
      promo_format: this.dbSettings.promo_format !== undefined ? this.dbSettings.promo_format : (this.env.promo_format || "markdown")
    };

    if (this.config.push && !this.config.push.endsWith("/contact")) {
      this.config.push = this.config.push.replace(/\/$/, "") + "/contact";
    }

    this.config.img = this.DEFAULT_IMG;
    const imgSource = this.dbSettings.img || this.env.img;
    if (imgSource) {
      const imgStr = imgSource.trim();
      if (imgStr.startsWith("data:")) {
        this.config.img = imgStr;
      } else {
        const list = imgStr.split(",").map(s => s.trim()).filter(Boolean);
        if (list.length) {
          const dayIndex = Math.floor(this.time.now.getTime() / 86400000);
          this.config.img = list[dayIndex % list.length];
        }
      }
    }
  }

  loadJsonData() {
    const getJsonEnv = k => {
      try { return this.env[k] ? JSON.parse(this.env[k]) : []; }
      catch { return []; }
    };
    this.LINKS_DATA = this.dbSettings.links ? JSON.parse(this.dbSettings.links) : getJsonEnv("LINKS");
    this.FRIENDS_DATA = this.dbSettings.friends ? JSON.parse(this.dbSettings.friends) : getJsonEnv("FRIENDS");
  }

  getSafeParam(sp, key, def = "") {
    return sp.get(key)?.trim() || def;
  }

  safeCssUrl(url) {
    return String(url || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  safeScriptJson(obj) {
    return JSON.stringify(obj)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
  }

  escapeHtml(str = "") {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  renderRichContent(content = "", format = "html") {
    const raw = String(content || "");
    const mode = String(format || "html").toLowerCase();

    if (mode === "html") return raw;

    let s = this.escapeHtml(raw);
    s = s.replace(/^###\s+(.*)$/gm, "<h3>$1</h3>");
    s = s.replace(/^##\s+(.*)$/gm, "<h2>$1</h2>");
    s = s.replace(/^#\s+(.*)$/gm, "<h1>$1</h1>");
    s = s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*(.*?)\*/g, "<em>$1</em>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/$$([^$$]+)\]$(https?:\/\/[^\s)]+)$/g, `<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>`);

    const lines = s.split("\n");
    const html = [];
    let inList = false;

    for (const line of lines) {
      if (/^\s*[-*]\s+/.test(line)) {
        if (!inList) { html.push("<ul>"); inList = true; }
        html.push(`<li>${line.replace(/^\s*[-*]\s+/, "")}</li>`);
      } else {
        if (inList) { html.push("</ul>"); inList = false; }
        if (!line.trim()) html.push("");
        else if (/^<h[1-3]>/.test(line)) html.push(line);
        else html.push(`<p>${line}</p>`);
      }
    }
    if (inList) html.push("</ul>");
    return html.join("\n");
  }

  getBgShellStyle() {
    return `background-color:#0f172a;background-size:cover;background-position:center;background-repeat:no-repeat;`;
  }

  render_BgRuntimeScript() {
    const primary = this.safeCssUrl(this.config.img);
    const fallback = this.safeCssUrl(this.DEFAULT_IMG);
    return `<script>(function(){if(window.__bgInitDone)return;window.__bgInitDone=true;const body=document.body,primary='${primary}',fallback='${fallback}';function applyBg(url){body.style.backgroundImage="linear-gradient(rgba(2,6,23,0.30),rgba(2,6,23,0.40)),url('"+url+"')"}function loadImage(url,ok,fail){if(!url){fail&&fail();return}const img=new Image();img.onload=()=>ok&&ok(url);img.onerror=()=>fail&&fail();img.referrerPolicy='no-referrer';img.src=url}applyBg(fallback);if(primary&&primary!==fallback)loadImage(primary,applyBg,()=>loadImage(fallback,applyBg));else loadImage(fallback,applyBg)})();</script>`;
  }

  render_Head(title) {
    return `<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>`;
  }

  async route_Redirect(path) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2) return new Response("Invalid URL", { status: 400 });

    const type = parts[0] === "go" ? "link" : "friend";
    const id = parts[1];
    const isBackup = parts[2] === "backup";
    const dataSet = type === "link" ? this.LINKS_DATA : this.FRIENDS_DATA;
    const item = dataSet.find(l => l.id === id);
    if (!item) return new Response("Target not found", { status: 404 });

    let targetUrl = item.url;
    let logName = item.name;
    if (type === "link" && isBackup && item.backup_url) {
      targetUrl = item.backup_url;
      logName += "(备用)";
    }

    if (!targetUrl) return new Response("No valid URL available", { status: 400 });

    if (this.env.db) this.ctx.waitUntil(this.db_recordClick(isBackup ? `${id}_backup` : id, logName, type));
    return Response.redirect(targetUrl, 302);
  }

  route_MessageDetail() {
    const dataStr = this.url.searchParams.get("d");
    let msgData = { c: "未知", m: "内容解析失败或已损坏", t: this.time.fullStr };
    if (dataStr) { try { msgData = JSON.parse(decodeURIComponent(atob(dataStr))); } catch {} }
    return new Response(this.render_MessageDetail(msgData), {
      headers: { "content-type": "text/html;charset=UTF-8" }
    });
  }

  async route_Contact() {
    if (this.request.method === "GET") {
      return new Response(this.render_ContactPage(), {
        headers: { "content-type": "text/html;charset=UTF-8" }
      });
    }

    if (this.request.method === "POST") {
      try {
        const formData = await this.request.formData();
        const contactInfo = formData.get("guest_contact") || "匿名访客";
        const messageContent = formData.get("message") || "无内容";
        if (!this.config.push) return new Response("⚠️ 站长尚未配置接收通道", { status: 500 });

        const payload = JSON.stringify({ c: contactInfo, m: messageContent, t: this.time.fullStr });
        const detailUrl = `${this.config.host}/message?d=${btoa(encodeURIComponent(payload))}`;
        const shortMsg = messageContent.length > 60 ? messageContent.substring(0, 60) + "..." : messageContent;

        await fetch(this.config.push, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `💬 导航站留言: ${contactInfo}`,
            content: `时间: ${this.time.fullStr}\n内容: ${shortMsg}\n\n👉 点击卡片查看完整详情`,
            url: detailUrl
          })
        });
        return new Response("✅ 发送成功！站长已收到你的留言", { status: 200 });
      } catch {
        return new Response("❌ 发送失败，请稍后重试", { status: 500 });
      }
    }
  }

  route_HomePage() {
    return new Response(this.render_HomePage(), {
      headers: { "content-type": "text/html;charset=UTF-8" }
    });
  }

  async route_AdminPage() {
    const cookie = this.request.headers.get("Cookie") || "";

    if (this.request.method === "POST") {
      const formData = await this.request.formData();
      const password = formData.get("password") || "";

      if (password.length > 100) {
        return new Response(this.render_LoginPage("密码长度异常"), {
          headers: { "content-type": "text/html;charset=UTF-8" }
        });
      }

      if (password === this.config.admin_pass) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: this.ADMIN_PATH,
            "Set-Cookie": `${this.COOKIE_NAME}=true; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict`
          }
        });
      }

      return new Response(this.render_LoginPage("密码错误"), {
        headers: { "content-type": "text/html;charset=UTF-8" }
      });
    }

    if (!cookie.includes(`${this.COOKIE_NAME}=true`)) {
      return new Response(this.render_LoginPage(""), {
        headers: { "content-type": "text/html;charset=UTF-8" }
      });
    }

    this.loadJsonData();
    const selected = this.getSafeParam(this.url.searchParams, "m", this.time.dateKey);

    try {
      const dashboardData = await this.db_getDashboardData(selected);
      return new Response(this.render_AdminDashboard(dashboardData, selected), {
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
        Location: this.ADMIN_PATH,
        "Set-Cookie": `${this.COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
      }
    });
  }

  async api_GetLogs() {
    if (this.request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const cookie = this.request.headers.get("Cookie") || "";
    if (!cookie.includes(`${this.COOKIE_NAME}=true`)) return new Response("Unauthorized", { status: 401 });

    const id = this.getSafeParam(this.url.searchParams, "id");
    const m = this.getSafeParam(this.url.searchParams, "m", this.time.dateKey);
    if (!this.env.db) return new Response("Database not available", { status: 500 });

    try {
      let normalized = m.replace("_", "-").substring(0, 7);
      const queryParam = /^\d{4}-\d{2}$/.test(normalized) ? m.replace("_", "-") : this.time.dateKey.replace("_", "-");
      const { results } = await this.env.db.prepare(
        "SELECT click_time, ip_address, user_agent FROM logs WHERE link_id = ? AND click_time LIKE ? || '%' ORDER BY id DESC LIMIT 50"
      ).bind(id, queryParam).all();

      return new Response(JSON.stringify(results || []), {
        headers: { "content-type": "application/json" }
      });
    } catch {
      return new Response("Failed to fetch logs", { status: 500 });
    }
  }

  async api_SaveSettings() {
    if (this.request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const cookie = this.request.headers.get("Cookie") || "";
    if (!cookie.includes(`${this.COOKIE_NAME}=true`)) return new Response("Unauthorized", { status: 401 });

    try {
      const body = await this.request.json();
      const stmts = Object.keys(body).map(k =>
        this.env.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(k, String(body[k]))
      );
      await this.env.db.batch(stmts);
      return new Response("OK");
    } catch {
      return new Response("Save failed", { status: 500 });
    }
  }

  async db_recordClick(id, name, type) {
    try {
      const ip = this.request.headers.get("CF-Connecting-IP") || "unknown";
      const userAgent = this.request.headers.get("User-Agent") || "unknown";
      const { dateKey, fullStr, year, todayStr } = this.time;

      await this.env.db.prepare(
        "INSERT INTO logs (link_id, click_time, month_key, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)"
      ).bind(id, fullStr, dateKey, ip, userAgent).run();

      await this.env.db.prepare(
        `INSERT INTO stats (id, name, type, total_clicks, year_clicks, month_clicks, day_clicks, last_year, last_month, last_day, last_time)
         VALUES (?1, ?2, ?3, 1, 1, 1, 1, ?4, ?5, ?7, ?6)
         ON CONFLICT(id) DO UPDATE SET
           total_clicks = total_clicks + 1,
           year_clicks = CASE WHEN last_year = ?4 THEN year_clicks + 1 ELSE 1 END,
           month_clicks = CASE WHEN last_month = ?5 THEN month_clicks + 1 ELSE 1 END,
           day_clicks = CASE WHEN last_day = ?7 THEN day_clicks + 1 ELSE 1 END,
           last_year = ?4,
           last_month = ?5,
           last_day = ?7,
           last_time = ?6,
           name = ?2,
           type = ?3`
      ).bind(id, name, type, year, dateKey, fullStr, todayStr).run();
    } catch (e) {
      console.error("DB Record Error:", e);
    }
  }

  async db_getDashboardData(selected) {
    if (!this.env.db) throw new Error("Database not bound");

    const currentMonthKey = selected.replace("-", "_").substring(0, 7);
    const queryParam = selected.replace("_", "-");
    const isDayMode = selected.length > 7 && /^\d{4}-\d{2}-\d{2}$/.test(selected);

    const queries = [
      this.env.db.prepare("SELECT id, total_clicks, last_time FROM stats").all().catch(() => ({ results: [] })),
      this.env.db.prepare("SELECT link_id, COUNT(*) as count FROM logs WHERE click_time LIKE ? || '%' GROUP BY link_id").bind(this.time.todayStr).all().catch(() => ({ results: [] })),
      this.env.db.prepare("SELECT link_id, COUNT(*) as count FROM logs WHERE click_time LIKE ? || '%' GROUP BY link_id").bind(queryParam).all().catch(() => ({ results: [] })),
      isDayMode
        ? this.env.db.prepare("SELECT link_id, COUNT(*) as count FROM logs WHERE month_key = ? GROUP BY link_id").bind(currentMonth
