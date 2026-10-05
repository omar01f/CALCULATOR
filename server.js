const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
try { fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(l => { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }); } catch {}
const { PLANS, charge } = require('./payments');
const PORT = process.env.PORT || 3000, DAY = 864e5;
const DB_FILE = path.join(__dirname, 'data', 'db.json');
let db = { users: [], sessions: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE)); } catch {}
const save = () => { fs.mkdirSync(path.dirname(DB_FILE), { recursive: true }); fs.writeFileSync(DB_FILE, JSON.stringify(db)); };

const hash = (p, s = crypto.randomBytes(16).toString('hex')) => s + ':' + crypto.scryptSync(p, s, 32).toString('hex');
const verify = (p, h) => { const a = Buffer.from(hash(p, h.split(':')[0])), b = Buffer.from(h); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const pwOk = p => typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
const subActive = u => !!(u.sub && u.sub.end > Date.now());
const pub = u => ({ name: u.name, email: u.email, credits: u.credits, total: u.calcs.length, sub: { active: subActive(u), end: u.sub ? u.sub.end : null, cancelled: !!(u.sub && u.sub.cancelled) } });

// Safe expression evaluator (no eval): + - * / ^ % ( ) sqrt
function calc(src) {
  const s = String(src).replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/√/g, 'sqrt');
  if (!s || s.length > 200) throw new Error('Invalid expression');
  let i = 0; const pk = () => s[i];
  const close = () => { if (pk() !== ')') throw new Error('Missing )'); i++; };
  const expr = () => { let v = term(); while (pk() === '+' || pk() === '-') { const o = s[i++], r = term(); v = o === '+' ? v + r : v - r; } return v; };
  const term = () => { let v = unary(); while (pk() === '*' || pk() === '/') { const o = s[i++], r = unary(); if (o === '/' && r === 0) throw new Error('Division by zero'); v = o === '*' ? v * r : v / r; } return v; };
  const unary = () => pk() === '-' ? (i++, -unary()) : pk() === '+' ? (i++, unary()) : power();
  const power = () => { const b = post(); if (pk() === '^') { i++; return Math.pow(b, unary()); } return b; };
  const post = () => { let v = atom(); while (pk() === '%') { i++; v /= 100; } return v; };
  const atom = () => {
    if (pk() === '(') { i++; const v = expr(); close(); return v; }
    if (s.startsWith('sqrt', i)) { i += 4; let v; if (pk() === '(') { i++; v = expr(); close(); } else v = atom(); if (v < 0) throw new Error('Square root of a negative number'); return Math.sqrt(v); }
    const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i)); if (!m) throw new Error('Invalid expression');
    i += m[0].length; return parseFloat(m[0]);
  };
  const v = expr(); if (i < s.length) throw new Error('Invalid expression');
  if (!isFinite(v)) throw new Error('Result out of range'); return +v.toPrecision(14);
}

const send = (res, code, obj, h = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise(r => { let d = ''; req.on('data', c => { d += c; if (d.length > 1e5) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

async function api(req, res, route) {
  const b = req.method === 'POST' ? await readBody(req) : {};
  const tok = cookies(req).sid, user = db.users.find(u => u.id === db.sessions[tok]);
  const setSess = u => { const t = crypto.randomBytes(24).toString('hex'); db.sessions[t] = u.id; save(); return { 'Set-Cookie': `sid=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` }; };
  if (route === 'signup') {
    const email = String(b.email || '').trim().toLowerCase(), name = String(b.name || '').trim().slice(0, 60);
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Enter a valid name and email' });
    if (!pwOk(b.password)) return send(res, 400, { error: 'Password needs 8+ characters with a letter and a number' });
    if (db.users.some(u => u.email === email)) return send(res, 409, { error: 'Email already registered' });
    const u = { id: crypto.randomUUID(), name, email, pw: hash(b.password), credits: 0, sub: null, calcs: [], payments: [] };
    db.users.push(u); return send(res, 200, pub(u), setSess(u));
  }
  if (route === 'login') {
    const u = db.users.find(x => x.email === String(b.email || '').trim().toLowerCase());
    if (!u || !verify(String(b.password || ''), u.pw)) return send(res, 401, { error: 'Invalid email or password' });
    return send(res, 200, pub(u), setSess(u));
  }
  if (route === 'logout') { delete db.sessions[tok]; save(); return send(res, 200, {}, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' }); }
  if (route === 'me') return user ? send(res, 200, pub(user)) : send(res, 401, { error: 'Not signed in' });
  if (!user) return send(res, 401, { error: 'Please log in' });

  if (route === 'calc') {
    let result; try { result = calc(b.expression); } catch (e) { return send(res, 400, { error: e.message }); }
    const sub = subActive(user);
    if (!sub && user.credits < 1) return send(res, 402, { error: 'Payment required' });
    if (!sub) user.credits--;
    user.calcs.unshift({ expression: String(b.expression).slice(0, 200), result, at: Date.now(), paid: sub ? 'subscription' : 'credit' });
    save(); return send(res, 200, { result, user: pub(user) });
  }
  if (route === 'history') return send(res, 200, { calcs: user.calcs.slice(0, 100), payments: user.payments.slice(0, 100) });
  if (route === 'pay') {
    if (!PLANS[b.plan]) return send(res, 400, { error: 'Unknown plan' });
    try {
      const c = await charge(b.plan);
      if (b.plan === 'credit') user.credits++;
      else { user.sub = { end: Math.max(Date.now(), subActive(user) ? user.sub.end : 0) + 30 * DAY, cancelled: false }; }
      user.payments.unshift({ id: c.id, plan: PLANS[b.plan].label, amount: PLANS[b.plan].amount, at: Date.now(), status: c.status });
      save(); return send(res, 200, pub(user));
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (route === 'cancel') { if (!subActive(user)) return send(res, 400, { error: 'No active subscription' }); user.sub.cancelled = true; save(); return send(res, 200, pub(user)); }
  if (route === 'resume') { if (!subActive(user)) return send(res, 400, { error: 'No active subscription' }); user.sub.cancelled = false; save(); return send(res, 200, pub(user)); }
  if (route === 'settings') {
    if (b.name !== undefined) { const n = String(b.name).trim().slice(0, 60); if (!n) return send(res, 400, { error: 'Name required' }); user.name = n; }
    if (b.newPassword) {
      if (!verify(String(b.currentPassword || ''), user.pw)) return send(res, 401, { error: 'Current password is wrong' });
      if (!pwOk(b.newPassword)) return send(res, 400, { error: 'Password needs 8+ characters with a letter and a number' });
      user.pw = hash(b.newPassword);
    }
    save(); return send(res, 200, pub(user));
  }
  send(res, 404, { error: 'Not found' });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname.slice(5));
    const f = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
    if (!f.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  } catch (e) { send(res, 500, { error: 'Server error' }); }
}).listen(PORT, () => console.log(`CalcPro running at http://localhost:${PORT} (payments: ${process.env.PAYMENT_PROVIDER || 'mock'})`));
