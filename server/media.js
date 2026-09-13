'use strict';
const { sanitizeText } = require('./sanitize');

// Media blocks are built here, server-side, from validated fields - never
// from markup the editor typed. That is what makes it safe to emit an
// <iframe> for a video embed at all.

const UPLOAD_PATH = /^\/uploads\/[A-Za-z0-9._-]+$/;
const SITE_ASSET = /^\/?assets\/[A-Za-z0-9._\-/]+$/;

function escapeAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Only files this server is serving. No remote hotlinking. */
function safeSrc(value) {
  const v = String(value || '').trim();
  if (UPLOAD_PATH.test(v)) return v;
  if (SITE_ASSET.test(v)) return v.replace(/^\/?/, '/');
  return '';
}

/**
 * Turn a pasted video link into an embed URL.
 * Only YouTube and Vimeo are recognised; anything else is refused.
 */
function embedUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let url;
  try { url = new URL(raw); } catch (_) { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1);
    if (/^[\w-]{6,20}$/.test(id)) return 'https://www.youtube-nocookie.com/embed/' + id;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'm.youtube.com') {
    const id = url.searchParams.get('v')
      || (/^\/(embed|shorts|live)\/([\w-]{6,20})/.exec(url.pathname) || [])[2];
    if (id && /^[\w-]{6,20}$/.test(id)) return 'https://www.youtube-nocookie.com/embed/' + id;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = (/(\d{6,12})/.exec(url.pathname) || [])[1];
    if (id) return 'https://player.vimeo.com/video/' + id;
  }
  return null;
}

const VIDEO_FILE = /\.(mp4|webm|ogg|mov)$/i;

/** Normalise one block from the editor into something safe to store. */
function cleanBlock(input) {
  const b = input || {};
  const kind = b.kind === 'video' ? 'video' : 'image';
  const out = {
    id: String(b.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'b' + Date.now().toString(36),
    kind,
    caption: sanitizeText(b.caption).slice(0, 300),
  };

  if (kind === 'image') {
    out.src = safeSrc(b.src);
    out.alt = sanitizeText(b.alt).slice(0, 300);
  } else {
    const file = safeSrc(b.src);
    if (file && VIDEO_FILE.test(file)) out.src = file;         // uploaded video
    else out.src = '';
    out.url = embedUrl(b.url) ? String(b.url).trim() : '';      // YouTube / Vimeo
  }
  return out;
}

function isEmpty(block) {
  return block.kind === 'image' ? !block.src : (!block.src && !block.url);
}

/** Render one block. Returns '' for a block with nothing in it yet. */
function renderBlock(block) {
  if (isEmpty(block)) return '';
  const caption = block.caption
    ? '<figcaption class="cms-media__caption">' + escapeAttr(block.caption) + '</figcaption>'
    : '';

  if (block.kind === 'image') {
    return '<figure class="cms-media cms-media--image">'
      + '<img src="' + escapeAttr(block.src) + '" alt="' + escapeAttr(block.alt) + '" loading="lazy">'
      + caption + '</figure>';
  }

  if (block.src) {
    return '<figure class="cms-media cms-media--video">'
      + '<video class="cms-media__player" controls playsinline preload="metadata" '
      + 'src="' + escapeAttr(block.src) + '"></video>'
      + caption + '</figure>';
  }

  const embed = embedUrl(block.url);
  if (!embed) return '';
  return '<figure class="cms-media cms-media--video">'
    + '<div class="cms-media__frame"><iframe src="' + escapeAttr(embed) + '" '
    + 'title="Video" loading="lazy" allowfullscreen '
    + 'allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture" '
    + 'referrerpolicy="strict-origin-when-cross-origin"></iframe></div>'
    + caption + '</figure>';
}

function renderStack(blocks) {
  const html = (blocks || []).map(renderBlock).filter(Boolean).join('');
  return html ? '<div class="cms-media-stack">' + html + '</div>' : '';
}

module.exports = { cleanBlock, renderBlock, renderStack, embedUrl, safeSrc, isEmpty };
