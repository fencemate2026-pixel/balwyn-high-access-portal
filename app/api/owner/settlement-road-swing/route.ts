// Owner, or a Settlement Road member → settlement-road-swing (Azure). Shared logic: lib/gd-owner-handler.ts. Anyone else is 404.
import { handleOwnerGet, handleOwnerPost } from "@/lib/gd-owner-handler";
import { SETTLEMENT_DEVICE_ID } from "@/lib/gd-swing-model";

export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleOwnerGet(request, SETTLEMENT_DEVICE_ID);
export const POST = (request: Request) => handleOwnerPost(request, SETTLEMENT_DEVICE_ID);
