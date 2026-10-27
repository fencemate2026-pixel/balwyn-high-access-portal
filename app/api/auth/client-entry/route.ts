import { createClientEntryHandler } from "@/lib/client-entry";
import { POST as emailSignIn } from "../email/route";
import { POST as verifySignIn } from "../email/verify/route";

export const POST = createClientEntryHandler(emailSignIn, verifySignIn);
