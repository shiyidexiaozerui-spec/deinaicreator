import express from 'express';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4600;
const token = () => crypto.randomBytes(16).toString('hex');
const code6 = () => String(Math.floor(100000 + Math.random() * 900000));

// ---------- auth middleware ----------
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  const user = t && db.prepare('SELECT * FROM users WHERE token = ?').get(t);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  next();
}

function onboardingState(u) {
  const social = db
    .prepare('SELECT COUNT(*) c FROM socials WHERE user_id = ? AND connected = 1')
    .get(u.id).c;
  return {
    verified: true,
    portraitAuthorized: !!u.portrait_authorized,
    socialsConnected: social,
  };
}

// ================= AUTH =================
app.post('/api/auth/request-code', (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const code = code6();
  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) {
    const handle = '@' + (phone.replace(/\D/g, '').slice(-4) || 'creator');
    const r = db
      .prepare('INSERT INTO users (phone, name, handle, login_code) VALUES (?,?,?,?)')
      .run(phone, 'Aisha', 'aisha.style', code);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  } else {
    db.prepare('UPDATE users SET login_code = ? WHERE id = ?').run(code, user.id);
  }
  // dev mode: return the code so the prototype can auto-fill it
  res.json({ ok: true, devCode: code });
});

app.post('/api/auth/verify', (req, res) => {
  const { phone, code } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user || String(user.login_code) !== String(code))
    return res.status(401).json({ error: 'invalid code' });
  const t = token();
  db.prepare('UPDATE users SET token = ?, login_code = NULL WHERE id = ?').run(t, user.id);
  // ensure default social rows exist
  const has = db.prepare('SELECT COUNT(*) c FROM socials WHERE user_id = ?').get(user.id).c;
  if (!has) {
    db.prepare(
      'INSERT INTO socials (user_id,platform,handle,connected,followers,core_age,top_region,top_interest) VALUES (?,?,?,?,?,?,?,?)'
    ).run(user.id, 'TikTok', '@aisha.style', 0, '128K', '18–34', 'Saudi', 'Beauty');
    db.prepare(
      'INSERT INTO socials (user_id,platform,handle,connected,followers,core_age,top_region,top_interest) VALUES (?,?,?,?,?,?,?,?)'
    ).run(user.id, 'Instagram', '', 0, '—', '—', '—', '—');
  }
  res.json({ token: t, user: publicUser(user), onboarding: onboardingState(user) });
});

function publicUser(u) {
  return { id: u.id, phone: u.phone, name: u.name, handle: u.handle };
}

app.get('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user), onboarding: onboardingState(req.user) });
});

// ================= PORTRAIT =================
app.post('/api/portrait/authorize', auth, (req, res) => {
  db.prepare(
    "UPDATE users SET portrait_authorized = 1, portrait_authorized_at = date('now') WHERE id = ?"
  ).run(req.user.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, authorizedAt: u.portrait_authorized_at });
});

app.post('/api/portrait/revoke', auth, (req, res) => {
  db.prepare(
    'UPDATE users SET portrait_authorized = 0, portrait_authorized_at = NULL WHERE id = ?'
  ).run(req.user.id);
  res.json({ ok: true });
});

// ================= SOCIALS =================
app.get('/api/socials', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM socials WHERE user_id = ? ORDER BY id').all(req.user.id));
});

app.post('/api/socials/:platform/connect', auth, (req, res) => {
  const { platform } = req.params;
  const row = db
    .prepare('SELECT * FROM socials WHERE user_id = ? AND lower(platform) = lower(?)')
    .get(req.user.id, platform);
  if (!row) return res.status(404).json({ error: 'platform not found' });
  const handle = row.handle || '@aisha.' + platform.toLowerCase();
  const followers = row.followers && row.followers !== '—' ? row.followers : '54K';
  db.prepare(
    'UPDATE socials SET connected = 1, handle = ?, followers = ?, core_age = ?, top_region = ?, top_interest = ? WHERE id = ?'
  ).run(handle, followers, '18–34', 'Saudi', 'Beauty', row.id);
  res.json(db.prepare('SELECT * FROM socials WHERE id = ?').get(row.id));
});

