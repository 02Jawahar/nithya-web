'use strict';
const { sanitizeHtml, sanitizeText, safeUrl } = require('./sanitize');
const { cleanBlock, renderStack } = require('./media');

// Tags that count as "just formatting" - an element whose only element
// children are these is a leaf the editor can own outright.
const FORMATTING = new Set([
  'em', 'strong', 'b', 'i', 'u', 's', 'small', 'sup', 'sub',
  'code', 'br', 'mark', 'abbr', 'time', 'q', 'cite', 'del', 'ins',
]);
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'hr', 'button']);

function kids(el) {
  return (el.children || []).filter((c) => c.type === 'tag');
}

function textOf($, el) {
  return $(el).text().replace(/\s+/g, ' ').trim();
}

// Stable positional key: section[1]>div[1]>h1[1], rooted at <body>.
function pathOf(el) {
  const parts = [];
  let node = el;
  while (node && node.tagName && node.tagName !== 'body' && node.tagName !== 'html') {
    const parent = node.parent;
    if (!parent || !parent.children) break;
    const twins = parent.children.filter((c) => c.type === 'tag' && c.tagName === node.tagName);
    parts.unshift(node.tagName + '[' + (twins.indexOf(node) + 1) + ']');
    node = parent;
  }
  return parts.join('>');
}

function labelFor(el) {
  const tag = el.tagName;
  const cls = el.attribs && el.attribs.class ? el.attribs.class : '';
  const byClass = [
    [/\beyebrow\b/, 'Eyebrow'],
    [/\blede\b/, 'Intro paragraph'],
    [/stat__num/, 'Stat - number'],
    [/stat__label/, 'Stat - label'],
    [/\btag\b/, 'Tag'],
    [/card__more/, 'Card link label'],
    [/portrait__caption/, 'Portrait caption'],
    [/portrait__initials/, 'Portrait initials'],
    [/brand__mark/, 'Logo initials'],
    [/\bbrand\b/, 'Brand name'],
    [/link-arrow/, 'Link'],
    [/\bbtn\b/, 'Button'],
    [/\bcallout\b/, 'Callout'],
  ];
  for (const [re, name] of byClass) if (re.test(cls)) return name;
  if (/^h[1-6]$/.test(tag)) return 'Heading ' + tag.toUpperCase();
  const plain = {
    p: 'Paragraph', li: 'List item', a: 'Link', img: 'Image',
    blockquote: 'Quote', figcaption: 'Caption', td: 'Table cell',
    th: 'Table heading', dt: 'Term', dd: 'Definition', span: 'Text', div: 'Text',
  };
  return plain[tag] || tag;
}

// Section titles: prefer the hand-written HTML comment above the section
// (<!-- Hero -->), fall back to its first heading.
const VAGUE_COMMENTS = /^(sections?|content|main|grid|cards?|block|wrap)$/i;

function sectionLabel($, el) {
  let comment = '';
  let prev = el.prev;
  while (prev && prev.type !== 'tag') {
    if (prev.type === 'comment') {
      const t = String(prev.data || '').trim();
      if (t && t.length < 60 && !t.startsWith('[')) { comment = t; break; }
    }
    prev = prev.prev;
  }
  if (comment && !VAGUE_COMMENTS.test(comment)) return comment;

  const head = $(el).find('h1,h2,h3').first();
  if (head.length) {
    const text = head.text().replace(/\s+/g, ' ').trim();
    if (text) return text.length > 52 ? text.slice(0, 52) + '...' : text;
  }
  return comment || 'Section';
}

/**
 * Walk a page, collect every editable field, and - when `overrides` is
 * given - apply the saved values in the same pass.
 *
 * @returns {{groups: Array, fields: Array}}
 */
