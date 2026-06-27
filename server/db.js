import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// DB_DIR is overridable (e.g. a mounted volume on the host) for durable storage
const DB_DIR = process.env.DB_DIR || join(__dirname, '..', 'data');
const DB_PATH = join(DB_DIR, 'deinai.db');

mkdirSync(DB_DIR, { recursive: true }); // ensure the directory exists on a fresh deploy

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE,
  name TEXT,
  handle TEXT,
  token TEXT,
  login_code TEXT,
  portrait_authorized INTEGER DEFAULT 0,
  portrait_authorized_at TEXT,
  portrait_scope TEXT DEFAULT 'Shoppable video generation',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS socials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  platform TEXT,
  handle TEXT,
  connected INTEGER DEFAULT 0,
  followers TEXT,
  core_age TEXT,
  top_region TEXT,
  top_interest TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  title_ar TEXT,
  price_sar INTEGER,
  match_pct INTEGER,
  commission_pct REAL,
  category TEXT
);

CREATE TABLE IF NOT EXISTS queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  product_id INTEGER,
  status TEXT DEFAULT 'to_make',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS saved (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  product_id INTEGER
);

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  product_id INTEGER,
  style TEXT DEFAULT 'My Style',
  language TEXT DEFAULT 'Arabic · Gulf',
  hijab_overlay INTEGER DEFAULT 1,
  duration TEXT DEFAULT '30s',
  ratio TEXT DEFAULT '9:16',
  platform TEXT DEFAULT 'TikTok',
  script TEXT,
  status TEXT DEFAULT 'generating',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS publishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  video_id INTEGER,
  platforms TEXT,
  caption TEXT,
  share_link TEXT,
  promo_code TEXT,
  status TEXT DEFAULT 'published',
  scheduled_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS earnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  product_title TEXT,
  video_tag TEXT,
  gmv_sar REAL,
  amount_sar REAL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Smart Link: tracked redirect short link + light landing page
CREATE TABLE IF NOT EXISTS smartlinks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  user_id INTEGER,
  video_id INTEGER,
  product_id INTEGER,
  promo TEXT,
  clicks INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- per-click tracking (records platform source / UTM)
CREATE TABLE IF NOT EXISTS link_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  source TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- creator bio / Linktree configuration (one-time, reused for "not clickable" platforms)
CREATE TABLE IF NOT EXISTS bios (
  user_id INTEGER PRIMARY KEY,
  smart_code TEXT,
  smart_url TEXT,
  configured INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);
`);

// ---- seed products (shared catalog) ----
const productCount = db.prepare('SELECT COUNT(*) c FROM products').get().c;
if (productCount === 0) {
  const ins = db.prepare(
    'INSERT INTO products (title,title_ar,price_sar,match_pct,commission_pct,category) VALUES (?,?,?,?,?,?)'
  );
  [
    ['Wireless Earbuds Pro', 'سماعات لاسلكية Pro', 129, 94, 12.5, 'Electronics'],
    ['Portable Juicer Cup', 'كوب عصير محمول', 79, 88, 10, 'Home'],
    ['Silk Hair Serum', 'سيروم الشعر الحريري', 95, 91, 15, 'Beauty'],
    ['Matte Lip Tint Set', 'طقم أحمر شفاه مط', 65, 89, 18, 'Beauty'],
    ['Smart LED Strip', 'شريط إضاءة ذكي', 49, 82, 9, 'Home'],
    ['Aroma Diffuser', 'موزّع عطر', 110, 86, 11, 'Home'],
  ].forEach((r) => ins.run(...r));
  console.log('[db] seeded products');
}

export default db;
