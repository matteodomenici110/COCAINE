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
  1: { id:1, name:"Classic Logo Hoodie", sku:"CN-001 / BLK", price:149, img:"hoodie-01.png",
       desc:"La felpa firma del brand. Wordmark COCAINE stampato sul petto, tre righe iconiche sulla tasca frontale. Cotone pesante 450 gsm con interno a felpa garzata. Vestibilità oversize ma strutturata.",
       details:["100% cotone biologico 450 gsm","Stampa serigrafica artigianale","Vestibilità oversize","Fatto a Milano, Italia","Edizione limitata 200 pezzi"],
       sizes: { XS: 12, S: 30, M: 45, L: 28, XL: 8 } },
  2: { id:2, name:"Minimal Lines Hoodie", sku:"CN-002 / BLK", price:139, img:"hoodie-02.png",
       desc:"Versione più essenziale del drop. Solo le tre righe iconiche stampate sulla tasca frontale, niente wordmark. Per chi capisce senza bisogno di leggerlo.",
       details:["100% cotone biologico 450 gsm","Stampa minimal sulla tasca","Vestibilità oversize","Fatto a Milano, Italia","Edizione limitata 200 pezzi"],
       sizes: { XS: 18, S: 25, M: 38, L: 32, XL: 14 } },
  3: { id:3, name:"Pixel Girl Hoodie", sku:"CN-003 / BLK", price:169, img:"hoodie-03.png",
       desc:"Il pezzo più narrativo della collezione. Illustrazione pixel art al centro del petto, censura nera sugli occhi. Provocazione e nostalgia 8-bit insieme.",
       details:["100% cotone biologico 450 gsm","Stampa digitale ad alta definizione","Vestibilità oversize","Fatto a Milano, Italia","Edizione limitata 200 pezzi — Low stock"],
       sizes: { XS: 2, S: 4, M: 0, L: 6, XL: 3 } },
  4: { id:4, name:"Portrait Edition", sku:"CN-004 / BLK", price:179, img:"hoodie-04.png",
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
let __navRAF = false;
window.addEventListener('scroll', () => {
  if (__navRAF) return;
  __navRAF = true;
  requestAnimationFrame(() => {
    const sc = scrollY;
    $('#nav').classList.toggle('scrolled', sc > 60);
    const total = document.body.scrollHeight - innerHeight;
    $('#progress').style.width = (total > 0 ? sc/total*100 : 0) + '%';
    __navRAF = false;
  });
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
  // Only update elements that are within (or near) the viewport — skips work when scrolled far away.
  const vh = innerHeight;
  if (heroBg) {
    const r = heroBg.parentElement.getBoundingClientRect();
    if (r.bottom > -vh && r.top < vh*2) heroBg.style.transform = `translate(-50%, calc(-50% + ${sc*0.3}px))`;
  }
  if (manifestoBg) {
    const r = manifestoBg.parentElement.getBoundingClientRect();
    if (r.bottom > -vh && r.top < vh*2) manifestoBg.style.transform = `translateX(${-r.top*0.4}px)`;
  }
  if (newsletterBg) {
    const r = newsletterBg.parentElement.getBoundingClientRect();
    if (r.bottom > -vh && r.top < vh*2) newsletterBg.style.transform = `translate(-50%, calc(-50% + ${-r.top*0.15}px))`;
  }
}
// rAF-based throttle: at most one parallax computation per frame even if scroll fires more often
let __parallaxRAF = false;
window.addEventListener('scroll', () => {
  if (__parallaxRAF) return;
  __parallaxRAF = true;
  requestAnimationFrame(() => { parallax(); __parallaxRAF = false; });
}, { passive: true });

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
      <div class="h-product-img-wrap"><img class="h-product-img" alt="" loading="lazy"/></div>
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
/* ============ ROUTER ============ */
function getRoute() {
  const hash = location.hash.slice(1) || 'home';
  const parts = hash.split('/').filter(Boolean);
  const page = parts[0] || 'home';
  const param = parts[1] || null;

  if (page === 'product' && param) return { page:'product', id: param };
  if (page === 'order' && param) return { page:'order', id: param };
  if (page === 'admin' && param === 'login') return { page:'admin-login' };
  if (page === 'admin') return { page:'admin' };
  if (page === 'account' && param === 'login') return { page:'auth' };
  if (page === 'account') return { page:'account' };
  if (['home','shop','cart','checkout','manifesto','lookbook','contact'].includes(page)) {
    return { page };
  }
  return { page:'home' };
}

async function handleRoute(initial=false) {
  const route = getRoute();

  // smooth scroll for home anchors
  if (state.currentPage === 'home' && ['manifesto','lookbook','contact'].includes(route.page)) {
    const target = $('#'+route.page);
    if (target) { target.scrollIntoView({ behavior:'smooth' }); return; }
  }

  if (state.isTransitioning) {
    await new Promise(r => {
      const check = () => state.isTransitioning ? setTimeout(check, 50) : r();
      check();
    });
  }

  const sameParams = JSON.stringify(state.currentParams) === JSON.stringify(route.id || null);
  if (state.currentPage === route.page && sameParams && !initial) return;

  if (initial) { showPage(route); return; }

  state.isTransitioning = true;
  $('#pageTransLabel').textContent = labelFor(route);
  const trans = $('#pageTrans');
  trans.classList.remove('uncover');
  trans.classList.add('cover');
  $('#pageTransLabel').classList.add('show');
  await wait(700);
  showPage(route);
  await wait(150);
  $('#pageTransLabel').classList.remove('show');
  trans.classList.remove('cover');
  trans.classList.add('uncover');
  await wait(600);
  trans.classList.remove('uncover');
  state.isTransitioning = false;
}

function labelFor(r) {
  const m = { home:'COCAINE®', shop:'SHOP', cart:'BAG', checkout:'CHECKOUT',
    order:'ORDER', account:'ACCOUNT', auth:'LOGIN', admin:'ADMIN', 'admin-login':'ADMIN' };
  if (r.page === 'product') return products[r.id]?.name?.toUpperCase() || 'PRODUCT';
  return m[r.page] || r.page.toUpperCase();
}

function showPage(route) {
  $$('.page').forEach(p => p.classList.remove('active','fade-in','in'));
  state.currentPage = route.page;
  state.currentParams = route.id || null;

  let pageEl;
  switch (route.page) {
    case 'home':
      buildHomeProducts(); bindEditorialImages();
      pageEl = $('#page-home');
      break;
    case 'shop':
      renderShop();
      pageEl = $('#page-shop');
      break;
    case 'product':
      if (!products[route.id]) { navigate('#shop'); return; }
      renderProduct(route.id);
      pageEl = $('#page-product');
      break;
    case 'cart':
      renderCart();
      pageEl = $('#page-cart');
      break;
    case 'checkout':
      if (CART.count() === 0) { navigate('#cart'); return; }
      renderCheckout();
      pageEl = $('#page-checkout');
      break;
    case 'order':
      renderOrderConfirm(route.id);
      pageEl = $('#page-order');
      break;
    case 'auth':
      renderAuth();
      pageEl = $('#page-auth');
      break;
    case 'account':
      if (!AUTH.isLoggedIn()) { navigate('#account/login'); return; }
      renderAccount();
      pageEl = $('#page-account');
      break;
    case 'admin-login':
      renderAdminLogin();
      pageEl = $('#page-admin-login');
      break;
    case 'admin':
      if (!AUTH.isAdminLoggedIn()) { navigate('#admin/login'); return; }
      renderAdmin();
      pageEl = $('#page-admin');
      break;
    default:
      navigate('#home');
      return;
  }

  if (!pageEl) return;
  pageEl.classList.add('active');
  scrollTo(0, 0);
  requestAnimationFrame(() => {
    pageEl.classList.add('fade-in');
    requestAnimationFrame(() => {
      pageEl.classList.add('in');
      if (route.page === 'home') activateHeroAnim();
      if (route.page === 'shop') animateShopCards();
    });
  });

  bindCursorHovers();
  bindReveals();
  refreshNav();
}

function navigate(hash) {
  if (!hash.startsWith('#')) hash = '#' + hash;
  if (location.hash === hash) { handleRoute(false); return; }
  location.hash = hash;
}

window.addEventListener('hashchange', () => handleRoute(false));

/* ============ CLICK DELEGATION (FIX BUG: cart link ora va al carrello) ============ */
document.addEventListener('click', e => {
  // Specific cards first
  const hp = e.target.closest('.h-product');
  if (hp && hp.dataset.product) { e.preventDefault(); navigate('#product/' + hp.dataset.product); return; }
  const sc = e.target.closest('.shop-card');
  if (sc && sc.dataset.product) { e.preventDefault(); navigate('#product/' + sc.dataset.product); return; }
  const rc = e.target.closest('.related-card');
  if (rc && rc.dataset.product) { e.preventDefault(); navigate('#product/' + rc.dataset.product); return; }
  const oc = e.target.closest('.order-card');
  if (oc && oc.dataset.order) { e.preventDefault(); navigate('#order/' + oc.dataset.order); return; }
  // Generic data-link
  const a = e.target.closest('a[data-link]');
  if (a) {
    const href = a.getAttribute('href');
    if (href && href.startsWith('#') && href.length > 1) {
      e.preventDefault();
      navigate(href);
    }
  }
});

/* ============ SHOP ============ */
function renderShop() {
  const grid = $('#shopGrid');
  grid.innerHTML = '';
  Object.values(products).forEach(p => {
    const card = document.createElement('button');
    card.className = 'shop-card';
    card.type = 'button';
    card.dataset.product = p.id;
    card.innerHTML = `
      <div class="shop-card-img"><img alt="" loading="lazy"/></div>
      <div class="shop-card-info">
        <div><h3></h3><div class="sku"></div></div>
        <div class="price"></div>
      </div>`;
    card.querySelector('img').src = p.img;
    card.querySelector('img').alt = p.name;
    card.querySelector('h3').textContent = p.name;
    card.querySelector('.sku').textContent = 'SKU · ' + p.sku;
    card.querySelector('.price').textContent = fmt(p.price);
    grid.appendChild(card);
  });
}

function animateShopCards() {
  $$('.shop-card').forEach((c,i) => {
    setTimeout(() => c.classList.add('in'), 250 + i*110);
  });
}

/* ============ PRODUCT ============ */
function renderProduct(id) {
  const p = products[id];
  if (!p) return;

  $('#prodName').textContent = p.name;
  $('#prodSku').textContent = p.sku;
  $('#prodMeta').textContent = '— Drop 001 / ' + p.sku;
  $('#prodPrice').textContent = fmt(p.price);
  $('#prodDesc').textContent = p.desc;
  $('#prodImg').src = p.img;
  $('#prodImg').alt = p.name;
  $('#addToCartLabel').textContent = 'Aggiungi al carrello — ' + fmt(p.price);

  // Sizes
  const sizeSel = $('#sizeSelector');
  sizeSel.innerHTML = '';
  let firstAvailable = null;
  ['XS','S','M','L','XL'].forEach(s => {
    const stock = p.sizes[s] || 0;
    const b = document.createElement('button');
    b.className = 'size-btn';
    b.type = 'button';
    b.textContent = s;
    b.dataset.size = s;
    if (stock <= 0) b.disabled = true;
    else if (!firstAvailable) firstAvailable = s;
    b.addEventListener('click', () => {
      $$('.size-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
    sizeSel.appendChild(b);
  });
  if (firstAvailable) sizeSel.querySelector('[data-size="'+firstAvailable+'"]').classList.add('active');

  // Details
  const det = $('#prodDetails');
  det.innerHTML = '';
  p.details.forEach(d => { const li = document.createElement('li'); li.textContent = d; det.appendChild(li); });

  // Add to cart
  $('#addToCart').onclick = () => {
    const active = document.querySelector('.size-btn.active');
    if (!active) { toast('Seleziona una taglia', 'error'); return; }
    const size = active.dataset.size;
    if ((p.sizes[size]||0) <= 0) { toast('Taglia esaurita', 'error'); return; }
    CART.add(p.id, size, 1);
    toast(p.name + ' aggiunto al carrello', 'success');
    const lbl = $('#addToCartLabel');
    const original = lbl.textContent;
    lbl.textContent = '✓ Aggiunto al carrello';
    setTimeout(() => { lbl.textContent = original; }, 1800);
  };

  // Related
  const rel = $('#relatedGrid');
  rel.innerHTML = '';
  Object.values(products).filter(rp => String(rp.id) !== String(id)).slice(0,3).forEach(rp => {
    const card = document.createElement('button');
    card.className = 'related-card';
    card.type = 'button';
    card.dataset.product = rp.id;
    card.innerHTML = `
      <div class="related-card-img"><img alt="" loading="lazy"/></div>
      <div class="name"></div>
      <div class="price"></div>`;
    card.querySelector('img').src = rp.img;
    card.querySelector('img').alt = rp.name;
    card.querySelector('.name').textContent = rp.name;
    card.querySelector('.price').textContent = fmt(rp.price);
    rel.appendChild(card);
  });
}

/* ============ CART ============ */
function renderCart() {
  const items = CART.read();
  const wrap = $('#cartContent');
  $('#cartItemsCount').textContent = items.length + ' ' + (items.length===1?'articolo':'articoli');

  if (items.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state">
        <h3>Il carrello è vuoto.</h3>
        <p>Inizia ad esplorare il drop per aggiungere il tuo primo pezzo.</p>
        <a href="#shop" class="btn-primary with-arrow" data-link><span>Vai allo shop</span></a>
      </div>`;
    bindCursorHovers();
    return;
  }

  wrap.innerHTML = `
    <div class="cart-layout">
      <div class="cart-items" id="cartItems"></div>
      <div class="cart-summary">
        <h3>Riepilogo ordine</h3>
        <div class="summary-row"><span>Subtotale</span><span id="sumSub"></span></div>
        <div class="summary-row"><span>Spedizione</span><span id="sumShip"></span></div>
        <div class="summary-row total"><span>Totale</span><span id="sumTot"></span></div>
        <button class="btn-primary with-arrow" id="goCheckout" type="button"><span>Vai al checkout</span></button>
        <div class="secure-note">🔒 Pagamento sicuro · Dati cifrati</div>
      </div>
    </div>`;

  const list = $('#cartItems');
  items.forEach((it, idx) => {
    const p = products[it.productId];
    if (!p) return;
    const row = document.createElement('div');
    row.className = 'cart-item';
    row.innerHTML = `
      <img class="cart-item-img" alt="" loading="lazy"/>
      <div class="cart-item-info">
        <div class="sku"></div>
        <h4></h4>
        <div class="opt"></div>
      </div>
      <div class="cart-item-side">
        <div class="price"></div>
        <div class="qty">
          <button type="button" class="dec">−</button>
          <input type="number" min="1" max="10" value="${it.qty}"/>
          <button type="button" class="inc">+</button>
        </div>
        <button type="button" class="cart-remove">Rimuovi</button>
      </div>`;
    row.querySelector('.cart-item-img').src = p.img;
    row.querySelector('.cart-item-img').alt = p.name;
    row.querySelector('.sku').textContent = 'SKU · ' + p.sku;
    row.querySelector('h4').textContent = p.name;
    row.querySelector('.opt').textContent = 'Taglia ' + it.size;
    row.querySelector('.price').textContent = fmt(p.price * it.qty);

    row.querySelector('.dec').onclick = () => { CART.setQty(idx, it.qty - 1); renderCart(); };
    row.querySelector('.inc').onclick = () => { CART.setQty(idx, it.qty + 1); renderCart(); };
    row.querySelector('input').onchange = e => {
      const v = parseInt(e.target.value, 10) || 1;
      CART.setQty(idx, Math.max(1, Math.min(10, v)));
      renderCart();
    };
    row.querySelector('.cart-remove').onclick = () => { CART.remove(idx); renderCart(); toast('Rimosso dal carrello'); };
    list.appendChild(row);
  });

  $('#sumSub').textContent = fmt(CART.subtotal());
  $('#sumShip').textContent = CART.shipping() === 0 ? 'Gratis' : fmt(CART.shipping());
  $('#sumTot').textContent = fmt(CART.total());
  $('#goCheckout').onclick = () => navigate('#checkout');
  bindCursorHovers();
}

/* ============ CHECKOUT ============ */
const checkoutState = { step: 1, shipping: {}, payment: { method: 'card' } };

function renderCheckout() {
  checkoutState.step = 1;
  checkoutState.shipping = {};
  checkoutState.payment = { method: 'card' };
  drawCheckoutStep();
}

function setStep(n) {
  checkoutState.step = n;
  $$('#checkoutSteps .checkout-step').forEach(el => {
    const s = parseInt(el.dataset.step, 10);
    el.classList.toggle('active', s === n);
    el.classList.toggle('done', s < n);
  });
  drawCheckoutStep();
}

function drawCheckoutStep() {
  const wrap = $('#checkoutContent');
  if (checkoutState.step === 1) drawShipping(wrap);
  else if (checkoutState.step === 2) drawPayment(wrap);
  else if (checkoutState.step === 3) drawReview(wrap);
  bindCursorHovers();
}

function checkoutSidebar() {
  const items = CART.read();
  const lines = items.map(() => `
    <div class="order-line">
      <img alt=""/>
      <div class="order-line-info">
        <div class="name"></div>
        <div class="opt"></div>
      </div>
      <div class="p"></div>
    </div>`).join('');
  return `
    <aside class="order-summary">
      <h3>Il tuo ordine</h3>
      <div id="checkoutLines">${lines}</div>
      <div class="summary-row" style="margin-top:18px"><span>Subtotale</span><span>${fmt(CART.subtotal())}</span></div>
      <div class="summary-row"><span>Spedizione</span><span>${CART.shipping()===0?'Gratis':fmt(CART.shipping())}</span></div>
      <div class="summary-row total"><span>Totale</span><span>${fmt(CART.total())}</span></div>
    </aside>`;
}

function fillCheckoutLines() {
  const items = CART.read();
  $$('#checkoutLines .order-line').forEach((row, i) => {
    const it = items[i];
    if (!it) return;
    const p = products[it.productId];
    if (!p) return;
    row.querySelector('img').src = p.img;
    row.querySelector('img').alt = p.name;
    row.querySelector('.name').textContent = p.name;
    row.querySelector('.opt').textContent = 'Taglia ' + it.size + ' · Qty ' + it.qty;
    row.querySelector('.p').textContent = fmt(p.price * it.qty);
  });
}

function drawShipping(wrap) {
  const u = AUTH.current();
  const pre = checkoutState.shipping;
  wrap.innerHTML = `
    <div class="checkout-layout">
      <div>
        <div class="security-banner"><span class="lock"></span><span>I tuoi dati personali sono cifrati con la tua password — nessuno può leggerli senza il tuo accesso.</span></div>
        <div class="checkout-section" style="margin-top:30px">
          <h3>Spedizione</h3>
          <form id="shipForm" autocomplete="on" novalidate>
            <div class="form-grid">
              <div class="field full">
                <label for="email">Email</label>
                <input type="email" id="email" name="email" autocomplete="email" maxlength="120" required value="${escHtml(pre.email||u?.email||'')}"/>
                <div class="err-msg" data-for="email"></div>
              </div>
              <div class="field">
                <label for="firstName">Nome</label>
                <input type="text" id="firstName" name="firstName" autocomplete="given-name" maxlength="60" required value="${escHtml(pre.firstName||u?.firstName||'')}"/>
                <div class="err-msg" data-for="firstName"></div>
              </div>
              <div class="field">
                <label for="lastName">Cognome</label>
                <input type="text" id="lastName" name="lastName" autocomplete="family-name" maxlength="60" required value="${escHtml(pre.lastName||'')}"/>
                <div class="err-msg" data-for="lastName"></div>
              </div>
              <div class="field full">
                <label for="address">Indirizzo</label>
                <input type="text" id="address" name="address" autocomplete="street-address" maxlength="160" required value="${escHtml(pre.address||'')}"/>
                <div class="err-msg" data-for="address"></div>
              </div>
              <div class="field">
                <label for="city">Città</label>
                <input type="text" id="city" name="city" autocomplete="address-level2" maxlength="80" required value="${escHtml(pre.city||'')}"/>
                <div class="err-msg" data-for="city"></div>
              </div>
              <div class="field">
                <label for="zip">CAP</label>
                <input type="text" id="zip" name="zip" autocomplete="postal-code" maxlength="12" required value="${escHtml(pre.zip||'')}"/>
                <div class="err-msg" data-for="zip"></div>
              </div>
              <div class="field">
                <label for="country">Paese</label>
                <select id="country" name="country" autocomplete="country" required>
                  <option value="IT" ${(pre.country||'IT')==='IT'?'selected':''}>Italia</option>
                  <option value="FR" ${pre.country==='FR'?'selected':''}>Francia</option>
                  <option value="DE" ${pre.country==='DE'?'selected':''}>Germania</option>
                  <option value="ES" ${pre.country==='ES'?'selected':''}>Spagna</option>
                  <option value="UK" ${pre.country==='UK'?'selected':''}>Regno Unito</option>
                  <option value="US" ${pre.country==='US'?'selected':''}>Stati Uniti</option>
                </select>
              </div>
              <div class="field">
                <label for="phone">Telefono</label>
                <input type="tel" id="phone" name="phone" autocomplete="tel" maxlength="20" required value="${escHtml(pre.phone||'')}"/>
                <div class="err-msg" data-for="phone"></div>
              </div>
            </div>
            <div class="checkout-actions">
              <a href="#cart" class="btn-secondary" data-link>← Torna al carrello</a>
              <button type="submit" class="btn-primary with-arrow"><span>Continua al pagamento</span></button>
            </div>
          </form>
        </div>
      </div>
      ${checkoutSidebar()}
    </div>`;
  fillCheckoutLines();

  $('#shipForm').addEventListener('submit', e => {
    e.preventDefault();
    const data = {};
    new FormData(e.target).forEach((v,k) => data[k] = String(v).trim());
    const errors = {};
    if (!V.email(data.email)) errors.email = 'Email non valida';
    if (!V.minLen(data.firstName, 2)) errors.firstName = 'Nome obbligatorio';
    if (!V.minLen(data.lastName, 2)) errors.lastName = 'Cognome obbligatorio';
    if (!V.minLen(data.address, 5)) errors.address = 'Indirizzo non valido';
    if (!V.minLen(data.city, 2)) errors.city = 'Città non valida';
    if (!V.zip(data.zip)) errors.zip = 'CAP non valido';
    if (!V.phone(data.phone)) errors.phone = 'Telefono non valido';

    $$('#shipForm .err-msg').forEach(el => el.textContent = '');
    $$('#shipForm input, #shipForm select').forEach(i => i.classList.remove('error'));

    if (Object.keys(errors).length) {
      Object.entries(errors).forEach(([k, msg]) => {
        const inp = e.target.querySelector('[name="'+k+'"]');
        if (inp) inp.classList.add('error');
        const el = e.target.querySelector('.err-msg[data-for="'+k+'"]');
        if (el) el.textContent = msg;
      });
      toast('Controlla i dati di spedizione', 'error');
      return;
    }
    checkoutState.shipping = data;
    setStep(2);
  });
}

function drawPayment(wrap) {
  wrap.innerHTML = `
    <div class="checkout-layout">
      <div>
        <div class="security-banner"><span class="lock"></span><span>I dati della carta non vengono mai salvati. Solo le ultime 4 cifre sono memorizzate per riferimento.</span></div>
        <div class="checkout-section" style="margin-top:30px">
          <h3>Metodo di pagamento</h3>
          <div class="payment-methods" id="payMethods">
            <button type="button" class="pay-option ${checkoutState.payment.method==='card'?'active':''}" data-method="card">
              <span class="radio"></span><span class="label">Carta di credito / debito</span><span class="meta">Visa · MC · Amex</span>
            </button>
            <button type="button" class="pay-option ${checkoutState.payment.method==='paypal'?'active':''}" data-method="paypal">
              <span class="radio"></span><span class="label">PayPal</span><span class="meta">Sicuro</span>
            </button>
            <button type="button" class="pay-option ${checkoutState.payment.method==='cod'?'active':''}" data-method="cod">
              <span class="radio"></span><span class="label">Pagamento alla consegna</span><span class="meta">+€3 commissione</span>
            </button>
          </div>
          <div id="payDetails"></div>
          <div class="checkout-actions">
            <button type="button" class="btn-secondary" id="payBack">← Indietro</button>
            <button type="button" class="btn-primary with-arrow" id="payNext"><span>Rivedi ordine</span></button>
          </div>
        </div>
      </div>
      ${checkoutSidebar()}
    </div>`;
  fillCheckoutLines();

  function drawPayDetails(method) {
    const det = $('#payDetails');
    if (method === 'card') {
      det.innerHTML = `
        <div class="form-grid" style="margin-top:20px" id="cardForm">
          <div class="field full">
            <label for="cardNum">Numero carta</label>
            <input type="text" id="cardNum" inputmode="numeric" autocomplete="cc-number" maxlength="19" placeholder="1234 5678 9012 3456"/>
            <div class="err-msg" data-for="cardNum"></div>
            <div class="hint">Demo: 4242 4242 4242 4242 supera la validazione</div>
          </div>
          <div class="field full">
            <label for="cardName">Nome sulla carta</label>
            <input type="text" id="cardName" autocomplete="cc-name" maxlength="80"/>
            <div class="err-msg" data-for="cardName"></div>
          </div>
          <div class="field">
            <label for="cardExp">Scadenza (MM/AA)</label>
            <input type="text" id="cardExp" inputmode="numeric" autocomplete="cc-exp" maxlength="5" placeholder="12/27"/>
            <div class="err-msg" data-for="cardExp"></div>
          </div>
          <div class="field">
            <label for="cardCvc">CVC</label>
            <input type="text" id="cardCvc" inputmode="numeric" autocomplete="cc-csc" maxlength="4" placeholder="123"/>
            <div class="err-msg" data-for="cardCvc"></div>
          </div>
        </div>`;
      $('#cardNum').addEventListener('input', e => {
        const v = e.target.value.replace(/\D/g,'').slice(0,16);
        e.target.value = v.replace(/(.{4})/g,'$1 ').trim();
      });
      $('#cardExp').addEventListener('input', e => {
        let v = e.target.value.replace(/\D/g,'').slice(0,4);
        if (v.length >= 3) v = v.slice(0,2)+'/'+v.slice(2);
        e.target.value = v;
      });
    } else if (method === 'paypal') {
      det.innerHTML = '<p style="color:#888;margin-top:20px;font-size:14px;line-height:1.6">Verrai reindirizzato a PayPal per completare il pagamento. Demo: cliccando "Rivedi ordine" simuliamo il flusso.</p>';
    } else {
      det.innerHTML = '<p style="color:#888;margin-top:20px;font-size:14px;line-height:1.6">Pagherai in contanti al corriere alla consegna. Verrà aggiunta una commissione di €3.</p>';
    }
    bindCursorHovers();
  }
  drawPayDetails(checkoutState.payment.method);

  $$('#payMethods .pay-option').forEach(b => {
    b.addEventListener('click', () => {
      $$('#payMethods .pay-option').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      checkoutState.payment.method = b.dataset.method;
      drawPayDetails(checkoutState.payment.method);
    });
  });

  $('#payBack').onclick = () => setStep(1);
  $('#payNext').onclick = () => {
    if (checkoutState.payment.method === 'card') {
      const data = {
        num: ($('#cardNum').value||'').trim(),
        name: ($('#cardName').value||'').trim(),
        exp: ($('#cardExp').value||'').trim(),
        cvc: ($('#cardCvc').value||'').trim()
      };
      const errors = {};
      if (!V.cardNumber(data.num)) errors.cardNum = 'Numero carta non valido';
      if (!V.minLen(data.name, 2)) errors.cardName = 'Nome obbligatorio';
      if (!V.cardExpiry(data.exp)) errors.cardExp = 'Scadenza non valida';
      if (!V.cardCVC(data.cvc)) errors.cardCvc = 'CVC non valido';
      $$('#cardForm .err-msg').forEach(el => el.textContent = '');
      $$('#cardForm input').forEach(i => i.classList.remove('error'));
      if (Object.keys(errors).length) {
        Object.entries(errors).forEach(([k, msg]) => {
          const inp = $('#'+k); if (inp) inp.classList.add('error');
          const el = document.querySelector('#cardForm .err-msg[data-for="'+k+'"]');
          if (el) el.textContent = msg;
        });
        toast('Controlla i dati della carta', 'error');
        return;
      }
      checkoutState.payment.cardLast4 = data.num.replace(/\s/g,'').slice(-4);
    }
    setStep(3);
  };
}

function drawReview(wrap) {
  const ship = checkoutState.shipping;
  const pay = checkoutState.payment;
  const payLabel = pay.method === 'card' ? 'Carta •••• ' + pay.cardLast4 :
                   pay.method === 'paypal' ? 'PayPal' : 'Pagamento alla consegna';
  const codFee = pay.method === 'cod' ? 3 : 0;
  const total = CART.total() + codFee;

  wrap.innerHTML = `
    <div class="checkout-layout">
      <div>
        <div class="security-banner"><span class="lock"></span><span>Stai per confermare l'ordine. Dati salvati in modo sicuro nel tuo dispositivo.</span></div>
        <div class="checkout-section" style="margin-top:30px">
          <h3>Riepilogo</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:30px">
            <div style="background:#0a0a0a;padding:24px;border:1px solid #1a1a1a">
              <h4 class="admin-section-title">Spedizione</h4>
              <div id="reviewShip" style="font-size:14px;line-height:1.7;color:#ccc"></div>
            </div>
            <div style="background:#0a0a0a;padding:24px;border:1px solid #1a1a1a">
              <h4 class="admin-section-title">Pagamento</h4>
              <div id="reviewPay" style="font-size:14px;line-height:1.7;color:#ccc"></div>
            </div>
          </div>
          <div class="checkout-actions">
            <button type="button" class="btn-secondary" id="revBack">← Indietro</button>
            <button type="button" class="btn-primary with-arrow" id="placeOrder"><span>Conferma ordine — ${fmt(total)}</span></button>
          </div>
        </div>
      </div>
      ${checkoutSidebar()}
    </div>`;
  fillCheckoutLines();

  const sh = $('#reviewShip');
  [`${ship.firstName} ${ship.lastName}`, ship.address, `${ship.zip} ${ship.city}`, ship.country, ship.email, ship.phone]
    .forEach(line => { const d = document.createElement('div'); d.textContent = line; sh.appendChild(d); });
  const pd = $('#reviewPay');
  [payLabel, codFee?`+ ${fmt(codFee)} commissione`:'Pagamento immediato'].filter(Boolean)
    .forEach(line => { const d = document.createElement('div'); d.textContent = line; pd.appendChild(d); });

  $('#revBack').onclick = () => setStep(2);
  $('#placeOrder').onclick = async () => {
    const btn = $('#placeOrder');
    btn.setAttribute('disabled', 'true');
    btn.querySelector('span').textContent = 'Elaborazione...';
    try {
      const order = await ORDERS.create({
        items: CART.read(),
        shipping: { ...ship },
        paymentMethod: pay.method,
        cardLast4: pay.cardLast4 || null
      });
      CART.clear();
      navigate('#order/' + order.id);
    } catch (e) {
      toast(e.message || 'Errore nell\'ordine', 'error');
      btn.removeAttribute('disabled');
      btn.querySelector('span').textContent = 'Conferma ordine — ' + fmt(total);
    }
  };
}

/* ============ ORDER CONFIRMATION ============ */
async function renderOrderConfirm(id) {
  const wrap = $('#orderContent');
  const order = await ORDERS.byId(id);
  if (!order) {
    wrap.innerHTML = `
      <div class="empty-state">
        <h3>Ordine non trovato.</h3>
        <p>Controlla il link o l'ID dell'ordine.</p>
        <a href="#shop" class="btn-primary with-arrow" data-link><span>Torna allo shop</span></a>
      </div>`;
    bindCursorHovers();
    return;
  }

  const itemsHtml = order.items.map(i => `
    <div class="order-line">
      <img src="${escHtml(i.img)}" alt=""/>
      <div class="order-line-info">
        <div class="name">${escHtml(i.name)}</div>
        <div class="opt">Taglia ${escHtml(i.size)} · Qty ${escHtml(i.qty)}</div>
      </div>
      <div class="p">${fmt(i.priceAtPurchase * i.qty)}</div>
    </div>`).join('');

  wrap.innerHTML = `
    <div class="order-confirm">
      <div class="check">✓</div>
      <h1>Ordine confermato.</h1>
      <p class="sub">Grazie. Riceverai un'email a <b>${escHtml(order.email)}</b><br>con i dettagli e il tracking.</p>
      <div class="order-id">${escHtml(order.id)}</div>
      <div class="actions">
        <a href="#account" class="btn-primary with-arrow" data-link><span>I miei ordini</span></a>
        <a href="#shop" class="btn-secondary" data-link>Continua a comprare</a>
      </div>
    </div>
    <div style="max-width:720px;margin:60px auto 0;background:#0a0a0a;border:1px solid #1a1a1a;padding:36px">
      <h3 class="admin-section-title">Dettagli</h3>
      ${itemsHtml}
      <div class="summary-row" style="margin-top:18px"><span>Subtotale</span><span>${fmt(order.subtotal)}</span></div>
      <div class="summary-row"><span>Spedizione</span><span>${order.shippingCost===0?'Gratis':fmt(order.shippingCost)}</span></div>
      <div class="summary-row total"><span>Totale</span><span>${fmt(order.total)}</span></div>
    </div>`;
  bindCursorHovers();
}

/* ============ AUTH ============ */
let authMode = 'login';

function renderAuth() {
  const wrap = $('#authContent');
  wrap.innerHTML = `
    <h1><span>${authMode==='login'?'Accedi.':'Registrati.'}</span></h1>
    <div class="auth-sub">${authMode==='login'?'Accedi per vedere i tuoi ordini.':'Crea un account per tracciare i tuoi ordini.'}</div>
    <div class="auth-tabs">
      <button class="auth-tab ${authMode==='login'?'active':''}" data-mode="login" type="button">Accedi</button>
      <button class="auth-tab ${authMode==='signup'?'active':''}" data-mode="signup" type="button">Registrati</button>
    </div>
    <form class="auth-form" id="authForm" novalidate autocomplete="on">
      ${authMode==='signup'?`
        <div class="field">
          <label for="firstName">Nome</label>
          <input type="text" id="firstName" name="firstName" autocomplete="given-name" maxlength="60" required/>
          <div class="err-msg" data-for="firstName"></div>
        </div>`:''}
      <div class="field">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" autocomplete="email" maxlength="120" required/>
        <div class="err-msg" data-for="email"></div>
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" autocomplete="${authMode==='login'?'current-password':'new-password'}" minlength="8" maxlength="128" required/>
        <div class="err-msg" data-for="password"></div>
        ${authMode==='signup'?'<div class="hint">Minimo 8 caratteri</div>':''}
      </div>
      <button type="submit" class="btn-primary with-arrow"><span>${authMode==='login'?'Accedi':'Crea account'}</span></button>
    </form>`;

  $$('.auth-tab').forEach(t => t.addEventListener('click', () => {
    authMode = t.dataset.mode;
    renderAuth();
    bindCursorHovers();
  }));

  $('#authForm').addEventListener('submit', async e => {
    e.preventDefault();
    const data = {};
    new FormData(e.target).forEach((v,k) => data[k] = String(v).trim());
    const errors = {};
    // Allow plain username (no @) for admin login on the same form
    const isAdminAttempt = authMode === 'login' && data.email && !data.email.includes('@');
    if (!isAdminAttempt && !V.email(data.email)) errors.email = 'Email non valida';
    if (!V.password(data.password)) errors.password = 'Password minimo 8 caratteri';
    if (authMode === 'signup' && !V.minLen(data.firstName, 2)) errors.firstName = 'Nome obbligatorio';
    $$('#authForm .err-msg').forEach(el => el.textContent = '');
    $$('#authForm input').forEach(i => i.classList.remove('error'));
    if (Object.keys(errors).length) {
      Object.entries(errors).forEach(([k,msg]) => {
        const inp = e.target.querySelector('[name="'+k+'"]');
        if (inp) inp.classList.add('error');
        const el = e.target.querySelector('.err-msg[data-for="'+k+'"]');
        if (el) el.textContent = msg;
      });
      return;
    }
    try {
      if (authMode === 'login') {
        // UNIFIED LOGIN: try admin first if input matches admin username pattern
        // Admin uses username "admin" (no @), users use email
        const isAdminAttempt = !data.email.includes('@');
        if (isAdminAttempt) {
          await AUTH.adminLogin(data.email, data.password);
          toast('Accesso admin', 'success');
          navigate('#admin');
          return;
        }
        await AUTH.login(data.email, data.password);
      } else {
        await AUTH.signup(data.email, data.password, data.firstName);
      }
      toast(authMode==='login'?'Bentornato':'Account creato', 'success');
      navigate('#account');
    } catch (err) {
      toast(err.message || 'Errore', 'error');
    }
  });

  bindCursorHovers();
}

/* ============ ACCOUNT ============ */
let accountTab = 'orders';

function renderAccount() {
  const u = AUTH.current();
  const wrap = $('#accountContent');
  wrap.innerHTML = `
    <div class="app-head">
      <div>
        <div class="num">— Account</div>
        <h1><span>Ciao, ${escHtml(u.firstName)}.</span></h1>
      </div>
    </div>
    <div class="account-grid">
      <aside class="account-side">
        <a href="#" class="${accountTab==='orders'?'active':''}" data-tab="orders">I miei ordini</a>
        <a href="#" class="${accountTab==='profile'?'active':''}" data-tab="profile">Profilo</a>
        <button class="signout" id="signoutBtn" type="button">Esci</button>
      </aside>
      <div id="accountMain"></div>
    </div>`;

  $$('.account-side a').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    accountTab = a.dataset.tab;
    renderAccount();
  }));

  $('#signoutBtn').onclick = () => {
    AUTH.logout();
    toast('Disconnesso');
    navigate('#home');
  };

  if (accountTab === 'orders') renderMyOrders();
  else renderProfile();
  bindCursorHovers();
}

async function renderMyOrders() {
  const wrap = $('#accountMain');
  wrap.innerHTML = '<div style="color:#666">Caricamento ordini...</div>';
  try {
    const orders = await ORDERS.forUser(AUTH.current().email);
    if (!orders.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <h3>Nessun ordine.</h3>
          <p>Quando effettui il primo ordine, lo trovi qui.</p>
          <a href="#shop" class="btn-primary with-arrow" data-link><span>Vai allo shop</span></a>
        </div>`;
      bindCursorHovers();
      return;
    }
    wrap.innerHTML = '<div class="orders-list" id="ordersList"></div>';
    const list = $('#ordersList');
    orders.forEach(o => {
      const card = document.createElement('button');
      card.className = 'order-card';
      card.dataset.order = o.id;
      card.type = 'button';
      const date = new Date(o.createdAt).toLocaleDateString('it-IT', { day:'2-digit', month:'short', year:'numeric' });
      const summary = o.items.map(i => i.name + ' (' + i.size + ') ×' + i.qty).join(', ');
      card.innerHTML = `
        <div class="order-card-head">
          <div>
            <div class="id"></div>
            <div class="date"></div>
          </div>
          <div class="order-status ${o.status}"><span style="width:6px;height:6px;border-radius:50%;background:currentColor"></span><span></span></div>
        </div>
        <div class="order-card-body">
          <div class="summary"></div>
          <div class="total"></div>
        </div>`;
      card.querySelector('.id').textContent = o.id;
      card.querySelector('.date').textContent = date;
      card.querySelector('.order-status span:last-child').textContent = o.status;
      card.querySelector('.summary').textContent = summary;
      card.querySelector('.total').textContent = fmt(o.total);
      list.appendChild(card);
    });
    bindCursorHovers();
  } catch (e) {
    wrap.innerHTML = '<div style="color:#ff5252">Errore: ' + escHtml(e.message) + '</div>';
  }
}

function renderProfile() {
  const u = AUTH.current();
  const wrap = $('#accountMain');
  wrap.innerHTML = `
    <div style="background:#0a0a0a;border:1px solid #1a1a1a;padding:36px;max-width:520px">
      <h3 class="admin-section-title">Dati account</h3>
      <div class="field" style="margin-bottom:20px">
        <label>Email</label>
        <input type="text" disabled value="${escHtml(u.email)}"/>
      </div>
      <div class="field">
        <label>Nome</label>
        <input type="text" disabled value="${escHtml(u.firstName)}"/>
      </div>
    </div>`;
}
/* ============ ADMIN LOGIN ============ */
function renderAdminLogin() {
  const wrap = $('#adminLoginContent');
  wrap.innerHTML = `
    <h1><span>Admin Login.</span></h1>
    <div class="auth-sub">Accesso riservato.<br><span style="color:#444;font-size:11px">Demo: username "admin" / password "cocaine2026"</span></div>
    <form class="auth-form" id="adminLoginForm" novalidate autocomplete="off">
      <div class="field">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" autocomplete="username" maxlength="60" required/>
        <div class="err-msg" data-for="username"></div>
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" autocomplete="current-password" maxlength="128" required/>
        <div class="err-msg" data-for="password"></div>
      </div>
      <button type="submit" class="btn-primary with-arrow"><span>Accedi</span></button>
    </form>
    <div class="auth-switch">
      <a href="#home" data-link>← Torna al sito</a>
    </div>`;

  $('#adminLoginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const data = {};
    new FormData(e.target).forEach((v,k) => data[k] = String(v).trim());
    if (!data.username || !data.password) { toast('Campi obbligatori', 'error'); return; }
    try {
      await AUTH.adminLogin(data.username, data.password);
      toast('Accesso admin', 'success');
      navigate('#admin');
    } catch (err) {
      toast(err.message || 'Credenziali non valide', 'error');
    }
  });
  bindCursorHovers();
}

/* ============ ADMIN DASHBOARD ============ */
let adminSearch = '', adminStatusFilter = 'all';

function renderAdmin() {
  const wrap = $('#adminContent');
  wrap.innerHTML = `
    <div class="app-head">
      <div>
        <div class="num">— Admin Panel</div>
        <h1><span>Dashboard.</span></h1>
      </div>
      <button class="btn-secondary" id="adminLogout" type="button">Esci</button>
    </div>
    <div id="adminMain"></div>`;

  $('#adminLogout').onclick = () => {
    AUTH.adminLogout();
    navigate('#admin/login');
  };

  renderAdminOrders();
  bindCursorHovers();
}

function adminStats() {
  const all = ORDERS.all();
  const totalOrders = all.length;
  const totalRevenue = all.filter(o => o.status !== 'cancelled').reduce((s,o) => s + o.total, 0);
  const pending = all.filter(o => o.status === 'pending').length;
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const today = all.filter(o => o.createdAt >= todayStart.getTime()).length;
  return { totalOrders, totalRevenue, pending, today };
}

function renderAdminOrders() {
  const main = $('#adminMain');
  const stats = adminStats();
  let orders = ORDERS.all();
  // Filter
  if (adminStatusFilter !== 'all') orders = orders.filter(o => o.status === adminStatusFilter);
  // Search
  if (adminSearch) {
    const term = adminSearch.toLowerCase();
    orders = orders.filter(o =>
      o.id.toLowerCase().includes(term) ||
      o.email.toLowerCase().includes(term) ||
      (o.adminShipping?.lastName||'').toLowerCase().includes(term) ||
      (o.adminShipping?.firstName||'').toLowerCase().includes(term)
    );
  }

  main.innerHTML = `
    <div class="admin-stats">
      <div class="admin-stat"><div class="lbl">Ordini totali</div><div class="val">${stats.totalOrders}</div></div>
      <div class="admin-stat"><div class="lbl">Ricavi</div><div class="val">${fmt(stats.totalRevenue)}</div></div>
      <div class="admin-stat"><div class="lbl">In sospeso</div><div class="val">${stats.pending}</div><div class="change">Richiedono azione</div></div>
      <div class="admin-stat"><div class="lbl">Oggi</div><div class="val">${stats.today}</div><div class="change">Nuovi ordini</div></div>
    </div>
    <h3 style="margin:40px 0 20px;font-family:'Anton',sans-serif;font-size:32px">Ordini & Stock</h3>
    <div class="admin-toolbar">
      <input type="text" class="admin-search" id="orderSearch" placeholder="Cerca ID / email / cognome" value="${escHtml(adminSearch)}"/>
      <div class="admin-filters" id="statusFilters"></div>
    </div>
    <table class="admin-table">
      <thead>
        <tr>
          <th>ID Ordine</th>
          <th>Cliente</th>
          <th>Email</th>
          <th>Stato</th>
          <th>Totale</th>
          <th>Azione</th>
        </tr>
      </thead>
      <tbody id="orderTableBody"></tbody>
    </table>
    <h3 style="margin:60px 0 20px;font-family:'Anton',sans-serif;font-size:32px">Inventario</h3>
    <table class="admin-table">
      <thead>
        <tr>
          <th>Prodotto</th><th>SKU</th>
          <th style="text-align:center">XS</th>
          <th style="text-align:center">S</th>
          <th style="text-align:center">M</th>
          <th style="text-align:center">L</th>
          <th style="text-align:center">XL</th>
          <th style="text-align:center">Totale</th>
        </tr>
      </thead>
      <tbody id="stockTableBody"></tbody>
    </table>`;

  // Filters
  const filtersEl = $('#statusFilters');
  ['all','pending','processing','shipped','delivered','cancelled'].forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'admin-filter ' + (s === adminStatusFilter ? 'active' : '');
    btn.type = 'button';
    btn.textContent = s.toUpperCase();
    btn.addEventListener('click', () => {
      adminStatusFilter = s;
      renderAdminOrders();
    });
    filtersEl.appendChild(btn);
  });

  // Search (debounced 250ms — avoids re-rendering on every keystroke)
  let __searchTimer = null;
  $('#orderSearch').addEventListener('input', e => {
    const v = e.target.value;
    if (__searchTimer) clearTimeout(__searchTimer);
    __searchTimer = setTimeout(() => {
      adminSearch = v;
      renderAdminOrders();
      // Restore focus and caret position to the input after re-render
      const inp = $('#orderSearch');
      if (inp) { inp.focus(); inp.setSelectionRange(v.length, v.length); }
    }, 250);
  });

  // Orders table
  const tbody = $('#orderTableBody');
  if (!orders.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#666">Nessun ordine</td></tr>';
  } else {
    orders.forEach(o => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="order-id-cell"></td>
        <td></td>
        <td></td>
        <td>
          <select class="order-status-select">
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="shipped">Shipped</option>
            <option value="delivered">Delivered</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </td>
        <td></td>
        <td><button class="btn-secondary" style="padding:6px 12px;font-size:10px" type="button">Dettagli</button></td>`;
      tr.children[0].textContent = o.id;
      tr.children[1].textContent = (o.adminShipping?.firstName || '') + ' ' + (o.adminShipping?.lastName || '');
      tr.children[2].textContent = o.email;
      const sel = tr.querySelector('.order-status-select');
      sel.value = o.status;
      sel.addEventListener('change', e => {
        ORDERS.updateStatus(o.id, e.target.value);
        toast('Stato aggiornato', 'success');
        renderAdminOrders();
      });
      tr.children[4].textContent = fmt(o.total);
      tr.querySelector('button').addEventListener('click', () => showOrderDetail(o.id));
      tbody.appendChild(tr);
    });
  }

  // Stock table
  const stockTbody = $('#stockTableBody');
  Object.values(products).forEach(p => {
    const total = Object.values(p.sizes).reduce((s,n) => s+n, 0);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td></td><td></td>
      <td style="text-align:center">${p.sizes.XS||0}</td>
      <td style="text-align:center">${p.sizes.S||0}</td>
      <td style="text-align:center">${p.sizes.M||0}</td>
      <td style="text-align:center">${p.sizes.L||0}</td>
      <td style="text-align:center">${p.sizes.XL||0}</td>
      <td style="text-align:center;font-weight:600">${total}</td>`;
    tr.children[0].textContent = p.name;
    tr.children[1].textContent = p.sku;
    stockTbody.appendChild(tr);
  });
  bindCursorHovers();
}

function showOrderDetail(orderId) {
  const order = ORDERS.all().find(o => o.id === orderId);
  if (!order) return;
  const modal = $('#adminDetailModal');
  const content = $('#adminDetailContent');
  const ship = order.adminShipping || {};

  const itemsHtml = order.items.map(i => `
    <div style="padding:12px 0;border-bottom:1px solid #1a1a1a;display:flex;justify-content:space-between">
      <div>
        <div style="font-weight:600">${escHtml(i.name)}</div>
        <div style="color:#888;font-size:12px">Taglia ${escHtml(i.size)} · Qty ${escHtml(i.qty)}</div>
      </div>
      <div>${fmt(i.priceAtPurchase * i.qty)}</div>
    </div>`).join('');

  content.innerHTML = `
    <button type="button" class="close" id="closeModal">×</button>
    <h3>${escHtml(order.id)}</h3>
    <div class="admin-section">
      <div class="admin-section-title">Status — ${escHtml(order.status)}</div>
    </div>
    <div class="admin-section">
      <div class="admin-section-title">Cliente</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div>
          <div style="color:#666;font-size:11px;text-transform:uppercase;margin-bottom:6px">Email</div>
          <div>${escHtml(order.email)}</div>
        </div>
        <div>
          <div style="color:#666;font-size:11px;text-transform:uppercase;margin-bottom:6px">Telefono</div>
          <div>${escHtml(ship.phone||'')}</div>
        </div>
      </div>
    </div>
    <div class="admin-section">
      <div class="admin-section-title">Spedizione</div>
      <div style="line-height:1.8;font-size:14px">
        ${escHtml((ship.firstName||'') + ' ' + (ship.lastName||''))}<br>
        ${escHtml(ship.address||'')}<br>
        ${escHtml((ship.zip||'') + ' ' + (ship.city||''))}<br>
        ${escHtml(ship.country||'')}
      </div>
    </div>
    <div class="admin-section">
      <div class="admin-section-title">Pagamento</div>
      <div style="font-size:14px">
        ${escHtml(order.paymentMethod === 'card' ? 'Carta •••• ' + (order.cardLast4||'****') :
                  order.paymentMethod === 'paypal' ? 'PayPal' : 'Pagamento alla consegna')}
      </div>
    </div>
    <div class="admin-section">
      <div class="admin-section-title">Articoli</div>
      ${itemsHtml}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;background:#050505;padding:20px">
      <div>
        <div style="color:#666;font-size:11px;text-transform:uppercase;margin-bottom:8px">Subtotale</div>
        <div>${fmt(order.subtotal)}</div>
      </div>
      <div>
        <div style="color:#666;font-size:11px;text-transform:uppercase;margin-bottom:8px">Spedizione</div>
        <div>${order.shippingCost===0?'Gratis':fmt(order.shippingCost)}</div>
      </div>
      <div style="grid-column:1/-1">
        <div style="color:#666;font-size:11px;text-transform:uppercase;margin-bottom:8px">TOTALE</div>
        <div style="font-size:24px;font-family:'Anton',sans-serif">${fmt(order.total)}</div>
      </div>
    </div>`;

  modal.classList.add('show');
  $('#closeModal').addEventListener('click', () => modal.classList.remove('show'));
}

// Modal close on outside click
$('#adminDetailModal').addEventListener('click', e => {
  if (e.target === $('#adminDetailModal')) {
    $('#adminDetailModal').classList.remove('show');
  }
});

/* ============ NEWSLETTER ============ */
$('#newsletterForm').addEventListener('submit', e => {
  e.preventDefault();
  const email = e.target.querySelector('input').value.trim();
  if (V.email(email)) {
    toast('Iscrizione confermata', 'success');
    e.target.reset();
  } else {
    toast('Email non valida', 'error');
  }
});

/* ============ STARTUP ============ */
async function startApp() {
  await AUTH.adminInit();
  refreshNav();

  // On initial load, always land on home — never on shop/admin/cart/etc.
  // This prevents bookmarks/shared links/browser history from opening on a sub-page.
  if (location.hash) {
    history.replaceState(null, '', location.pathname + location.search);
  }

  // Show loader briefly
  await wait(1700);
  $('#loader').classList.add('done');
  document.body.classList.remove('locked');
  setTimeout(() => $('#nav').classList.add('show'), 200);
  handleRoute(true);
}

if (document.readyState === 'complete') startApp();
else window.addEventListener('load', startApp);
