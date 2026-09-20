import { helpProvider } from '@/lib/help-provider';
import { env } from "@/lib/server-env";
import { getSql } from "@/db";
import { assertSameOrigin, getAdminSettingsAccess, requireOperator } from "@/lib/portal-auth";
import { readEquipment } from "@/lib/equipment-store";
import { validateEquipment } from "@/lib/equipment-config";
import { ensurePortalSeeded } from "@/lib/portal-store";
import { GATES } from "@/lib/portal-model";
export const dynamic = "force-dynamic";
const json = (body: unknown, status=200) => Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
export async function GET(request: Request) {
  const auth = await requireOperator(request,"viewer");
  if (!auth.user) return auth.response;
  await ensurePortalSeeded();
  const config = await readEquipment();
  if (auth.user.role !== "administrator" || !await getAdminSettingsAccess(request)) return json({preferences:{refreshSeconds:config.refreshSeconds,voiceRate:config.voiceRate,voiceVolume:config.voiceVolume}});
  const runtime = env as unknown as Record<string,string|undefined>;
  let environmentMap = {};
  try { environmentMap = JSON.parse(runtime.DOOR_GATE_MAP || "{}"); } catch { /* status remains unconfigured */ }
  return json({config, environmentMap, connection:{urlConfigured:Boolean(runtime.DOOR_SERVICE_URL),tokenConfigured:Boolean(runtime.DOOR_SERVICE_TOKEN),aiConfigured:Boolean(helpProvider(runtime).apiKey), controller:"Compass ACB-004", gateway:"Raspberry Pi", motor:"Roger F70/IPU36"}});
}
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return json({error:"Request rejected"},403);
  const auth = await requireOperator(request,"administrator");
  if (!auth.user) return auth.response;
  if (!await getAdminSettingsAccess(request)) return json({error:"Unlock administrator settings before changing equipment",code:"admin_password_required"},403);
  try {
    const text = await request.text();
    if (text.length > 12000) return json({error:"Settings are too large"},413);
    const config = validateEquipment(JSON.parse(text),GATES);
    await ensurePortalSeeded();
    await getSql().batch([
      getSql().prepare("UPDATE portal_settings SET equipment = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1").bind(JSON.stringify(config),auth.user.displayName),
      getSql().prepare("INSERT INTO activity_log (action,detail,category,actor_name,actor_role) VALUES ('Equipment settings saved','Portal mapping and preferences saved. Pi configuration requires local installation.','settings',?,?)").bind(auth.user.displayName,auth.user.role),
    ]);
    return json({config});
  } catch (error) { return json({error:error instanceof Error ? error.message : "Settings could not be saved"},400); }
}
