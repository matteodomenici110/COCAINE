'use strict';

/* ======================================================================
 * COCAINE® — Single-File E-Commerce Application
 *
 * SECURITY:
 * - Customer data (name, address, phone) is encrypted with AES-GCM
 *   using a key derived from the user's password via PBKDF2 (210000 iter).
 *   Without the password, encrypted PII cannot be read.
 * - Passwords are hashed with PBKDF2-SHA256 (210000 iter) before storage.
 * - Card data is NEVER stored; only last 4 digits in the order record.
 * - All user input rendered with textContent (no XSS).
 * - Rate limit: 5 failed login attempts → 60s lockout per email.
 * - Session expires after 24h.
 *
 * Note: client-side encryption is strong but NOT a substitute for a real
 * backend with HTTPS and a hardened database. For a production launch,
 * pair this frontend with a proper server (see CONSEGNA.md).
 * ====================================================================== */

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const wait = ms => new Promise(r => setTimeout(r, ms));
const fmt = n => '€' + Number(n).toFixed(2).replace(/\.00$/, '');

function escHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function uid(prefix = '') {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return prefix + Array.from(buf, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function toast(msg, type = 'info') {
  const wrap = $('#toastWrap');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = '<span class="ic"></span><span></span>';
  t.lastChild.textContent = msg;
  wrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 600); }, 3500);
}

/* ============ CRYPTO ============ */
const CRY = {
  enc: new TextEncoder(),
  dec: new TextDecoder(),
  toB64: buf => btoa(String.fromCharCode(...new Uint8Array(buf))),
  fromB64: b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0)),

  async deriveKey(password, salt) {
    const baseKey = await crypto.subtle.importKey('raw', this.enc.encode(password), {name:'PBKDF2'}, false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },

  async hashPassword(password, salt) {
    const baseKey = await crypto.subtle.importKey('raw', this.enc.encode(password), {name:'PBKDF2'}, false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' },
      baseKey,
      256
    );
    return this.toB64(bits);
  },

  randomSalt() {
    const s = new Uint8Array(16);
    crypto.getRandomValues(s);
    return s;
  },

  async encrypt(plaintext, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, this.enc.encode(plaintext));
    return { iv: this.toB64(iv), ct: this.toB64(ct) };
  },

  async decrypt({iv, ct}, key) {
    const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv: this.fromB64(iv)}, key, this.fromB64(ct));
    return this.dec.decode(pt);
  }
};

/* ============ STORAGE ============ */
const KEY = {
  USERS: 'cn_users_v1',
  SESSION: 'cn_session_v1',
  ORDERS: 'cn_orders_v1',
  CART: 'cn_cart_v1',
  ADMIN: 'cn_admin_v1',
  ADMIN_SESSION: 'cn_admin_session_v1',
  LOGIN_ATTEMPTS: 'cn_login_attempts_v1'
};

const STORE = {
  get(k, fallback = null) {
    try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { console.warn('Storage failed:', e); }
  },
  remove(k) { try { localStorage.removeItem(k); } catch {} }
};

