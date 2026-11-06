// Gate Pi → portal (Azure) for thomastown-sliding. All logic is shared: lib/gd-device-handler.ts.
import { handleDevicePost } from "@/lib/gd-device-handler";
import { SLIDING_DEVICE_ID } from "@/lib/gd-swing-model";

export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleDevicePost(request, SLIDING_DEVICE_ID);
