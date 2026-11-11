// Owner → thomastown-swing (Azure). Shared logic: lib/gd-owner-handler.ts. A Settlement Road member is 404 here.
import { handleOwnerGet, handleOwnerPost } from "@/lib/gd-owner-handler";
import { SWING_DEVICE_ID } from "@/lib/gd-swing-model";

export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleOwnerGet(request, SWING_DEVICE_ID);
export const POST = (request: Request) => handleOwnerPost(request, SWING_DEVICE_ID);