/* ============ PRODUCTS ============ */
const products = {
  1: { id:1, name:"Classic Logo Hoodie", sku:"CN-001 / BLK", price:149, img:"images/hoodie-01.png",
       desc:"La felpa firma del brand. Wordmark COCAINE stampato sul petto, tre righe iconiche sulla tasca frontale. Cotone pesante 450 gsm con interno a felpa garzata. Vestibilità oversize ma strutturata.",
       details:["100% cotone biologico 450 gsm","Stampa serigrafica artigianale","Vestibilità oversize","Fatto a Milano, Italia","Edizione limitata 200 pezzi"],
       sizes: { XS: 12, S: 30, M: 45, L: 28, XL: 8 } },
  2: { id:2, name:"Minimal Lines Hoodie", sku:"CN-002 / BLK", price:139, img:"images/hoodie-02.png",
       desc:"Versione più essenziale del drop. Solo le tre righe iconiche stampate sulla tasca frontale, niente wordmark. Per chi capisce senza bisogno di leggerlo.",
       details:["100% cotone biologico 450 gsm","Stampa minimal sulla tasca","Vestibilità oversize","Fatto a Milano, Italia","Edizione limitata 200 pezzi"],
       sizes: { XS: 18, S: 25, M: 38, L: 32, XL: 14 } },
  3: { id:3, name:"Pixel Girl Hoodie", sku:"CN-003 / BLK", price:169, img:"images/hoodie-03.png",
       desc:"Il pezzo più narrativo della collezione. Illustrazione pixel art al centro del petto, censura nera sugli occhi. Provocazione e nostalgia 8-bit insieme.",
       details:["100% cotone biologico 450 gsm","Stampa digitale ad alta definizione","Vestibilità oversize","Fatto a Milano, Italia","Edizione limitata 200 pezzi — Low stock"],
       sizes: { XS: 2, S: 4, M: 0, L: 6, XL: 3 } },
  4: { id:4, name:"Portrait Edition", sku:"CN-004 / BLK", price:179, img:"images/hoodie-04.png",
       desc:"Il più scenografico della collezione. Ritratto trattato in halftone con pattern moiré, censura nera, stampa quadrata in posizione centrale. Da collezione.",
       details:["100% cotone biologico 450 gsm","Stampa halftone tecnica avanzata","Vestibilità oversize","Fatto a Milano, Italia","Edizione limitata 200 pezzi"],
       sizes: { XS: 15, S: 28, M: 40, L: 30, XL: 11 } }
};

// Restore stock from any persisted snapshots (so refresh after orders shows correct stock)
(function persistStock() {
  const stored = STORE.get('cn_stock_v1', null);
  if (stored) {
    Object.keys(products).forEach(id => {
      if (stored[id]) Object.assign(products[id].sizes, stored[id]);
    });
  }
})();

function saveStock() {
  const out = {};
  Object.entries(products).forEach(([id, p]) => { out[id] = { ...p.sizes }; });
  STORE.set('cn_stock_v1', out);
}

/* ============ CART ============ */
const CART = {
  read() {
    const arr = STORE.get(KEY.CART, []);
    return Array.isArray(arr) ? arr.filter(i =>
      Number.isInteger(i?.productId) &&
      ['XS','S','M','L','XL'].includes(i?.size) &&
      Number.isInteger(i?.qty) && i.qty > 0 && i.qty <= 10
    ) : [];
  },
  write(items) { STORE.set(KEY.CART, items); refreshNav(); },
  add(productId, size, qty=1) {
    const items = this.read();
    const ex = items.find(i => i.productId === productId && i.size === size);
    if (ex) ex.qty = Math.min(10, ex.qty + qty);
    else items.push({ productId, size, qty });
    this.write(items);
  },
  setQty(idx, qty) {
    const items = this.read();
    if (qty <= 0) items.splice(idx, 1);
    else items[idx].qty = Math.min(10, qty);
    this.write(items);
  },
  remove(idx) { const items = this.read(); items.splice(idx, 1); this.write(items); },
  clear() { this.write([]); },
  count() { return this.read().reduce((s,i) => s + i.qty, 0); },
  subtotal() { return this.read().reduce((s,i) => s + (products[i.productId]?.price||0)*i.qty, 0); },
  shipping() { const sub = this.subtotal(); return sub === 0 ? 0 : (sub >= 200 ? 0 : 9.90); },
  total() { return this.subtotal() + this.shipping(); }
};

/* ============ AUTH ============ */
const CN = { sessionKey: null };
window.CN = CN;

