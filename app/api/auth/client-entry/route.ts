import { clientEntry } from "@/lib/client-entry";
import { requestOrigin } from "@/lib/request-origin";
import { POST as passwordSignIn } from "../email/route";

export async function POST(request: Request) {
  return clientEntry(request, passwordSignIn, requestOrigin(request));
}
