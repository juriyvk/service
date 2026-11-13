// @ts-nocheck
// GENERATED JavaScript for pasting into Dashboard index.ts. Do not edit.
// Canonical typed sources: supabase/functions/. Rebuild: node scripts/build-dashboard.mjs
export class HttpError extends Error {
    constructor(status, message, code = '') { super(message); this.status = status; this.code = code; }
}
export function equal(a, b) {
    const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
    let diff = x.length ^ y.length;
    for (let i = 0; i < Math.max(x.length, y.length); i++)
        diff |= (x[i] || 0) ^ (y[i] || 0);
    return diff === 0;
}
async function hmac(key, value) {
    const bytes = typeof key === 'string' ? new TextEncoder().encode(key) : key;
    const k = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(value)));
}
export async function verifyInitData(raw, token, now = Math.floor(Date.now() / 1000)) {
    if (!token)
        throw new HttpError(503, 'Server configuration missing');
    if (typeof raw !== 'string' || !raw || raw.length > 8192)
        throw new HttpError(401, 'Invalid Telegram data');
    const params = new URLSearchParams(raw), seen = new Set();
    for (const [key] of params) {
        if (seen.has(key))
            throw new HttpError(401, 'Duplicate field');
        seen.add(key);
    }
    const hash = params.get('hash');
    if (!/^[a-f0-9]{64}$/i.test(hash || ''))
        throw new HttpError(401, 'Invalid signature');
    params.delete('hash');
    const check = [...params].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = await hmac('WebAppData', token);
    const expected = [...await hmac(secret, check)].map(x => x.toString(16).padStart(2, '0')).join('');
    if (!equal(hash.toLowerCase(), expected))
        throw new HttpError(401, 'Invalid signature');
    const rawDate = params.get('auth_date') || '';
    if (!/^\d+$/.test(rawDate))
        throw new HttpError(401, 'Invalid auth_date');
    const authDate = Number(rawDate);
    if (!Number.isSafeInteger(authDate) || authDate <= 0 || now - authDate > 3600 || authDate > now + 60)
        throw new HttpError(401, 'Expired Telegram data');
    let user;
    try {
        user = JSON.parse(params.get('user'));
    }
    catch {
        throw new HttpError(401, 'Invalid user');
    }
    if (!Number.isSafeInteger(user?.id) || user.id <= 0)
        throw new HttpError(401, 'Invalid user');
    return user.id;
}
export const MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
export function validateDocument(d) {
    if (!d || typeof d.name !== 'string' || !d.name.trim() || d.name.length > 240 || !MIME.has(d.mime) || !Number.isInteger(d.size) || d.size < 1 || d.size > 10485760)
        throw new HttpError(400, 'Invalid document (maximum 10 MiB)');
    return { name: d.name, mime: d.mime, size: d.size };
}
export function parseTaskMessage(text) {
    // Explicit command: /task <employee UUID or self> | title | YYYY-MM-DD (optional)
    const match = /^\/task(?:@\w+)?\s+(self|[a-f0-9-]{36})\s*\|\s*([^|]+?)(?:\s*\|\s*(\d{4}-\d{2}-\d{2}))?\s*$/i.exec(text || '');
    if (!match || match[2].trim().length > 240)
        throw new HttpError(400, 'Используйте /task self | Название | ГГГГ-ММ-ДД или UUID сотрудника вместо self');
    return { title: match[2].trim(), ...(match[1] === 'self' ? {} : { assignee_id: match[1] }), due_date: match[3] || null };
}
export const env = (name) => { const v = Deno.env.get(name); if (!v)
    throw new HttpError(503, 'Server configuration missing'); return v; };