app.post('/api/socials/:platform/disconnect', auth, (req, res) => {
  const row = db
    .prepare('SELECT * FROM socials WHERE user_id = ? AND lower(platform) = lower(?)')
    .get(req.user.id, req.params.platform);
  if (!row) return res.status(404).json({ error: 'platform not found' });
  db.prepare('UPDATE socials SET connected = 0 WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// ================= PRODUCTS / DISCOVER =================
app.get('/api/products', auth, (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  let rows = db.prepare('SELECT * FROM products ORDER BY match_pct DESC').all();
  if (q) rows = rows.filter((p) => (p.title + ' ' + p.category).toLowerCase().includes(q));
  res.json(rows);
});

// ================= QUEUE =================
app.get('/api/queue', auth, (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT q.id, q.status, p.* FROM queue q JOIN products p ON p.id = q.product_id
         WHERE q.user_id = ? ORDER BY q.created_at DESC`
      )
      .all(req.user.id)
  );
});

app.post('/api/queue', auth, (req, res) => {
  const { productId } = req.body || {};
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!p) return res.status(404).json({ error: 'product not found' });
  const exists = db
    .prepare("SELECT id FROM queue WHERE user_id = ? AND product_id = ? AND status='to_make'")
    .get(req.user.id, productId);
  if (!exists) db.prepare('INSERT INTO queue (user_id, product_id) VALUES (?,?)').run(req.user.id, productId);
  const count = db
    .prepare("SELECT COUNT(*) c FROM queue WHERE user_id = ? AND status='to_make'")
    .get(req.user.id).c;
  res.json({ ok: true, queueCount: count });
});

app.delete('/api/queue/:id', auth, (req, res) => {
  db.prepare('DELETE FROM queue WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ================= VIDEOS / CREATE =================
const SCRIPTS = [
  "Hey loves — I've used these earbuds for two weeks; the noise canceling is super clean…",
  'Okay this one surprised me — the sound is rich and the fit stays put all day.',
  'Real talk: if you want premium audio without the premium price, watch this.',
];

app.post('/api/videos/regenerate-script', auth, (req, res) => {
  const next = SCRIPTS[Math.floor(Math.random() * SCRIPTS.length)];
  res.json({ script: next, safeWord: true });
});

app.post('/api/videos', auth, (req, res) => {
  const b = req.body || {};
  if (!req.user.portrait_authorized)
    return res.status(403).json({ error: 'portrait authorization required' });
  const r = db
    .prepare(
      `INSERT INTO videos (user_id, product_id, style, language, hijab_overlay, duration, ratio, platform, script, status)
       VALUES (?,?,?,?,?,?,?,?,?, 'generating')`
    )
    .run(
      req.user.id,
      b.productId,
      b.style || 'My Style',
      b.language || 'Arabic · Gulf',
      b.hijab ? 1 : 0,
      b.duration || '30s',
      b.ratio || '9:16',
      b.platform || 'TikTok',
      b.script || SCRIPTS[0]
    );
  const id = r.lastInsertRowid;
  // simulate a ~3s generation job
  setTimeout(() => {
    try {
      db.prepare("UPDATE videos SET status = 'ready' WHERE id = ?").run(id);
    } catch {}
  }, 3000);
  res.json({ id, status: 'generating', etaMs: 3000 });
});

app.get('/api/videos/:id', auth, (req, res) => {
  const v = db
    .prepare('SELECT v.*, p.title product_title FROM videos v LEFT JOIN products p ON p.id = v.product_id WHERE v.id = ? AND v.user_id = ?')
    .get(req.params.id, req.user.id);
  if (!v) return res.status(404).json({ error: 'not found' });
  res.json(v);
});

// ================= SMART LINK (tracked redirect + light landing) =================
function promoFor(user) { return (user.name || 'AISHA').toUpperCase().slice(0, 5) + '15'; }
function baseUrl(req) { return `${req.protocol}://${req.get('host')}`; }

function smartLinkPayload(req, row) {
  const promo = row.promo;
  return {
    code: row.code,
    branded: `go.deinai.ai/${row.code}`,           // shown to the creator
    url: `${baseUrl(req)}/go/${row.code}`,          // real, clickable in this prototype
    creatorId: req.user.handle || ('c' + req.user.id),
    videoId: row.video_id,
    promo,
    clicks: row.clicks,
    utm: { medium: 'creator', campaign: 'deinai_shoppable', content: 'v' + row.video_id },
  };
}

// create (or return existing) Smart Link for a video
app.post('/api/smartlink', auth, (req, res) => {
  const { videoId } = req.body || {};
  const v = db.prepare('SELECT * FROM videos WHERE id = ? AND user_id = ?').get(videoId, req.user.id);
  if (!v) return res.status(404).json({ error: 'video not found' });
  let row = db.prepare('SELECT * FROM smartlinks WHERE user_id = ? AND video_id = ?').get(req.user.id, videoId);
  if (!row) {
    const code = crypto.randomBytes(3).toString('hex'); // e.g. a3f9c1
    db.prepare(
      'INSERT INTO smartlinks (code, user_id, video_id, product_id, promo) VALUES (?,?,?,?,?)'
    ).run(code, req.user.id, videoId, v.product_id, promoFor(req.user));
    row = db.prepare('SELECT * FROM smartlinks WHERE code = ?').get(code);
  }
  res.json(smartLinkPayload(req, row));
});

app.get('/api/smartlink/by-video/:videoId', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM smartlinks WHERE user_id = ? AND video_id = ?').get(req.user.id, req.params.videoId);
  res.json(row ? smartLinkPayload(req, row) : null);
});

// QR as SVG (public so <img>/inline can load without auth headers)
app.get('/api/qr', async (req, res) => {
  const d = req.query.d || 'https://go.deinai.ai';
  try {
    const svg = await QRCode.toString(String(d), { type: 'svg', margin: 1, width: 132,
      color: { dark: '#141414', light: '#00000000' } });
    res.type('image/svg+xml').send(svg);
  } catch (e) { res.status(400).json({ error: 'qr failed' }); }
});

// ================= CREATOR BIO / LINKTREE CONFIG =================
app.get('/api/bio', auth, (req, res) => {
  const b = db.prepare('SELECT * FROM bios WHERE user_id = ?').get(req.user.id);
  res.json({ configured: !!(b && b.configured), url: b ? b.smart_url : null });
});

app.post('/api/bio/configure', auth, (req, res) => {
  const { code } = req.body || {};
  const row = db.prepare('SELECT * FROM smartlinks WHERE code = ? AND user_id = ?').get(code, req.user.id);
  if (!row) return res.status(404).json({ error: 'smart link not found' });
  const url = `go.deinai.ai/${row.code}`;
  const exists = db.prepare('SELECT user_id FROM bios WHERE user_id = ?').get(req.user.id);
  if (exists) db.prepare("UPDATE bios SET smart_code=?, smart_url=?, configured=1, updated_at=datetime('now') WHERE user_id=?").run(row.code, url, req.user.id);
  else db.prepare('INSERT INTO bios (user_id, smart_code, smart_url, configured) VALUES (?,?,?,1)').run(req.user.id, row.code, url);
  res.json({ configured: true, url });
});

// ================= LANDING PAGE (the "light landing" the Smart Link redirects to) =================
app.get('/go/:code', (req, res) => {
  const row = db.prepare('SELECT * FROM smartlinks WHERE code = ?').get(req.params.code);
  if (!row) return res.status(404).send('Link not found');
  const source = (req.query.s || 'direct').toString().slice(0, 24);
  db.prepare('UPDATE smartlinks SET clicks = clicks + 1 WHERE code = ?').run(row.code);
  db.prepare('INSERT INTO link_clicks (code, source) VALUES (?,?)').run(row.code, source);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(row.product_id) || {};
  res.type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${p.title || 'DeiNai'} · Shop</title>
<style>*{box-sizing:border-box;margin:0;font-family:-apple-system,'Plus Jakarta Sans',sans-serif}
body{background:#faf9f5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{background:#fff;border-radius:24px;box-shadow:0 20px 60px rgba(0,0,0,.12);max-width:380px;width:100%;overflow:hidden}
.top{background:#141414;color:#fff;padding:18px 22px;display:flex;align-items:center;gap:10px;font-weight:800}
.dot{display:flex}.dot svg{display:block}
.body{padding:22px}.img{height:200px;border-radius:16px;background:#E2DBD5;display:flex;align-items:center;justify-content:center;color:#A99F95;font-weight:500}
h1{font-size:20px;margin:18px 0 6px}.price{color:#2F3471;font-size:22px;font-weight:800}
.pills{display:flex;gap:8px;margin-top:12px}.pill{font-size:12px;font-weight:700;padding:6px 11px;border-radius:999px}
.g{color:#1E8A5A;background:#E6F4EC}.v{color:#6E55AC;background:#ECE4F6}
.promo{margin-top:16px;border:1.5px dashed #1E8A5A;border-radius:12px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center}
.promo b{color:#1E8A5A;letter-spacing:1px}.cta{margin-top:16px;display:block;text-align:center;background:#1E8A5A;color:#fff;text-decoration:none;font-weight:700;padding:15px;border-radius:14px}
.src{margin-top:14px;text-align:center;color:#A7A7AF;font-size:11px}</style></head>
<body><div class="card">
<div class="top"><span class="dot"><svg width="26" height="17" viewBox="0 0 46 30" fill="none"><circle cx="16" cy="15" r="11" stroke="#fff" stroke-width="4.4"/><circle cx="30" cy="15" r="11" stroke="#fff" stroke-width="4.4"/></svg></span> DeiNai · Creator pick</div>
<div class="body">
<div class="img">Product image</div>
<h1>${p.title || 'Featured product'}</h1>
<div class="price">SAR ${p.price_sar || '—'}</div>
<div class="pills"><span class="pill g">Match ${p.match_pct || '—'}%</span><span class="pill v">Verified seller</span></div>
<div class="promo"><span>Promo code</span><b>${row.promo}</b></div>
<a class="cta" href="#">Shop now →</a>
<div class="src">Tracked via Smart Link · source: ${source} · creator pick</div>
</div></div></body></html>`);
});

// ================= DISTRIBUTE / PUBLISH =================
app.post('/api/publish', auth, (req, res) => {
  const { videoId, platforms, captions, smartCode, schedule } = req.body || {};
  const v = db.prepare('SELECT * FROM videos WHERE id = ? AND user_id = ?').get(videoId, req.user.id);
  if (!v) return res.status(404).json({ error: 'video not found' });
  const plats = Array.isArray(platforms) && platforms.length ? platforms : ['tiktok'];

  // ensure a Smart Link exists
  let link = smartCode && db.prepare('SELECT * FROM smartlinks WHERE code = ? AND user_id = ?').get(smartCode, req.user.id);
  if (!link) {
    link = db.prepare('SELECT * FROM smartlinks WHERE user_id = ? AND video_id = ?').get(req.user.id, videoId);
    if (!link) {
      const code = crypto.randomBytes(3).toString('hex');
      db.prepare('INSERT INTO smartlinks (code, user_id, video_id, product_id, promo) VALUES (?,?,?,?,?)')
        .run(code, req.user.id, videoId, v.product_id, promoFor(req.user));
      link = db.prepare('SELECT * FROM smartlinks WHERE code = ?').get(code);
    }
  }
  const promo = link.promo;
  const branded = `go.deinai.ai/${link.code}`;

  const r = db.prepare(
    `INSERT INTO publishes (user_id, video_id, platforms, caption, share_link, promo_code, status, scheduled_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(req.user.id, videoId, JSON.stringify(plats), JSON.stringify(captions || {}), branded, promo,
    schedule ? 'scheduled' : 'published', schedule || null);
  db.prepare("UPDATE videos SET status = 'published' WHERE id = ?").run(videoId);

  // record an earning event so the Earnings screen reflects real activity
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(v.product_id);
  if (p) {
    const gmv = p.price_sar * (plats.length + Math.floor(Math.random() * 3)); // more reach → more GMV
    const amount = +(gmv * (p.commission_pct / 100)).toFixed(2);
    db.prepare(
      `INSERT INTO earnings (user_id, product_title, video_tag, gmv_sar, amount_sar, status) VALUES (?,?,?,?,?, 'pending')`
    ).run(req.user.id, p.title, '#V' + videoId, gmv, amount);
  }

  res.json({
    ok: true,
    id: r.lastInsertRowid,
    smartLink: branded,
    promoCode: promo,
    platforms: plats,
    status: schedule ? 'scheduled' : 'published',
  });
});

// ================= EARNINGS =================
app.get('/api/earnings', auth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM earnings WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  // base demo figures + live activity from publishes
  const baseGMV = 19800,
    baseCommission = 2475,
    baseWithdrawable = 2480.5,
    baseMonth = 690;
  const liveGMV = rows.reduce((s, r) => s + r.gmv_sar, 0);
  const liveCommission = rows.reduce((s, r) => s + r.amount_sar, 0);
  const settled = rows
    .filter((r) => r.status === 'settled')
    .reduce((s, r) => s + r.amount_sar, 0);
  res.json({
    withdrawableSar: +(baseWithdrawable + settled).toFixed(2),
    totalGmvSar: Math.round(baseGMV + liveGMV),
    totalCommissionSar: Math.round(baseCommission + liveCommission),
    thisMonthSar: Math.round(baseMonth + liveCommission),
    detail: [
      { title: 'Wireless Earbuds · Video #A1', status: 'Settled', amount: 16.1 },
      { title: 'Juicer Cup · Video #B2', status: 'Pending', amount: 7.9 },
      ...rows.map((r) => ({
        title: `${r.product_title} · Video ${r.video_tag}`,
        status: r.status === 'settled' ? 'Settled' : 'Pending',
        amount: r.amount_sar,
      })),
    ],
  });
});

app.post('/api/earnings/withdraw', auth, (req, res) => {
  db.prepare("UPDATE earnings SET status = 'settled' WHERE user_id = ? AND status = 'pending'").run(
    req.user.id
  );
  res.json({ ok: true, message: 'Withdrawal requested to your bank (SAR).' });
});

// ================= AUTHORIZATION & PRIVACY =================
app.get('/api/authorization', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const generated = db.prepare('SELECT COUNT(*) c FROM videos WHERE user_id = ?').get(u.id).c;
  res.json({
    authorized: !!u.portrait_authorized,
    scope: u.portrait_scope,
    eSignDate: u.portrait_authorized_at || '—',
    basis: 'PDPL · e-sign on record',
    generatedCount: generated || 12,
  });
});

app.post('/api/authorization/data-deletion', auth, (req, res) => {
  res.json({
    ok: true,
    message: 'Best-effort deletion queued. Processing window applies (PDPL).',
  });
});

// ---------- JSON error handler (never return HTML to the API client) ----------
app.use('/api', (err, req, res, next) => {
  console.error('[api error]', err.message);
  res.status(500).json({ error: err.message || 'internal error' });
});

// ---------- static frontend ----------
app.use(express.static(join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`\n  DeiNai 2.0 · Saudi Edition`);
  console.log(`  ▸ app:    http://localhost:${PORT}`);
  console.log(`  ▸ board:  http://localhost:${PORT}/board.html\n`);
});