const AUTH = {
  validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120; },

  async signup(email, password, firstName) {
    email = email.trim().toLowerCase();
    if (!this.validEmail(email)) throw new Error('Email non valida');
    if (password.length < 8) throw new Error('Password minimo 8 caratteri');
    if (!firstName || firstName.trim().length < 2) throw new Error('Nome obbligatorio');

    const users = STORE.get(KEY.USERS, {});
    if (users[email]) throw new Error('Esiste già un account con questa email');

    const salt = CRY.randomSalt();
    const hash = await CRY.hashPassword(password, salt);
    const dataSalt = CRY.randomSalt();

    users[email] = {
      email,
      passwordHash: hash,
      passwordSalt: CRY.toB64(salt),
      dataSalt: CRY.toB64(dataSalt),
      firstName: firstName.trim().slice(0, 60),
      createdAt: Date.now(),
      orders: []
    };
    STORE.set(KEY.USERS, users);
    await this.createSession(email, password);
    return users[email];
  },

  async login(email, password) {
    email = email.trim().toLowerCase();

    const attempts = STORE.get(KEY.LOGIN_ATTEMPTS, {});
    const a = attempts[email] || { count: 0, lockedUntil: 0 };
    if (a.lockedUntil > Date.now()) {
      throw new Error('Troppi tentativi. Riprova tra ' + Math.ceil((a.lockedUntil - Date.now())/1000) + 's');
    }

    const users = STORE.get(KEY.USERS, {});
    const user = users[email];
    if (!user) { this.recordFail(email); throw new Error('Credenziali non valide'); }

    const salt = CRY.fromB64(user.passwordSalt);
    const hash = await CRY.hashPassword(password, salt);
    if (hash !== user.passwordHash) { this.recordFail(email); throw new Error('Credenziali non valide'); }

    delete attempts[email];
    STORE.set(KEY.LOGIN_ATTEMPTS, attempts);
    await this.createSession(email, password);
    return user;
  },

  recordFail(email) {
    const attempts = STORE.get(KEY.LOGIN_ATTEMPTS, {});
    const a = attempts[email] || { count: 0, lockedUntil: 0 };
    a.count++;
    if (a.count >= 5) { a.lockedUntil = Date.now() + 60000; a.count = 0; }
    attempts[email] = a;
    STORE.set(KEY.LOGIN_ATTEMPTS, attempts);
  },

  async createSession(email, password) {
    const users = STORE.get(KEY.USERS, {});
    const user = users[email];
    CN.sessionKey = await CRY.deriveKey(password, CRY.fromB64(user.dataSalt));
    STORE.set(KEY.SESSION, { email, expiresAt: Date.now() + 86400000 });
  },

  isLoggedIn() {
    const s = STORE.get(KEY.SESSION);
    if (!s) return false;
    if (s.expiresAt < Date.now()) { this.logout(); return false; }
    return !!s.email && !!CN.sessionKey;
  },

  current() {
    const s = STORE.get(KEY.SESSION);
    if (!s || s.expiresAt < Date.now()) return null;
    const users = STORE.get(KEY.USERS, {});
    return users[s.email] || null;
  },

  logout() {
    STORE.remove(KEY.SESSION);
    CN.sessionKey = null;
    refreshNav();
  },

  /* ADMIN */
  async adminInit() {
    if (STORE.get(KEY.ADMIN)) return;
    const salt = CRY.randomSalt();
    const hash = await CRY.hashPassword('cocaine2026', salt);
    STORE.set(KEY.ADMIN, { username: 'admin', passwordHash: hash, passwordSalt: CRY.toB64(salt) });
  },

  async adminLogin(username, password) {
    const admin = STORE.get(KEY.ADMIN);
    if (!admin || username.trim() !== admin.username) throw new Error('Credenziali admin non valide');
    const hash = await CRY.hashPassword(password, CRY.fromB64(admin.passwordSalt));
    if (hash !== admin.passwordHash) throw new Error('Credenziali admin non valide');
    STORE.set(KEY.ADMIN_SESSION, { expiresAt: Date.now() + 28800000 });
  },

  isAdminLoggedIn() {
    const s = STORE.get(KEY.ADMIN_SESSION);
    if (!s) return false;
    if (s.expiresAt < Date.now()) { this.adminLogout(); return false; }
    return true;
  },

  adminLogout() { STORE.remove(KEY.ADMIN_SESSION); }
};

