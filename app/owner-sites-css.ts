// Shared styles of the owner sites console (Thomastown panel + Mildura view). Plain module so
// server components (the dev preview) can inline it too.
// Themed to Magic Keys navy glass (4 Nov 2026).
export const OWNER_SITES_CSS = `
.os-wrap{display:grid;grid-template-columns:230px 1fr;gap:16px;align-items:start;color:#F5FBFF}
.os-solo{grid-template-columns:1fr}
.os-list{display:flex;flex-direction:column;gap:4px;padding:8px;border:1px solid #1E5A8A;border-radius:0;background:linear-gradient(to bottom right,#0D3A63,#062846)}
.os-list h4{margin:4px 6px 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#B9CFE2}
.os-site{display:flex;gap:10px;align-items:center;text-align:left;padding:9px 10px;border-radius:0;border:0;background:none;cursor:pointer;color:#F5FBFF}
.os-site:hover{background:rgba(255,255,255,.06)} .os-site.on{background:rgba(255,122,0,.12);outline:1px solid #FF7A00}
.os-site small{display:block;color:#B9CFE2;font-size:12px}
.os-dot{width:10px;height:10px;border-radius:50%;background:#9aa3b2;flex-shrink:0} .os-dot.ok{background:#34d399} .os-dot.bad{background:#ff6b6b} .os-dot.warn{background:#fbbf24}
.os-tabs{display:flex;gap:4px;border-bottom:1px solid rgba(255,255,255,.14);margin:10px 0 14px;overflow-x:auto}
.os-tab{border:0;background:none;padding:8px 12px;border-bottom:2px solid transparent;cursor:pointer;color:#B9CFE2;opacity:1;white-space:nowrap}
.os-tab.on{color:#F5FBFF;border-color:#FF7A00;font-weight:600}
.os-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.os-card{border:1px solid rgba(255,255,255,.14);border-radius:0;padding:14px;background:rgba(255,255,255,.06)}
.os-card h3{margin:0;font-size:15px;display:flex;gap:8px;align-items:center;color:#F5FBFF}
.os-kv{display:grid;grid-template-columns:130px 1fr;gap:4px 10px;font-size:13px;margin:10px 0;color:#F5FBFF}
.os-kv>span:nth-child(odd){color:#B9CFE2}
.os-pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;font-weight:600;margin:0 4px 4px 0}
.os-ok{background:rgba(52,211,153,.12);color:#34d399} .os-bad{background:rgba(255,107,107,.12);color:#ff6b6b}
.os-warn{background:rgba(251,191,36,.16);color:#fbbf24} .os-mute{background:rgba(255,255,255,.08);color:#B9CFE2}
.os-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.os-form{display:grid;grid-template-columns:1.4fr 1fr 1fr auto;gap:8px;margin:8px 0 12px}
.os-table{width:100%;border-collapse:collapse;font-size:13px;color:#F5FBFF}
.os-table th,.os-table td{padding:8px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left;vertical-align:middle}
.os-table th{font-size:12px;color:#B9CFE2;font-weight:600}
.os-scroll{overflow-x:auto;border:1px solid rgba(255,255,255,.14);border-radius:0;background:rgba(255,255,255,.04)}
.os-banner{padding:10px 12px;border-radius:0;margin-bottom:12px;font-size:13px;border:1px solid}
.os-banner.warn{background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.5);color:#F5FBFF} .os-banner.info{background:rgba(92,200,255,.08);border-color:rgba(92,200,255,.35);color:#F5FBFF}
.os-days label{display:inline-flex;gap:3px;align-items:center;margin-right:8px;font-size:13px;color:#F5FBFF}
.os-mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#B9CFE2}
.os-list h4+h4,.os-list .os-gap{margin-top:12px}
a.os-site{text-decoration:none}
.os-site .os-ext{margin-left:auto;opacity:.55;width:14px;height:14px;flex-shrink:0}
@media (max-width:900px){.os-wrap{grid-template-columns:1fr}.os-form{grid-template-columns:1fr 1fr}.os-kv{grid-template-columns:110px 1fr}}
`;
