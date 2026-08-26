// Small pieces of UI shared by more than one screen.
//
// This exists because `collapsible()` was written in js/ui/home.js for the day
// list, and the Music card wants one too — but home.js already imports
// renderMusic from music.js, so importing it back would be a cycle. Anything
// two screens both need lands here instead.

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// Whether a drawer is open is a preference, not data, so it lives in
// localStorage rather than in the .sqlite export — and a failed read must never
// take the screen with it (Safari private mode throws on localStorage).
export function drawerOpen(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function setDrawerOpen(key, open) {
  try {
    localStorage.setItem(key, open ? '1' : '0');
  } catch { /* preference lost, screen still works */ }
}

// One collapsible section: the day list, Data, and the Music card's Advanced
// box all use this, so the button, the caret, the open class and the stored
// preference live in one place rather than being copied per screen.
//
// Returns { node, body }: append the section's contents to `body`.
export function collapsible({ label, hint = '', storageKey, cls = '' }) {
  const node = el('nav', 'drawer' + (cls ? ' ' + cls : ''));
  const tab = el('button', 'drawertab');
  const tabLabel = el('span', 'drawerlabel', label);
  const tabHint = el('span', 'drawerhint', '');
  const caret = el('span', 'drawercaret', '▾');
  tab.append(tabLabel, tabHint, caret);
  const body = el('div', 'drawerbody');
  node.append(tab, body);

  let open = drawerOpen(storageKey);
  const paint = () => {
    node.classList.toggle('open', open);
    caret.textContent = open ? '▴' : '▾';
    // the hint is what the closed state is for: a reason not to open it
    tabHint.textContent = open ? '' : hint;
    tab.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  tab.onclick = () => {
    open = !open;
    setDrawerOpen(storageKey, open);
    paint();
  };
  paint();
  return { node, body };
}
