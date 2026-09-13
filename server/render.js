'use strict';
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { analyze } = require('./fields');
const { SITE_DIR, PAGES } = require('./config');

const sources = new Map();   // file -> raw HTML on disk
const cache = new Map();     // file + revision -> rendered HTML

function isManaged(file) {
  return PAGES.some((p) => p.file === file);
}

function readSource(file) {
  if (!isManaged(file)) throw new Error('Unmanaged page: ' + file);
  if (!sources.has(file)) {
    sources.set(file, fs.readFileSync(path.join(SITE_DIR, file), 'utf8'));
  }
  return sources.get(file);
}

// display:none for anything the editor switched off, plus a neutral
// placeholder for image slots that have not been filled in yet.
const RUNTIME_CSS = `
[data-cms-hidden]{display:none !important}
img[data-cms-empty]{visibility:hidden}
`;

const PREVIEW_CSS = `
[data-cms-key]{outline:0 solid transparent;transition:outline-color .12s,background-color .12s}
[data-cms-key]:hover{outline:2px dashed rgba(99,102,241,.75);outline-offset:3px;cursor:pointer}
[data-cms-key].cms-active{outline:2px solid #6366f1;outline-offset:3px;background:rgba(99,102,241,.08)}
[data-cms-hidden]{display:revert !important;opacity:.35;filter:grayscale(1)}
[data-cms-section]{position:relative}
img[data-cms-empty]{visibility:visible;min-height:120px;background:repeating-linear-gradient(45deg,#e9e9ee,#e9e9ee 10px,#f4f4f7 10px,#f4f4f7 20px);border-radius:12px}
`;

// Runs inside the preview iframe: click an element to focus its field,
// and repaint on every keystroke coming from the editor.
const PREVIEW_JS = `
(function(){
  var active=null;
  function post(m){ try{ parent.postMessage(m,'*'); }catch(e){} }
  document.addEventListener('click',function(e){
    var el=e.target.closest('[data-cms-key]');
    if(!el) return;
    e.preventDefault(); e.stopPropagation();
    post({type:'cms:select',key:el.getAttribute('data-cms-key')});
  },true);
  document.addEventListener('submit',function(e){ e.preventDefault(); },true);
  window.addEventListener('message',function(e){
    var d=e.data||{};
    if(d.type==='cms:highlight'){
      if(active) active.classList.remove('cms-active');
      active=document.querySelector('[data-cms-key="'+CSS.escape(d.key)+'"]')
          || document.querySelector('[data-cms-section="'+CSS.escape(d.key)+'"]');
      if(active){
        active.classList.add('cms-active');
        active.scrollIntoView({block:'center',behavior:'smooth'});
      }
    }
    if(d.type==='cms:set'){
      var el=document.querySelector('[data-cms-key="'+CSS.escape(d.key)+'"]');
      if(!el) return;
      if(d.field==='html') el.innerHTML=d.value;
      else if(d.field==='text'){
        for(var i=0;i<el.childNodes.length;i++){
          var n=el.childNodes[i];
          if(n.nodeType===3){ n.nodeValue=' '+d.value+' '; break; }
        }
      }
      else if(d.field==='href') el.setAttribute('href',d.value);
      else if(d.field==='src'){ el.setAttribute('src',d.value); if(d.value) el.removeAttribute('data-cms-empty'); }
      else if(d.field==='alt') el.setAttribute('alt',d.value);
    }
    if(d.type==='cms:hidden'){
      var t=document.querySelector('[data-cms-key="'+CSS.escape(d.key)+'"]')
         || document.querySelector('[data-cms-section="'+CSS.escape(d.key)+'"]');
      if(t){ if(d.value) t.setAttribute('data-cms-hidden','1'); else t.removeAttribute('data-cms-hidden'); }
    }
  });
  post({type:'cms:ready'});
})();
`;

/**
 * Render a managed page with a set of overrides applied.
 * @param {string} file       e.g. "index.html"
 * @param {object} overrides  content map for this page
 * @param {object} opts       { preview, basePath, revision }
 */
function renderPage(file, overrides, opts) {
  const o = opts || {};
  const cacheKey = file + '|' + (o.revision || '0') + '|' + (o.preview ? 'p' : 'l') + '|' + (o.basePath || '');
  if (!o.preview && cache.has(cacheKey)) return cache.get(cacheKey);

  const $ = cheerio.load(readSource(file));
  const result = analyze($, { overrides: overrides || {}, preview: !!o.preview });

  $('head').append('<style data-cms-runtime>' + RUNTIME_CSS + '</style>');
  if (o.preview) {
    // Preview is served from /preview/<page>, so the page's relative asset
    // URLs need a base to resolve against or the CSS never loads.
    $('head').prepend('<base href="' + (o.basePath || '') + '/">');
    $('head').append('<style data-cms-preview>' + PREVIEW_CSS + '</style>');
    $('body').append('<script data-cms-preview>' + PREVIEW_JS + '<\/script>');
  }

  const out = { html: $.html(), groups: result.groups, fields: result.fields };
  if (!o.preview) cache.set(cacheKey, out);
  return out;
}

// Field inventory for the admin UI, without rendering anything live.
function inspectPage(file, overrides) {
  const $ = cheerio.load(readSource(file));
  return analyze($, { overrides: overrides || {}, preview: false });
}

function clearCache() {
  cache.clear();
}

module.exports = { renderPage, inspectPage, clearCache, isManaged, readSource };
