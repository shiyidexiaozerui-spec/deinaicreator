/* DeiNai 2.0 · Saudi Edition — frontend SPA (talks to the Node + SQLite backend) */
(function () {
  'use strict';

  // ---------------- API layer ----------------
  const TOKEN_KEY = 'deinai_token';
  let token = localStorage.getItem(TOKEN_KEY) || null;

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data });
    return data;
  }

  // ---------------- app state ----------------
  const S = {
    user: null,
    lang: 'en',
    create: { product: null, style: 'My Style', hijab: true, lang: 'Arabic · Gulf', script: '', duration: '30s', ratio: '9:16', platform: 'TikTok' },
    videoId: null,
    publish: { selected: ['tiktok', 'snap'], lang: 'en', smart: null, bio: null, qrOpen: false, schedule: false },
  };

  // ---------------- DOM helpers ----------------
  const screenEl = document.getElementById('screen');
  const tabbarEl = document.getElementById('tabbar');
  const toastEl = document.getElementById('toast');
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.prototype.slice.call(root.querySelectorAll(sel));
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  // ---------------- micro-interaction utilities ----------------
  // haptic (web approximation via Vibration API; silently no-ops if unsupported)
  const HAPTIC = { selection: 8, light: 12, medium: [16, 30, 16], success: [10, 40, 16], warning: [24, 40, 24] };
  function haptic(kind) { try { navigator.vibrate && navigator.vibrate(HAPTIC[kind] || 10); } catch {} }

  // shared-element: fly a small chip from a source element to a target (e.g. the To-Make tab)
  function flyChip(fromEl, toEl, label) {
    if (!fromEl || !toEl) return;
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    const chip = document.createElement('div');
    chip.className = 'flychip';
    chip.textContent = label || '';
    const size = 26;
    chip.style.width = chip.style.height = size + 'px';
    chip.style.left = a.left + a.width / 2 - size / 2 + 'px';
    chip.style.top = a.top + a.height / 2 - size / 2 + 'px';
    chip.style.transition = 'none';
    document.body.appendChild(chip);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    void chip.offsetWidth; // force reflow so the transition runs
    chip.style.transition = 'transform .45s cubic-bezier(.3,0,.2,1), opacity .45s ease';
    chip.style.transform = `translate(${dx}px,${dy}px) scale(.35)`;
    chip.style.opacity = '0.2';
    setTimeout(() => {
      chip.remove();
      toEl.classList.remove('badge-pop'); void toEl.offsetWidth; toEl.classList.add('badge-pop');
    }, 460);
  }

  // animated number roll-up (respects decimals + thousands)
  function countUp(el, to, dur = 700) {
    if (!el) return;
    const from = 0, dec = to % 1 ? (String(to).split('.')[1] || '').length : 0;
    const start = performance.now();
    const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    function frame(now) {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    setTimeout(() => { el.textContent = fmt(to); }, dur + 60); // safety: guarantee final value if rAF is throttled
  }

  // skeleton list (returns markup matching real product card height → zero layout shift)
  function skeletonCards(n) {
    let s = '';
    for (let i = 0; i < n; i++) {
      s += `<div class="sk-card"><div style="display:flex;gap:13px;">
        <div class="sk" style="width:92px;height:92px;border-radius:12px;flex:none;"></div>
        <div style="flex:1;"><div class="sk" style="height:16px;width:70%;"></div>
        <div class="sk" style="height:18px;width:40%;margin-top:10px;"></div>
        <div class="sk" style="height:22px;width:80%;margin-top:12px;border-radius:999px;"></div></div></div>
        <div class="sk" style="height:46px;margin-top:13px;border-radius:12px;"></div></div>`;
    }
    return s;
  }

  // bottom smart aggregation pill (Discover → Create bridge)
  const smart = {
    el: null,
    show(count, highValue) {
      let el = document.getElementById('smartpill');
      if (!el) {
        el = document.createElement('div');
        el.id = 'smartpill'; el.className = 'smartpill';
        document.getElementById('phone').appendChild(el);
      }
      const lead = highValue ? '✨ High-potential item ready' : `✨ ${count} item${count > 1 ? 's' : ''} ready`;
      el.innerHTML = `<div class="sp-txt">${lead}<small>${count} in your To-Make queue</small></div>
        <button class="sp-go">Start creating →</button><button class="sp-x" aria-label="dismiss">×</button>`;
      el.querySelector('.sp-go').onclick = () => { smart.hide(); openCreate(); };
      el.querySelector('.sp-x').onclick = () => smart.hide();
      void el.offsetWidth; el.classList.add('show'); // force reflow → reliable transition (rAF throttles when backgrounded)
    },
    hide() { const el = document.getElementById('smartpill'); if (el) el.classList.remove('show'); },
    remove() { const el = document.getElementById('smartpill'); if (el) el.remove(); },
  };

  // ---------------- router ----------------
  const SCREENS = {};
  let current = null;
  function go(name, opts) {
    // clean transient overlays (smart pill, coach tip) on any navigation
    smart.remove();
    const coach = document.getElementById('coachtip'); if (coach) coach.remove();
    current = name;
    const def = SCREENS[name];
    screenEl.dir = name === 'discover' && S.lang === 'ar' ? 'rtl' : 'ltr';
    screenEl.innerHTML = def.html(opts);
    setTabbar(def.tab);
    if (def.init) def.init(opts);
    screenEl.scrollTop = 0;
  }

  function setTabbar(active) {
    if (!active) { tabbarEl.hidden = true; return; }
    tabbarEl.hidden = false;
    const ar = S.lang === 'ar';
    const tabs = [
      { id: 'discover', en: 'Discover', ar: 'اكتشف' },
      { id: 'create', en: 'Create', ar: 'إنشاء' },
      { id: 'earnings', en: 'Earnings', ar: 'الأرباح' },
      { id: 'me', en: 'Me', ar: 'حسابي' },
    ];
    tabbarEl.dir = ar && active === 'discover' ? 'rtl' : 'ltr';
    tabbarEl.innerHTML = tabs.map((t) =>
      `<button class="tab ${t.id === active ? 'on' : ''}" data-tab="${t.id}"><span class="dot"></span><span class="lbl">${ar ? t.ar : t.en}</span></button>`
    ).join('');
    $$('.tab', tabbarEl).forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.tab;
      haptic('selection');
      if (id === 'discover') go('discover');
      else if (id === 'create') openCreate();
      else if (id === 'earnings') go('earnings');
      else if (id === 'me') go('privacy');
    }));
  }

  const header = (title, onBack) =>
    `<div style="flex:none;padding:4px 22px 12px;display:flex;align-items:center;gap:14px;">
      <button class="back" ${onBack ? 'data-back' : ''}>‹</button>
      <span class="h-title">${title}</span>
    </div>`;

  // ===========================================================
  // 01 · SIGN UP
  // ===========================================================
  SCREENS.signup = {
    tab: null,
    html: () => `
      <div class="scroll" style="padding:40px 28px 24px;display:flex;flex-direction:column;">
        <img src="logo.png" alt="DeiNai" style="height:50px;width:auto;align-self:flex-start;">
        <div style="font:800 28px/1.3 'Plus Jakarta Sans';color:var(--ink);margin-top:36px;">Join the Creator<br>Commerce Program</div>
        <div style="font:500 14px/1.6 'Plus Jakarta Sans';color:var(--muted);margin-top:12px;">Turn products into your own-style videos with AI — publish and earn commission.</div>
        <div style="display:flex;gap:8px;margin-top:30px;background:#F4F4F6;padding:4px;border-radius:12px;">
          <div class="seg-tab on" style="flex:1;text-align:center;padding:10px;border-radius:9px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.06);font:700 14px/1 'Plus Jakarta Sans';">Phone</div>
          <div class="seg-tab" style="flex:1;text-align:center;padding:10px;border-radius:9px;font:500 14px/1 'Plus Jakarta Sans';color:var(--faint);">Email</div>
        </div>
        <div style="margin-top:16px;display:flex;align-items:center;border:1.5px solid var(--line2);border-radius:12px;padding:0 14px;height:52px;">
          <span style="font:700 14px/1 'Plus Jakarta Sans';padding-right:12px;border-right:1px solid var(--line2);">+966</span>
          <input id="phoneNum" class="input" style="border:0;height:auto;padding-left:12px;flex:1;" inputmode="numeric" placeholder="5X XXX XXXX" value="551234567">
        </div>
        <div style="margin-top:12px;display:flex;gap:10px;">
          <input id="code" class="input" style="flex:1;" inputmode="numeric" placeholder="Enter code">
          <button id="getcode" style="width:108px;border:1.5px solid var(--line2);border-radius:12px;font:700 13px/1 'Plus Jakarta Sans';color:var(--ink);background:#fff;cursor:pointer;">Get code</button>
        </div>
        <div style="margin-top:14px;display:flex;align-items:flex-start;gap:9px;">
          <div id="agree" class="cbx tap" style="width:18px;height:18px;border-radius:5px;background:var(--green);flex:none;margin-top:1px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;">✓</div>
          <div style="font:500 12px/1.6 'Plus Jakarta Sans';color:var(--muted);">I agree to the <b style="color:var(--ink);">Terms</b> &amp; <b style="color:var(--ink);">Privacy Policy</b> (incl. PDPL).</div>
        </div>
        <button id="login" class="btn btn-dark" style="margin-top:18px;">Log in / Sign up</button>
        <div style="margin-top:18px;text-align:center;font:500 12px/1 'Plus Jakarta Sans';color:#B2B2BA;">or quick sign-in</div>
        <div style="margin-top:13px;display:flex;justify-content:center;gap:14px;">
          <div style="width:46px;height:46px;border-radius:12px;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;font:800 12px 'Plus Jakarta Sans';">TT</div>
          <div style="width:46px;height:46px;border-radius:12px;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;font:800 12px 'Plus Jakarta Sans';">IG</div>
        </div>
      </div>
      <div style="flex:none;padding:16px 24px 22px;border-top:1px solid #F4F4F6;display:flex;">
        ${stepDots(1)}
      </div>`,
    init() {
      let agreed = true;
      $('#agree').addEventListener('click', () => {
        agreed = !agreed;
        $('#agree').style.background = agreed ? 'var(--green)' : '#fff';
        $('#agree').style.border = agreed ? '0' : '1.5px solid #C9C9CF';
        $('#agree').textContent = agreed ? '✓' : '';
      });
      $('#getcode').addEventListener('click', async () => {
        const btn = $('#getcode'); if (btn.dataset.busy) return;
        const phone = '+966' + $('#phoneNum').value.replace(/\s/g, '');
        btn.dataset.busy = '1'; const label = btn.textContent; btn.innerHTML = '<span class="spinner"></span>';
        haptic('light');
        try {
          const r = await api('/auth/request-code', { method: 'POST', body: { phone } });
          $('#code').value = r.devCode; // dev mode auto-fill
          btn.textContent = 'Sent ✓';
          toast('Code sent — auto-filled: ' + r.devCode);
          setTimeout(() => { btn.textContent = label; delete btn.dataset.busy; }, 1600);
        } catch (e) { btn.textContent = label; delete btn.dataset.busy; haptic('warning'); toast('Could not send code'); }
      });
      $('#login').addEventListener('click', async () => {
        if (!agreed) return toast('Please accept Terms & Privacy');
        const phone = '+966' + $('#phoneNum').value.replace(/\s/g, '');
        const code = $('#code').value.trim();
        if (!code) return toast('Tap “Get code” first');
        try {
          const r = await api('/auth/verify', { method: 'POST', body: { phone, code } });
          token = r.token; localStorage.setItem(TOKEN_KEY, token); S.user = r.user;
          toast('Welcome, ' + r.user.name);
          go('portrait');
        } catch (e) { toast('Invalid code'); }
      });
    },
  };

  function stepDots(active) {
    const steps = ['Sign up', 'Verify', 'Authorize', 'Connect'];
    return steps.map((s, i) => {
      const on = i + 1 <= active;
      return `<div style="flex:1;text-align:center;">
        <div style="width:24px;height:24px;border-radius:50%;background:${on ? 'var(--green)' : '#EFEFF1'};color:${on ? '#fff' : '#B2B2BA'};font:800 12px/24px 'Plus Jakarta Sans';margin:0 auto;">${i + 1}</div>
        <div style="font:${on ? 700 : 600} 9px/1.3 'Plus Jakarta Sans';color:${on ? 'var(--green)' : '#B2B2BA'};margin-top:5px;">${s}</div>
      </div>`;
    }).join('');
  }

  // ===========================================================
  // 02 · PORTRAIT AUTHORIZATION
  // ===========================================================
  SCREENS.portrait = {
    tab: null,
    html: () => `
      ${header('Face capture & authorization', false)}
      <div style="flex:none;padding:0 22px 6px;">
        <div class="progress"><i style="width:62%"></i></div>
        <div style="font:500 11px/1 'Plus Jakarta Sans';color:var(--faint);margin-top:8px;">Step 3 of 4 · used to generate your own-style videos</div>
      </div>
      <div class="scroll" style="padding:10px 22px 16px;">
        <div style="background:var(--ink);border-radius:20px;padding:24px;display:flex;flex-direction:column;align-items:center;position:relative;overflow:hidden;">
          <div style="position:absolute;top:14px;left:16px;font:600 11px/1 'Plus Jakarta Sans';color:#9AA0AA;">Live capture</div>
          <div style="position:absolute;top:14px;right:16px;display:flex;align-items:center;gap:5px;font:600 11px/1 'Plus Jakarta Sans';color:#5FD79E;"><span style="width:7px;height:7px;border-radius:50%;background:#5FD79E;"></span>Good lighting</div>
          <div style="position:relative;width:144px;height:144px;border-radius:50%;border:3px dashed #5FD79E;display:flex;align-items:center;justify-content:center;margin-top:12px;background:#23262E;">
            <svg width="70" height="70" viewBox="0 0 24 24" fill="none" stroke="#6A6F79" stroke-width="1.5"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 3.5-6 8-6s8 2 8 6"></path></svg>
            <div class="scanwrap"><div class="scanline"></div></div>
          </div>
          <div style="font:600 13px/1.5 'Plus Jakarta Sans';color:#E7E7EA;margin-top:16px;text-align:center;">Center your face and slowly turn your head for multi-angle capture</div>
        </div>
        <div id="angles" style="display:flex;gap:9px;margin-top:14px;"></div>
        <div style="margin-top:14px;background:#fff;border-radius:16px;padding:16px 18px;border:1px solid var(--line);">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font:800 14px/1 'Plus Jakarta Sans';">Portrait AI Usage Authorization</span>
            <span style="font:700 10px/1 'Plus Jakarta Sans';color:#C2611C;background:#FBEAD9;padding:4px 8px;border-radius:999px;">Required</span>
          </div>
          <div style="font:500 12px/1.7 'Plus Jakarta Sans';color:var(--muted);margin-top:9px;">Authorize fine-tuning of your private style model for shoppable videos. PDPL-compliant and <b style="color:var(--ink);">revocable anytime</b>.</div>
          <div style="margin-top:12px;display:flex;align-items:center;gap:9px;">
            <div id="esign" class="cbx tap" style="width:18px;height:18px;border-radius:5px;border:1.5px solid #C9C9CF;flex:none;"></div>
            <div style="font:500 12px/1.4 'Plus Jakarta Sans';color:#3C3C44;">I have read and agree to e-sign</div>
          </div>
        </div>
      </div>
      <div class="cta-wrap"><button id="finish" class="btn btn-dark" disabled>Finish capture &amp; e-sign</button></div>`,
    init() {
      const angles = [
        { k: 'Front', s: 'pending' }, { k: 'Left', s: 'pending' },
        { k: 'Right', s: 'pending' }, { k: 'Smile', s: 'pending' },
      ];
      let esigned = false, captured = 0;
      const renderAngles = () => {
        $('#angles').innerHTML = angles.map((a) => {
          const done = a.s === 'passed', cap = a.s === 'capturing';
          const bd = done ? '#C5E6D3' : cap ? 'var(--green)' : 'var(--line2)';
          const bg = cap ? 'var(--green-soft)' : '#fff';
          const col = done || cap ? 'var(--green)' : '#B2B2BA';
          const sub = done ? 'Passed' : cap ? 'Capturing' : 'Pending';
          return `<div style="flex:1;border:1.5px solid ${bd};border-radius:12px;padding:11px 6px;text-align:center;background:${bg};"><div style="font:700 13px/1 'Plus Jakarta Sans';color:${col};">${a.k}${done ? ' ✓' : ''}</div><div style="font:500 10px/1 'Plus Jakarta Sans';color:${col === '#B2B2BA' ? '#C9C9CF' : 'var(--green-ink)'};margin-top:5px;">${sub}</div></div>`;
        }).join('');
      };
      renderAngles();
      // auto-capture sequence
      const seq = setInterval(() => {
        if (captured >= angles.length) { clearInterval(seq); return; }
        if (captured > 0) { angles[captured - 1].s = 'passed'; haptic('selection'); }
        angles[captured].s = 'capturing';
        renderAngles();
        captured++;
        if (captured === angles.length) {
          setTimeout(() => { angles[angles.length - 1].s = 'passed'; renderAngles(); updateBtn(); }, 700);
        }
        updateBtn();
      }, 800);
      const allPassed = () => angles.every((a) => a.s === 'passed');
      function updateBtn() { $('#finish').disabled = !(allPassed() && esigned); }
      $('#esign').addEventListener('click', () => {
        esigned = !esigned;
        $('#esign').style.background = esigned ? 'var(--green)' : '#fff';
        $('#esign').style.border = esigned ? '0' : '1.5px solid #C9C9CF';
        $('#esign').innerHTML = esigned ? '<span style="color:#fff;font-size:11px;display:block;text-align:center;line-height:18px;">✓</span>' : '';
        updateBtn();
      });
      $('#finish').addEventListener('click', async () => {
        haptic('medium');
        try { await api('/portrait/authorize', { method: 'POST' }); haptic('success'); toast('Portrait authorized · e-signed'); go('connect'); }
        catch (e) { haptic('warning'); toast('Authorization failed'); }
      });
    },
  };

  // ===========================================================
  // 03 · CONNECT SOCIAL
  // ===========================================================
  SCREENS.connect = {
    tab: null,
    html: () => `
      ${header('Connect social media', false)}
      <div style="flex:none;padding:0 22px 10px;"><div style="font:500 13px/1.6 'Plus Jakarta Sans';color:var(--muted);">Read-only OAuth to fetch real follower insights for better product matching. Connect at least 1.</div></div>
      <div class="scroll" id="sociallist" style="padding:4px 22px;"></div>
      <div class="cta-wrap"><button id="done" class="btn btn-dark" disabled>Done — start picking</button></div>`,
    init() { loadSocials(); },
  };
  async function loadSocials() {
    const box = $('#sociallist');
    if (box && !box.children.length) {
      box.innerHTML = `<div class="sk" style="height:84px;border-radius:16px;margin-bottom:14px;"></div>
        <div class="sk" style="height:84px;border-radius:16px;margin-bottom:14px;"></div>`;
    }
    const list = await api('/socials');
    const icon = (p) => p === 'TikTok'
      ? `<div style="width:42px;height:42px;border-radius:12px;background:var(--ink);display:flex;align-items:center;justify-content:center;color:#fff;font:800 14px 'Plus Jakarta Sans';">TT</div>`
      : `<div style="width:42px;height:42px;border-radius:12px;background:linear-gradient(45deg,#F58529,#DD2A7B,#8134AF);display:flex;align-items:center;justify-content:center;color:#fff;font:800 14px 'Plus Jakarta Sans';">IG</div>`;
    const card = (s) => s.connected
      ? `<div style="border:1.5px solid #C5E6D3;border-radius:16px;padding:16px 18px;margin-bottom:14px;">
          <div style="display:flex;align-items:center;gap:12px;">${icon(s.platform)}<div style="flex:1;"><div style="font:800 15px/1 'Plus Jakarta Sans';">${s.platform}</div><div style="font:500 11px/1 'Plus Jakarta Sans';color:var(--green);margin-top:5px;">Connected · ${s.handle}</div></div><div class="pill pill-green">Connected</div></div>
          <div style="margin-top:14px;display:flex;gap:8px;padding-top:14px;border-top:1px solid #F4F4F6;">
            ${stat(s.followers, 'Followers')}${stat(s.core_age, 'Core age')}${stat(s.top_region, 'Top region')}${stat(s.top_interest, 'Top interest')}
          </div></div>`
      : `<div style="border:1.5px solid var(--line2);border-radius:16px;padding:16px 18px;margin-bottom:14px;display:flex;align-items:center;gap:12px;">${icon(s.platform)}<div style="flex:1;"><div style="font:800 15px/1 'Plus Jakarta Sans';">${s.platform}</div><div style="font:500 11px/1 'Plus Jakarta Sans';color:var(--faint);margin-top:5px;">Not connected · official OAuth</div></div><button class="connect-btn" data-p="${s.platform}" style="font:700 12px/1 'Plus Jakarta Sans';color:#fff;background:var(--ink);padding:9px 18px;border-radius:999px;border:0;cursor:pointer;">Connect</button></div>`;
    const stat = (v, l) => `<div style="flex:1;"><div style="font:800 ${String(v).length > 4 ? 14 : 18}px/1.2 'Plus Jakarta Sans';">${v}</div><div style="font:500 10px/1.2 'Plus Jakarta Sans';color:var(--faint);margin-top:4px;">${l}</div></div>`;
    $('#sociallist').innerHTML = list.map(card).join('') +
      `<div style="margin-top:0;border:1.5px solid var(--line2);border-radius:16px;padding:16px 18px;display:flex;align-items:center;gap:12px;"><div style="width:42px;height:42px;border-radius:12px;background:#F4F4F6;display:flex;align-items:center;justify-content:center;color:var(--faint);font:800 18px 'Plus Jakarta Sans';">+</div><div style="flex:1;"><div style="font:800 15px/1 'Plus Jakarta Sans';">Other platforms</div><div style="font:500 11px/1 'Plus Jakarta Sans';color:var(--faint);margin-top:5px;">YouTube / Snapchat, etc.</div></div><div style="font:700 12px/1 'Plus Jakarta Sans';">Add ›</div></div>
      <div style="margin-top:16px;display:flex;align-items:flex-start;gap:8px;background:var(--green-soft);border-radius:12px;padding:13px 14px;"><span style="color:var(--green);font-weight:800;">ⓘ</span><div style="font:500 12px/1.6 'Plus Jakarta Sans';color:var(--green-ink);">We only fetch read-only aggregated insights — never post or read your DMs. Re-auth when the token expires.</div></div>`;
    const connectedCount = list.filter((s) => s.connected).length;
    $('#done').disabled = connectedCount === 0;
    $$('.connect-btn').forEach((b) => b.addEventListener('click', async () => {
      b.innerHTML = '<span class="spinner" style="border-color:rgba(255,255,255,.4);border-top-color:#fff;"></span>'; haptic('light');
      try { await api(`/socials/${b.dataset.p}/connect`, { method: 'POST' }); haptic('success'); toast(b.dataset.p + ' connected'); loadSocials(); }
      catch (e) { haptic('warning'); toast('Connect failed'); b.textContent = 'Connect'; }
    }));
    $('#done').addEventListener('click', () => go('discover'));
  }

  // ===========================================================
  // 04 · DISCOVER  (EN / العربية)
  // ===========================================================
  SCREENS.discover = {
    tab: 'discover',
    html: () => {
      const ar = S.lang === 'ar';
      const t = ar ? { title: 'اكتشف', search: 'ابحث عن منتج / فئة', filter: 'تصفية', foryou: 'لك', tomake: 'قيد الإنتاج', saved: 'المحفوظات' }
                   : { title: 'Discover', search: 'Search products / category', filter: 'Filter', foryou: 'For You', tomake: 'To Make', saved: 'Saved' };
      return `
      <div style="flex:none;padding:4px 22px 10px;display:flex;align-items:center;justify-content:space-between;">
        <svg width="34" height="22" viewBox="0 0 46 30" fill="none"><circle cx="16" cy="15" r="11" stroke="#141414" stroke-width="4.4"></circle><circle cx="30" cy="15" r="11" stroke="#141414" stroke-width="4.4"></circle></svg>
        <div class="lang-toggle" style="display:flex;align-items:center;gap:2px;background:#EEF3F0;padding:3px;border-radius:999px;">
          <span class="lp ${!ar ? 'on' : ''}" data-l="en" style="font:700 12px/1 'Plus Jakarta Sans';padding:6px 13px;border-radius:999px;cursor:pointer;background:${!ar ? 'var(--green)' : 'transparent'};color:${!ar ? '#fff' : 'var(--faint)'};">EN</span>
          <span class="lp ${ar ? 'on' : ''}" data-l="ar" style="font:700 12px/1 'Noto Sans Arabic';padding:6px 13px;border-radius:999px;cursor:pointer;background:${ar ? 'var(--green)' : 'transparent'};color:${ar ? '#fff' : 'var(--faint)'};">العربية</span>
        </div>
      </div>
      <div style="flex:none;padding:0 22px 12px;">
        <div style="font:800 22px/1 'Plus Jakarta Sans';">${t.title}</div>
        <div style="display:flex;gap:10px;margin-top:14px;">
          <div style="flex:1;display:flex;align-items:center;border:1.5px solid var(--line);border-radius:12px;height:46px;padding:0 14px;">
            <input id="search" class="input" style="border:0;height:auto;padding:0;font-size:13px;" placeholder="${t.search}">
          </div>
          <div style="padding:0 16px;display:flex;align-items:center;justify-content:center;background:var(--green-soft);border-radius:12px;font:700 13px/1 'Plus Jakarta Sans';color:var(--green);">${t.filter}</div>
        </div>
        <div style="display:flex;gap:22px;margin-top:16px;border-bottom:1px solid #F0F0F2;">
          <div style="padding-bottom:10px;border-bottom:2.5px solid var(--green);font:800 14px/1 'Plus Jakarta Sans';">${t.foryou}</div>
          <div style="padding-bottom:10px;font:500 14px/1 'Plus Jakarta Sans';color:var(--faint);">${t.tomake} <span id="qcount" style="font:700 10px 'Plus Jakarta Sans';color:#fff;background:var(--green);padding:1px 6px;border-radius:999px;">0</span></div>
          <div style="padding-bottom:10px;font:500 14px/1 'Plus Jakarta Sans';color:var(--faint);">${t.saved}</div>
        </div>
      </div>
      <div class="scroll" id="productlist" style="padding:14px 22px;"></div>`;
    },
    init() {
      loadProducts('');
      refreshQueueCount();
      $$('.lp').forEach((p) => p.addEventListener('click', () => { S.lang = p.dataset.l; go('discover'); }));
      let timer;
      $('#search').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => loadProducts(e.target.value), 200); });
    },
  };

  async function refreshQueueCount() {
    try {
      const q = await api('/queue');
      const el = $('#qcount'); if (el) el.textContent = q.length;
      // returning to Discover with items already queued → keep the bridge visible
      if (q.length && current === 'discover') smart.show(q.length, false);
    } catch {}
  }

  // first-time coaching near the To-Make tab (shown once per device)
  function maybeCoachToMake() {
    if (localStorage.getItem('deinai_coach_tomake')) return;
    const phone = document.getElementById('phone');
    const anchor = $('#qcount'); if (!anchor || !phone) return;
    const pr = phone.getBoundingClientRect(), r = anchor.getBoundingClientRect();
    const left = Math.max(16, r.left - pr.left - 24);
    const c = document.createElement('div');
    c.id = 'coachtip'; c.className = 'coach';
    c.style.left = left + 'px';
    c.style.top = r.bottom - pr.top + 12 + 'px';
    c.textContent = S.lang === 'ar'
      ? 'قائمتك تكبر — اضغط "قيد الإنتاج" عندما تكون جاهزًا.'
      : 'Your queue is building. Tap “To Make” when you’re ready.';
    // arrow pointing up toward the badge
    c.insertAdjacentHTML('beforeend', `<i style="left:${Math.min(180, r.left - pr.left - left)}px"></i>`);
    phone.appendChild(c);
    void c.offsetWidth; c.classList.add('show');
    localStorage.setItem('deinai_coach_tomake', '1');
    setTimeout(() => { c.classList.remove('show'); setTimeout(() => c.remove(), 300); }, 4200);
  }

  async function loadProducts(q) {
    const ar = S.lang === 'ar';
    const list = $('#productlist'); if (!list) return;
    list.innerHTML = skeletonCards(3); // skeleton first → no layout shift
    let products;
    try { products = await api('/products?q=' + encodeURIComponent(q || '')); }
    catch (e) {
      list.innerHTML = `<div style="text-align:center;padding:40px 20px;">
        <div style="font:700 14px/1.5 'Plus Jakarta Sans';color:var(--ink);">${ar ? 'تعذّر الاتصال' : 'Connection lost'}</div>
        <button id="retry" class="btn btn-dark" style="margin-top:14px;height:44px;">${ar ? 'إعادة المحاولة' : 'Retry'}</button></div>`;
      $('#retry').onclick = () => loadProducts(q);
      return;
    }
    if (!products.length) {
      list.innerHTML = `<div class="fade-up" style="text-align:center;padding:50px 24px;">
        <svg width="46" height="30" viewBox="0 0 46 30" fill="none" style="opacity:.25;"><circle cx="16" cy="15" r="11" stroke="#141414" stroke-width="4.4"/><circle cx="30" cy="15" r="11" stroke="#141414" stroke-width="4.4"/></svg>
        <div style="font:700 15px/1.5 'Plus Jakarta Sans';color:var(--ink);margin-top:18px;">${ar ? 'لا نتائج' : 'No matches found'}</div>
        <div style="font:500 13px/1.6 'Plus Jakarta Sans';color:var(--muted);margin-top:8px;">${ar ? 'جرّب كلمة أخرى' : 'Try a different keyword or category'}</div></div>`;
      return;
    }
    list.innerHTML = products.map((p) => {
      const title = ar ? p.title_ar : p.title;
      const hv = p.commission_pct >= 15 && p.match_pct >= 90;
      return `<div class="pcard fade-up" style="margin-bottom:14px;border:1px solid var(--line);border-radius:18px;padding:14px;">
        <div style="display:flex;gap:13px;">
          <div class="pimg" style="width:92px;height:92px;border-radius:12px;background:#E2DBD5;flex:none;display:flex;align-items:center;justify-content:center;font:500 11px/1 'Plus Jakarta Sans';color:#A99F95;">${ar ? 'صورة' : 'Image'}</div>
          <div style="flex:1;min-width:0;">
            ${hv ? `<span class="hv-flag" style="margin-bottom:7px;">✦ ${ar ? 'فرصة عالية' : 'High-yield match'}</span>` : ''}
            <div style="font:800 15px/1.4 'Plus Jakarta Sans';${hv ? 'margin-top:2px;' : ''}">${title}</div>
            <div style="font:800 16px/1 'Plus Jakarta Sans';color:var(--indigo);margin-top:8px;">SAR ${p.price_sar}</div>
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
              <span class="pill pill-green">${ar ? 'مطابقة' : 'Match'} ${p.match_pct}%</span>
              <span class="pill pill-violet">${ar ? 'عمولة' : 'Commission'} ${p.commission_pct}%</span>
            </div>
          </div>
        </div>
        <button class="btn btn-dark addq" data-id="${p.id}" data-hv="${hv ? 1 : 0}" style="margin-top:13px;height:46px;font-size:14px;">${ar ? 'أضِف إلى القائمة' : 'Add to queue'}</button>
        <button class="makenow" data-id="${p.id}">${ar ? 'أنشئ الآن →' : 'Make now →'}</button>
      </div>`;
    }).join('');

    $$('.addq', list).forEach((b) => b.addEventListener('click', async () => {
      if (b.classList.contains('added')) return;
      try {
        const r = await api('/queue', { method: 'POST', body: { productId: +b.dataset.id } });
        const highValue = b.dataset.hv === '1';
        haptic('success');
        // morph button
        b.classList.add('added');
        b.textContent = ar ? 'أُضيف ✓' : 'Added ✓';
        // shared-element: fly thumbnail → To-Make badge, then bump count
        const card = b.closest('.pcard');
        flyChip(card.querySelector('.pimg'), $('#qcount'), '');
        setTimeout(() => { const el = $('#qcount'); if (el) el.textContent = r.queueCount; }, 300);
        // grow the "Make now →" shortcut
        const mk = card.querySelector('.makenow'); if (mk) mk.classList.add('show');
        // bottom smart bridge
        smart.show(r.queueCount, highValue);
        // one-time coaching
        maybeCoachToMake();
      } catch (e) { haptic('warning'); toast('Failed'); }
    }));

    $$('.makenow', list).forEach((b) => b.addEventListener('click', () => {
      haptic('light'); smart.hide(); openCreate(+b.dataset.id);
    }));
  }

  // ===========================================================
  // 05 · CREATE STUDIO
  // ===========================================================
  async function openCreate(productId) {
    // prefer an explicit product (Make now →), else most-recent queued, else first product
    try {
      const q = await api('/queue');
      if (productId) {
        S.create.product = q.find((p) => p.id === productId) || (await api('/products')).find((p) => p.id === productId);
      } else if (q.length) S.create.product = q[0];
      else { const ps = await api('/products'); S.create.product = ps[0]; }
      if (!S.create.script) {
        const r = await api('/videos/regenerate-script', { method: 'POST' });
        S.create.script = r.script;
      }
      go('create');
    } catch (e) { toast('Open Create failed'); }
  }

  SCREENS.create = {
    tab: 'create',
    html: () => {
      const p = S.create.product || {};
      const c = S.create;
      return `
      <div style="flex:none;padding:4px 22px 12px;display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:14px;"><button class="back" data-back>‹</button><span class="h-title">Create Studio</span></div>
        <span style="font:600 11px/1 'Plus Jakarta Sans';color:var(--faint);background:#F4F4F6;padding:6px 11px;border-radius:999px;">Draft · autosaved</span>
      </div>
      <div class="scroll" style="padding:4px 22px;">
        <div style="border-radius:14px;padding:10px;display:flex;align-items:center;gap:10px;border:1px solid var(--line);">
          <div style="width:46px;height:46px;border-radius:10px;background:#E2DBD5;flex:none;"></div>
          <div style="flex:1;"><div style="font:800 13px/1.2 'Plus Jakarta Sans';">${p.title || '—'}</div><div style="font:500 10px/1 'Plus Jakarta Sans';color:var(--green);margin-top:5px;">Commission ${p.commission_pct || '—'}% · Match ${p.match_pct || '—'}%</div></div>
          <button class="back" id="changeprod" style="font:700 11px/1 'Plus Jakarta Sans';">Change ›</button>
        </div>

        <div style="font:800 13px/1 'Plus Jakarta Sans';margin-top:16px;">Style / Template</div>
        <div id="styles" style="display:flex;gap:9px;margin-top:10px;">
          ${styleChip('My Style', 'private · default', c.style === 'My Style')}
          ${styleChip('Unboxing', 'template', c.style === 'Unboxing')}
          ${styleChip('Lifestyle', 'template', c.style === 'Lifestyle')}
        </div>

        <div style="font:800 13px/1 'Plus Jakarta Sans';margin-top:16px;">Localization <span style="font:500 10px 'Plus Jakarta Sans';color:var(--faint);">· default for Saudi</span></div>
        <div style="margin-top:10px;border-radius:14px;border:1px solid var(--line);overflow:hidden;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 16px;">
            <span style="font:600 13px/1 'Plus Jakarta Sans';color:#3C3C44;">Hijab overlay</span>
            <div id="hijab" class="switch ${c.hijab ? 'on' : ''}"><i></i></div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-top:1px solid #F4F4F6;">
            <span style="font:600 13px/1 'Plus Jakarta Sans';color:#3C3C44;">Language / Accent</span>
            <span style="font:700 12px/1 'Plus Jakarta Sans';">${c.lang} ›</span>
          </div>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:16px;">
          <span style="font:800 13px/1 'Plus Jakarta Sans';">Script</span>
          <button id="regen" class="pill pill-green tap" style="border:0;cursor:pointer;"><span id="regenicon" style="display:inline-block;transition:transform .5s var(--e-standard);">✦</span> Regenerate</button>
        </div>
        <div style="margin-top:10px;border-radius:14px;border:1px solid var(--line);padding:13px 15px;font:500 12px/1.7 'Plus Jakarta Sans';color:#3C3C44;">
          <span id="script">${c.script}</span> <span style="color:#B2B2BA;">(editable)</span>
          <div style="margin-top:8px;display:flex;gap:8px;"><span style="font:700 9px/1 'Plus Jakarta Sans';color:var(--green);background:var(--green-soft);padding:4px 8px;border-radius:6px;">✓ Safe-word check</span><span style="font:600 9px/1 'Plus Jakarta Sans';color:var(--muted);background:#F4F4F6;padding:4px 8px;border-radius:6px;">+ Insert B-roll</span></div>
        </div>

        <div style="display:flex;gap:9px;margin-top:14px;">
          ${specBox('Duration', c.duration)}${specBox('Ratio', c.ratio)}${specBox('Platform', c.platform)}
        </div>
      </div>
      <div style="flex:none;padding:12px 22px 30px;border-top:1px solid #F4F4F6;">
        <div style="font:500 10px/1.4 'Plus Jakarta Sans';color:var(--faint);text-align:center;margin-bottom:8px;">Final videos auto-tagged "AI-generated" (compliance)</div>
        <button id="generate" class="btn btn-dark">✦ Generate video (≈2 min)</button>
      </div>`;
    },
    init() {
      $$('#styles .stylechip').forEach((c) => c.addEventListener('click', () => {
        haptic('selection'); S.create.style = c.dataset.style; go('create');
      }));
      $('#hijab').addEventListener('click', () => { haptic('selection'); S.create.hijab = !S.create.hijab; $('#hijab').classList.toggle('on'); });
      $('#changeprod').addEventListener('click', () => go('discover'));
      let spin = 0;
      $('#regen').addEventListener('click', async () => {
        haptic('light');
        const icon = $('#regenicon'); spin += 360; if (icon) icon.style.transform = `rotate(${spin}deg)`;
        const scriptEl = $('#script'); scriptEl.style.opacity = '.4';
        try {
          const r = await api('/videos/regenerate-script', { method: 'POST' });
          S.create.script = r.script; scriptEl.textContent = r.script; toast('New script generated ✦');
        } finally { scriptEl.style.transition = 'opacity .3s'; scriptEl.style.opacity = '1'; }
      });
      $('#generate').addEventListener('click', () => {
        if (!S.create.product || !S.create.product.id) { haptic('warning'); toast('Pick a product in Discover first'); return go('discover'); }
        haptic('medium'); generateVideo();
      });
    },
  };
  const styleChip = (name, sub, on) =>
    `<div class="stylechip tap" data-style="${name}" style="flex:1;border:1.5px solid ${on ? 'var(--green)' : 'var(--line2)'};background:${on ? 'var(--green-soft)' : '#fff'};border-radius:12px;padding:11px;text-align:center;"><div style="font:700 12px/1 'Plus Jakarta Sans';color:${on ? 'var(--green)' : '#3C3C44'};">${name}</div><div style="font:500 9px/1.3 'Plus Jakarta Sans';color:${on ? 'var(--green-ink)' : 'var(--faint)'};margin-top:5px;">${sub}</div></div>`;
  const specBox = (l, v) =>
    `<div style="flex:1;border:1px solid var(--line);border-radius:10px;padding:9px;text-align:center;"><div style="font:500 9px/1 'Plus Jakarta Sans';color:var(--faint);">${l}</div><div style="font:800 12px/1 'Plus Jakarta Sans';margin-top:5px;">${v}</div></div>`;

  async function generateVideo() {
    const c = S.create;
    try {
      const r = await api('/videos', { method: 'POST', body: {
        productId: c.product.id, style: c.style, language: c.lang, hijab: c.hijab,
        duration: c.duration, ratio: c.ratio, platform: c.platform, script: c.script,
      }});
      S.videoId = r.id;
      go('generating');
    } catch (e) {
      if (e.status === 403) { toast('Portrait authorization required'); go('portrait'); }
      else toast('Generation failed');
    }
  }

  // ---- generating overlay screen ----
  SCREENS.generating = {
    tab: null,
    html: () => `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;text-align:center;">
        <div style="width:120px;height:120px;border-radius:50%;background:var(--green-soft);display:flex;align-items:center;justify-content:center;">
          <div class="spinner" style="width:46px;height:46px;border-width:5px;border-color:rgba(30,138,90,.25);border-top-color:var(--green);"></div>
        </div>
        <div style="font:800 20px/1.3 'Plus Jakarta Sans';margin-top:30px;">Generating your video</div>
        <div style="font:500 13px/1.6 'Plus Jakarta Sans';color:var(--muted);margin-top:10px;max-width:260px;">Fine-tuning your private style model and rendering a 9:16 shoppable clip…</div>
        <div class="progress" style="width:220px;margin-top:24px;"><i id="genbar" style="width:8%"></i></div>
        <div id="genstatus" style="font:600 12px/1 'Plus Jakarta Sans';color:var(--faint);margin-top:12px;">Rendering…</div>
      </div>`,
    init() {
      const bar = $('#genbar'); let pct = 8;
      const steps = ['Fine-tuning your private style model…', 'Rendering 9:16 frames…', 'Applying Gulf-Arabic voiceover…', 'Adding compliance “AI-generated” tag…'];
      let si = 0; const st = $('#genstatus');
      const copy = setInterval(() => { si = (si + 1) % steps.length; if (st) st.textContent = steps[si]; }, 900);
      if (st) st.textContent = steps[0];
      const tick = setInterval(() => { pct = Math.min(96, pct + 7); bar.style.width = pct + '%'; }, 250);
      const poll = setInterval(async () => {
        try {
          const v = await api('/videos/' + S.videoId);
          if (v.status === 'ready' || v.status === 'published') {
            clearInterval(poll); clearInterval(tick); clearInterval(copy);
            bar.style.width = '100%'; if (st) st.textContent = 'Done ✓'; haptic('success');
            setTimeout(() => go('distribute'), 500);
          }
        } catch {}
      }, 600);
    },
  };

  // ===========================================================
  // 06 · DISTRIBUTE
  // ===========================================================
  // platform model: capability determines link placement (the whole point)
  const PLATFORMS = {
    tiktok:   { name: 'TikTok',    sub: 'Video',              tier: 'public',  clickable: false, placement: 'bio' },
    reels:    { name: 'Instagram', sub: 'Reels',              tier: 'public',  clickable: false, placement: 'bio' },
    shorts:   { name: 'YouTube',   sub: 'Shorts',             tier: 'public',  clickable: false, placement: 'bio' },
    snap:     { name: 'Snapchat',  sub: 'Story · Spotlight',  tier: 'public',  clickable: true,  placement: 'sticker' },
    x:        { name: 'X',         sub: 'Twitter',            tier: 'public',  clickable: true,  placement: 'inline' },
    telegram: { name: 'Telegram',  sub: 'Channel',            tier: 'private', clickable: true,  placement: 'inline' },
    whatsapp: { name: 'WhatsApp',  sub: 'Status · Broadcast', tier: 'private', clickable: true,  placement: 'inline' },
  };
  const PUBLIC_IDS = ['tiktok', 'reels', 'shorts', 'snap', 'x'];
  const PRIVATE_IDS = ['telegram', 'whatsapp'];
  const PIC = {
    tiktok:   `<div class="pic" style="background:#141414;color:#fff">TT</div>`,
    reels:    `<div class="pic" style="background:linear-gradient(45deg,#F58529,#DD2A7B,#8134AF);color:#fff">IG</div>`,
    shorts:   `<div class="pic" style="background:#FF0000;color:#fff">▶</div>`,
    snap:     `<div class="pic" style="background:#FFFC00;color:#141414">👻</div>`,
    x:        `<div class="pic" style="background:#141414;color:#fff">𝕏</div>`,
    telegram: `<div class="pic" style="background:#29A9EB;color:#fff">✈</div>`,
    whatsapp: `<div class="pic" style="background:#25D366;color:#fff">✆</div>`,
  };
  const T = (en, zh, ar, lang) => ({ en, zh, ar }[lang]);

  // localized caption fragments (EN / 中文 / العربية)
  const CAP = {
    en: { base: 'Must-have noise-canceling earbuds 🎧 honest review + my pick inside.', tags: '#goodfinds #SaudiFinds',
      bio: '🔗 Link in bio', sticker: '🔗 Tap the link sticker to shop',
      retention: (promo, url) => `Restock is live 🛒 your exclusive code ${promo} is updated — tap to grab yours 👉 ${url}` },
    zh: { base: '必入的降噪耳机 🎧 真实测评，选品都在这。', tags: '#好物分享 #沙特好物',
      bio: '🔗 链接在主页 bio', sticker: '🔗 点链接贴纸即可购买',
      retention: (promo, url) => `补货上架啦 🛒 你的专属优惠码 ${promo} 已更新，点这里下单 👉 ${url}` },
    ar: { base: 'سماعات عزل الضوضاء التي لا غنى عنها 🎧 مراجعة صادقة + اختياري بالداخل.', tags: '#اكتشافات #منتجات_سعودية',
      bio: '🔗 الرابط في الـ bio', sticker: '🔗 اضغط ملصق الرابط للتسوق',
      retention: (promo, url) => `المنتج متوفّر من جديد 🛒 رمزك الخاص ${promo} تم تحديثه — اضغط للطلب 👈 ${url}` },
  };
  function captionFor(id, lang, url, promo) {
    const pf = PLATFORMS[id], L = CAP[lang];
    if (pf.tier === 'private') return L.retention(promo, url);       // 私域复购语气，链接直接放
    const base = `${L.base} ${L.tags}`;
    if (!pf.clickable) return `${base}\n${L.bio}`;                   // 不可点 → 引导主页 bio
    if (pf.placement === 'sticker') return `${base}\n${L.sticker}`;  // Snapchat 链接贴纸
    return `${base}\n${url}`;                                       // X 正文直接放
  }
  const CAPTAG = {
    bio:     { en: '↗ Link in bio',   zh: '↗ 链接在 bio', ar: '↗ الرابط في bio' },
    sticker: { en: '🔗 Link sticker', zh: '🔗 链接贴纸',  ar: '🔗 ملصق الرابط' },
    inline:  { en: '🔗 Link in post', zh: '🔗 正文可点',  ar: '🔗 داخل المنشور' },
    message: { en: '🔗 In message',   zh: '🔗 私域可点',  ar: '🔗 داخل الرسالة' },
  };
  const kindOf = (id) => { const pf = PLATFORMS[id]; return pf.tier === 'private' ? 'message' : !pf.clickable ? 'bio' : pf.placement; };
  const capTag = (id, lang) => { const k = kindOf(id); return `<span class="captag ${k === 'bio' ? 'bio' : 'clk'}">${CAPTAG[k][lang]}</span>`; };
  const PLACE = {
    bio:     { en: 'Smart Link → your profile bio (set once)', zh: 'Smart Link 落点：主页 bio（一次性配置）', ar: 'Smart Link → الـ bio (إعداد لمرة واحدة)' },
    sticker: { en: 'Smart Link → attached as a link sticker',  zh: 'Smart Link 落点：链接贴纸',               ar: 'Smart Link → كملصق رابط' },
    inline:  { en: 'Smart Link → directly in the post',        zh: 'Smart Link 落点：正文内直接放',           ar: 'Smart Link → داخل المنشور مباشرة' },
    message: { en: 'Smart Link → directly in the message',     zh: 'Smart Link 落点：消息 / 频道内直接放',     ar: 'Smart Link → داخل الرسالة مباشرة' },
  };
  const placeHint = (id, lang) => PLACE[kindOf(id)][lang];

  SCREENS.distribute = {
    tab: null,
    html: () => {
      const p = S.create.product || {};
      const P = S.publish; const lang = P.lang; const sl = P.smart;
      const url = sl ? sl.branded : 'go.deinai.ai/••••';
      const promo = sl ? sl.promo : 'AISHA15';
      const status = sl
        ? `<span class="sl-status" style="color:#5FD79E"><span style="width:7px;height:7px;border-radius:50%;background:#5FD79E"></span>${T('Generated', '已生成', 'تم الإنشاء', lang)}</span>`
        : `<span class="sl-status" style="color:#9AA0AA"><span class="spinner" style="width:12px;height:12px;border-color:rgba(255,255,255,.3);border-top-color:#9AA0AA"></span>${T('Generating…', '生成中…', 'جارٍ…', lang)}</span>`;
      const platRow = (id) => {
        const pf = PLATFORMS[id]; const on = P.selected.includes(id);
        return `<button class="prow ${on ? 'on' : ''}" data-pid="${id}">${PIC[id]}
          <div class="pmeta"><div class="pname">${pf.name} <small>${pf.sub}</small></div>${capTag(id, lang)}</div>
          <span class="pcheck">${on ? '✓' : ''}</span></button>`;
      };
      const selected = P.selected.filter((id) => PLATFORMS[id]);
      const anyBio = selected.some((id) => kindOf(id) === 'bio');
      const bioDone = P.bio && P.bio.configured;
      const capCard = (id) => `<div class="capbox">
          <div class="cl"><span style="display:flex;align-items:center;gap:8px;">${PIC[id]} ${PLATFORMS[id].name}</span>${capTag(id, lang)}</div>
          <div class="captext"${lang === 'ar' ? ' dir="rtl"' : ''}>${captionFor(id, lang, url, promo)}</div>
          <div class="placehint">${placeHint(id, lang)}</div></div>`;

      return `
      ${header(T('Distribute', '分发', 'النشر', lang), true)}
      <div class="scroll" style="padding:4px 22px;">
        <!-- video preview -->
        <div style="display:flex;gap:12px;border-radius:16px;padding:12px;border:1px solid var(--line);">
          <div style="width:74px;height:100px;border-radius:12px;background:var(--ink);flex:none;position:relative;display:flex;align-items:center;justify-content:center;"><span style="width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.92);display:flex;align-items:center;justify-content:center;color:var(--ink);">▶</span><span style="position:absolute;top:6px;left:6px;font:700 8px/1 'Plus Jakarta Sans';color:var(--green);background:var(--green-soft);padding:3px 5px;border-radius:5px;">AI · 9:16</span></div>
          <div style="flex:1;"><div style="font:800 13px/1.4 'Plus Jakarta Sans';">${p.title || '—'} · ${S.create.style}</div><div style="font:500 10px/1.4 'Plus Jakarta Sans';color:var(--faint);margin-top:6px;">${S.create.duration} · ${S.create.ratio} · ${S.create.lang}</div><div style="margin-top:10px;" class="pill pill-green">✓ ${T('Reviewed', '已审核', 'تمت المراجعة', lang)}</div></div>
        </div>

        <!-- Smart Link -->
        <div class="slcard">
          <div style="display:flex;align-items:center;justify-content:space-between;"><span style="font:800 14px/1 'Plus Jakarta Sans';color:#fff;">Smart Link</span>${status}</div>
          <div style="font:500 10px/1.5 'Plus Jakarta Sans';color:#9AA0AA;margin-top:7px;">${T('Tracked redirect + light landing — works on every platform.', '带追踪中转短链 + 轻落地页 — 全平台可追踪。', 'رابط ذكي بتتبّع — يعمل على كل منصّة.', lang)}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;gap:10px;">
            <span style="font:800 15px/1 'Plus Jakarta Sans';color:#fff;letter-spacing:.3px;">${url}</span>
            <div style="display:flex;gap:8px;flex:none;">
              <button id="sl-qr" style="font:700 11px/1 'Plus Jakarta Sans';color:#fff;background:#23262E;padding:8px 11px;border-radius:8px;border:0;cursor:pointer;">▣ QR</button>
              <button id="sl-copy" style="font:700 11px/1 'Plus Jakarta Sans';color:var(--ink);background:#fff;padding:8px 12px;border-radius:8px;border:0;cursor:pointer;">${T('Copy', '复制', 'نسخ', lang)}</button>
            </div>
          </div>
          <div><span class="sl-chip">creator: ${sl ? sl.creatorId : '—'}</span><span class="sl-chip">video: v${S.videoId || '—'}</span><span class="sl-chip">promo: ${promo}</span><span class="sl-chip">+ source · UTM</span></div>
          <div class="qrpanel ${P.qrOpen ? 'open' : ''}" id="sl-qrpanel">
            <div class="qrbox" id="sl-qrbox"></div>
            <div style="flex:1;"><div style="font:800 13px/1.3 'Plus Jakarta Sans';color:var(--ink);">${T('Save to your bio', '保存到主页', 'احفظه في الـ bio', lang)}</div><div style="font:500 11px/1.6 'Plus Jakarta Sans';color:var(--muted);margin-top:6px;">${T('Put this QR / link in your profile bio or Linktree.', '把二维码或链接放到主页 bio / Linktree。', 'ضعه في الـ bio أو Linktree.', lang)}</div></div>
          </div>
        </div>

        <!-- PUBLIC tier -->
        <div class="sechead"><span class="st">${T('Public · reach', '公域 · 种草', 'عام · وصول', lang)}</span><span class="sd">${T('discovery & new fans', '拉新种草', 'اكتشاف ومتابعون', lang)}</span></div>
        ${PUBLIC_IDS.map(platRow).join('')}
        <div class="tier-divider"></div>
        <!-- PRIVATE tier -->
        <div class="sechead"><span class="st">${T('Private · retention', '私域 · 沉淀', 'خاص · احتفاظ', lang)}</span><span class="sd">${T('repurchase & loyalty', '复购触达', 'إعادة الشراء', lang)}</span></div>
        ${PRIVATE_IDS.map(platRow).join('')}

        <!-- per-platform captions -->
        <div class="sechead" style="justify-content:space-between;width:100%;"><span class="st">${T('Captions (auto)', '文案（自动）', 'النصوص (تلقائي)', lang)}</span>
          <span class="langseg" id="caplang"><button data-cl="en" class="${lang === 'en' ? 'on' : ''}">EN</button><button data-cl="zh" class="${lang === 'zh' ? 'on' : ''}">中文</button><button data-cl="ar" class="${lang === 'ar' ? 'on' : ''}" style="font-family:'Noto Sans Arabic'">ع</button></span></div>
        <div style="font:500 11px/1.5 'Plus Jakarta Sans';color:var(--faint);margin-top:8px;">${T('Each platform gets the right caption & link placement automatically.', '每个平台自动匹配文案与链接落点。', 'لكل منصّة نص ومكان رابط مناسب تلقائيًا.', lang)}</div>
        ${selected.length ? selected.map(capCard).join('') : `<div style="text-align:center;padding:24px;color:var(--faint);font:600 12px 'Plus Jakarta Sans';">${T('Select a platform above', '请选择上方平台', 'اختر منصّة بالأعلى', lang)}</div>`}

        <!-- bio config prompt (for the "not clickable" platforms) -->
        ${anyBio ? (bioDone
          ? `<div class="bioprompt done"><div class="bt">✓ ${T('Bio is set with your Smart Link', '主页 bio 已配置 Smart Link', 'تم إعداد الـ bio', lang)}</div><div class="bd">${T('Reused automatically for TikTok / Instagram / YouTube.', 'TikTok / Instagram / YouTube 自动复用。', 'يُعاد استخدامه تلقائيًا.', lang)}</div></div>`
          : `<div class="bioprompt"><div class="bt">⚠ ${T('Your bio isn’t set up yet', '你的主页 bio 还没配置', 'الـ bio غير مُعد بعد', lang)}</div><div class="bd">${T('TikTok / Instagram / YouTube links aren’t clickable. Add your Smart Link to your bio once — we reuse it.', 'TikTok / Instagram / YouTube 链接不可点。把 Smart Link 配到 bio 一次即可复用。', 'روابط TikTok / Instagram / YouTube غير قابلة للنقر. أضِف Smart Link مرة واحدة.', lang)}</div><button class="bbtn" id="bio-config">${T('Add Smart Link to bio / Linktree', '添加到 bio / Linktree', 'أضِف إلى bio / Linktree', lang)}</button></div>`) : ''}
        <div style="height:8px;"></div>
      </div>

      <!-- footer -->
      <div style="flex:none;padding:12px 22px 30px;border-top:1px solid #F4F4F6;">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;">
          <div id="mode-now" class="modebtn tap" style="flex:1;text-align:center;border-radius:10px;padding:11px;font:${P.schedule ? 600 : 700} 12px/1 'Plus Jakarta Sans';color:${P.schedule ? 'var(--faint)' : 'var(--green)'};background:${P.schedule ? '#F4F4F6' : 'var(--green-soft)'};">${T('Publish now', '立即发布', 'نشر الآن', lang)}</div>
          <div id="mode-sch" class="modebtn tap" style="flex:1;text-align:center;border-radius:10px;padding:11px;font:${P.schedule ? 700 : 600} 12px/1 'Plus Jakarta Sans';color:${P.schedule ? 'var(--green)' : 'var(--faint)'};background:${P.schedule ? 'var(--green-soft)' : '#F4F4F6'};">${T('Schedule', '定时', 'جدولة', lang)}</div>
        </div>
        <button id="publish" class="btn btn-dark" ${selected.length ? '' : 'disabled'}>${P.schedule ? T('Schedule publish', '定时发布', 'جدولة النشر', lang) : `${T('Publish to', '发布到', 'نشر إلى', lang)} ${selected.length} ${T('platforms', '个平台', 'منصّات', lang)}`}</button>
      </div>`;
    },
    init() { initDistribute(); },
  };

  async function initDistribute() {
    const P = S.publish;
    if (!P.smart || P.smart.videoId !== S.videoId) {
      try { P.smart = await api('/smartlink', { method: 'POST', body: { videoId: S.videoId } }); } catch {}
      try { P.bio = await api('/bio'); } catch { P.bio = { configured: false }; }
      if (current === 'distribute') return go('distribute'); // re-render with data
    }
    bindDistribute();
    if (P.qrOpen && P.smart) loadQR();
  }

  function bindDistribute() {
    const P = S.publish;
    $$('.prow').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.pid; const i = P.selected.indexOf(id);
      if (i >= 0) P.selected.splice(i, 1); else P.selected.push(id);
      haptic('selection'); go('distribute');
    }));
    $$('#caplang button').forEach((b) => b.addEventListener('click', () => { haptic('selection'); P.lang = b.dataset.cl; go('distribute'); }));
    $('#sl-qr')?.addEventListener('click', () => {
      P.qrOpen = !P.qrOpen; haptic('light');
      $('#sl-qrpanel').classList.toggle('open', P.qrOpen);
      if (P.qrOpen) loadQR();
    });
    $('#sl-copy')?.addEventListener('click', () => {
      if (!P.smart) return;
      navigator.clipboard?.writeText(P.smart.branded); haptic('light');
      toast(T('Smart Link copied', 'Smart Link 已复制', 'تم نسخ الرابط', P.lang));
    });
    $('#bio-config')?.addEventListener('click', async (e) => {
      e.target.innerHTML = '<span class="spinner"></span>';
      try { P.bio = await api('/bio/configure', { method: 'POST', body: { code: P.smart.code } }); haptic('success'); toast(T('Smart Link added to your bio ✓', '已添加到主页 bio ✓', 'تمت الإضافة ✓', P.lang)); go('distribute'); }
      catch { toast('Failed'); }
    });
    $('#mode-now')?.addEventListener('click', () => { if (P.schedule) { P.schedule = false; go('distribute'); } });
    $('#mode-sch')?.addEventListener('click', () => { if (!P.schedule) { P.schedule = true; go('distribute'); } });
    $('#publish')?.addEventListener('click', doPublish);
  }

  async function loadQR() {
    const P = S.publish; const box = $('#sl-qrbox'); if (!box || !P.smart || box.dataset.loaded) return;
    try { box.innerHTML = await fetch('/api/qr?d=' + encodeURIComponent(P.smart.url)).then((r) => r.text()); box.dataset.loaded = '1'; } catch {}
  }

  async function doPublish() {
    const P = S.publish; const lang = P.lang;
    const selected = P.selected.filter((id) => PLATFORMS[id]);
    if (!selected.length) { haptic('warning'); return toast(T('Select at least 1 platform', '至少选择 1 个平台', 'اختر منصّة واحدة', lang)); }
    haptic('medium');
    const btn = $('#publish'); btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true;
    const captions = {};
    const url = P.smart ? P.smart.branded : ''; const promo = P.smart ? P.smart.promo : '';
    selected.forEach((id) => { captions[id] = captionFor(id, lang, url, promo); });
    try {
      await api('/publish', { method: 'POST', body: {
        videoId: S.videoId, platforms: selected, captions, smartCode: P.smart ? P.smart.code : null,
        schedule: P.schedule ? '2026-06-28 19:00' : null,
      }});
      haptic('success');
      toast(P.schedule
        ? T('Scheduled · 28 Jun 7:00 PM', '已定时 · 6月28日 19:00', 'مجدول · 28 يونيو', lang)
        : T(`Published to ${selected.length} platforms · tracking live`, `已发布到 ${selected.length} 个平台 · 追踪已开启`, `تم النشر على ${selected.length} منصّات`, lang));
      S.justPublished = true;
      setTimeout(() => go('earnings'), 1100);
    } catch (e) { btn.disabled = false; go('distribute'); toast('Publish failed'); }
  }

  // ===========================================================
  // 07 · EARNINGS
  // ===========================================================
  SCREENS.earnings = {
    tab: 'earnings',
    html: () => `
      <div style="flex:none;padding:4px 22px 14px;display:flex;align-items:center;gap:9px;">
        <svg width="34" height="22" viewBox="0 0 46 30" fill="none"><circle cx="16" cy="15" r="11" stroke="#141414" stroke-width="4.4"></circle><circle cx="30" cy="15" r="11" stroke="#141414" stroke-width="4.4"></circle></svg>
        <span style="font:900 21px/1 'Plus Jakarta Sans';">My Earnings</span>
      </div>
      <div class="scroll" id="earnbody" style="padding:4px 22px;">
        <div class="sk" style="height:120px;border-radius:18px;"></div>
        ${'<div class="sk" style="height:54px;border-radius:14px;margin-top:12px;"></div>'.repeat(3)}
      </div>`,
    init() { loadEarnings(); },
  };
  async function loadEarnings() {
    const e = await api('/earnings');
    const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 1 : 0, maximumFractionDigits: 2 });
    const justPub = S.justPublished; S.justPublished = false;
    // newest live row sits at index 2 (after the 2 base rows); highlight it on arrival from publish
    const detailRow = (d, i) => `<div class="${justPub && i === 2 ? 'row-new' : ''}" style="margin-top:12px;border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;"><div><div style="font:700 13px/1.3 'Plus Jakarta Sans';">${d.title}</div><div style="margin-top:8px;display:inline-flex;font:700 10px/1 'Plus Jakarta Sans';color:${d.status === 'Settled' ? 'var(--green)' : '#C2611C'};background:${d.status === 'Settled' ? '#E6F2E8' : '#FBEAD9'};padding:5px 9px;border-radius:999px;">${d.status}</div></div><span style="font:800 15px/1 'Plus Jakarta Sans';color:var(--green);">+SAR ${fmt(d.amount)}</span></div>`;
    $('#earnbody').innerHTML = `
      <div id="hero" style="background:var(--green-soft);border-radius:18px;padding:22px;display:flex;align-items:center;justify-content:space-between;position:relative;overflow:hidden;">
        <div style="position:absolute;left:0;top:0;bottom:0;width:6px;background:var(--green);"></div>
        <div style="padding-left:4px;"><div style="font:600 12px/1 'Plus Jakarta Sans';color:var(--green);">Withdrawable (SAR)</div><div id="wd" style="font:800 34px/1 'Plus Jakarta Sans';margin-top:10px;font-variant-numeric:tabular-nums;">0</div></div>
        <button id="withdraw" style="font:700 14px/1 'Plus Jakarta Sans';color:#fff;background:var(--green);padding:14px 22px;border-radius:14px;border:0;cursor:pointer;">Withdraw</button>
      </div>
      ${kv('Total GMV', 'gmv')}
      ${kv('Total commission', 'comm')}
      ${kv('This month', 'month')}
      <div style="font:800 14px/1 'Plus Jakarta Sans';margin-top:20px;">Earnings detail</div>
      ${e.detail.map(detailRow).join('')}
      <div style="height:10px;"></div>`;
    // animated roll-ups
    countUp($('#wd'), e.withdrawableSar, 800);
    countUp($('#gmv'), e.totalGmvSar, 800);
    countUp($('#comm'), e.totalCommissionSar, 800);
    countUp($('#month'), e.thisMonthSar, 800);
    // milestone: crossing a hundreds boundary upward → celebrate (once)
    const prev = S.lastMonthSar;
    if (justPub && prev != null && Math.floor(e.thisMonthSar / 100) > Math.floor(prev / 100)) {
      const hero = $('#hero'); if (hero) { hero.classList.add('milestone'); haptic('medium'); }
    }
    S.lastMonthSar = e.thisMonthSar;
    $('#withdraw').addEventListener('click', async () => {
      haptic('medium');
      const r = await api('/earnings/withdraw', { method: 'POST' });
      toast(r.message); loadEarnings();
    });
  }
  // kv now renders the value as an empty span with an id for countUp to fill (prefixed "SAR ")
  const kv = (l, id) => `<div style="margin-top:12px;border:1px solid var(--line);border-radius:14px;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;"><span style="font:600 13px/1 'Plus Jakarta Sans';">${l}</span><span style="font:800 15px/1 'Plus Jakarta Sans';color:var(--green);font-variant-numeric:tabular-nums;">SAR <span id="${id}">0</span></span></div>`;

  // ===========================================================
  // 08 · AUTHORIZATION & PRIVACY  (Me)
  // ===========================================================
  SCREENS.privacy = {
    tab: 'me',
    html: () => `
      ${header('Authorization & Privacy', false)}
      <div class="scroll" id="privbody" style="padding:4px 22px;"></div>`,
    init() { loadPrivacy(); },
  };
  async function loadPrivacy() {
    const a = await api('/authorization');
    $('#privbody').innerHTML = `
      <div style="border:1px solid var(--line);border-radius:16px;padding:18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font:800 15px/1 'Plus Jakarta Sans';">Portrait AI Authorization</span>
          <span class="pill pill-green" style="gap:5px;">${a.authorized ? '<span style="width:7px;height:7px;border-radius:50%;background:var(--green);"></span>Authorized' : 'Revoked'}</span>
        </div>
        <div style="margin-top:14px;display:flex;flex-direction:column;gap:10px;">
          ${prow('Scope', a.scope)}${prow('E-sign date', a.eSignDate)}${prow('Basis', a.basis)}
        </div>
      </div>
      <div style="margin-top:14px;background:#FFF4F1;border:1px solid #F6D6CC;border-radius:16px;padding:16px 18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font:800 14px/1 'Plus Jakarta Sans';color:#C23E29;">Revoke portrait authorization</span>
          <div id="revoke" class="switch danger ${a.authorized ? 'on' : ''}"><i></i></div>
        </div>
        <div style="font:500 12px/1.7 'Plus Jakarta Sans';color:#9A5648;margin-top:9px;">One-tap revoke of facial AI usage. Revoking <b style="color:#C23E29;">stops private-model training</b> and triggers deletion.</div>
      </div>
      <div style="margin-top:14px;border:1px solid var(--line);border-radius:16px;overflow:hidden;">
        <div id="deletereq" class="tap" style="display:flex;align-items:center;justify-content:space-between;padding:15px 18px;"><div><div style="font:800 13px/1 'Plus Jakarta Sans';">Data deletion request</div><div style="font:500 11px/1.4 'Plus Jakarta Sans';color:var(--faint);margin-top:5px;">Best-effort deletion · processing window</div></div><span style="font:700 13px/1 'Plus Jakarta Sans';">›</span></div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-top:1px solid #F4F4F6;"><div><div style="font:800 13px/1 'Plus Jakarta Sans';">Generated content (${a.generatedCount})</div><div style="font:500 11px/1.4 'Plus Jakarta Sans';color:var(--faint);margin-top:5px;">Unlist platform-side · third-party posts can't be recalled</div></div><span style="font:700 13px/1 'Plus Jakarta Sans';">›</span></div>
      </div>
      <div style="margin-top:16px;display:flex;align-items:flex-start;gap:8px;background:var(--green-soft);border-radius:12px;padding:13px 14px;"><span style="color:var(--green);font-weight:800;">ⓘ</span><div style="font:500 11px/1.7 'Plus Jakarta Sans';color:var(--green-ink);">Compliance: revoke + best-effort deletion + contractual limits. We don't promise to recall content already posted to third-party social media.</div></div>
      <div style="margin-top:16px;"><button id="logout" style="width:100%;height:46px;border-radius:12px;border:1px solid var(--line2);background:#fff;font:700 13px/1 'Plus Jakarta Sans';color:#C23E29;cursor:pointer;">Log out</button></div>
      <div style="height:10px;"></div>`;
    $('#revoke').addEventListener('click', async () => {
      const sw = $('#revoke'); const willRevoke = sw.classList.contains('on');
      if (willRevoke) {
        // destructive → require confirmation; do NOT flip the switch yet
        haptic('warning');
        confirmRevoke(sw, async () => {
          await api('/portrait/revoke', { method: 'POST' });
          haptic('success'); toast('Authorization revoked · deletion triggered'); loadPrivacy();
        });
      } else {
        await api('/portrait/authorize', { method: 'POST' }); haptic('light'); toast('Re-authorized'); loadPrivacy();
      }
    });
    $('#deletereq').addEventListener('click', async () => {
      haptic('light');
      const r = await api('/authorization/data-deletion', { method: 'POST' }); toast(r.message);
    });
    $('#logout').addEventListener('click', () => {
      token = null; localStorage.removeItem(TOKEN_KEY); S.user = null;
      toast('Logged out'); go('signup');
    });
  }
  const prow = (l, v) => `<div style="display:flex;justify-content:space-between;font:500 12px/1 'Plus Jakarta Sans';"><span style="color:var(--faint);">${l}</span><span style="font-weight:700;">${v}</span></div>`;

  // destructive confirm bubble anchored to the revoke switch
  function confirmRevoke(anchor, onYes) {
    const phone = document.getElementById('phone');
    const existing = document.getElementById('cfbubble'); if (existing) existing.remove();
    const pr = phone.getBoundingClientRect(), r = anchor.getBoundingClientRect();
    const c = document.createElement('div');
    c.id = 'cfbubble'; c.className = 'confirm';
    c.style.top = r.bottom - pr.top + 10 + 'px';
    c.innerHTML = `<p>Revoking stops private-model training and triggers deletion. Continue?</p>
      <div class="cf-row"><button class="cf-no">Cancel</button><button class="cf-yes">Revoke</button></div>`;
    phone.appendChild(c);
    void c.offsetWidth; c.classList.add('show');
    const close = () => { c.classList.remove('show'); setTimeout(() => c.remove(), 200); };
    c.querySelector('.cf-no').onclick = close;
    c.querySelector('.cf-yes').onclick = () => { close(); onYes(); };
    setTimeout(() => { document.addEventListener('click', function h(ev) { if (!c.contains(ev.target) && ev.target !== anchor) { close(); document.removeEventListener('click', h); } }); }, 0);
  }

  // ---------------- global back handling ----------------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-back]');
    if (!b) return;
    const map = { create: 'discover', distribute: 'create', portrait: 'signup', connect: 'portrait', privacy: 'discover' };
    go(map[current] || 'discover');
  });

  // ---------------- boot ----------------
  async function boot() {
    // api health
    fetch('/api/products', { headers: token ? { Authorization: 'Bearer ' + token } : {} })
      .then((r) => { document.getElementById('apihealth').textContent = 'API: connected ✓'; })
      .catch(() => { document.getElementById('apihealth').textContent = 'API: offline ✕'; });

    if (token) {
      try { const me = await api('/me'); S.user = me.user; go(me.onboarding.portraitAuthorized ? 'discover' : 'portrait'); return; }
      catch { token = null; localStorage.removeItem(TOKEN_KEY); }
    }
    go('signup');
  }
  boot();
})();
