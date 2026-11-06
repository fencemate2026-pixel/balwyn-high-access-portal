// Gate Pi → portal (Azure) for thomastown-swing. All logic is shared: lib/gd-device-handler.ts.
import { handleDevicePost } from "@/lib/gd-device-handler";
import { SWING_DEVICE_ID } from "@/lib/gd-swing-model";

export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleDevicePost(request, SWING_DEVICE_ID);