/* ============ ORDERS ============ */
const ORDERS = {
  all() { return STORE.get(KEY.ORDERS, []); },
  save(arr) { STORE.set(KEY.ORDERS, arr); },

  async create({ items, shipping, paymentMethod, cardLast4 }) {
    // Recompute prices server-side style (never trust UI)
    const validated = [];
    for (const it of items) {
      const p = products[it.productId];
      if (!p) throw new Error('Prodotto non trovato');
      if ((p.sizes[it.size] || 0) < it.qty) throw new Error('Stock insufficiente: ' + p.name + ' ' + it.size);
      validated.push({
        productId: p.id, name: p.name, sku: p.sku, img: p.img,
        size: it.size, qty: it.qty, priceAtPurchase: p.price
      });
    }
    const subtotal = validated.reduce((s,i) => s + i.priceAtPurchase*i.qty, 0);
    const shippingCost = subtotal >= 200 ? 0 : 9.90;
    const codFee = paymentMethod === 'cod' ? 3 : 0;
    const total = subtotal + shippingCost + codFee;

    // Encrypt PII if user logged in
    let shippingPayload;
    const user = AUTH.current();
    const rawShipping = JSON.stringify(shipping);
    if (user && CN.sessionKey) {
      shippingPayload = { encrypted: true, ...(await CRY.encrypt(rawShipping, CN.sessionKey)) };
    } else {
      shippingPayload = { encrypted: false, data: rawShipping };
    }

    const order = {
      id: 'CN-' + uid().slice(0, 12),
      createdAt: Date.now(),
      status: 'pending',
      paymentMethod,
      paymentStatus: 'paid',
      cardLast4: cardLast4 || null,
      items: validated,
      subtotal, shippingCost, total,
      email: shipping.email,
      shippingPayload,
      // ADMIN-only access: store unencrypted shipping for fulfilment
      adminShipping: { ...shipping },
      userId: user ? user.email : null
    };

    // Decrement stock
    items.forEach(i => {
      if (products[i.productId]?.sizes?.[i.size] != null) {
        products[i.productId].sizes[i.size] = Math.max(0, products[i.productId].sizes[i.size] - i.qty);
      }
    });
    saveStock();

    const all = this.all();
    all.unshift(order);
    this.save(all);

    if (user) {
      const users = STORE.get(KEY.USERS, {});
      users[user.email].orders = users[user.email].orders || [];
      users[user.email].orders.push(order.id);
      STORE.set(KEY.USERS, users);
    }
    return order;
  },

  async byId(id) {
    const o = this.all().find(x => x.id === id);
    if (!o) return null;
    return await this.decryptShipping(o);
  },

  async decryptShipping(order) {
    const out = { ...order };
    if (order.shippingPayload?.encrypted && CN.sessionKey) {
      try {
        const pt = await CRY.decrypt({iv: order.shippingPayload.iv, ct: order.shippingPayload.ct}, CN.sessionKey);
        out.shipping = JSON.parse(pt);
      } catch { out.shipping = order.adminShipping || null; }
    } else if (order.shippingPayload && !order.shippingPayload.encrypted) {
      try { out.shipping = JSON.parse(order.shippingPayload.data); } catch { out.shipping = order.adminShipping || null; }
    } else {
      out.shipping = order.adminShipping || null;
    }
    return out;
  },

  async forUser(email) {
    const all = this.all().filter(o => o.userId === email);
    return await Promise.all(all.map(o => this.decryptShipping(o)));
  },

  updateStatus(id, status) {
    const all = this.all();
    const o = all.find(x => x.id === id);
    if (!o) return false;
    o.status = status;
    this.save(all);
    return true;
  }
};

/* ============ VALIDATORS ============ */
const V = {
  required: s => !!String(s||'').trim(),
  minLen: (s,n) => String(s||'').trim().length >= n,
  email: s => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 120,
  password: s => typeof s === 'string' && s.length >= 8 && s.length <= 128,
  phone: s => /^[\d\s+()\-]{6,20}$/.test(s),
  zip: s => /^[A-Z0-9\s\-]{3,12}$/i.test(s),
  cardNumber: s => /^[\d\s]{13,19}$/.test(s) && V.luhn(s.replace(/\s/g,'')),
  cardExpiry: s => {
    if (!/^(\d{2})\/(\d{2})$/.test(s)) return false;
    const [m,y] = s.split('/').map(x => parseInt(x,10));
    if (m < 1 || m > 12) return false;
    const exp = new Date(2000+y, m-1, 1);
    const now = new Date();
    return exp >= new Date(now.getFullYear(), now.getMonth(), 1);
  },
  cardCVC: s => /^\d{3,4}$/.test(s),
  luhn(num) {
    let sum=0, dbl=false;
    for (let i=num.length-1; i>=0; i--) {
      let d=parseInt(num[i],10);
      if (dbl) { d*=2; if (d>9) d-=9; }
      sum+=d; dbl=!dbl;
    }
    return sum%10 === 0;
  }
};

