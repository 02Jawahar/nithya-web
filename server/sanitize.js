'use strict';
const cheerio = require('cheerio');

// Inline formatting the editor is allowed to keep, and the attributes
// each tag may carry. Anything else is unwrapped, not dropped, so the
// text survives even when the markup does not.
const ALLOWED = {
  a: ['href', 'title', 'target', 'rel'],
  em: [], strong: [], b: [], i: [], u: [], s: [],
  small: [], sup: [], sub: [], code: [], br: [],
  mark: [], abbr: ['title'], time: ['datetime'],
  span: ['class'],
};

function safeUrl(value) {
  const v = String(value || '').trim();
  // Block javascript:/data: payloads; allow the ordinary link shapes.
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(v)) return v;
  if (/^[\w.\-/]+(\.html)?(#.*)?$/i.test(v)) return v;   // relative page link
  return '';
}

function sanitizeHtml(html) {
  const $ = cheerio.load(String(html == null ? '' : html), null, false);

  $('script, style, iframe, object, embed, form, input, svg').remove();

  // Depth-first so an unwrapped parent still gets its children checked.
  let pass = 0;
  while (pass++ < 10) {
    const bad = $('*').filter((_, el) => !Object.hasOwn(ALLOWED, el.tagName));
    if (bad.length === 0) break;
    bad.each((_, el) => $(el).replaceWith($(el).contents()));
  }

  $('*').each((_, el) => {
    const allowed = ALLOWED[el.tagName] || [];
    for (const name of Object.keys(el.attribs || {})) {
      if (!allowed.includes(name)) { delete el.attribs[name]; continue; }
      if (name === 'href') {
        const url = safeUrl(el.attribs.href);
        if (url) el.attribs.href = url; else delete el.attribs.href;
      }
    }
    if (el.attribs && el.attribs.target === '_blank') el.attribs.rel = 'noopener noreferrer';
  });

  return $.html();
}

// Plain text: strip every tag, keep the words.
function sanitizeText(value) {
  return String(value == null ? '' : value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = { sanitizeHtml, sanitizeText, safeUrl };
