// @ts-nocheck
// GENERATED JavaScript for pasting into Dashboard index.ts. Do not edit.
// Canonical typed sources: supabase/functions/. Rebuild: node scripts/build-dashboard.mjs
export class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
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
        throw new HttpError(status, status === 409 ? 'Данные изменились. Обновите задачу.' : status === 403 ? 'Доступ запрещён' : 'Некорректные данные или переход статуса');
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
// Compatible response contract with the original index.html identity gate.
serve(async (req) => {
    const data = await body(req);
    if (typeof data.initData !== 'string')
        throw new HttpError(400, 'initData required');
    const employee = await identity(data.initData);
    // Preserve the legacy ID and position in the existing identity-gate contract.
    // CRM actor UUID is resolved separately on every CRM request.
    return json({ ok: true, employee: { id: employee.legacy_id, full_name: employee.full_name, position: employee.position, role: employee.role } });
}, true);