function analyze($, options) {
  const opts = options || {};
  const overrides = opts.overrides || {};
  const preview = !!opts.preview;
  const groups = [];
  const fields = [];

  const emit = (group, field) => { group.fields.push(field); fields.push(field); };

  function addGroup(id, label, el) {
    const g = { id, label, key: el ? pathOf(el) : null, fields: [], canHide: false, hidden: false };
    groups.push(g);
    return g;
  }

  // ---- Page settings (head) -------------------------------------------
  const meta = addGroup('meta', 'Page settings', null);
  const titleEl = $('head > title');
  if (titleEl.length) {
    const ov = overrides['@title'] || {};
    const original = titleEl.text();
    if (typeof ov.text === 'string') titleEl.text(sanitizeText(ov.text));
    emit(meta, {
      key: '@title', type: 'text', label: 'Browser tab / SEO title',
      value: titleEl.text(), original, hidden: false,
      hint: 'Shows in the browser tab and in Google results.',
    });
  }
  const descEl = $('head > meta[name="description"]');
  if (descEl.length) {
    const ov = overrides['@description'] || {};
    const original = descEl.attr('content') || '';
    if (typeof ov.text === 'string') descEl.attr('content', sanitizeText(ov.text));
    emit(meta, {
      key: '@description', type: 'textarea', label: 'Search description',
      value: descEl.attr('content') || '', original, hidden: false,
      hint: 'The grey summary line under the title in Google. Around 155 characters.',
    });
  }

  // ---- Body regions ----------------------------------------------------
  const regions = [];
  const header = $('body > header').first();
  if (header.length) regions.push({ id: 'header', label: 'Header & navigation', el: header[0] });
  $('body > main > section').each((i, el) => {
    regions.push({ id: 'section-' + (i + 1), label: sectionLabel($, el), el, isSection: true });
  });
  const footer = $('body > footer').first();
  if (footer.length) regions.push({ id: 'footer', label: 'Footer', el: footer[0] });

  function applyVisibility(el, ov, field) {
    if (ov && ov.hidden) {
      $(el).attr('data-cms-hidden', '1');
      field.hidden = true;
    }
  }

  function addTextField(el, group, hasSvg) {
    const key = pathOf(el);
    const ov = overrides[key] || {};
    const field = {
      key, type: hasSvg ? 'text' : 'richtext', label: labelFor(el),
      tag: el.tagName, hidden: false,
    };

    if (hasSvg) {
      // Only the words are editable; the inline icon stays put.
      const textNodes = (el.children || []).filter((c) => c.type === 'text');
      const raw = textNodes.map((n) => n.data).join('');
      field.original = raw.replace(/\s+/g, ' ').trim();
      if (typeof ov.text === 'string') {
        const value = sanitizeText(ov.text);
        const lead = /^\s*/.exec(raw)[0];
        const tail = /\s*$/.exec(raw)[0];
        textNodes.forEach((n, i) => { n.data = i === 0 ? lead + value + tail : ''; });
        field.value = value;
      } else {
        field.value = field.original;
      }
    } else {
      field.original = $(el).html();
      if (typeof ov.html === 'string') $(el).html(sanitizeHtml(ov.html));
      field.value = $(el).html();
    }

    // A link destination is editable alongside its label.
    if (el.tagName === 'a') {
      field.hasHref = true;
      field.originalHref = $(el).attr('href') || '';
      if (typeof ov.href === 'string') {
        const url = safeUrl(ov.href);
        if (url) $(el).attr('href', url);
      }
      field.href = $(el).attr('href') || '';
    }

    applyVisibility(el, ov, field);
    if (preview) $(el).attr('data-cms-key', key);
    emit(group, field);
  }

  function addImageField(el, group) {
    const key = pathOf(el);
    const ov = overrides[key] || {};
    const field = {
      key, type: 'image', label: labelFor(el), tag: el.tagName, hidden: false,
      original: $(el).attr('src') || '', originalAlt: $(el).attr('alt') || '',
    };
    if (typeof ov.src === 'string') $(el).attr('src', ov.src);
    if (typeof ov.alt === 'string') $(el).attr('alt', sanitizeText(ov.alt));
    field.value = $(el).attr('src') || '';
    field.alt = $(el).attr('alt') || '';
    // An empty image slot should not render a broken-image icon.
    if (field.value) $(el).removeAttr('data-cms-empty');
    else $(el).attr('data-cms-empty', '1');
    applyVisibility(el, ov, field);
    if (preview) $(el).attr('data-cms-key', key);
    emit(group, field);
  }

  function walk(el, group) {
    for (const child of kids(el)) {
      if (SKIP.has(child.tagName)) continue;
      const $c = $(child);

      if (child.tagName === 'img' || $c.attr('data-cms-slot') === 'image') {
        addImageField(child, group);
        continue;
      }

      const childTags = kids(child);
      const isLeaf = childTags.every((g) => FORMATTING.has(g.tagName) || g.tagName === 'svg');

      if (!isLeaf || !textOf($, child)) { walk(child, group); continue; }

      addTextField(child, group, childTags.some((g) => g.tagName === 'svg'));
    }
  }

  for (const region of regions) {
    const group = addGroup(region.id, region.label, region.isSection ? region.el : null);
    group.canHide = !!region.isSection;
    walk(region.el, group);

    if (region.isSection) {
      const ov = overrides[group.key] || {};
      if (ov.hidden) { $(region.el).attr('data-cms-hidden', '1'); group.hidden = true; }
      if (preview) $(region.el).attr('data-cms-section', group.key);

      // Images and videos the editor added to this section. Appended after
      // the walk, so the positional keys above are unaffected.
      addMediaStack(region.el, group);
    }
  }

  function addMediaStack(sectionEl, group) {
    const key = 'media:' + group.key;
    const blocks = ((overrides[key] || {}).blocks || []).map(cleanBlock);

    const html = renderStack(blocks);
    if (html) {
      const host = $(sectionEl).children('.wrap').last();
      (host.length ? host : $(sectionEl)).append(html);
    }

    group.media = { key, blocks };
  }

  return { groups: groups.filter((g) => g.fields.length || g.canHide), fields };
}

module.exports = { analyze, pathOf };
