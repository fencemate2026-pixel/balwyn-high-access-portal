// Mildura boom gate Pi -> portal (Azure). All logic: lib/gd-mildura-handler.ts. POST only; no cookies, no CORS.
import { handleMilduraPost } from "@/lib/gd-mildura-handler";

export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleMilduraPost(request);
