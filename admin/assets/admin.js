'use strict';
/* Nitya Lanka content manager */

const BASE = location.pathname.replace(/\/admin\/?$/, '');
const api = (p, opts) => fetch(BASE + '/api' + p, Object.assign({ credentials: 'same-origin' }, opts));

const json = async (p, method, body) => {
  const res = await api(p, {
    method: method || 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { location.href = BASE + '/admin/login'; throw new Error('Signed out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const state = { pages: [], current: null, groups: [], pendingCount: 0, frameReady: false };

/* ---------------------------------------------------------------- toast */
let toastTimer;
function toast(message, kind) {
  const t = $('#toast');
  t.textContent = message;
  t.className = 'toast ' + (kind || '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ------------------------------------------------------------- top bar */
function paintPending() {
  const badge = $('#pendingBadge');
  const n = state.pendingCount;
  badge.hidden = n === 0;
  badge.textContent = n + (n === 1 ? ' unpublished change' : ' unpublished changes');
  $('#btnPublish').disabled = n === 0;
  $('#btnDiscard').hidden = n === 0;
}

function paintPages() {
  const list = $('#pageList');
  list.innerHTML = '';
  for (const page of state.pages) {
    const li = el('li');
    const btn = el('button');
    btn.classList.toggle('is-on', page.file === state.current);
    btn.append(el('span', null, page.title));
    if (page.pending) btn.append(el('span', 'pill', String(page.pending)));
    btn.onclick = () => selectPage(page.file);
    li.append(btn);
    list.append(li);
  }
}

async function refreshState() {
  const data = await json('/state');
  state.pages = data.pages;
  state.pendingCount = data.pendingCount;
  $('#siteUser').textContent = 'Signed in as ' + data.user;
  $('#viewLive').href = (data.basePath || '') + '/';
  $('#pwUser').value = data.user;
  paintPending();
  paintPages();
}

/* -------------------------------------------------------------- fields */
function send(message) {
  const frame = $('#frame');
  if (state.frameReady && frame.contentWindow) frame.contentWindow.postMessage(message, '*');
}

const savers = new Map();
function save(key, patch, delay, scope) {
  clearTimeout(savers.get(key));
  savers.set(key, setTimeout(async () => {
    try {
      const res = await json('/page/' + state.current + '/field', 'POST', { key, patch, scope });
      state.pendingCount = res.pendingCount;
      paintPending();
      refreshCounts();
    } catch (e) { toast(e.message, 'bad'); }
  }, delay == null ? 500 : delay));
}

async function refreshCounts() {
  try {
    const data = await json('/state');
    state.pages = data.pages;
    state.pendingCount = data.pendingCount;
    paintPending();
    paintPages();
  } catch (_) { /* non-fatal */ }
}

function markPending(node) {
  node.classList.add('is-pending');
}

function richToolbar(editable) {
  const bar = el('div', 'rtbar');
  const add = (label, title, run) => {
    const b = el('button', null, label);
    b.type = 'button';
    b.title = title;
    b.onmousedown = (e) => { e.preventDefault(); };
    b.onclick = () => { editable.focus(); run(); editable.dispatchEvent(new Event('input')); };
    bar.append(b);
  };
  add('B', 'Bold', () => document.execCommand('bold'));
  add('I', 'Italic', () => document.execCommand('italic'));
  add('🔗', 'Add link', () => {
    const url = prompt('Link address (for example https://example.com or music.html)');
    if (url) document.execCommand('createLink', false, url);
  });
  add('⌫', 'Remove formatting', () => document.execCommand('removeFormat'));
  return bar;
}

/* ------------------------------------------------- image picker */
// One component behind every image slot: the fixed page slots, the site
// logo, and the images inside media blocks. Upload straight from the
// field, drop a file on it, or reuse something already in the library.
async function uploadOne(file) {
  const body = new FormData();
  body.append('files', file);
  const res = await api('/media', { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data.files[0].url;
}

function imagePicker(value, onChange) {
  const box = el('div', 'picker');
  const drop = el('div', 'picker__drop');
  const img = el('img', 'picker__img');
  const empty = el('div', 'picker__empty');
  empty.append(el('b', null, 'Drop an image here'));
  empty.append(el('span', null, 'or click to choose a file'));
  const file = el('input');
  file.type = 'file';
  file.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml';
  file.hidden = true;

  const row = el('div', 'picker__row');
  const upBtn = el('button', 'tool', 'Upload');
  const libBtn = el('button', 'tool', 'Library');
  const clrBtn = el('button', 'tool', 'Remove');
  [upBtn, libBtn, clrBtn].forEach((b) => { b.type = 'button'; });
  row.append(upBtn, libBtn, clrBtn);

  let current = value || '';

  function paint() {
    const has = !!current;
    img.hidden = !has;
    empty.hidden = has;
    clrBtn.hidden = !has;
    drop.classList.toggle('is-filled', has);
    if (has) img.src = current;
  }

  function set(url) {
    current = url || '';
    paint();
    onChange(current);
  }

  async function take(files) {
    if (!files || !files.length) return;
    drop.classList.add('is-busy');
    try {
      set(await uploadOne(files[0]));
      toast('Image uploaded', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      drop.classList.remove('is-busy');
    }
  }

  drop.onclick = () => file.click();
  upBtn.onclick = () => file.click();
  file.onchange = (e) => { take(e.target.files); e.target.value = ''; };

  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => {
    e.preventDefault(); drop.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => {
    e.preventDefault(); drop.classList.remove('is-over');
  }));
  drop.addEventListener('drop', (e) => take(e.dataTransfer.files));

  libBtn.onclick = () => openMedia((url) => { set(url); closeModals(); });
  clrBtn.onclick = () => set('');

  drop.append(img, empty, file);
  box.append(drop, row);
  paint();
  return box;
}

function buildField(field) {
  const wrap = el('div', 'field');
  wrap.dataset.key = field.key;
  if (field.pending) markPending(wrap);
  if (field.hidden) wrap.classList.add('is-off');

  const top = el('div', 'field__top');
  top.append(el('span', 'field__label', field.label));

  const tools = el('div', 'field__tools');
  const hideBtn = el('button', 'tool' + (field.hidden ? ' is-on' : ''), field.hidden ? 'Hidden' : 'Hide');
  hideBtn.type = 'button';
  hideBtn.title = 'Show or hide this on the website';
  hideBtn.onclick = () => {
    const now = !wrap.classList.contains('is-off');
    wrap.classList.toggle('is-off', now);
    hideBtn.classList.toggle('is-on', now);
    hideBtn.textContent = now ? 'Hidden' : 'Hide';
    markPending(wrap);
    send({ type: 'cms:hidden', key: field.key, value: now });
    save(field.key, { hidden: now }, 0, field.scope);
  };

  const resetBtn = el('button', 'tool', 'Reset');
  resetBtn.type = 'button';
  resetBtn.title = 'Back to the original wording';
  resetBtn.onclick = async () => {
    await json('/page/' + state.current + '/field', 'POST', { key: field.key, patch: { reset: true }, scope: field.scope })
      .catch((e) => toast(e.message, 'bad'));
    await loadPage(state.current);
    reloadFrame();
    refreshCounts();
    toast('Reset to the original');
  };

  tools.append(hideBtn, resetBtn);
  top.append(tools);
  wrap.append(top);

  const focusInFrame = () => {
    document.querySelectorAll('.field.is-active').forEach((n) => n.classList.remove('is-active'));
    wrap.classList.add('is-active');
    send({ type: 'cms:highlight', key: field.key });
  };

  if (field.type === 'richtext') {
    const editable = el('div', 'rt');
    editable.contentEditable = 'true';
    editable.spellcheck = true;
    editable.innerHTML = field.value || '';
    editable.addEventListener('focus', focusInFrame);
    editable.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
    editable.addEventListener('input', () => {
      markPending(wrap);
      send({ type: 'cms:set', key: field.key, field: 'html', value: editable.innerHTML });
      save(field.key, { html: editable.innerHTML }, undefined, field.scope);
    });
    wrap.append(richToolbar(editable), editable);

  } else if (field.type === 'textarea') {
    const ta = el('textarea');
    ta.value = field.value || '';
    ta.addEventListener('focus', focusInFrame);
    ta.addEventListener('input', () => {
      markPending(wrap);
      save(field.key, { text: ta.value }, undefined, field.scope);
    });
    wrap.append(ta);

  } else if (field.type === 'image') {
    const picker = imagePicker(field.value, (url) => {
      markPending(wrap);
      send({ type: 'cms:set', key: field.key, field: 'src', value: url });
      save(field.key, { src: url }, 0, field.scope);
    });

    const altRow = el('div', 'sub');
    altRow.append(el('label', null, 'Alt'));
    const alt = el('input');
    alt.type = 'text';
    alt.value = field.alt || '';
    alt.placeholder = 'Describe the image for screen readers';
    alt.addEventListener('input', () => {
      markPending(wrap);
      send({ type: 'cms:set', key: field.key, field: 'alt', value: alt.value });
      save(field.key, { alt: alt.value }, undefined, field.scope);
    });
    altRow.append(alt);
    wrap.append(picker, altRow);

  } else {
    const input = el('input');
    input.type = 'text';
    input.value = field.value || '';
    input.addEventListener('focus', focusInFrame);
    input.addEventListener('input', () => {
      markPending(wrap);
      send({ type: 'cms:set', key: field.key, field: 'text', value: input.value });
      save(field.key, { text: input.value }, undefined, field.scope);
    });
    wrap.append(input);
  }

  if (field.hasHref) {
    const row = el('div', 'sub');
    row.append(el('label', null, 'Link'));
    const href = el('input');
    href.type = 'text';
    href.value = field.href || '';
    href.placeholder = 'music.html or https://…';
    href.addEventListener('input', () => {
      markPending(wrap);
      send({ type: 'cms:set', key: field.key, field: 'href', value: href.value });
      save(field.key, { href: href.value }, undefined, field.scope);
    });
    row.append(href);
    wrap.append(row);
  }

  if (field.hint) {
    const hint = el('p', 'note', field.hint);
    hint.style.margin = '6px 0 0';
    wrap.append(hint);
  }

  return wrap;
}

/* --------------------------------------------------- media blocks */
// Images and videos the client adds to a section (as opposed to the fixed
// image slots that already exist in the page markup).
function buildMediaPanel(group) {
  const box = el('div', 'mediaBlocks');
  const list = el('div', 'mediaBlocks__list');
  let blocks = (group.media.blocks || []).slice();

  const persist = async () => {
    try {
      const res = await json('/page/' + state.current + '/media', 'POST',
        { key: group.media.key, blocks });
      blocks = res.blocks;
      state.pendingCount = res.pendingCount;
      paintPending();
      refreshCounts();
      reloadFrame();
      if (res.rejected) {
        toast(res.rejected + ' item(s) still need a file or a video link', 'bad');
      }
    } catch (e) { toast(e.message, 'bad'); }
  };

  const paint = () => {
    list.innerHTML = '';
    blocks.forEach((block, index) => list.append(buildBlockRow(block, index)));
  };

  function buildBlockRow(block, index) {
    const row = el('div', 'mblock');

    const head = el('div', 'mblock__head');
    head.append(el('span', 'mblock__n', (block.kind === 'video' ? 'Video ' : 'Image ') + (index + 1)));

    const swap = el('button', 'tool', block.kind === 'video' ? 'Use an image' : 'Use a video');
    swap.type = 'button';
    swap.onclick = () => {
      block.kind = block.kind === 'video' ? 'image' : 'video';
      block.src = ''; block.url = '';
      paint(); persist();
    };

    const up = el('button', 'tool', '↑');
    up.type = 'button'; up.title = 'Move up'; up.disabled = index === 0;
    up.onclick = () => {
      blocks.splice(index - 1, 0, blocks.splice(index, 1)[0]);
      paint(); persist();
    };

    const del = el('button', 'tool', 'Remove');
    del.type = 'button';
    del.onclick = () => {
      if (!confirm('Remove this item from the page?')) return;
      blocks.splice(index, 1);
      paint(); persist();
    };

    head.append(swap, up, del);
    row.append(head);

    if (block.kind === 'image') {
      row.append(imagePicker(block.src, (url) => { block.src = url; persist(); }));

      row.append(labelledInput('Alt text', block.alt || '',
        'Describe the picture for screen readers', (v) => { block.alt = v; }, persist));

    } else {
      const hint = el('p', 'note', 'Paste a YouTube or Vimeo link, or upload a video file.');
      hint.style.margin = '4px 0 8px';
      row.append(hint);

      row.append(labelledInput('Link', block.url || '',
        'https://youtu.be/…', (v) => { block.url = v; block.src = ''; }, persist));

      const choose = el('button', 'tool wide', block.src ? 'Change video file' : '…or upload a video file');
      choose.type = 'button';
      choose.onclick = () => openMedia((url) => {
        block.src = url; block.url = '';
        closeModals(); paint(); persist();
      });
      row.append(choose);

      if (block.src) {
        const name = el('p', 'note', 'Using uploaded file: ' + block.src.split('/').pop());
        name.style.margin = '6px 0 0';
        row.append(name);
      }
    }

    row.append(labelledInput('Caption', block.caption || '',
      'Optional line under the item', (v) => { block.caption = v; }, persist));

    return row;
  }

  function labelledInput(label, value, placeholder, onInput, onDone) {
    const wrap = el('div', 'sub');
    wrap.append(el('label', null, label));
    const input = el('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholder;
    let timer;
    input.addEventListener('input', () => {
      onInput(input.value);
      clearTimeout(timer);
      timer = setTimeout(onDone, 600);
    });
    wrap.append(input);
    return wrap;
  }

  const add = el('button', 'tool wide addMedia', '+  Add an image or video here');
  add.type = 'button';
  add.onclick = () => {
    blocks.push({ id: 'b' + Date.now().toString(36) + blocks.length, kind: 'image', src: '', alt: '', caption: '' });
    paint();
    list.lastChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  paint();
  box.append(list, add);
  return box;
}

function buildGroup(group, index) {
  const box = el('div', 'group' + (index === 0 ? ' is-open' : '') + (group.hidden ? ' is-hidden' : ''));
  const head = el('div', 'group__head');
  head.append(el('span', 'caret', '▶'));
  head.append(el('h3', null, group.label));

  if (group.canHide) {
    const t = el('button', 'tool' + (group.hidden ? ' is-on' : ''), group.hidden ? 'Section hidden' : 'Hide section');
    t.type = 'button';
    t.onclick = (e) => {
      e.stopPropagation();
      const now = !box.classList.contains('is-hidden');
      box.classList.toggle('is-hidden', now);
      t.classList.toggle('is-on', now);
      t.textContent = now ? 'Section hidden' : 'Hide section';
      send({ type: 'cms:hidden', key: group.key, value: now });
      save(group.key, { hidden: now }, 0);
    };
    head.append(t);
  }

  head.append(el('span', 'group__count', group.fields.length + ' items'));
  head.onclick = () => box.classList.toggle('is-open');

  const body = el('div', 'group__body');
  for (const field of group.fields) body.append(buildField(field));
  if (group.media) body.append(buildMediaPanel(group));

  box.append(head, body);
  return box;
}

async function loadPage(file) {
  const data = await json('/page/' + file);
  state.groups = data.groups;
  const host = $('#groups');
  host.innerHTML = '';
  data.groups.forEach((g, i) => host.append(buildGroup(g, i)));
  applySearch();
}

function reloadFrame() {
  state.frameReady = false;
  $('#frame').src = BASE + '/preview/' + state.current + '?t=' + Date.now();
}

async function selectPage(file) {
  state.current = file;
  const page = state.pages.find((p) => p.file === file);
  $('#pageTitle').textContent = page ? page.title : file;
  paintPages();
  await loadPage(file);
  reloadFrame();
}

/* -------------------------------------------------------------- search */
function applySearch() {
  const q = $('#search').value.trim().toLowerCase();
  document.querySelectorAll('.group').forEach((group) => {
    let hits = 0;
    group.querySelectorAll('.field').forEach((field) => {
      const match = !q || field.textContent.toLowerCase().includes(q);
      field.hidden = !match;
      if (match) hits++;
    });
    group.hidden = q ? hits === 0 : false;
    if (q && hits) group.classList.add('is-open');
  });
}

/* --------------------------------------------------------- frame bridge */
window.addEventListener('message', (e) => {
  const data = e.data || {};
  if (data.type === 'cms:ready') { state.frameReady = true; return; }
  if (data.type === 'cms:select') {
    const field = document.querySelector('.field[data-key="' + CSS.escape(data.key) + '"]');
    if (!field) return;
    field.closest('.group').classList.add('is-open');
    field.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const input = field.querySelector('.rt, input[type=text], textarea');
    if (input) input.focus();
  }
});

/* --------------------------------------------------------------- modals */
function closeModals() {
  document.querySelectorAll('.modal').forEach((m) => { m.hidden = true; });
  // Otherwise the next plain visit to the library still acts as a picker.
  mediaPick = null;
}
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-close]') || e.target.classList.contains('modal')) closeModals();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });

/* ---------------------------------------------------------------- media */
let mediaPick = null;

async function paintMedia() {
  const data = await json('/media');
  const host = $('#mediaList');
  host.innerHTML = '';
  if (!data.files.length) {
    host.append(el('p', 'note', 'Nothing uploaded yet.'));
    return;
  }
  for (const file of data.files) {
    const card = el('div', 'mediaItem');
    if (/\.pdf$/i.test(file.name)) card.append(el('div', 'pdf', '📄'));
    else if (/\.(mp4|webm|ogg|mov)$/i.test(file.name)) card.append(el('div', 'pdf', '🎬'));
    else { const i = el('img'); i.src = file.url; i.alt = file.name; card.append(i); }
    card.append(el('div', 'meta', file.name + ' · ' + Math.round(file.size / 1024) + ' KB'));

    const row = el('div', 'row');
    const use = el('button', null, mediaPick ? 'Use' : 'Copy link');
    use.onclick = () => {
      if (mediaPick) mediaPick(file.url);
      else { navigator.clipboard.writeText(location.origin + file.url); toast('Link copied'); }
    };
    const del = el('button', null, 'Delete');
    del.onclick = async () => {
      if (!confirm('Delete ' + file.name + '? Any page still using it will lose the image.')) return;
      await json('/media/' + encodeURIComponent(file.name), 'DELETE').catch((e) => toast(e.message, 'bad'));
      paintMedia();
    };
    row.append(use, del);
    card.append(row);
    host.append(card);
  }
}

function openMedia(onPick) {
  mediaPick = onPick || null;
  $('#modal-media').hidden = false;
  paintMedia();
}

async function uploadFiles(list) {
  if (!list || !list.length) return;
  const body = new FormData();
  for (const f of list) body.append('files', f);
  const res = await api('/media', { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return toast(data.error || 'Upload failed', 'bad');
  toast(data.files.length + ' file(s) uploaded', 'ok');
  paintMedia();
}

/* ------------------------------------------------------------- versions */
async function paintVersions() {
  const data = await json('/versions');
  const host = $('#versionList');
  host.innerHTML = '';
  if (!data.versions.length) {
    host.append(el('p', 'note', 'No snapshots yet — the first one is taken when you publish.'));
    return;
  }
  for (const v of data.versions) {
    const row = el('div', 'version');
    const info = el('div');
    info.append(el('b', null, new Date(v.savedAt).toLocaleString()));
    info.append(el('small', null, 'Revision ' + v.revision + (v.label ? ' · ' + v.label : '')));
    const btn = el('button', 'btn', 'Restore');
    btn.onclick = async () => {
      if (!confirm('Load this version into your draft? Your current unpublished edits will be replaced.')) return;
      await json('/versions/' + encodeURIComponent(v.id) + '/restore', 'POST', {});
      closeModals();
      await refreshState();
      await selectPage(state.current);
      toast('Version restored into your draft');
    };
    row.append(info, btn);
    host.append(row);
  }
}

/* ----------------------------------------------------------------- boot */
function wire() {
  $('#btnMenu').onclick = (e) => {
    e.stopPropagation();
    $('#menuList').hidden = !$('#menuList').hidden;
  };
  document.addEventListener('click', () => { $('#menuList').hidden = true; });
  $('#menuList').onclick = (e) => e.stopPropagation();

  document.querySelectorAll('[data-open]').forEach((btn) => {
    btn.onclick = () => {
      $('#menuList').hidden = true;
      const name = btn.dataset.open;
      $('#modal-' + name).hidden = false;
      if (name === 'media') openMedia(null);
      if (name === 'versions') paintVersions();
    };
  });

  $('#btnPublish').onclick = async () => {
    const n = state.pendingCount;
    if (!confirm('Publish ' + n + ' change' + (n === 1 ? '' : 's') + ' to the live website?')) return;
    try {
      await json('/publish', 'POST', {});
      await refreshState();
      toast('Published — the live site is updated', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  };

  $('#btnDiscard').onclick = async () => {
    if (!confirm('Throw away all unpublished changes and go back to what is live?')) return;
    await json('/discard', 'POST', {});
    await refreshState();
    await selectPage(state.current);
    toast('Draft reset to the published version');
  };

  $('#btnLogout').onclick = async () => {
    await fetch(BASE + '/admin/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    location.href = BASE + '/admin/login';
  };

  $('#search').addEventListener('input', applySearch);

  $('#pick').onclick = () => $('#file').click();
  $('#file').onchange = (e) => uploadFiles(e.target.files);
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => {
    e.preventDefault(); drop.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => {
    e.preventDefault(); drop.classList.remove('is-over');
  }));
  drop.addEventListener('drop', (e) => uploadFiles(e.dataTransfer.files));

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.onclick = () => {
      document.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-on'));
      chip.classList.add('is-on');
      const w = Number(chip.dataset.width);
      $('#frame').style.width = w ? w + 'px' : '100%';
    };
  });

  $('#pwForm').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await json('/password', 'POST', {
        username: form.get('username'),
        current: form.get('current'),
        next: form.get('next'),
      });
      e.target.reset();
      closeModals();
      await refreshState();
      toast('Credentials updated', 'ok');
    } catch (err) { $('#pwNote').textContent = err.message; }
  };

}

(async function start() {
  wire();
  try {
    await refreshState();
    await selectPage(state.pages[0].file);
  } catch (e) {
    $('#groups').innerHTML = '<p class="empty">' + e.message + '</p>';
  }
})();
