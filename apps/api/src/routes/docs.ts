import type { Hono } from 'hono'

import { buildOpenApi } from '../openapi.js'
import type { AuthEnv } from '../auth/middleware.js'
import type { ManifestEntry } from './registry.js'

/**
 * API docs (E06-5, §6.6). PUBLIC (registered before the /v1/* auth guard): the OpenAPI
 * document at /v1/openapi.json and a self-contained HTML docs page at /v1/docs that renders
 * it (SELF-CONTAINED — no external CDN/resources; a Scalar/Stoplight embed can replace the
 * renderer later behind an ADR for the bundle). It uses an inline script/style, so a future
 * strict CSP would need a nonce/hash — none is set today. The spec is generated from the
 * route manifest so it cannot drift from the live routes.
 */
export function mountDocs(app: Hono<AuthEnv>, opts: { manifest: ManifestEntry[]; serverUrl?: string }): void {
  const spec = buildOpenApi(opts.manifest, opts.serverUrl ?? '/')

  app.get('/v1/openapi.json', (c) => {
    c.header('Cache-Control', 'public, max-age=300')
    return c.json(spec)
  })

  app.get('/v1/docs', (c) => {
    c.header('Content-Type', 'text/html; charset=utf-8')
    return c.body(DOCS_HTML)
  })
}

// Minimal, dependency-free, CSP-safe docs renderer: fetches the spec and lists operations
// grouped by tag. No inline event handlers / no external resources.
const DOCS_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orbetra API</title>
<style>
:root{color-scheme:light dark}
body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:2rem;max-width:60rem;margin-inline:auto;background:#fff;color:#111}
@media(prefers-color-scheme:dark){body{background:#0b0d10;color:#e6e6e6}a{color:#7aa2f7}code{background:#1a1d23}}
h1{margin:.2rem 0}h2{margin-top:2rem;border-bottom:1px solid #8884;padding-bottom:.3rem;text-transform:capitalize}
.op{display:flex;gap:.6rem;align-items:center;padding:.35rem 0;border-bottom:1px solid #8882}
.m{font-weight:700;font-size:.72rem;padding:.15rem .5rem;border-radius:.3rem;color:#fff;min-width:3.4rem;text-align:center}
.get{background:#2b8a3e}.post{background:#1971c2}.patch{background:#e8590c}.delete{background:#c92a2a}
code{font-family:ui-monospace,monospace;background:#0001;padding:.1rem .3rem;border-radius:.3rem}
.sec{margin-left:auto;font-size:.75rem;opacity:.7}
.lede{opacity:.8}
</style></head>
<body>
<h1 id="title">Orbetra API</h1>
<p class="lede" id="desc"></p>
<p class="lede">Auth: <code>Authorization: Bearer &lt;jwt&gt;</code> (web) or <code>X-Api-Key: orb_live_…</code> (integrations, read-only). Full spec: <a href="/v1/openapi.json">/v1/openapi.json</a>.</p>
<main id="out">Loading…</main>
<script>
const M={get:'get',post:'post',patch:'patch',delete:'delete',put:'post'};
fetch('/v1/openapi.json').then(r=>r.json()).then(spec=>{
  document.getElementById('title').textContent=spec.info.title+' '+spec.info.version;
  document.getElementById('desc').textContent=spec.info.description||'';
  const byTag={};
  for(const[path,ops]of Object.entries(spec.paths)){
    for(const[method,op]of Object.entries(ops)){
      const tag=(op.tags&&op.tags[0])||'other';(byTag[tag]??=[]).push({method,path,op});
    }
  }
  const out=document.getElementById('out');out.textContent='';
  for(const tag of Object.keys(byTag).sort()){
    const h=document.createElement('h2');h.textContent=tag;out.appendChild(h);
    for(const{method,path,op}of byTag[tag].sort((a,b)=>a.path.localeCompare(b.path))){
      const row=document.createElement('div');row.className='op';
      const m=document.createElement('span');m.className='m '+(M[method]||'get');m.textContent=method.toUpperCase();
      const c=document.createElement('code');c.textContent=path;
      const s=document.createElement('span');s.className='sec';
      s.textContent=(op.security&&op.security.length)?op.security.map(x=>Object.keys(x)[0]==='apiKeyAuth'?'apiKey':'jwt').join(' | '):'public';
      const sm=document.createElement('span');sm.textContent=' '+(op.summary||'');sm.style.opacity=.7;sm.style.fontSize='.85rem';
      row.append(m,c,sm,s);out.appendChild(row);
    }
  }
}).catch(()=>{document.getElementById('out').textContent='Failed to load /v1/openapi.json';});
</script>
</body></html>`
