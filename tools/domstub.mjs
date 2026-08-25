// A deliberately STRICT DOM stub, so the screen modules can be executed in
// Node. Used only by tools/verify_screens.mjs — it never ships.
//
// The point of strictness: a permissive stub that returns undefined for
// anything it does not implement lets a render "pass" while the real browser
// throws. So reading a property nothing ever set is an error here. That is
// what turns `step.taget` from a blank screen on Dom's phone into a failing
// line on the PC.
import { readFileSync } from 'fs';

const SAFE_UNDEFINED = new Set(['then', 'catch', 'finally', 'toJSON', 'inspect',
  'constructor', 'nodeType', 'length', 'name']);

class ClassList {
  constructor(el) { this.el = el; }
  get set() {
    return new Set(String(this.el.className || '').split(/\s+/).filter(Boolean));
  }
  write(set) { this.el.className = [...set].join(' '); }
  add(...names) { const s = this.set; names.forEach((n) => s.add(n)); this.write(s); }
  remove(...names) { const s = this.set; names.forEach((n) => s.delete(n)); this.write(s); }
  contains(name) { return this.set.has(name); }
  toggle(name, force) {
    const s = this.set;
    const on = force === undefined ? !s.has(name) : !!force;
    if (on) s.add(name); else s.delete(name);
    this.write(s);
    return on;
  }
}

// ".chip", "div", ".a.b" — enough for what the app actually queries.
function matches(el, selector) {
  return selector.split(/\s*,\s*/).some((part) => {
    const classes = part.match(/\.[A-Za-z0-9_-]+/g) || [];
    const tag = part.replace(/\.[A-Za-z0-9_-]+/g, '').trim();
    if (tag && el.tagName !== tag.toUpperCase()) return false;
    return classes.every((c) => el.classList.contains(c.slice(1)));
  });
}

class El {
  constructor(tag, ns) {
    this.tagName = String(tag).toUpperCase();
    this.namespaceURI = ns || null;
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this._text = '';
    this._value = '';
    // Real elements carry these with a default; the app reads them before it
    // writes them, and a browser answers `false` rather than throwing.
    this.disabled = false;
    this.checked = false;
    this.hidden = false;
    this.classList = new ClassList(this);
  }

  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === DOCUMENT.documentElement || n === DOCUMENT.body || n.__root === true;
  }

  get value() { return this._value; }
  set value(v) { this._value = v == null ? '' : String(v); }

  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }
  set textContent(v) {
    this.children.forEach((c) => { c.parentNode = null; });
    this.children = [];
    this._text = v == null ? '' : String(v);
  }

  get innerHTML() { return this.textContent; }
  set innerHTML(v) {
    if (v !== '') throw new Error('DOM stub: innerHTML is only supported for clearing');
    this.children.forEach((c) => { c.parentNode = null; });
    this.children = [];
    this._text = '';
  }

  get firstChild() { return this.children[0] || null; }
  get childNodes() { return this.children; }

  append(...nodes) {
    for (const n of nodes) {
      if (n == null) continue;
      if (typeof n === 'string') { this.children.push(new TextNode(n)); continue; }
      if (n.parentNode) n.parentNode.remove(n);
      n.parentNode = this;
      this.children.push(n);
    }
  }
  appendChild(n) { this.append(n); return n; }
  insertBefore(node, ref) {
    const i = ref ? this.children.indexOf(ref) : this.children.length;
    node.parentNode = this;
    this.children.splice(i < 0 ? this.children.length : i, 0, node);
    return node;
  }
  remove(child) {
    if (child) {
      const i = this.children.indexOf(child);
      if (i >= 0) { this.children.splice(i, 1); child.parentNode = null; }
      return;
    }
    if (this.parentNode) this.parentNode.remove(this);
  }

  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'class') this.className = String(v);
  }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }

  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
  }
  dispatch(type, event = {}) {
    for (const fn of this.listeners[type] || []) fn(event);
    const inline = this['on' + type];
    if (typeof inline === 'function') inline(event);
  }
  // A disabled button does not fire in a browser, and a stub that fires
  // anyway would hide exactly the guards that stop bad rows being logged.
  click() {
    if (this.disabled) return false;
    this.dispatch('click', {});
    return true;
  }
  focus() { /* nothing to focus in Node, but the call must not throw */ }

  walk(fn) {
    fn(this);
    for (const c of this.children) if (c.walk) c.walk(fn);
  }
  querySelector(sel) {
    let found = null;
    for (const c of this.children) {
      if (found) break;
      if (c.walk) {
        c.walk((n) => { if (!found && n.tagName && matches(n, sel)) found = n; });
      }
    }
    return found;
  }
  querySelectorAll(sel) {
    const out = [];
    this.walk((n) => { if (n.tagName && n !== this && matches(n, sel)) out.push(n); });
    return out;
  }
  // convenience for the harness, not part of the DOM
  text() { return this.textContent; }
}

class TextNode {
  constructor(text) { this._text = String(text); this.parentNode = null; }
  get textContent() { return this._text; }
  walk() { /* leaves have no children */ }
}

