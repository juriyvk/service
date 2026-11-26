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
export function settingsFor(input) {
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
    return { ...input, projectId: input.projectId.toLowerCase(), boardId: input.boardId.toLowerCase(), baseUrl: base.origin + '/api-v2' };
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
export function createYougileClient(input, fetchImpl = fetch, beforeRequest = async () => { }) {
    const settings = settingsFor(input);
    async function request(method, path, body) {
        await beforeRequest();
        let response;
        try {
            response = await fetchImpl(settings.baseUrl + path, { method, headers: { Authorization: 'Bearer ' + settings.apiKey, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(10000) });
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
                throw new HttpError(503, 'Выбранный объект YouGile не найден', 'YG404');
            if (status === 429)
                throw new HttpError(429, 'YouGile ограничил частоту запросов. Повторите позже');
            throw new HttpError(502, 'Сбой API YouGile (HTTP ' + status + ')');
        }
        return boundedJson(response);
    }
    const get = path => request('GET', path);
    return { settings, get,
        task: async (id) => { if (!uuid(id))
            throw new HttpError(400, 'Некорректный ID задачи'); return get('/tasks/' + id); },
        createTask: payload => request('POST', '/tasks', payload),
        updateTask: async (id, payload) => { if (!uuid(id) || Object.keys(payload).some(k => !['title', 'description', 'columnId', 'assigned', 'deadline', 'completed'].includes(k)))
            throw new HttpError(400, 'Недопустимое изменение YouGile'); return request('PUT', '/tasks/' + id, payload); }
    };
}
export async function inspectYougile(input, fetchImpl = fetch) { return readYougileScope(createYougileClient(input, fetchImpl)); }
export async function readYougileScope(client) {
    const { settings, get } = client;
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
            return { memberIds: Object.keys(project.users || {}).filter(id => uuid(id) && project.users[id] !== '-' && project.users[id] !== 'observer'), read_only: true, writes_performed: false, project: { id: project.id, title: project.title }, board: { id: board.id, title: board.title }, columns };
        if (data.content.length === 0)
            throw new HttpError(502, 'YouGile вернул пустую страницу с продолжением');
        offset += data.content.length;
    }
    throw new HttpError(502, 'Слишком много колонок для проверки подключения');
}
export const SYNC_FIELDS = ['title', 'description', 'assignee_id', 'status', 'due_date'];
export class SyncConflict extends Error {
    constructor(reason, fields = []) { super(reason); this.reason = reason; this.fields = fields; }
}
export function stateEqual(a, b) {
    if (a === b)
        return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b))
        return false;
    const keysA = Object.keys(a).sort(), keysB = Object.keys(b).sort();
    return keysA.length === keysB.length && keysA.every((key, index) => key === keysB[index] && stateEqual(a[key], b[key]));
}
const mergeEqual = stateEqual;
const escapeText = text => String(text).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
const decodeText = text => String(text).replace(/&(amp|lt|gt|quot|#39);/g, x => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[x]));
export const localSnapshot = t => Object.fromEntries(SYNC_FIELDS.map(k => [k, t[k] ?? (k === 'due_date' ? null : '')]));
export function remoteSnapshot(t, columns, users) {
    if (t.deleted || t.archived)
        throw new SyncConflict('remote_removed');
    const entries = Object.entries(columns).filter(([, id]) => id === t.columnId);
    if (entries.length !== 1)
        throw new SyncConflict('remote_outside_scope');
    if (!Array.isArray(t.assigned) || t.assigned.length !== 1)
        throw new SyncConflict('single_assignee_required', ['assignee_id']);
    const binding = users.find(u => u.remote_user === t.assigned[0]);
    if (!binding)
        throw new SyncConflict('unbound_assignee', ['assignee_id']);
    const status = t.completed ? 'done' : entries[0][0];
    let due = null;
    if (t.deadline?.deadline != null) {
        const n = t.deadline.deadline;
        if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isFinite(new Date(n).getTime()))
            throw new SyncConflict('invalid_deadline', ['due_date']);
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(n));
        due = ['year', 'month', 'day'].map(k => parts.find(p => p.type === k)?.value).join('-');
    }
    if (t.description != null && typeof t.description !== 'string')
        throw new SyncConflict('invalid_description');
    const title = t.title, description = decodeText(t.description || '');
    if (typeof title !== 'string' || !title.trim() || title.length > 240 || description.length > 10000)
        throw new SyncConflict('unsupported_text_size');
    return { title, description, assignee_id: binding.employee_id, status, due_date: due };
}
export function mergeTask(local, remote, link) {
    const baseL = link.base_local, baseR = link.base_remote;
    if (!baseL || !baseR)
        throw new SyncConflict('baseline_missing');
    const resolution = link.resolution;
    if (resolution) {
        if (resolution.version !== local.version || !mergeEqual(resolution.remote, remote))
            throw new SyncConflict('resolution_stale');
        if (resolution.choice === 'local')
            return { desired: localSnapshot(local), push: SYNC_FIELDS.filter(k => !equivalent(k, local[k], remote[k])), pull: [] };
        if (resolution.choice === 'remote')
            return { desired: { ...remote, status: remote.status === 'pending' && local.status === 'accepted' ? 'accepted' : remote.status }, push: [], pull: SYNC_FIELDS.filter(k => !equivalent(k, local[k], remote[k])) };
        throw new SyncConflict('invalid_resolution');
    }
    const desired = localSnapshot(local), push = [], pull = [], conflicts = [];
    for (const key of SYNC_FIELDS) {
        const l = desired[key], r = remote[key], lc = !mergeEqual(l, baseL[key]), rc = !mergeEqual(r, baseR[key]);
        if (lc && rc && !equivalent(key, l, r)) {
            conflicts.push(key);
            continue;
        }
        if (lc && !equivalent(key, l, r))
            push.push(key);
        if (rc && !lc && !equivalent(key, l, r)) {
            desired[key] = r;
            pull.push(key);
        }
    }
    if (conflicts.length)
        throw new SyncConflict('both_sides_changed', conflicts);
    return { desired, push, pull };
}
function equivalent(key, l, r) { return mergeEqual(l, r) || key === 'status' && l === 'accepted' && r === 'pending'; }
export function remotePatch(snapshot, fields, columns, users, currentRemote) {
    const patch = {};
    for (const key of fields) {
        if (key === 'title')
            patch.title = snapshot.title;
        if (key === 'description')
            patch.description = escapeText(snapshot.description);
        if (key === 'assignee_id') {
            const binding = users.find(u => u.employee_id === snapshot.assignee_id);
            if (!binding)
                throw new SyncConflict('unbound_assignee', [key]);
            patch.assigned = [binding.remote_user];
        }
        if (key === 'status') {
            const status = snapshot.status === 'accepted' ? 'pending' : snapshot.status;
            if (!columns[status])
                throw new SyncConflict('status_unmapped', [key]);
            patch.columnId = columns[status];
            patch.completed = status === 'done';
        }
        if (key === 'due_date') {
            if (currentRemote?.deadline?.withTime)
                throw new SyncConflict('timed_deadline_requires_review', [key]);
            if (snapshot.due_date === null)
                patch.deadline = { deleted: true };
            else if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.due_date) || !Number.isFinite(new Date(snapshot.due_date + 'T12:00:00Z').getTime()) || new Date(snapshot.due_date + 'T12:00:00Z').toISOString().slice(0, 10) !== snapshot.due_date)
                throw new SyncConflict('invalid_deadline', [key]);
            else
                patch.deadline = { deadline: new Date(snapshot.due_date + 'T12:00:00Z').getTime(), withTime: false };
        }
    }
    return patch;
}
export function assertIncomingStatus(task, desired) {
    if (task.assignee_id !== desired.assignee_id) {
        if (['done', 'cancelled'].includes(task.status) || desired.status !== 'pending')
            throw new SyncConflict('reassignment_requires_pending', ['assignee_id', 'status']);
        return;
    }
    if (task.status === desired.status)
        return;
    const allowed = { pending: ['cancelled'], accepted: ['in_progress', 'cancelled'], in_progress: ['review', 'cancelled'], review: ['in_progress', 'done', 'cancelled'], done: [], cancelled: [] };
    if (!allowed[task.status]?.includes(desired.status))
        throw new SyncConflict(task.status === 'pending' ? 'acceptance_required' : 'invalid_transition', ['status']);
}
export class SyncBudget extends Error {
}
export async function syncYougile(settings, callRpc, fetchImpl = fetch, clock = () => Date.now()) {
    settings = settingsFor(settings);
    const db = (action, data = {}) => callRpc('dvfm_yg', { p_actor: null, p_action: action, p_data: data });
    const claim = await db('run.claim');
    if (claim.busy)
        return { busy: true };
    if (!claim.lease)
        return { enabled: false };
    const lease = claim.lease, cfg = claim.config, start = clock();
    const call = (action, data = {}) => db(action, { lease, ...data });
    const summary = { enabled: true, pushed: 0, pulled: 0, imported: 0, conflicts: 0, retried: 0, limited: false };
    try {
        if (settings.projectId !== cfg.remote_project || settings.boardId !== cfg.board_id)
            throw new HttpError(503, 'Настройки Secrets и выбранной связи YouGile не совпадают');
        const client = createYougileClient(settings, fetchImpl, async () => { if (clock() - start > 45000 || !await call('permit') || clock() - start > 45000)
            throw new SyncBudget(); });
        const scope = await readYougileScope(client);
        if (Object.values(cfg.columns).some(id => !scope.columns.some(c => c.id === id)))
            throw new HttpError(409, 'Колонки YouGile изменились. Проверьте настройки связи');
        const users = claim.users.filter(u => scope.memberIds.includes(u.remote_user));
        const projectRemote = t => remoteSnapshot(t, cfg.columns, users);
        async function issue(taskId, error, remote = null) {
            if (error instanceof SyncBudget)
                throw error;
            if (error?.code === 'YG404')
                error = new SyncConflict('remote_removed');
            if (error instanceof SyncConflict || error?.code === '22023' || error?.code === '40001' || error?.code === '42501') {
                await call('conflict', { task_id: taskId, reason: error.reason || (error.code === '22023' ? 'crm_transition_rejected' : error.code === '40001' ? 'local_changed' : 'authority_or_assignee_changed'), fields: error.fields || [], remote });
                summary.conflicts++;
            }
            else {
                await call('retry', { task_id: taskId });
                summary.retried++;
            }
        }
        async function reconcile(item, remoteObject) {
            const { task, link } = item;
            let remote = null;
            try {
                await call('validate', { task_id: task.id, version: task.version });
                if (!users.some(u => u.employee_id === task.assignee_id))
                    throw new SyncConflict('unbound_assignee', ['assignee_id']);
                if (!link.remote_id) {
                    const local = localSnapshot(task), payload = remotePatch(local, SYNC_FIELDS, cfg.columns, users, null);
                    // Null deadline is omitted on create; {deleted:true} is only an update operation.
                    if (local.due_date === null)
                        delete payload.deadline;
                    const created = await client.createTask({ ...payload, idempotencyKey: 'dvfm-' + cfg.project_id + '-' + task.id });
                    const object = await client.task(created.id);
                    remote = projectRemote(object);
                    if (!stateEqual({ ...remote, status: local.status === 'accepted' && remote.status === 'pending' ? 'accepted' : remote.status }, local)) {
                        await call('ack', { task_id: task.id, remote_id: object.id, version: task.version, local, remote });
                        throw new SyncConflict('remote_changed_after_create');
                    }
                    await call('ack', { task_id: task.id, remote_id: object.id, version: task.version, local, remote });
                    summary.pushed++;
                    return;
                }
                const observed = remoteObject || await client.task(link.remote_id);
                remote = projectRemote(observed);
                const plan = mergeTask(task, remote, link);
                if (plan.pull.length)
                    assertIncomingStatus(task, plan.desired);
                let finalObject = observed, finalRemote = remote;
                if (plan.push.length) {
                    const latest = await client.task(link.remote_id);
                    if (!stateEqual(projectRemote(latest), remote))
                        throw new SyncConflict('remote_changed_before_write');
                    const patch = remotePatch(plan.desired, plan.push, cfg.columns, users, latest);
                    await call('validate', { task_id: task.id, version: task.version });
                    await client.updateTask(link.remote_id, patch);
                    finalObject = await client.task(link.remote_id);
                    finalRemote = projectRemote(finalObject);
                    const expected = { ...remote };
                    for (const key of plan.push)
                        expected[key] = key === 'status' && plan.desired.status === 'accepted' ? 'pending' : plan.desired[key];
                    remote = finalRemote;
                    if (!stateEqual(finalRemote, expected))
                        throw new SyncConflict('remote_changed_after_write');
                    summary.pushed++;
                }
                if (plan.pull.length) {
                    await call('pull', { task_id: task.id, remote_id: link.remote_id, version: task.version, desired: plan.desired, remote: finalRemote });
                    summary.pulled++;
                }
                else
                    await call('ack', { task_id: task.id, remote_id: link.remote_id, version: task.version, local: localSnapshot(task), remote: finalRemote });
            }
            catch (error) {
                await issue(task.id, error, remote);
            }
        }
        const work = await call('work');
        for (const item of work)
            await reconcile(item);
        const watched = await call('watch');
        for (const item of watched) {
            await reconcile(item);
            await call('watch.advance', { task_id: item.task.id });
        }
        if (watched.length < 5)
            await call('watch.advance', { task_id: null });
        const allowImport = cfg.import_new && await call('allow_import');
        if (cfg.import_new && !allowImport)
            summary.import_waiting_for_creates = true;
        const columnIds = ['pending', 'in_progress', 'review', 'done', 'cancelled'].filter(key => cfg.columns[key]).map(key => cfg.columns[key]), index = cfg.scan_column % columnIds.length;
        const page = await client.get('/task-list?' + new URLSearchParams({ columnId: columnIds[index], limit: '5', offset: String(cfg.scan_offset) }));
        if (!Array.isArray(page.content) || page.content.length > 5 || typeof page.paging?.next !== 'boolean' || page.paging.next && page.content.length === 0)
            throw new HttpError(502, 'Некорректная страница задач YouGile');
        for (const candidate of page.content) {
            const item = await call('lookup', { remote_id: candidate.id });
            // A conflict is explicit state; polling must not resolve it on its own.
            if (item && (item.link.conflict && !item.link.resolution || item.link.attempts >= 10 || new Date(item.link.retry_at).getTime() > Date.now()))
                continue;
            if (!item && (!allowImport || candidate.deleted || candidate.archived))
                continue;
            const remoteObject = await client.task(candidate.id);
            if (item) {
                await reconcile(item, remoteObject);
                continue;
            }
            try {
                const remote = projectRemote(remoteObject);
                const result = await call('import', { remote_id: remoteObject.id, remote });
                if (result && !result.existing)
                    summary.imported++;
            }
            catch (error) {
                if (error instanceof SyncBudget)
                    throw error;
                // Unmapped external objects must be visible to the operator, not silently assigned.
                if (error instanceof SyncConflict) {
                    summary.conflicts++;
                    await call('scan.error', { remote_id: candidate.id, reason: error.reason });
                    continue;
                }
                throw error;
            }
        }
        await call('scan.advance', { column: page.paging.next ? index : (index + 1) % columnIds.length, offset: page.paging.next ? cfg.scan_offset + page.content.length : 0 });
    }
    catch (error) {
        if (error instanceof SyncBudget)
            summary.limited = true;
        else
            throw error;
    }
    finally {
        try {
            await call('run.release');
        }
        catch { /* Lease expires; never log credentials or task bodies. */ }
    }
    return summary;
}
const syncEnabled = () => Deno.env.get('YOUGILE_SYNC_ENABLED') === 'true';
const settings = () => ({ apiKey: env('YOUGILE_API_KEY'), projectId: env('YOUGILE_PROJECT_ID'), boardId: env('YOUGILE_BOARD_ID'), baseUrl: Deno.env.get('YOUGILE_API_BASE') });
serve(async (req) => {
    if (new URL(req.url).searchParams.get('worker') === '1') {
        requireSecret(req.headers.get('authorization'), 'OUTBOX_WORKER_AUTH');
        if (!syncEnabled())
            return json({ ok: true, data: { enabled: false } });
        return json({ ok: true, data: await syncYougile(settings(), rpc) });
    }
    const input = await body(req);
    const employee = await identity(input.initData);
    if (!['manager', 'deputy'].includes(employee.role))
        throw new HttpError(403, 'Интеграция доступна руководителю и заместителю');
    const data = input.data || {};
    const local = async (action, value = {}) => { try {
        return await rpc('dvfm_yg', { p_actor: employee.id, p_action: action, p_data: value });
    }
    catch (error) {
        if (error instanceof HttpError && error.code === 'PGRST202')
            throw new HttpError(503, 'Нужно применить миграцию синхронизации YouGile');
        throw error;
    } };
    if (input.action === 'inspect')
        return json({ ok: true, data: await inspectYougile(settings()) });
    if (input.action === 'status')
        return json({ ok: true, data: { ...await local('status'), server_enabled: syncEnabled() } });
    if (input.action === 'configure' || input.action === 'bind') {
        const configured = settings(), scope = await inspectYougile(configured);
        if (input.action === 'configure') {
            const columns = data.columns;
            if (!columns || typeof columns !== 'object' || Array.isArray(columns) || Object.values(columns).some(id => !scope.columns.some(c => c.id === id)))
                throw new HttpError(400, 'Все колонки должны принадлежать выбранной доске');
            return json({ ok: true, data: await local('configure', { ...data, remote_project: configured.projectId, board_id: configured.boardId }) });
        }
        if (!scope.memberIds.includes(data.remote_user))
            throw new HttpError(400, 'Нужен ID активного прямого участника выбранного проекта YouGile');
        return json({ ok: true, data: await local('bind', { employee_id: data.employee_id, remote_user: data.remote_user }) });
    }
    if (input.action === 'resolve' || input.action === 'retry.reset')
        return json({ ok: true, data: await local(input.action, data) });
    if (input.action === 'run') {
        if (!syncEnabled())
            throw new HttpError(409, 'Синхронизация выключена. Сначала проверьте настройки и YOUGILE_SYNC_ENABLED');
        return json({ ok: true, data: await syncYougile(settings(), rpc) });
    }
    throw new HttpError(400, 'Неизвестное действие интеграции');
}, true);
