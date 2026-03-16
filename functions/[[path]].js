// ============================================================================
// NooMiNav V13.0 旗舰版
// 双擎驱动适配器：完美支持 Cloudflare Workers 和 Pages
// ============================================================================
export default { async fetch(request, env, ctx) { const app = new NooMiNav(request, env, ctx); return app.handle(); } };
export async function onRequest(context) { const app = new NooMiNav(context.request, context.env, context); return app.handle(); }

// ============================================================================
// 核心应用类 (模块化架构)
// ============================================================================
class NooMiNav {
    constructor(request, env, ctx) {
        this.request = request;
        this.env = env;
        this.ctx = ctx;
        this.url = new URL(request.url);
        
        // 常量定义
        this.COOKIE_NAME = "nav_session_v13_pro";
        this.DEFAULT_IMG = "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=2073";
        this.FONT_STACK = `'SF Pro Display', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
        
        // 时间预处理 (UTC+8)
        const now = new Date(new Date().getTime() + 8 * 3600000);
        this.time = {
            now: now,
            year: now.getFullYear().toString(),
            month: (now.getMonth() + 1).toString().padStart(2, '0'),
            todayStr: now.toISOString().split('T')[0],
            fullStr: now.toISOString().replace('T', ' ').substring(0, 19),
            dateKey: `${now.getFullYear()}_${(now.getMonth() + 1).toString().padStart(2, '0')}`
        };
    }

    // ------------------------------------------------------------------------
    // [模块 1] 初始化配置加载 (合并 D1 和 Env 环境变量)
    // ------------------------------------------------------------------------
    async initConfig() {
        this.dbSettings = {};
        if (this.env.db) {
            try {
                const res = await this.env.db.prepare("SELECT * FROM settings").all();
                res.results.forEach(r => this.dbSettings[r.key] = r.value);
            } catch (e) {
                if (e.message.includes("no such table")) {
                    try { await this.env.db.prepare("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)").run(); } catch(err){}
                }
            }
        }

        // 基础参数合并
        this.ADMIN_PATH = '/' + (this.env.admin || 'admin').replace(/^\//, '');
        this.config = {
            admin_pass: this.dbSettings.admin_pass || "123456",
            title: this.dbSettings.title || this.env.TITLE || "云端加速 · 精选导航",
            subtitle: this.dbSettings.subtitle || this.env.SUBTITLE || "优质资源推荐 · 随时畅联",
            contact_url: this.dbSettings.contact_url || this.env.CONTACT_URL || "",
            mail: this.dbSettings.mail !== undefined ? this.dbSettings.mail : (this.env.mail || ""),
            push: this.dbSettings.push !== undefined ? this.dbSettings.push : (this.env.push || ""),
            host: (this.dbSettings.host || this.env.host || this.url.origin).replace(/\/$/, '')
        };

        // 格式化 Push API
        if (this.config.push && !this.config.push.endsWith('/contact')) {
            this.config.push = this.config.push.replace(/\/$/, '') + '/contact';
        }

        // 图片轮换逻辑
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

    // 懒加载 JSON 数据 (优化性能，防止不必要的解析开销)
    loadJsonData() {
        const getJsonEnv = (k) => { try { return this.env[k] ? JSON.parse(this.env[k]) : []; } catch(e) { return []; } };
        this.LINKS_DATA = this.dbSettings.links ? JSON.parse(this.dbSettings.links) : getJsonEnv('LINKS');
        this.FRIENDS_DATA = this.dbSettings.friends ? JSON.parse(this.dbSettings.friends) : getJsonEnv('FRIENDS');
    }

    // ------------------------------------------------------------------------
    // [模块 2] 主路由分发器
    // ------------------------------------------------------------------------
    async handle() {
        await this.initConfig();

        const path = this.url.pathname;
        
        // 1. 无状态留言详情页
        if (path === '/message') return this.route_MessageDetail();
        
        // 2. 联系留言板
        if (path === '/contact') return this.route_Contact();
        
        // 3. API 接口: 日志查询
        if (path === `${this.ADMIN_PATH}/api/logs`) return this.api_GetLogs();
        
        // 4. API 接口: 设置保存
        if (path === `${this.ADMIN_PATH}/api/settings`) return this.api_SaveSettings();
        
        // 5. 后台管理页面与登出
        if (path === `${this.ADMIN_PATH}/logout`) return this.route_AdminLogout();
        if (path === this.ADMIN_PATH) return this.route_AdminPage();
        
        // 6. 链接跳转路由
        if (path.startsWith('/go/') || path.startsWith('/fgo/')) {
            this.loadJsonData();
            return this.route_Redirect(path);
        }

        // 7. 默认前台主页
        this.loadJsonData();
        return this.route_HomePage();
    }

    // ------------------------------------------------------------------------
    // [模块 3] 路由控制器与业务逻辑
    // ------------------------------------------------------------------------
    
    // 控制器: 跳转逻辑
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

        // 异步记录日志，不阻塞跳转
        if (this.env.db) {
            this.ctx.waitUntil(this.db_recordClick(isBackup ? `${id}_backup` : id, logName, type));
        }
        
        return Response.redirect(targetUrl, 302);
    }

    // 控制器: 留言详情页
    route_MessageDetail() {
        const dataStr = this.url.searchParams.get('d');
        let msgData = { c: '未知', m: '内容解析失败或已损坏', t: this.time.fullStr };
        if (dataStr) { try { msgData = JSON.parse(decodeURIComponent(atob(dataStr))); } catch(e) {} }
        return new Response(this.render_MessageDetail(msgData), { headers: { "content-type": "text/html;charset=UTF-8" } });
    }

    // 控制器: 留言提交页
    async route_Contact() {
        if (this.request.method === 'GET') {
            return new Response(this.render_ContactPage(), { headers: { "content-type": "text/html;charset=UTF-8" } });
        }
        if (this.request.method === 'POST') {
            try {
                const formData = await this.request.formData();
                const contactInfo = formData.get('guest_contact') || '匿名访客';
                const messageContent = formData.get('message') || '无内容';
                
                if (!this.config.push) return new Response('⚠️ 站长尚未配置接收通道', { status: 500 });
                
                const payload = JSON.stringify({ c: contactInfo, m: messageContent, t: this.time.fullStr });
                const detailUrl = `${this.config.host}/message?d=${btoa(encodeURIComponent(payload))}`;
                const shortMsg = messageContent.length > 60 ? messageContent.substring(0, 60) + '...' : messageContent;
                
                await fetch(this.config.push, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ title: `💬 导航站留言: ${contactInfo}`, content: `时间: ${this.time.fullStr}\n内容: ${shortMsg}\n\n👉 点击卡片查看完整详情`, url: detailUrl }) 
                });
                return new Response('✅ 发送成功！站长已收到你的留言', { status: 200 });
            } catch(e) { return new Response('❌ 发送失败，请稍后重试', { status: 500 }); }
        }
    }

    // 控制器: 前台主页
    route_HomePage() {
        const html = this.render_HomePage();
        return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
    }

    // 控制器: 后台页面
    async route_AdminPage() {
        const cookie = this.request.headers.get('Cookie') || '';
        
        // 处理登录
        if (this.request.method === 'POST') {
            const formData = await this.request.formData();
            const password = formData.get('password') || '';
            if (password.length > 100) return new Response(this.render_LoginPage('密码长度异常'), { headers: { "content-type": "text/html;charset=UTF-8" } });
            if (password === this.config.admin_pass) {
                return new Response(null, { status: 302, headers: { 'Location': this.ADMIN_PATH, 'Set-Cookie': `${this.COOKIE_NAME}=true; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict` } });
            } else {
                return new Response(this.render_LoginPage('密码错误'), { headers: { "content-type": "text/html;charset=UTF-8" } });
            }
        }
        
        // 校验权限
        if (!cookie.includes(`${this.COOKIE_NAME}=true`)) {
            return new Response(this.render_LoginPage(''), { headers: { "content-type": "text/html;charset=UTF-8" } });
        }

        // 加载数据用于看板渲染
        this.loadJsonData();
        const selectedDateOrMonth = this.getSafeParam(this.url.searchParams, 'm', this.time.dateKey);
        
        try {
            const dashboardData = await this.db_getDashboardData(selectedDateOrMonth);
            const html = this.render_AdminDashboard(dashboardData, selectedDateOrMonth);
            return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
        } catch (dbErr) { 
            return new Response(`Data Error: ${dbErr.message}`, { status: 500 }); 
        }
    }

    route_AdminLogout() {
        return new Response(null, { status: 302, headers: { 'Location': this.ADMIN_PATH, 'Set-Cookie': `${this.COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` } });
    }

    // API: 获取日志
    async api_GetLogs() {
        if (this.request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
        const cookie = this.request.headers.get('Cookie') || '';
        if (!cookie.includes(`${this.COOKIE_NAME}=true`)) return new Response('Unauthorized', { status: 401 });
        
        const id = this.getSafeParam(this.url.searchParams, 'id');
        const m = this.getSafeParam(this.url.searchParams, 'm', this.time.dateKey);
        
        if (!this.env.db) return new Response('Database not available', { status: 500 });
        
        try {
            let normalized = m.replace('_', '-').substring(0, 7);
            const queryParam = /^\d{4}-\d{2}$/.test(normalized) ? m.replace('_', '-') : this.time.dateKey.replace('_', '-');
            const { results } = await this.env.db.prepare("SELECT click_time, ip_address, user_agent FROM logs WHERE link_id = ? AND click_time LIKE ? || '%' ORDER BY id DESC LIMIT 50").bind(id, queryParam).all();
            return new Response(JSON.stringify(results || []), { headers: { "content-type": "application/json" } });
        } catch (dbErr) { return new Response('Failed to fetch logs', { status: 500 }); }
    }

    // API: 保存设置
    async api_SaveSettings() {
        if (this.request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
        const cookie = this.request.headers.get('Cookie') || '';
        if (!cookie.includes(`${this.COOKIE_NAME}=true`)) return new Response('Unauthorized', { status: 401 });
        
        try {
            const body = await this.request.json();
            const stmts = Object.keys(body).map(k => this.env.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(k, String(body[k])));
            await this.env.db.batch(stmts);
            return new Response('OK');
        } catch(e) { return new Response('Save failed', { status: 500 }); }
    }

    // ------------------------------------------------------------------------
    // [模块 4] 数据库操作 (DAO)
    // ------------------------------------------------------------------------
    async db_recordClick(id, name, type) {
        try {
            const ip = this.request.headers.get('CF-Connecting-IP') || 'unknown';
            const userAgent = this.request.headers.get('User-Agent') || 'unknown';
            const { dateKey, fullStr, year, month, todayStr } = this.time;
            
            await this.env.db.prepare("INSERT INTO logs (link_id, click_time, month_key, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)").bind(id, fullStr, dateKey, ip, userAgent).run();
            await this.env.db.prepare(`INSERT INTO stats (id, name, type, total_clicks, year_clicks, month_clicks, day_clicks, last_year, last_month, last_day, last_time) VALUES (?1, ?2, ?3, 1, 1, 1, 1, ?4, ?5, ?7, ?6) ON CONFLICT(id) DO UPDATE SET total_clicks = total_clicks + 1, year_clicks = CASE WHEN last_year = ?4 THEN year_clicks + 1 ELSE 1 END, month_clicks = CASE WHEN last_month = ?5 THEN month_clicks + 1 ELSE 1 END, day_clicks = CASE WHEN last_day = ?7 THEN day_clicks + 1 ELSE 1 END, last_year = ?4, last_month = ?5, last_day = ?7, last_time = ?6, name = ?2, type = ?3`).bind(id, name, type, year, dateKey, fullStr, todayStr).run();
        } catch (e) { console.error("DB Record Error:", e); }
    }

    async db_getDashboardData(selectedDateOrMonth) {
        if (!this.env.db) throw new Error('Database not bound');
        
        const currentMonthKey = selectedDateOrMonth.replace('-', '_').substring(0, 7); 
        const queryParam = selectedDateOrMonth.replace('_', '-'); 
        const isDayMode = selectedDateOrMonth.length > 7 && /^\d{4}-\d{2}-\d{2}$/.test(selectedDateOrMonth);

        // 并行优化数据库查询
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

        // 转化为 Map 实现 O(1) 取值性能优化
        const statsMap = new Map(); if (statsResult?.results) statsResult.results.forEach(r => statsMap.set(r.id, r));
        const dailyMap = new Map(); if (dailyResult?.results) dailyResult.results.forEach(r => dailyMap.set(r.link_id, r.count));
        const periodMap = new Map(); if (periodResult?.results) periodResult.results.forEach(r => periodMap.set(r.link_id, r.count));
        const monthContextMap = new Map(); if (monthContextResult?.results) monthContextResult.results.forEach(r => monthContextMap.set(r.link_id, r.count));
        const monthTotalClicks = monthTotalResult?.results?.[0]?.total || 0;

        return { statsMap, dailyMap, periodMap, monthContextMap, monthTotalClicks, isDayMode };
    }

    // 辅助: 参数安全获取
    getSafeParam(sp, key, def = '') { return sp.get(key)?.trim() || def; }

    // ------------------------------------------------------------------------
    // [模块 5] 渲染模块 (UI)
    // ------------------------------------------------------------------------
    render_Head(t) { 
        return `<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t}</title><style>:root{--glass:rgba(15,23,42,0.6);--border:rgba(255,255,255,0.15);--text-shadow:0 2px 4px rgba(0,0,0,0.8)}body{margin:0;min-height:100vh;font-family:${this.FONT_STACK};color:#fff;display:flex;justify-content:center;align-items:center}.glass-panel{background:var(--glass);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid var(--border);box-shadow:0 8px 32px rgba(0,0,0,0.2);border-radius:16px}h1,div,span,a{text-shadow:var(--text-shadow)}</style>`; 
    }
    
    getBgStyle() { 
        return `background-image: url('${this.config.img}'), url('${this.DEFAULT_IMG}'); background-size: cover; background-position: center; background-attachment: fixed; background-repeat: no-repeat;`; 
    }

    // 页面: 留言详情
    render_MessageDetail(data) {
        return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>留言详情</title><style>body { font-family: ${this.FONT_STACK}; background: #f3f4f6; margin: 0; padding: 20px; display: flex; justify-content: center; min-height: 100vh; box-sizing: border-box; } .ticket-card { background: #ffffff; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); width: 100%; max-width: 600px; padding: 40px; margin-top: 5vh; height: fit-content; border-top: 6px solid #8b5cf6; } .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 25px; } .badge { background: #ede9fe; color: #7c3aed; padding: 6px 12px; border-radius: 20px; font-size: 0.85rem; font-weight: 700; letter-spacing: 0.5px; } .time { color: #94a3b8; font-size: 0.9rem; font-family: monospace; } .sender-box { margin-bottom: 25px; } .label { font-size: 0.85rem; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 1px; margin-bottom: 5px; } .sender { font-size: 1.5rem; color: #0f172a; font-weight: 800; margin: 0; word-break: break-all; } .divider { height: 1px; background: #e2e8f0; margin: 25px 0; } .message { font-size: 1.1rem; line-height: 1.8; color: #334155; white-space: pre-wrap; word-break: break-word; } .footer { margin-top: 40px; text-align: center; color: #cbd5e1; font-size: 0.85rem; } @media (max-width: 600px) { .ticket-card { padding: 25px; } .sender { font-size: 1.2rem; } .message { font-size: 1rem; } }</style></head><body><div class="ticket-card"><div class="header"><span class="badge">INBOX MESSAGE</span><span class="time">${data.t}</span></div><div class="sender-box"><div class="label">Contact / 发件人</div><h2 class="sender">${data.c}</h2></div><div class="divider"></div><div class="label">Message / 内容</div><div class="message">${data.m}</div><div class="footer">🔒 Encrypted transmission powered by Cloudflare</div></div></body></html>`;
    }

    // 页面: 留言板
    render_ContactPage() {
        return `<!DOCTYPE html><html><head>${this.render_Head(this.config.title)}<style>.box { padding: 40px; width: 380px; text-align: left; } h2 { font-size: 1.6rem; margin: 0 0 10px 0; display: flex; align-items: center; gap: 8px; } p.desc { color: #cbd5e1; font-size: 0.9rem; margin-bottom: 25px; line-height: 1.5; } form { display: flex; flex-direction: column; width: 100%; } label { font-size: 0.85rem; color: #f1f5f9; margin-bottom: 8px; font-weight: 600; } input, textarea { width: 100%; padding: 14px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.2); border-radius: 12px; color: #fff; margin-bottom: 20px; outline: none; transition: 0.3s; font-size: 0.95rem; box-sizing: border-box; font-family: inherit; } input:focus, textarea:focus { border-color: #f43f5e; background: rgba(0,0,0,0.5); box-shadow: 0 0 0 3px rgba(244,63,94,0.2); } input::placeholder, textarea::placeholder { color: rgba(255,255,255,0.4); } textarea { resize: vertical; min-height: 100px; } button { width: 100%; padding: 16px; background: linear-gradient(135deg, #f43f5e, #fb923c); color: #fff; border: none; border-radius: 12px; font-weight: 800; cursor: pointer; font-size: 1rem; transition: 0.3s; box-shadow: 0 4px 15px rgba(244,63,94,0.3); } button:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(244,63,94,0.5); } button:disabled { opacity: 0.7; cursor: not-allowed; transform: none; } .status { margin-top: 15px; font-size: 0.9rem; font-weight: 600; text-align: center; min-height: 20px; } .back { text-align: center; margin-top: 20px; } .back a { color: #94a3b8; text-decoration: none; font-size: 0.85rem; transition: 0.2s; } .back a:hover { color: #fff; }</style></head><body style="${this.getBgStyle()} display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0;"><div class="glass-panel box"><h2>📝 给我留言</h2><p class="desc">有任何问题或合作意向？<br>留下联系方式，看到了会联系你，优先留下邮箱。</p><form id="msgForm"><label>怎么联系你？</label><input type="text" name="guest_contact" placeholder="请在这里输入你的邮箱或者QQ" required><label>你想说什么？</label><textarea name="message" placeholder="写下你的留言内容..." required></textarea><button type="submit" id="submitBtn">发送留言</button></form><div id="status" class="status"></div><div class="back"><a href="/">← 返回导航主页</a></div></div><script>document.getElementById('msgForm').addEventListener('submit', async (e) => { e.preventDefault(); const btn = document.getElementById('submitBtn'); const status = document.getElementById('status'); btn.disabled = true; btn.innerText = '发送中...'; status.innerText = ''; try { const res = await fetch('/contact', { method: 'POST', body: new FormData(e.target) }); const text = await res.text(); status.style.color = res.ok ? '#34d399' : '#f87171'; status.innerText = text; if(res.ok) e.target.reset(); } catch(err) { status.style.color = '#f87171'; status.innerText = '网络错误，请稍后重试'; } finally { btn.disabled = false; btn.innerText = '发送留言'; } });</script></body></html>`;
    }

    // 页面: 登录页
    render_LoginPage(errorMsg = '') {
        return `<!DOCTYPE html><html><head>${this.render_Head(this.config.title)}<style>.box { padding: 50px 40px; text-align: center; width: 340px; display: flex; flex-direction: column; align-items: center; } h1 { font-size: 1.8rem; margin-bottom: 30px; } form { width: 100%; display: flex; flex-direction: column; align-items: center; } input { width: 100%; padding: 16px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.2); border-radius: 12px; color: #fff; margin-bottom: 20px; outline: none; transition: 0.3s; font-size: 1rem; box-sizing: border-box; text-align: center; } input:focus { border-color: #a78bfa; background: rgba(0,0,0,0.5); transform: scale(1.02); } input::placeholder { color: rgba(255,255,255,0.5); } button { width: 100%; padding: 16px; background: #fff; color: #000; border: none; border-radius: 12px; font-weight: 800; cursor: pointer; font-size: 1rem; transition: 0.3s; box-shadow: 0 4px 15px rgba(0,0,0,0.2); } button:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,0,0,0.3); } .error-msg { color: #f87171; margin-bottom: 15px; font-size: 0.9rem; min-height: 20px; }</style></head><body style="${this.getBgStyle()} display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0;"><div class="glass-panel box"><h1>🔐 管理后台</h1>${errorMsg ? `<div class="error-msg">❌ ${errorMsg}</div>` : ''}<form method="POST" action="${this.ADMIN_PATH}"><input type="password" name="password" placeholder="请输入访问口令" required autofocus><button type="submit">立即登录</button></form></div></body></html>`;
    }

    // 页面: 前台主页
    render_HomePage() {
        const safeLinks = Array.isArray(this.LINKS_DATA) ? this.LINKS_DATA : [];
        const safeFriends = Array.isArray(this.FRIENDS_DATA) ? this.FRIENDS_DATA : [];
        
        const cardsHtml = safeLinks.map(item => {
            const mainUrl = `/go/${item.id}`, backupHtml = item.backup_url ? `<a href="/go/${item.id}/backup" class="tag-backup" title="备用线路">备用</a>` : '', customTagHtml = item.tag ? `<span class="tag-special">${item.tag}</span>` : '';
            return `<div class="glass-card resource-card-wrap"><a href="${mainUrl}" class="resource-main-link"><div class="card-icon">${item.emoji || '🔗'}</div><div class="card-info"><h3 style="display:flex;align-items:center;flex-wrap:wrap;">${item.name}${customTagHtml}</h3><p>⚠️ ${item.note || '无说明'}</p></div></a>${backupHtml}</div>`;
        }).join('');
        
        const friendsHtml = safeFriends.map((f) => `<a href="/fgo/${f.id}" target="_blank" class="glass-card partner-card">${f.name}</a>`).join('');

        let fabHtml = `<div class="fab-container">`;
        if (this.config.contact_url) fabHtml += `<a href="${this.config.contact_url}" target="_blank" class="fab-btn fab-telegram">💬 获取支持</a>`;
        if (this.config.mail) fabHtml += `<a href="mailto:${this.config.mail}" class="fab-btn fab-mail">📧 发送邮件</a>`;
        if (this.config.push) fabHtml += `<a href="/contact" class="fab-btn fab-push">📝 给我留言</a>`;
        fabHtml += `</div>`;

        return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${this.config.title}</title><style>
          :root { --glass: rgba(255,255,255,0.15); --border: rgba(255,255,255,0.2); --text-main: #fff; --text-sub: #e2e8f0; --warning: #fcd34d; --primary: #8b5cf6; --backdrop-blur: 16px; --transition: 0.3s ease; } .dark-theme { --glass: rgba(15,23,42,0.8); --border: rgba(255,255,255,0.1); } * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
          body { font-family: ${this.FONT_STACK}; color: var(--text-main); ${this.getBgStyle()} min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 40px 20px 100px; position: relative; transition: var(--transition); }
          .container { width: 100%; max-width: 1200px; } .glass-card { background: var(--glass); backdrop-filter: blur(var(--backdrop-blur)); -webkit-backdrop-filter: blur(var(--backdrop-blur)); border: 1px solid var(--border); border-radius: 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.15); transition: var(--transition); }
          .header { text-align: center; padding: 40px 20px; margin-bottom: 30px; } .header h1 { font-size: 3rem; font-weight: 800; margin-bottom: 10px; text-shadow: 0 4px 15px rgba(0,0,0,0.4); } .header p { font-size: 1.1rem; opacity: 0.9; color: var(--text-sub); } .section-title { font-size: 1rem; font-weight: 800; color: #7dd3fc; margin-bottom: 15px; margin-left: 5px; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.6); }
          .grid-resources { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 40px; } .resource-card-wrap { display: flex; position: relative; overflow: hidden; height: 100px; opacity: 0; transform: translateY(20px); animation: fadeInUp 0.6s forwards; }
          .partner-card { text-decoration: none; color: #fff; text-align: center; padding: 15px 10px; font-size: 0.9rem; border-radius: 12px; text-shadow: 0 1px 3px rgba(0,0,0,0.6); transition: var(--transition); height: 60px; display: flex; align-items: center; justify-content: center; opacity: 0; transform: translateY(20px); animation: fadeInUp 0.6s forwards; }
          .resource-card-wrap:hover, .partner-card:hover { background: rgba(255,255,255,0.25); transform: translateY(-5px); box-shadow: 0 12px 40px rgba(0,0,0,0.25); } .resource-main-link { flex: 1; display: flex; align-items: center; text-decoration: none; color: white; padding: 20px; text-shadow: 0 2px 4px rgba(0,0,0,0.5); } .card-icon { font-size: 2.5rem; margin-right: 15px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); } .card-info h3 { font-size: 1.2rem; font-weight: 700; margin-bottom: 4px; } .card-info p { font-size: 0.85rem; color: var(--warning); font-weight: 500; }
          .tag-special { display: inline-flex; align-items: center; margin-left: 8px; padding: 2px 7px; font-size: 0.65rem; font-weight: 800; color: #ecfdf5; background: linear-gradient(135deg, rgba(16, 185, 129, 0.8), rgba(5, 150, 105, 0.9)); border: 1px solid rgba(52, 211, 153, 0.4); border-radius: 8px; box-shadow: 0 2px 10px rgba(16, 185, 129, 0.3); transform: translateY(-1px); text-shadow: 0 1px 2px rgba(0,0,0,0.4); white-space: nowrap; }
          .tag-backup { width: 36px; background: rgba(0,0,0,0.3); border-left: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: #e2e8f0; writing-mode: vertical-rl; letter-spacing: 2px; text-decoration: none; transition: 0.3s; } .tag-backup:hover { background: var(--primary); color: white; }
          .grid-partners { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 15px; margin-bottom: 40px; }
          .fab-container { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); display: flex; gap: 15px; z-index: 100; } .fab-btn { padding: 12px 25px; border-radius: 50px; text-decoration: none; font-weight: bold; color: white; transition: var(--transition); box-shadow: 0 10px 25px rgba(0,0,0,0.3); white-space: nowrap; display: flex; align-items: center; justify-content: center; text-shadow: 0 1px 2px rgba(0,0,0,0.3); } .fab-btn:hover { transform: translateY(-3px); box-shadow: 0 12px 30px rgba(0,0,0,0.5); } .fab-telegram { background: linear-gradient(135deg, #8b5cf6, #a855f7); } .fab-mail { background: linear-gradient(135deg, #3b82f6, #2dd4bf); } .fab-push { background: linear-gradient(135deg, #f43f5e, #fb923c); }
          .search-container { margin-bottom: 30px; text-align: center; width: 100%; } .search-box { width: 100%; max-width: 500px; padding: 15px 20px; border-radius: 50px; border: none; background: rgba(255,255,255,0.2); backdrop-filter: blur(10px); color: white; font-size: 1rem; box-shadow: 0 4px 20px rgba(0,0,0,0.1); transition: var(--transition); } .search-box::placeholder { color: rgba(255,255,255,0.7); } .search-box:focus { outline: none; background: rgba(255,255,255,0.3); }
          .theme-toggle { position: fixed; top: 20px; right: 20px; width: 50px; height: 50px; border-radius: 50%; background: rgba(255,255,255,0.2); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 100; color: white; font-size: 1.2rem; } .no-result { text-align: center; padding: 40px 0; color: var(--text-sub); font-size: 1.2rem; display: none; }
          .notice-card { margin-bottom: 30px; padding: 22px 28px; text-align: left; background: linear-gradient(135deg, rgba(244, 63, 94, 0.1) 0%, rgba(30, 41, 59, 0.4) 100%); border-left: 4px solid #fb7185; backdrop-filter: blur(20px); animation: fadeInUp 0.8s forwards; animation-delay: 0.05s; } .notice-title { font-size: 1.15rem; font-weight: 800; background: linear-gradient(to right, #fb7185, #c084fc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 15px; display: flex; align-items: center; gap: 10px; text-shadow: none; } .notice-title span { -webkit-text-fill-color: initial; } .notice-content { font-size: 0.95rem; line-height: 1.8; color: rgba(255, 255, 255, 0.9); letter-spacing: 0.5px; } .notice-highlight { color: #fcd34d; font-weight: 700; padding: 0 4px; background: rgba(252, 211, 77, 0.1); border-radius: 4px; } .notice-sub { margin-top: 8px; font-size: 0.9rem; opacity: 0.8; font-style: italic; } .heart-beat { display: inline-block; animation: beat 1.5s infinite ease-in-out; }
          @keyframes beat { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.25); } } @keyframes fadeInUp { to { opacity: 1; transform: translateY(0); } }
          @media (max-width: 768px) { .header h1 { font-size: 2.2rem; } .container { padding: 0 10px; } .grid-resources { grid-template-columns: 1fr; gap: 15px; } .resource-card-wrap { height: auto; min-height: 100px; } .grid-partners { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; } .fab-container { bottom: 20px; gap: 10px; flex-wrap: wrap; justify-content:center; width: 100%;} .fab-btn { padding: 10px 15px; font-size: 0.85rem; } .notice-card { padding: 15px 20px; } }
        </style>
        <script>
          function initSearch() { const searchBox = document.querySelector('.search-box'), noResult = document.createElement('div'); noResult.className = 'no-result'; noResult.innerHTML = '😕 暂无匹配结果'; document.querySelector('.grid-resources').after(noResult); if (!searchBox) return; searchBox.addEventListener('keydown', e => e.key === 'Enter' && e.preventDefault()); searchBox.addEventListener('input', function(e) { const searchTerm = e.target.value.toLowerCase().trim(); const cards = document.querySelectorAll('.resource-card-wrap, .partner-card'); let hasMatch = false; cards.forEach(card => { const isMatch = !searchTerm || card.textContent.toLowerCase().includes(searchTerm); card.style.display = isMatch ? 'flex' : 'none'; if (isMatch) hasMatch = true; }); noResult.style.display = searchTerm && !hasMatch ? 'block' : 'none'; }); }
          function initThemeToggle() { const themeBtn = document.querySelector('.theme-toggle'); if (!themeBtn) return; const toggleTheme = () => { document.body.classList.toggle('dark-theme'); const isDark = document.body.classList.contains('dark-theme'); localStorage.setItem('theme', isDark ? 'dark' : 'light'); themeBtn.textContent = isDark ? '☀️' : '🌙'; }; themeBtn.addEventListener('click', toggleTheme); const savedTheme = localStorage.getItem('theme'), prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches; if (savedTheme === 'dark' || (!savedTheme && prefersDark)) { document.body.classList.add('dark-theme'); themeBtn.textContent = '☀️'; } }
          function initAnimation() { const baseDelay = 0.1, resources = document.querySelectorAll('.resource-card-wrap'); resources.forEach((card, i) => card.style.animationDelay = \`\${i * baseDelay}s\`); const friends = document.querySelectorAll('.partner-card'); friends.forEach((card, i) => card.style.animationDelay = \`\${(resources.length + i) * baseDelay}s\`); }
          document.addEventListener('DOMContentLoaded', () => { initSearch(); initThemeToggle(); initAnimation(); });
        </script></head><body>
        <button class="theme-toggle" title="切换主题">🌙</button>
        <div class="container">
          <div class="header glass-card"><h1>${this.config.title}</h1><p>${this.config.subtitle}</p></div>
          <div class="search-container"><input type="text" class="search-box" placeholder="搜索导航项目..." /></div>
          <div class="glass-card notice-card"><div class="notice-title"><span class="heart-beat">❤️</span> 温馨提示</div><div class="notice-content"><div style="margin-bottom:8px">🚫 所有机场均属 <span class="notice-highlight">灰产</span></div><div style="margin-bottom:8px">⚠️ 所有产品（包括我推荐的）均有 <span class="notice-highlight">不可永续</span> 和 <span class="notice-highlight">跑路风险</span></div><div class="notice-sub">恳请小伙伴们下单之前仔细斟酌，再三考虑。<br>适合自己的就是最好的，<span style="color:#fff;font-weight:bold;border-bottom:1px dashed #fff">切勿冲动下单</span> 😇</div></div></div>
          <div class="section-title">💎 精选</div><div class="grid-resources">${cardsHtml}</div>
          <div class="section-title">🔗 友链</div><div class="grid-partners">${friendsHtml}</div>
        </div>
        ${fabHtml}
        </body></html>`;
    }

    // 页面: 动态仪表盘 (全屏设置, 极致 UI 优化)
    render_AdminDashboard(dbData, m) {
        const { statsMap, dailyMap, periodMap, monthContextMap, monthTotalClicks, isDayMode } = dbData;
        const safeLinks = Array.isArray(this.LINKS_DATA) ? this.LINKS_DATA : [];
        const safeFriends = Array.isArray(this.FRIENDS_DATA) ? this.FRIENDS_DATA : [];
        const activeIds = new Set([ ...safeLinks.map(i => i.id), ...safeFriends.map(i => i.id) ]);
        
        let historyTotal = 0; for (let v of statsMap.values()) { if (activeIds.has(v.id)) historyTotal += (v.total_clicks || 0); }
        let viewTotalDenominator = 0; if (isDayMode) { for(let c of monthContextMap.values()) viewTotalDenominator += c; } else { for(let c of periodMap.values()) viewTotalDenominator += c; }
        
        let prevDay = m, nextDay = m, prevMonthStr = "", nextMonthStr = "";
        try {
            if (isDayMode) { const d = new Date(m); d.setDate(d.getDate()-1); prevDay = d.toISOString().split('T')[0]; d.setDate(d.getDate()+2); nextDay = d.toISOString().split('T')[0]; }
            const currentY_int = parseInt(m.substring(0, 4)), currentM_int = parseInt(m.substring(5, 7));
            let prevM_Y = currentY_int, prevM_M = currentM_int - 1; if (prevM_M === 0) { prevM_Y -= 1; prevM_M = 12; } prevMonthStr = `${prevM_Y}_${String(prevM_M).padStart(2,'0')}`;
            let nextM_Y = currentY_int, nextM_M = currentM_int + 1; if (nextM_M === 13) { nextM_Y += 1; nextM_M = 1; } nextMonthStr = `${nextM_Y}_${String(nextM_M).padStart(2,'0')}`;
        } catch(e) {}

        const buildCard = (id, name, emoji, isMini) => {
            const stat = statsMap.get(id) || { total_clicks: 0, last_time: '' }, realTodayVal = dailyMap.get(id) || 0, selectedTargetVal = periodMap.get(id) || 0, monthContextVal = monthContextMap.get(id) || 0; 
            let col2Label, col2Val, col3Label, col3Val, progressVal = 0;
            if (isDayMode) { col2Label = (m === this.time.todayStr) ? "今日" : "当日"; col2Val = selectedTargetVal; col3Label = "当月"; col3Val = monthContextVal; progressVal = viewTotalDenominator > 0 ? ((monthContextVal / viewTotalDenominator) * 100).toFixed(1) : 0; } 
            else { col2Label = "今日"; col2Val = realTodayVal; col3Label = (m === this.time.dateKey) ? "本月" : "当月"; col3Val = selectedTargetVal; progressVal = viewTotalDenominator > 0 ? ((selectedTargetVal / viewTotalDenominator) * 100).toFixed(1) : 0; }
            let timeDisplay = stat.last_time || '暂无', timeIcon = '🕒';
            if (timeDisplay !== '暂无') { if(isDayMode) { timeDisplay = timeDisplay.split(' ')[1] || timeDisplay; } else { timeDisplay = timeDisplay.split(' ')[0].substring(5); timeIcon = '📅'; } }
            if (isMini) return `<div class="g-panel mini" onclick="openLog('${id}','${m}','${name}')"><div class="mini-main"><span class="mini-name" title="${name}">${name}</span><span class="mini-tag" style="color:${isDayMode?'#fbbf24':'#38bdf8'}">${selectedTargetVal}</span></div><div class="mini-sub"><span class="mini-time">${timeDisplay}</span></div></div>`;
            return `<div class="g-panel card" onclick="openLog('${id}','${m}','${name}')"><div class="row top"><div style="display:flex;align-items:center;gap:12px;overflow:hidden;flex:1"><span style="font-size:1.6em;flex-shrink:0">${emoji || '🔗'}</span><span class="card-title">${name}</span></div><div class="pct">${progressVal}%</div></div><div class="row data"><div class="col left"><span class="lbl">历史</span><span class="val grad-white">${stat.total_clicks||0}</span></div><div class="col mid"><span class="lbl">${col2Label}</span><span class="val grad-gold">${col2Val}</span></div><div class="col right"><span class="lbl">${col3Label}</span><span class="val grad-blue">${col3Val}</span></div></div><div class="bar"><div style="width:${progressVal}%"></div></div><div class="time">${timeIcon} ${timeDisplay}</div></div>`;
        };

        const linkHtml = safeLinks.map(i => buildCard(i.id, i.name, i.emoji, false)).join('');
        const friendHtml = safeFriends.map(i => buildCard(i.id, i.name, '', true)).join('');

        const sysSettings = { admin_pass: this.config.admin_pass, title: this.config.title, subtitle: this.config.subtitle, img: this.dbSettings.img || this.env.img || "", contact_url: this.config.contact_url, mail: this.config.mail, push: this.dbSettings.push || this.env.push || "", host: this.dbSettings.host || this.env.host || "", links: JSON.stringify(this.LINKS_DATA, null, 2), friends: JSON.stringify(this.FRIENDS_DATA, null, 2) };

        return `<!DOCTYPE html><html><head>${this.render_Head(this.config.title)}<style>
          :root { 
              --glass: rgba(15, 23, 42, 0.75); 
              --border: rgba(255, 255, 255, 0.15); 
              --text-main: #f8fafc; 
              --text-sub: #94a3b8; 
              --input-bg: rgba(15, 23, 42, 0.6); 
              --input-border: rgba(255, 255, 255, 0.2);
              --modal-bg: rgba(15, 23, 42, 0.95); 
              --card-bg: rgba(30, 41, 59, 0.75); 
              --title-shadow: 0 2px 10px rgba(0,0,0,0.3);
              --glow-shadow: 0 0 10px rgba(56,189,248,0.5);
          }
          .light-theme { 
              --glass: rgba(255, 255, 255, 0.9); 
              --border: rgba(0, 0, 0, 0.1); 
              --text-main: #0f172a; 
              --text-sub: #475569; 
              --input-bg: #ffffff; 
              --input-border: #cbd5e1;
              --modal-bg: rgba(241, 245, 249, 0.98); 
              --card-bg: rgba(255, 255, 255, 0.9); 
              --title-shadow: none;
              --glow-shadow: none;
          }
          
          body { color: var(--text-main); transition: 0.3s; }
          .main { width:94%; max-width:1200px; padding:20px 0 60px; }
          .header { padding:30px; text-align:center; background:var(--card-bg); backdrop-filter:blur(20px); border:1px solid var(--border); border-radius:16px; margin-bottom:20px; display:flex; flex-direction:column; align-items:center; gap:10px; transition:0.3s; }
          .head-title { font-size:2rem; margin:0; color:var(--text-main); font-weight:800; text-shadow:var(--title-shadow); }
          .badge { background:#38bdf8; color:#0f172a; padding:4px 12px; border-radius:20px; font-weight:800; font-size:0.85rem; }
          .stats-grp { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:15px; margin-bottom:25px; }
          .s-card { background:var(--card-bg); border:1px solid var(--border); border-radius:16px; padding:20px; text-align:center; backdrop-filter:blur(10px); transition:0.3s; }
          .s-val { font-size:2rem; font-weight:700; margin:5px 0; color:var(--text-main); text-shadow:var(--title-shadow); }
          .s-lbl { font-size:0.85rem; color:var(--text-sub); text-transform:uppercase; letter-spacing:1px; font-weight:600; }
          
          .date-bar { display:flex; justify-content:center; gap:10px; margin:20px 0; flex-wrap:wrap; align-items:center; background:var(--card-bg); padding:12px 20px; border-radius:50px; border:1px solid var(--border); backdrop-filter:blur(10px); box-shadow:0 10px 25px rgba(0,0,0,0.1); transition:0.3s; }
          .btn { background:rgba(128,128,128,0.1); border:1px solid var(--border); color:var(--text-main); padding:8px 16px; border-radius:20px; text-decoration:none; transition:0.2s; font-size:0.9rem; display:flex; align-items:center; cursor:pointer; }
          .btn:hover, .btn.active { background:#38bdf8; color:#0f172a; font-weight:bold; border-color:#38bdf8; }
          
          .date-display { display:flex; align-items:center; gap:8px; margin:0 15px; position:relative; }
          .date-val { color:var(--text-main); font-family:monospace; font-size:1.4rem; font-weight:800; text-shadow:var(--glow-shadow); }
          input[type="date"] { position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; height:100%; }
          
          .g-panel { background:var(--card-bg); border:1px solid var(--border); border-radius:16px; padding:20px; transition:0.2s; cursor:pointer; display:flex; flex-direction:column; justify-content:space-between; }
          .g-panel:hover { transform: translateY(-3px); border-color: #38bdf8; box-shadow:0 5px 15px rgba(0,0,0,0.1); }
          .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:15px; }
          .mini-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:12px; }
          .lbl-sec { color:#38bdf8; font-weight:800; margin:30px 0 10px 5px; text-transform:uppercase; letter-spacing:1px; }
          .row { display:flex; justify-content:space-between; align-items:center; }
          .top { margin-bottom:15px; }
          .card-title { font-weight:700; font-size:1.05rem; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .pct { background:rgba(56,189,248,0.2); color:#38bdf8; padding:3px 8px; border-radius:6px; font-weight:800; font-size:0.85rem; flex-shrink:0; }
          .data { margin-bottom:12px; font-size:0.9rem; color:var(--text-sub); }
          .col { display:flex; flex-direction:column; align-items:center; }
          .col.left { align-items:flex-start; } .col.right { align-items:flex-end; }
          .lbl { font-size:0.75rem; color:var(--text-sub); margin-bottom:2px; opacity:0.8; } .val { font-weight:700; font-size:1.1rem; }
          .grad-white { color:var(--text-main); } .grad-gold { color:#fbbf24; text-shadow:0 0 8px rgba(251,191,36,0.4); } .grad-blue { color:#38bdf8; text-shadow:0 0 8px rgba(56,189,248,0.4); }
          .bar { height:4px; background:rgba(128,128,128,0.2); border-radius:2px; overflow:hidden; margin-bottom:8px; } .bar div { height:100%; background:linear-gradient(90deg, #fbbf24, #38bdf8); }
          .time { font-size:0.8rem; color:#94a3b8; text-align:right; font-family:monospace; }
          
          .mini { padding:15px; height:80px; } .mini-main { display:flex; align-items:center; margin-bottom:5px; gap:8px; width:100%; } .mini-name { font-weight:600; font-size:0.95rem; color:var(--text-main); flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .mini-tag { background:#38bdf8; color:#0f172a; padding:2px 8px; border-radius:10px; font-size:0.8rem; font-weight:800; flex-shrink:0; } .mini-sub { text-align:right; margin-top:auto; } .mini-time { font-size:0.75rem; color:var(--text-sub); font-family:monospace; }
          
          /* 抽屉 & 全屏 Modal */
          .drawer { position:fixed; top:0; right:-400px; width:380px; max-width:100vw; height:100vh; background:var(--modal-bg); border-left:1px solid var(--border); transition:0.3s; z-index:99; display:flex; flex-direction:column; box-shadow: -10px 0 30px rgba(0,0,0,0.2); } .drawer.open { right:0; }
          .mask { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:90; opacity:0; pointer-events:none; transition:0.3s; } .mask.show { opacity:1; pointer-events:auto; }
          
          .fs-modal { position:fixed; inset:0; background:var(--modal-bg); z-index:1000; display:none; flex-direction:column; overflow-y:auto; backdrop-filter:blur(20px); transition:0.3s; opacity:0; }
          .fs-modal.open { display:flex; animation: slideIn 0.3s forwards; }
          @keyframes slideIn { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
          
          /* 优化的高级滚动条 */
          .fs-modal::-webkit-scrollbar { width: 8px; }
          .fs-modal::-webkit-scrollbar-track { background: transparent; }
          .fs-modal::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.4); border-radius: 10px; }
          .fs-modal::-webkit-scrollbar-thumb:hover { background: rgba(156, 163, 175, 0.7); }

          /* 🌟 SaaS 质感设置面板 Header */
          .fs-header { padding:20px 40px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); background:var(--glass); position:sticky; top:0; z-index:10; backdrop-filter:blur(10px); }
          .fs-header h3 { margin:0; font-size:1.5rem; color:var(--text-main); }
          .fs-content { padding:40px; max-width:1000px; margin:0 auto; width:100%; flex:1; }
          .set-grid { display:grid; grid-template-columns:1fr 1fr; gap:25px; }
          .set-full { grid-column: 1 / -1; }
          .set-field label { display: block; font-size: 0.9rem; color: var(--text-sub); margin-bottom: 8px; font-weight:600; }
          
          /* 🌟 SaaS 质感输入框 */
          .set-field input, .set-field textarea { width: 100%; padding: 15px; background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 10px; color: var(--text-main); font-family: monospace; font-size:1rem; box-sizing: border-box; transition:0.2s; box-shadow: inset 0 1px 2px rgba(0,0,0,0.05); }
          .set-field input:focus, .set-field textarea:focus { outline: none; border-color: #38bdf8; background:var(--card-bg); box-shadow:0 0 0 3px rgba(56,189,248,0.3); }
          .set-field textarea { height: 220px; resize: vertical; white-space: pre; line-height:1.5; }
          
          /* 🌟 顶部保存按钮组 */
          .btn-group-top { display:flex; gap: 12px; align-items:center; }
          .close-btn-top { background: transparent; border: 1px solid var(--text-sub); color: var(--text-main); padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s; }
          .close-btn-top:hover { background: rgba(128,128,128,0.1); }
          .save-btn-top { background: linear-gradient(135deg, #3b82f6, #8b5cf6); color: #fff; border: none; padding: 10px 24px; border-radius: 8px; font-size:1rem; font-weight: 700; cursor: pointer; transition: 0.2s; box-shadow:0 4px 10px rgba(59,130,246,0.3); }
          .save-btn-top:hover { transform:translateY(-1px); box-shadow:0 6px 15px rgba(59,130,246,0.4); }

          .theme-toggle { position: fixed; top: 20px; left: 20px; width: 45px; height: 45px; border-radius: 50%; background: var(--glass); backdrop-filter: blur(10px); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 100; color: var(--text-main); font-size: 1.2rem; box-shadow:0 4px 10px rgba(0,0,0,0.1); }

          @media (max-width:768px) { .set-grid { grid-template-columns:1fr; } .fs-content { padding:20px; } .fs-header { padding:15px 20px; flex-direction:column; gap:15px; align-items:flex-start; } .btn-group-top { width:100%; justify-content:space-between;} .stats-grp, .grid { grid-template-columns:1fr; } .date-val { font-size:1.2rem; } .date-bar { padding:10px 15px; } .btn { padding:6px 12px; font-size:0.85rem; } }
        </style></head>
        <body style="${this.getBgStyle()} display:flex; justify-content:center; margin:0; min-height: 100vh;">
          
          <button class="theme-toggle" onclick="toggleAdminTheme()" title="切换主题">☀️</button>

          <div class="main">
            <div class="header">
              <h1 class="head-title">📊 数据看板</h1>
              <div style="display:flex;align-items:center;gap:15px;flex-wrap:wrap;justify-content:center">
                  <span style="font-family:monospace;opacity:0.8;color:var(--text-sub)">${m}</span>
                  <span class="badge">历史总计 ${historyTotal}</span>
              </div>
              <div style="margin-top:10px;display:flex;gap:15px;justify-content:center;flex-wrap:wrap;">
                 <a href="/" class="btn" style="border:none;background:rgba(52,211,153,0.2);color:#34d399;">🏠 返回主页</a>
                 <a href="javascript:openSettings()" class="btn" style="border:none;background:rgba(56,189,248,0.2);color:#38bdf8;">⚙️ 系统设置</a>
                 <a href="${this.ADMIN_PATH}/logout" class="btn" style="border:none;background:rgba(248,113,113,0.2);color:#f87171;">登出</a>
              </div>
            </div>

            <div class="stats-grp">
              <div class="s-card"><div class="s-lbl">总项目</div><div class="s-val">${safeLinks.length}</div></div>
              <div class="s-card"><div class="s-lbl">本月总点击</div><div class="s-val" style="color:#38bdf8">${monthTotalClicks}</div></div>
              <div class="s-card"><div class="s-lbl">活跃项目</div><div class="s-val">${Array.from(statsMap.values()).filter(c=>c.total_clicks>0).length}</div></div>
            </div>

            <div class="date-bar">
              <a href="${this.ADMIN_PATH}?m=${prevMonthStr}" class="btn" title="上个月">⏪</a>
              <a href="${this.ADMIN_PATH}?m=${prevDay}" class="btn">◀</a>
              <div class="date-display" title="点击切换日期">
                  <span class="date-val">${m}</span>
                  <input type="date" value="${isDayMode ? m : ''}" onchange="if(this.value) location.href='${this.ADMIN_PATH}?m='+this.value">
              </div>
              <a href="${this.ADMIN_PATH}?m=${nextDay}" class="btn">▶</a>
              <a href="${this.ADMIN_PATH}?m=${nextMonthStr}" class="btn" title="下个月">⏩</a>
              <div style="width:1px;height:15px;background:var(--border);margin:0 8px"></div>
              <a href="${this.ADMIN_PATH}?m=${this.time.todayStr}" class="btn ${m===this.time.todayStr?'active':''}">今日</a>
              <a href="${this.ADMIN_PATH}?m=${this.time.dateKey}" class="btn ${m===this.time.dateKey?'active':''}">本月</a>
            </div>

            <div class="lbl-sec">💎 精选数据</div><div class="grid">${linkHtml}</div>
            <div class="lbl-sec">🔗 友链数据</div><div class="mini-grid">${friendHtml}</div>
          </div>

          <div class="mask" id="mask" onclick="cls()"></div>
          
          <div class="drawer" id="dr">
            <div style="padding:20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between">
              <h3 style="margin:0;color:var(--text-main)" id="dt">详情</h3><button onclick="cls()" style="background:none;border:none;color:var(--text-main);font-size:1.2rem;cursor:pointer">×</button>
            </div>
            <ul id="dl" style="flex:1;overflow-y:auto;padding:0;margin:0;list-style:none"></ul>
          </div>
      
          <!-- 🟢 全屏系统设置页 (UI质感升级版) -->
          <div class="fs-modal" id="set-fs">
            <div class="fs-header">
              <h3>⚙️ 系统全局配置 (NooMiNav V13.0)</h3>
              <div class="btn-group-top">
                  <button class="close-btn-top" onclick="cls()">取消 (Esc)</button>
                  <button class="save-btn-top" onclick="saveSettings(this)">💾 保存并生效</button>
              </div>
            </div>
            <div class="fs-content">
                <div class="set-grid">
                    <div class="set-field"><label>后台登录密码</label><input type="text" id="s_pass" placeholder="默认: 123456"></div>
                    <div class="set-field"><label>网站主标题</label><input type="text" id="s_title"></div>
                    
                    <div class="set-field"><label>网站副标题</label><input type="text" id="s_sub"></div>
                    <div class="set-field"><label>客服支持链接 (TG等)</label><input type="text" id="s_tg"></div>
                    
                    <div class="set-field set-full"><label>背景图 URL (多图用逗号隔开，支持 Base64)</label><input type="text" id="s_img" placeholder="留空使用默认高清壁纸"></div>
                    
                    <div class="set-field"><label>联系邮箱 (Mail)</label><input type="text" id="s_mail" placeholder="留空则不显示底部邮箱按钮"></div>
                    <div class="set-field"><label>留言板推送 Webhook (Push)</label><input type="text" id="s_push" placeholder="留空则不显示留言按钮。例如: https://.../your_key"></div>
                    
                    <div class="set-field set-full"><label>自定义卡片跳转域名 (防拉黑)</label><input type="text" id="s_host" placeholder="如果不填，默认自动使用当前访问的域名"></div>
                    
                    <div class="set-field set-full"><label>💎 精选资源 LINKS (JSON格式)</label><textarea id="s_links"></textarea></div>
                    <div class="set-field set-full"><label>🔗 合作伙伴 FRIENDS (JSON格式)</label><textarea id="s_friends"></textarea></div>
                </div>
            </div>
          </div>
      
          <script>
            const ADMIN_PATH = '${this.ADMIN_PATH}';
            const SYS_SET = ${JSON.stringify(sysSettings)};
            
            function initAdminTheme() { 
                if(localStorage.getItem('admin_theme') === 'light') { 
                    document.body.classList.add('light-theme'); 
                    document.querySelector('.theme-toggle').textContent = '🌙'; 
                } 
            }
            initAdminTheme();
            
            function toggleAdminTheme() { 
                document.body.classList.toggle('light-theme'); 
                const isLight = document.body.classList.contains('light-theme'); 
                localStorage.setItem('admin_theme', isLight ? 'light' : 'dark'); 
                document.querySelector('.theme-toggle').textContent = isLight ? '🌙' : '☀️'; 
            }
            
            async function openLog(id,m,n){
              document.getElementById('dr').classList.add('open'); 
              document.getElementById('mask').classList.add('show'); 
              document.getElementById('dt').innerText = n + ' 记录'; 
              const l=document.getElementById('dl'); 
              l.innerHTML='<li style="padding:20px;text-align:center;color:var(--text-sub)">加载中...</li>';
              try { 
                  const r=await fetch(\`\${ADMIN_PATH}/api/logs?id=\${id}&m=\${m}\`); 
                  const data=await r.json(); 
                  if(!data.length){l.innerHTML='<li style="padding:20px;text-align:center;opacity:0.5;color:var(--text-sub)">该时段无记录</li>';return;} 
                  l.innerHTML=data.map((x,i)=>\`<li style="padding:12px 20px;border-bottom:1px solid var(--border);font-size:0.85rem"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:#38bdf8">#\${i+1}</span><span style="opacity:0.9;color:var(--text-main)">\${x.click_time.split(' ')[1]}</span></div><div style="display:flex;justify-content:space-between;font-family:monospace;font-size:0.75rem;color:var(--text-sub);flex-wrap:wrap;gap:8px"><span>\${x.ip_address}</span><span>\${x.click_time.split(' ')[0]}</span></div></li>\`).join(''); 
              } catch(e) {
                  l.innerHTML='<li style="padding:20px;text-align:center;color:#f87171">加载失败</li>';console.error(e);
              }
            }
            
            function openSettings() {
                document.getElementById('s_pass').value = SYS_SET.admin_pass || ''; 
                document.getElementById('s_title').value = SYS_SET.title || ''; 
                document.getElementById('s_sub').value = SYS_SET.subtitle || ''; 
                document.getElementById('s_img').value = SYS_SET.img || ''; 
                document.getElementById('s_tg').value = SYS_SET.contact_url || ''; 
                document.getElementById('s_mail').value = SYS_SET.mail || ''; 
                document.getElementById('s_push').value = SYS_SET.push || ''; 
                document.getElementById('s_host').value = SYS_SET.host || ''; 
                document.getElementById('s_links').value = SYS_SET.links || '[]'; 
                document.getElementById('s_friends').value = SYS_SET.friends || '[]';
                
                document.getElementById('set-fs').classList.add('open'); 
                document.body.style.overflow = 'hidden';
            }
      
            async function saveSettings(btn) {
                try { 
                    JSON.parse(document.getElementById('s_links').value); 
                    JSON.parse(document.getElementById('s_friends').value); 
                } catch(e) { 
                    alert("⚠️ JSON 格式解析错误！请检查是否有遗漏的逗号、引号或括号。"); 
                    return; 
                }
                
                const data = { 
                    admin_pass: document.getElementById('s_pass').value, 
                    title: document.getElementById('s_title').value, 
                    subtitle: document.getElementById('s_sub').value, 
                    img: document.getElementById('s_img').value, 
                    contact_url: document.getElementById('s_tg').value, 
                    mail: document.getElementById('s_mail').value, 
                    push: document.getElementById('s_push').value, 
                    host: document.getElementById('s_host').value, 
                    links: document.getElementById('s_links').value, 
                    friends: document.getElementById('s_friends').value 
                };
                
                const originalText = btn.innerText;
                btn.innerText = "保存中...";
                try { 
                    const res = await fetch(\`\${ADMIN_PATH}/api/settings\`, { method: 'POST', body: JSON.stringify(data) }); 
                    if(res.ok) { 
                        alert('✅ 配置已保存并生效！'); 
                        location.reload(); 
                    } else { 
                        alert('❌ 保存失败'); 
                    } 
                } catch(e) { 
                    alert('❌ 网络错误'); 
                }
                btn.innerText = originalText;
            }
      
            function cls() { 
                document.getElementById('dr').classList.remove('open'); 
                document.getElementById('set-fs').classList.remove('open'); 
                document.getElementById('mask').classList.remove('show'); 
                document.body.style.overflow = ''; 
            }
            
            document.addEventListener('keydown', (e) => { if(e.key === 'Escape') cls(); });
          </script>
        </body></html>`;
    }
}
