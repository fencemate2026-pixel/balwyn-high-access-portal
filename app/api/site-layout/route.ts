import { requireOperator } from "@/lib/portal-auth";
import layer from "@/data/balwyn_site.json";
export const dynamic="force-dynamic";
export async function GET(request:Request){const auth=await requireOperator(request,"viewer");if(!auth.user)return auth.response;return Response.json(layer,{headers:{"Cache-Control":"no-store"}})}