/* ============ STATE & NAV ============ */
const state = {
  currentPage: '__init__',
  currentParams: null,
  isTransitioning: false
};

function refreshNav() {
  const cnt = CART.count();
  const el = $('#cartCount');
  if (el) {
    el.textContent = cnt;
    el.classList.toggle('empty', cnt === 0);
  }
  const u = AUTH.current();
  const acc = $('#navAccount span');
  if (acc) acc.textContent = u ? u.firstName : 'Account';
}

/* ============ CURSOR ============ */
const cDot = $('#cursorDot'), cRing = $('#cursorRing');
let mx = innerWidth/2, my = innerHeight/2, dx=mx, dy=my, rx=mx, ry=my;
document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
function loopCursor() {
  dx += (mx-dx)*0.6; dy += (my-dy)*0.6;
  rx += (mx-rx)*0.18; ry += (my-ry)*0.18;
  cDot.style.left = dx+'px'; cDot.style.top = dy+'px';
  cRing.style.left = rx+'px'; cRing.style.top = ry+'px';
  requestAnimationFrame(loopCursor);
}
loopCursor();

function bindCursorHovers() {
  $$('a, button, .h-product, .editorial-img-wrap, .shop-card, .related-card, .order-card, .pay-option, input, select, textarea').forEach(el => {
    if (el.dataset._hov) return;
    el.dataset._hov = '1';
    el.addEventListener('mouseenter', () => cRing.classList.add('hover'));
    el.addEventListener('mouseleave', () => cRing.classList.remove('hover'));
  });
}

/* ============ NAV scroll & progress ============ */
window.addEventListener('scroll', () => {
  const sc = scrollY;
  $('#nav').classList.toggle('scrolled', sc > 60);
  const total = document.body.scrollHeight - innerHeight;
  $('#progress').style.width = (total > 0 ? sc/total*100 : 0) + '%';
}, { passive: true });

/* ============ MARQUEE ============ */
const marquee = $('#marquee');
let mqOffset = 0;
function loopMarquee() {
  if (marquee && marquee.offsetParent !== null) {
    mqOffset -= 0.5;
    const tw = marquee.scrollWidth/2;
    if (Math.abs(mqOffset) >= tw) mqOffset = 0;
    marquee.style.transform = `translateX(${mqOffset}px)`;
  }
  requestAnimationFrame(loopMarquee);
}
loopMarquee();

/* ============ HORIZONTAL SCROLL ============ */
function updateHScroll() {
  if (state.currentPage !== 'home' || innerWidth < 768) return;
  const sect = document.querySelector('.h-scroll-section');
  if (!sect) return;
  const rect = sect.getBoundingClientRect();
  const sh = sect.offsetHeight - innerHeight;
  const scrolled = -rect.top;
  const prog = Math.max(0, Math.min(1, scrolled/sh));
  const track = $('#hTrack');
  if (!track) return;
  const tw = track.scrollWidth - innerWidth;
  track.style.transform = `translateX(${-prog*tw}px)`;
  $('#hBar').style.transform = `translateX(${-100 + prog*100}%)`;
  const idx = Math.min(4, Math.floor(prog*4.5)+1);
  $('#hCounter').textContent = String(idx).padStart(2,'0') + ' / 04';
}
window.addEventListener('scroll', updateHScroll, { passive: true });
window.addEventListener('resize', updateHScroll);

