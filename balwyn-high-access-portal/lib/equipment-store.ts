import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { portalSettings } from "@/db/schema";
import { DEFAULT_EQUIPMENT, validateEquipment } from "@/lib/equipment-config";
import { GATES } from "@/lib/portal-model";
export async function readEquipment() {
  const rows = await getDb().select({ equipment: portalSettings.equipment }).from(portalSettings).where(eq(portalSettings.id,1)).limit(1);
  return rows[0]?.equipment ? validateEquipment(JSON.parse(rows[0].equipment), GATES) : structuredClone(DEFAULT_EQUIPMENT);
}
