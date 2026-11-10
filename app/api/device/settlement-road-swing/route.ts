// Gate Pi → portal (Azure) for settlement-road-swing. All logic is shared: lib/gd-device-handler.ts.
import { handleDevicePost } from "@/lib/gd-device-handler";
import { SETTLEMENT_DEVICE_ID } from "@/lib/gd-swing-model";

export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleDevicePost(request, SETTLEMENT_DEVICE_ID);
