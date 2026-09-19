import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, watch: null } });
try {
 const { default: Dashboard } = await vite.ssrLoadModule('/app/dashboard-client.tsx');
 const { GATES, makeSchedules } = await vite.ssrLoadModule('/lib/portal-model.ts');
 const user = {displayName:'Example operator', email:'operator@example.invalid',role:'viewer'};
 const now = new Date().toISOString();
 const snapshot={user,serverTime:now,systemMode:'normal',gates:GATES.map((g,i)=>({gateId:g.id,commandedPosition:i===0?'open':'closed',reportedPosition:g.active?(i===0?'open':'closed'):'unknown',controllerState:g.active?'online':'uncommissioned',safetyOk:g.active?true:null,lastSeen:g.active?now:null,lastCommandState:'idle',lastCommandId:null,lastError:null,credentialIssued:g.active,commissioned:g.active})), schedules:makeSchedules(),activity:[],automations:[],settings:{positionMonitoring:true,faultAlerts:true,voiceAnnouncements:false,enabledModules:[]},plan:{tier:'core',name:'Gate Operations',advancedFeatures:false}};
 const markup=renderToStaticMarkup(React.createElement(Dashboard,{user,initialData:snapshot}));
 const filters='<svg class="logo-filter-definitions" aria-hidden="true"><defs><filter id="logo-clear-background" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 -1 -1 -1 0 2.85" result="background-mask"/><feComposite in="SourceGraphic" in2="background-mask" operator="in"/></filter></defs></svg>';
 await writeFile('public/dashboard-illustration.html', `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=1440"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'"><title>Magic Keys dashboard demonstration</title><link rel="stylesheet" href="/dashboard-illustration.css"><style>html,body{margin:0;width:1440px;height:1200px;overflow:hidden}body{pointer-events:none}.dashboard-panels,.advanced-discovery{display:none}.workspace-content{padding-top:22px}.demo-banner{position:fixed;z-index:100;bottom:0;left:0;right:0;padding:12px;background:#f6b64b;color:#10283c;text-align:center;font:600 20px Arial}</style></head><body>${filters}<div inert>${markup}</div><div class="demo-banner">DEMONSTRATION · EXAMPLE GATE STATES</div></body></html>`);
 const css=await postcss([tailwind({base:root,optimize:true})]).process(await readFile('app/globals.css','utf8'),{from:path.join(root,'app/globals.css')});
 await writeFile('public/dashboard-illustration.css',css.css);
 console.log('Rendered the current dashboard as an inert illustration. No operator data or requests.');
} finally { await vite.close(); }
