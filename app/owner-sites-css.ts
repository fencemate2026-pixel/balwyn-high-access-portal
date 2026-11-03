// Shared styles of the owner sites console (Thomastown panel + Mildura view). Plain module so
// server components (the dev preview) can inline it too.
export const OWNER_SITES_CSS = `
.os-wrap{display:grid;grid-template-columns:230px 1fr;gap:16px;align-items:start}
.os-solo{grid-template-columns:1fr}
.os-list{display:flex;flex-direction:column;gap:4px;padding:8px;border:1px solid var(--border,#e3e7ef);border-radius:12px;background:var(--card,#fff)}
.os-list h4{margin:4px 6px 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.65}
.os-site{display:flex;gap:10px;align-items:center;text-align:left;padding:9px 10px;border-radius:8px;border:0;background:none;cursor:pointer;color:inherit}
.os-site:hover{background:rgba(127,127,127,.08)} .os-site.on{background:rgba(255,107,0,.1);outline:1px solid rgba(255,107,0,.35)}
.os-site small{display:block;opacity:.65;font-size:12px}
.os-dot{width:10px;height:10px;border-radius:50%;background:#9aa3b2;flex-shrink:0} .os-dot.ok{background:#0f9d58} .os-dot.bad{background:#d93025} .os-dot.warn{background:#f4b400}
.os-tabs{display:flex;gap:4px;border-bottom:1px solid var(--border,#e3e7ef);margin:10px 0 14px;overflow-x:auto}
.os-tab{border:0;background:none;padding:8px 12px;border-bottom:2px solid transparent;cursor:pointer;color:inherit;opacity:.7;white-space:nowrap}
.os-tab.on{opacity:1;border-color:#ff6b00;font-weight:600}
.os-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.os-card{border:1px solid var(--border,#e3e7ef);border-radius:12px;padding:14px;background:var(--card,#fff)}
.os-card h3{margin:0;font-size:15px;display:flex;gap:8px;align-items:center}
.os-kv{display:grid;grid-template-columns:130px 1fr;gap:4px 10px;font-size:13px;margin:10px 0}
.os-kv>span:nth-child(odd){opacity:.65}
.os-pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;font-weight:600;margin:0 4px 4px 0}
.os-ok{background:rgba(15,157,88,.12);color:#0b7a44} .os-bad{background:rgba(217,48,37,.12);color:#b3261e}
.os-warn{background:rgba(244,180,0,.16);color:#8a5a00} .os-mute{background:rgba(127,127,127,.12)}
.os-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.os-form{display:grid;grid-template-columns:1.4fr 1fr 1fr auto;gap:8px;margin:8px 0 12px}
.os-table{width:100%;border-collapse:collapse;font-size:13px}
.os-table th,.os-table td{padding:8px;border-bottom:1px solid var(--border,#e3e7ef);text-align:left;vertical-align:middle}
.os-table th{font-size:12px;opacity:.65;font-weight:600}
.os-scroll{overflow-x:auto;border:1px solid var(--border,#e3e7ef);border-radius:12px}
.os-banner{padding:10px 12px;border-radius:10px;margin-bottom:12px;font-size:13px;border:1px solid}
.os-banner.warn{background:rgba(244,180,0,.12);border-color:rgba(244,180,0,.5)} .os-banner.info{background:rgba(26,95,209,.08);border-color:rgba(26,95,209,.35)}
.os-days label{display:inline-flex;gap:3px;align-items:center;margin-right:8px;font-size:13px}
.os-mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}
.os-list h4+h4,.os-list .os-gap{margin-top:12px}
a.os-site{text-decoration:none}
.os-site .os-ext{margin-left:auto;opacity:.55;width:14px;height:14px;flex-shrink:0}
@media (max-width:900px){.os-wrap{grid-template-columns:1fr}.os-form{grid-template-columns:1fr 1fr}.os-kv{grid-template-columns:110px 1fr}}
`;
