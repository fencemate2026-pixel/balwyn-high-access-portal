import { clientAddressSource } from "@/lib/client-address";

// Process health only; this endpoint does not seed data or issue commands.
// `clientAddressSource` names which platform header supplies visitor addresses
// for sign-in rate limits ("azure" or "cloudflare"); it never includes an address.
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ status: "ok", clientAddressSource: clientAddressSource() }, { headers: { "Cache-Control": "no-store" } });
}