export function json(data, status = 200, headers = {}) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } }); }
export async function rpc(name, args) {
    const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) });
    const data = await r.json();
    if (!r.ok) {
        const status = data.code === '42501' ? 403 : data.code === '40001' ? 409 : 400;
        const code = typeof data.code === 'string' && /^(?:[A-Z0-9]{5}|PGRST[0-9]{3})$/.test(data.code) ? data.code : '';
        throw new HttpError(status, status === 409 ? 'Данные изменились. Обновите задачу.' : status === 403 ? 'Доступ запрещён' : 'Некорректные данные или переход статуса', code);
    }
    return data;
}
export async function identity(initData) {
    const id = await verifyInitData(initData, env('TELEGRAM_BOT_TOKEN'));
    const employee = await rpc('dvfm_identity', { p_telegram_id: id });
    if (!employee)
        throw new HttpError(403, 'Сотрудник не зарегистрирован или отключён');
    return employee;
}
export async function body(req, limit = 32768) {
    if (Number(req.headers.get('content-length')) > limit)
        throw new HttpError(413, 'Request too large');
    const reader = req.body?.getReader();
    if (!reader)
        throw new HttpError(400, 'Body required');
    let size = 0;
    const parts = [];
    while (true) {
        const { value, done } = await reader.read();
        if (done)
            break;
        size += value.length;
        if (size > limit) {
            await reader.cancel();
            throw new HttpError(413, 'Request too large');
        }
        parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let pos = 0;
    for (const part of parts) {
        bytes.set(part, pos);
        pos += part.length;
    }
    try {
        const data = JSON.parse(new TextDecoder().decode(bytes));
        if (!data || typeof data !== 'object' || Array.isArray(data))
            throw new Error();
        return data;
    }
    catch {
        throw new HttpError(400, 'Invalid JSON object');
    }
}
export function serve(handler, browser = false) {
    Deno.serve(async (req) => {
        let headers = {};
        try {
            if (browser) {
                const origin = req.headers.get('origin');
                const allowed = (Deno.env.get('ALLOWED_ORIGINS') || 'https://juriyvk.github.io').split(',').map(s => s.trim());
                if (origin && !allowed.includes(origin))
                    throw new HttpError(403, 'Origin forbidden');
                if (origin)
                    headers = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
            }
            if (req.method === 'OPTIONS' && browser)
                return new Response(null, { status: 204, headers });
            if (req.method !== 'POST')
                throw new HttpError(405, 'POST required');
            const response = await handler(req);
            for (const [k, v] of Object.entries(headers))
                response.headers.set(k, v);
            return response;
        }
        catch (e) {
            return json({ ok: false, error: e instanceof HttpError ? e.message : 'Internal server error' }, e instanceof HttpError ? e.status : 500, headers);
        }
    });
}
export async function storage(path, method, body, mime) {
    const r = await fetch(`${env('SUPABASE_URL')}/storage/v1/${path}`, { method, headers: { Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`, ...(mime ? { 'Content-Type': mime } : {}), ...(method === 'POST' && path.startsWith('object/dvfm-private/') ? { 'x-upsert': 'true' } : {}) }, body, signal: AbortSignal.timeout(30000) });
    if (!r.ok)
        throw new HttpError(502, 'Storage operation failed');
    return r;
}
export async function telegram(method, payload) {
    const r = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
    const data = await r.json();
    if (!r.ok || !data.ok)
        throw new HttpError(502, 'Telegram operation failed');
    return data.result;
}
export function taskLink(id) {
    const url = new URL(env('TELEGRAM_MINI_APP_URL'));
    if (url.protocol !== 'https:' || url.hostname !== 't.me')
        throw new HttpError(503, 'Invalid Mini App URL');
    url.searchParams.set('startapp', `task_${id}`);
    return url.href;
}
export async function drain() {
    const jobs = await rpc('dvfm_outbox', {});
    for (const job of jobs) {
        let success = false;
        try {
            await telegram('sendMessage', { chat_id: job.telegram_id, text: job.text, ...(job.task_id ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть задачу', url: taskLink(job.task_id) }]] } } : {}) });
            success = true;
        }
        catch { /* Durable retry; never log token-bearing URLs. */ }
        await rpc('dvfm_outbox', { p_id: job.id, p_token: job.lease_token, p_success: success });
    }
}
export function requireSecret(actual, name) { if (!actual || !equal(actual, env(name)))
    throw new HttpError(401, 'Unauthorized'); }
// Temporary administrative helper for this staging project and bot only.
const project = 'https://wepogbvijpvyvyfzxzeo.supabase.co';
const botUsername = 'DVFMTESTCRM_bot';
serve(async (req) => {
    requireSecret(req.headers.get('authorization'), 'OUTBOX_WORKER_AUTH');
    if (env('SUPABASE_URL').replace(/\/$/, '') !== project)
        throw new HttpError(403, 'Staging project required');
    const input = await body(req);
    if (!['inspect', 'configure', 'configure_worker'].includes(input.action))
        throw new HttpError(400, 'Use inspect, configure or configure_worker');
    const me = await telegram('getMe', {});
    if (!me.is_bot || me.username?.toLowerCase() !== botUsername.toLowerCase())
        throw new HttpError(409, 'Staging bot token does not match expected username');
    if (input.action === 'configure_worker') {
        const workerAuth = env('OUTBOX_WORKER_AUTH');
        if (!/^Bearer [A-Za-z0-9_-]{32,256}$/.test(workerAuth))
            throw new HttpError(503, 'OUTBOX_WORKER_AUTH: требуется Bearer, один пробел и 32–256 латинских букв, цифр, _ или -. Исправьте Secrets и Authorization в Test.');
        const link = new URL(taskLink('00000000-0000-4000-8000-000000000000'));
        if (!/^\/DVFMTESTCRM_bot(?:\/[A-Za-z0-9_]+)?\/?$/i.test(link.pathname))
            throw new HttpError(503, 'Mini App link must use the staging bot');
        if (link.pathname.split('/').filter(Boolean).length === 1 && !me.has_main_web_app)
            throw new HttpError(409, 'Enable the staging bot Main Mini App in BotFather first');
        try {
            const worker = await rpc('dvfm_staging_configure_worker', { p_worker_auth: workerAuth });
            return json({ ok: true, bot: me.username, worker });
        }
        catch (error) {
            if (!(error instanceof HttpError))
                throw error;
            if (error.code === 'PGRST202')
                throw new HttpError(503, 'SQL-функция dvfm_staging_configure_worker не найдена в API. Выполните staging-install-worker.sql в тестовом проекте и повторите через несколько секунд.');
            if (error.code === '22023')
                throw new HttpError(503, 'SQL-функция отклонила настройки worker (22023). Проверьте формат OUTBOX_WORKER_AUTH и актуальность staging-install-worker.sql.');
            if (error.code === '42501')
                throw new HttpError(403, 'Нет разрешений для настройки worker или Vault открыт клиентским ролям (42501). Нужна проверка SQL-установки и прав Vault.');
            if (['42P01', '42883', '3F000'].includes(error.code))
                throw new HttpError(503, 'Для worker отсутствует SQL-объект или расширение Vault/Cron. Код ' + error.code + '. Проверьте staging-install-worker.sql.');
            throw new HttpError(502, 'Не удалось настроить worker. Код БД: ' + (error.code || 'UNKNOWN') + '. Сообщите этот код без секретов.');
        }
    }
    const url = project + '/functions/v1/telegram-webhook';
    let info = await telegram('getWebhookInfo', {});
    if (input.action === 'configure') {
        if (info.url && info.url !== url)
            throw new HttpError(409, 'Bot already has a different webhook; inspect before changing it');
        const secret = env('TELEGRAM_WEBHOOK_SECRET');
        if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret))
            throw new HttpError(503, 'Invalid webhook secret format');
        await telegram('setWebhook', { url, secret_token: secret, allowed_updates: ['message'], max_connections: 10, drop_pending_updates: false });
        info = await telegram('getWebhookInfo', {});
    }
    return json({ ok: true, bot: me.username, configured: info.url === url, webhook_url: info.url || null, pending_updates: info.pending_update_count || 0 });
});
