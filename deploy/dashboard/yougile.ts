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
const CLOUD_HOSTS = new Set(['ru.yougile.com', 'rf.yougile.com', 'yougile.com']);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
function settingsFor(input) {
    let base;
    try {
        base = new URL(input.baseUrl || 'https://ru.yougile.com/api-v2');
    }
    catch {
        throw new HttpError(503, 'Некорректный адрес YouGile');
    }
    if (base.protocol !== 'https:' || !CLOUD_HOSTS.has(base.hostname) || base.port || base.username || base.password || base.search || base.hash || !/^\/api-v2\/?$/.test(base.pathname))
        throw new HttpError(503, 'Разрешён только облачный HTTPS API YouGile');
    if (!uuid(input.projectId) || !uuid(input.boardId))
        throw new HttpError(503, 'Настройте YOUGILE_PROJECT_ID и YOUGILE_BOARD_ID в Secrets');
    if (typeof input.apiKey !== 'string' || !input.apiKey || input.apiKey.length > 4096 || /\s/.test(input.apiKey))
        throw new HttpError(503, 'Настройте YOUGILE_API_KEY в Secrets');
    return { ...input, baseUrl: base.origin + '/api-v2' };
}
async function boundedJson(response) {
    const reader = response.body?.getReader();
    if (!reader)
        throw new HttpError(502, 'Пустой ответ YouGile');
    let size = 0;
    const parts = [];
    while (true) {
        const { value, done } = await reader.read();
        if (done)
            break;
        size += value.length;
        if (size > 262144) {
            await reader.cancel();
            throw new HttpError(502, 'Слишком большой ответ YouGile');
        }
        parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
    }
    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    }
    catch {
        throw new HttpError(502, 'Некорректный JSON от YouGile');
    }
}
export async function inspectYougile(input, fetchImpl = fetch) {
    const settings = settingsFor(input);
    async function get(path) {
        let response;
        try {
            response = await fetchImpl(settings.baseUrl + path, { method: 'GET', headers: { Authorization: 'Bearer ' + settings.apiKey, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
        }
        catch {
            throw new HttpError(502, 'Не удалось связаться с YouGile');
        }
        if (!response.ok) {
            await response.body?.cancel();
            const status = response.status;
            if (status === 401 || status === 403)
                throw new HttpError(503, 'Ключ YouGile недействителен или не имеет доступа к выбранному проекту');
            if (status === 404)
                throw new HttpError(503, 'Выбранный объект YouGile не найден');
            if (status === 429)
                throw new HttpError(429, 'YouGile ограничил частоту запросов. Повторите позже');
            throw new HttpError(502, 'Сбой API YouGile (HTTP ' + status + ')');
        }
        return boundedJson(response);
    }
    const project = await get('/projects/' + settings.projectId);
    if (project?.id !== settings.projectId || typeof project.title !== 'string')
        throw new HttpError(502, 'Неожиданный ответ проекта YouGile');
    if (project.deleted || project.archived)
        throw new HttpError(409, 'Проект YouGile удалён или архивирован');
    const board = await get('/boards/' + settings.boardId);
    if (board?.id !== settings.boardId || board.projectId !== settings.projectId || typeof board.title !== 'string')
        throw new HttpError(409, 'Доска YouGile не принадлежит настроенному проекту');
    if (board.deleted)
        throw new HttpError(409, 'Доска YouGile удалена');
    const columns = [];
    const seen = new Set();
    let offset = 0;
    for (let page = 0; page < 5; page++) {
        const data = await get('/columns?' + new URLSearchParams({ boardId: settings.boardId, limit: '100', offset: String(offset) }));
        if (!Array.isArray(data?.content) || !data.paging || typeof data.paging.next !== 'boolean' || data.content.length > 100)
            throw new HttpError(502, 'Неожиданный список колонок YouGile');
        for (const column of data.content) {
            if (!uuid(column.id) || column.boardId !== settings.boardId || typeof column.title !== 'string' || seen.has(column.id))
                throw new HttpError(502, 'Некорректная принадлежность или повтор колонки YouGile');
            seen.add(column.id);
            if (!column.deleted)
                columns.push({ id: column.id, title: column.title });
        }
        if (!data.paging.next)
            return { read_only: true, sync_enabled: false, project: { id: project.id, title: project.title }, board: { id: board.id, title: board.title }, columns };
        if (data.content.length === 0)
            throw new HttpError(502, 'YouGile вернул пустую страницу с продолжением');
        offset += data.content.length;
    }
    throw new HttpError(502, 'Слишком много колонок для проверки подключения');
}
// Connection inspection only. No external task writes or employee imports.
serve(async (req) => {
    const input = await body(req);
    const employee = await identity(input.initData);
    if (!['manager', 'deputy'].includes(employee.role))
        throw new HttpError(403, 'Проверка интеграции доступна руководителю и заместителю');
    if (input.action !== 'inspect')
        throw new HttpError(400, 'Доступно только действие inspect');
    const result = await inspectYougile({ apiKey: env('YOUGILE_API_KEY'), projectId: env('YOUGILE_PROJECT_ID'), boardId: env('YOUGILE_BOARD_ID'), baseUrl: Deno.env.get('YOUGILE_API_BASE') });
    return json({ ok: true, data: result });
}, true);