// Reading a property nothing ever defined is a bug in the app, not in the stub.
function strict(el) {
  return new Proxy(el, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol' || prop in target || SAFE_UNDEFINED.has(prop)) {
        return Reflect.get(target, prop, receiver);
      }
      if (prop.startsWith('on')) return undefined;      // handler slots start empty
      throw new Error('DOM stub: <' + target.tagName.toLowerCase()
        + '> has no "' + String(prop) + '" — implement it in tools/domstub.mjs '
        + 'or fix the caller');
    },
    set(target, prop, value) { return Reflect.set(target, prop, value); },
  });
}

const create = (tag, ns) => strict(new El(tag, ns));

// ---------- document / window ----------

const DOCUMENT = {
  visibilityState: 'visible',
  listeners: {},
  createElement: (tag) => create(tag),
  createElementNS: (ns, tag) => create(tag, ns),
  createTextNode: (t) => new TextNode(t),
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
  },
  dispatch(type, ev = {}) { for (const fn of this.listeners[type] || []) fn(ev); },
  querySelector(sel) { return DOCUMENT.body.querySelector(sel); },
  getElementById(id) {
    let found = null;
    DOCUMENT.body.walk((n) => { if (!found && n.attributes && n.attributes.id === id) found = n; });
    return found;
  },
};
DOCUMENT.body = create('body');
DOCUMENT.body.__root = true;
DOCUMENT.documentElement = DOCUMENT.body;

// ---------- IndexedDB: real enough to prove the migration path ----------
// Bytes are retained, so a second initDb() in the same process takes the
// STORED branch and runs migrations — which is what Dom's phone does on
// every update.
const IDB = new Map();

const indexedDBStub = {
  open() {
    const request = {};
    const dbHandle = {
      transaction: () => ({
        objectStore: () => ({
          get(key) {
            const req = {};
            queueMicrotask(() => {
              req.result = IDB.get(key);
              if (req.onsuccess) req.onsuccess();
            });
            return req;
          },
          put(value, key) {
            IDB.set(key, value);
            return {};
          },
        }),
        set oncomplete(fn) { queueMicrotask(fn); },
        set onerror(_fn) { /* the stub never fails a transaction */ },
      }),
      close() { /* nothing to release */ },
      createObjectStore() { /* schema is implicit in the Map */ },
    };
    queueMicrotask(() => {
      request.result = dbHandle;
      if (request.onsuccess) request.onsuccess();
    });
    return request;
  },
};

// ---------- timers: nothing may outlive the harness ----------
const liveIntervals = new Set();
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;

export function clearAllTimers() {
  for (const id of liveIntervals) realClearInterval(id);
  liveIntervals.clear();
}

// ---------- install ----------

// Node defines some of these as getter-only globals (navigator since 21), so
// they have to be redefined rather than assigned.
function define(name, value) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

export function installDom({ root = process.cwd() } = {}) {
  globalThis.document = DOCUMENT;
  define('navigator', {
    storage: { persist: async () => true, estimate: async () => ({}) },
    userAgent: 'node-domstub',
  });
  define('indexedDB', indexedDBStub);
  define('localStorage', {
    store: new Map(),
    getItem(k) { return this.store.has(k) ? this.store.get(k) : null; },
    setItem(k, v) { this.store.set(k, String(v)); },
    removeItem(k) { this.store.delete(k); },
  });
  define('location', {
    hash: '#/',
    origin: 'https://deedoubleyou34.github.io',
    pathname: '/workout-app/',
    search: '',
    assign(url) { this.lastAssigned = url; },
    reload() { this.reloaded = true; },
  });
  define('history', { replaceState() { /* url rewriting is not observable here */ } });
  define('confirm', () => true);
  globalThis.alert = (msg) => { globalThis.__alerts.push(String(msg)); };
  globalThis.__alerts = [];
  globalThis.URL.createObjectURL = () => 'blob:stub';
  globalThis.URL.revokeObjectURL = () => {};

  globalThis.setInterval = (fn, ms) => {
    const id = realSetInterval(fn, ms);
    liveIntervals.add(id);
    if (id && typeof id.unref === 'function') id.unref();
    return id;
  };
  globalThis.clearInterval = (id) => { liveIntervals.delete(id); realClearInterval(id); };

  // Local file "fetch": the app asks for ./js/schema.sql and ./audio/*.
  define('fetch', async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    const path = root + '/' + String(url).replace(/^\.\//, '').split('?')[0];
    const bytes = readFileSync(path);
    return {
      ok: true,
      status: 200,
      text: async () => bytes.toString('utf8'),
      json: async () => JSON.parse(bytes.toString('utf8')),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  });

  globalThis.window = {
    BUILD: 'test',
    document: DOCUMENT,
    location: globalThis.location,
    addEventListener() { /* the harness drives events directly */ },
    removeEventListener() {},
    scrollTo() {},
  };
  globalThis.scrollTo = () => {};
  return { document: DOCUMENT, idb: IDB };
}

export { create as createElement, DOCUMENT as document };