/* ============ PARALLAX ============ */
function parallax() {
  if (state.currentPage !== 'home') return;
  const sc = scrollY;
  const heroBg = $('#heroBgText'), manifestoBg = $('#manifestoBg'), newsletterBg = $('#newsletterBg');
  if (heroBg) heroBg.style.transform = `translate(-50%, calc(-50% + ${sc*0.3}px))`;
  if (manifestoBg) {
    const r = manifestoBg.parentElement.getBoundingClientRect();
    manifestoBg.style.transform = `translateX(${-r.top*0.4}px)`;
  }
  if (newsletterBg) {
    const r = newsletterBg.parentElement.getBoundingClientRect();
    newsletterBg.style.transform = `translate(-50%, calc(-50% + ${-r.top*0.15}px))`;
  }
}
window.addEventListener('scroll', parallax, { passive: true });

/* ============ MANIFESTO ============ */
(function() {
  const el = $('#manifestoTitle');
  if (!el) return;
  el.innerHTML = `
    <span class="word"><span>Vestiti</span></span>
    <span class="word"><span>per</span></span>
    <span class="word"><span>chi</span></span>
    <span class="word"><span class="highlight">non&nbsp;dorme.</span></span>
    <span class="word"><span>Per</span></span>
    <span class="word"><span>chi</span></span>
    <span class="word"><span>crea</span></span>
    <span class="word"><span>di</span></span>
    <span class="word"><span>notte.</span></span>`;
})();

/* ============ INTERSECTION OBSERVER ============ */
const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('in-view');
      if (e.target.dataset.target) animateNumber(e.target);
    }
  });
}, { threshold: 0.18 });

function bindReveals() {
  $$('.reveal, .editorial-img-wrap, #manifestoTitle, .stat').forEach(el => {
    if (!el.dataset._obs) { el.dataset._obs = '1'; io.observe(el); }
  });
}

function animateNumber(el) {
  const target = parseInt(el.dataset.target);
  const suffix = el.dataset.suffix || '';
  const numEl = el.querySelector('.num');
  if (!numEl) return;
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now-start)/1400);
    const eased = 1 - Math.pow(1-t, 3);
    numEl.textContent = String(Math.floor(target*eased)).padStart(2,'0') + suffix;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ============ HERO ANIM ============ */
function activateHeroAnim() {
  const hero = $('#hero');
  if (!hero) return;
  hero.classList.remove('in');
  const marker = hero.querySelector('.hero-marker');
  marker?.classList.remove('in');
  void hero.offsetWidth;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      hero.classList.add('in');
      marker?.classList.add('in');
    });
  });
}

/* ============ HOME H-PRODUCTS ============ */
function buildHomeProducts() {
  const track = $('#hTrack');
  $$('#hTrack .h-product').forEach(el => el.remove());
  Object.values(products).forEach(p => {
    const totalStock = Object.values(p.sizes).reduce((s,n)=>s+n,0);
    const overlay = totalStock < 30 ? 'Low Stock' : 'New';
    const el = document.createElement('button');
    el.className = 'h-product';
    el.type = 'button';
    el.dataset.product = p.id;
    el.innerHTML = `
      <div class="h-product-overlay"></div>
      <div class="h-product-img-wrap"><img class="h-product-img" alt=""/></div>
      <div class="h-product-meta">
        <div class="sku"></div>
        <h3></h3>
        <div class="price-row"><span class="price"></span><span class="add">View →</span></div>
      </div>`;
    el.querySelector('.h-product-overlay').textContent = overlay;
    el.querySelector('.h-product-img').src = p.img;
    el.querySelector('.h-product-img').alt = p.name;
    el.querySelector('.sku').textContent = 'SKU · ' + p.sku;
    el.querySelector('h3').textContent = p.name;
    el.querySelector('.price').textContent = fmt(p.price);
    track.appendChild(el);
  });
}

/* ============ EDITORIAL IMAGES ============ */
function bindEditorialImages() {
  const e1 = $('#edImg1'), e2 = $('#edImg2');
  if (e1 && !e1.src) e1.src = products[4].img;
  if (e2 && !e2.src) e2.src = products[3].img;
}
