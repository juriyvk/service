export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function equal(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
async function hmac(key, value) {
  const bytes = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const k = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(value)));
}
export async function verifyInitData(raw, token, now = Math.floor(Date.now() / 1000)) {
  if (!token) throw new HttpError(503, 'Server configuration missing');
  if (typeof raw !== 'string' || !raw || raw.length > 16384) throw new HttpError(401, 'Invalid Telegram data');
  const params = new URLSearchParams(raw), seen = new Set();
  for (const [key] of params) { if (seen.has(key)) throw new HttpError(401, 'Duplicate field'); seen.add(key); }
  const hash = params.get('hash');
  if (!/^[a-f0-9]{64}$/.test(hash || '')) throw new HttpError(401, 'Invalid signature');
  params.delete('hash');
  const check = [...params].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = await hmac('WebAppData', token);
  const expected = [...await hmac(secret, check)].map(x => x.toString(16).padStart(2,'0')).join('');
  if (!equal(hash, expected)) throw new HttpError(401, 'Invalid signature');
  const authDate = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || now - authDate > 3600 || authDate > now + 30) throw new HttpError(401, 'Expired Telegram data');
  let user; try { user = JSON.parse(params.get('user')); } catch { throw new HttpError(401, 'Invalid user'); }
  if (!Number.isSafeInteger(user?.id) || user.id <= 0) throw new HttpError(401, 'Invalid user');
  return user.id;
}
export const MIME = new Set(['application/pdf','image/jpeg','image/png','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
export function validateDocument(d) {
  if (!d || typeof d.name !== 'string' || !d.name.trim() || d.name.length>240 || !MIME.has(d.mime) || !Number.isInteger(d.size) || d.size<1 || d.size>10485760) throw new HttpError(400,'Invalid document (maximum 10 MiB)');
  return {name:d.name, mime:d.mime, size:d.size};
}
export function parseTaskMessage(text) {
  // Explicit command: /task <employee UUID or self> | title | YYYY-MM-DD (optional)
  const match = /^\/task(?:@\w+)?\s+(self|[a-f0-9-]{36})\s*\|\s*([^|]+?)(?:\s*\|\s*(\d{4}-\d{2}-\d{2}))?\s*$/i.exec(text || '');
  if (!match || match[2].trim().length>240) throw new HttpError(400,'Используйте /task self | Название | ГГГГ-ММ-ДД или UUID сотрудника вместо self');
  return {title:match[2].trim(), ...(match[1]==='self'?{}:{assignee_id:match[1]}),due_date:match[3] || null};
}
