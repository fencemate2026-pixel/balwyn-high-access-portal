import { gates } from "@/lib/portal-config";
import type { PersistedPortalState } from "@/lib/portal-types";

function toRouteErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";

  if (
    message.includes("D1 binding") ||
    message.includes("no such table") ||
    message.includes("SQLITE_ERROR")
  ) {
    return "Portal persistence is not ready yet. Generate and apply the D1 migration before enabling state sync.";
  }

  return message;
}

export async function GET() {
  try {
    const [{ getDb }, { getPersistedPortalState }] = await Promise.all([
      import("@/db/index"),
      import("@/db/queries"),
    ]);
    const db = getDb();
    const state = await getPersistedPortalState(db);
    return Response.json({ state });
  } catch (error) {
    return Response.json({ state: null, warning: toRouteErrorMessage(error) });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      operator?: string;
      state?: PersistedPortalState;
    };

    if (!payload.state || !payload.operator) {
      return Response.json(
        { error: "operator and state are required" },
        { status: 400 },
      );
    }

    const [{ getDb }, { syncPortalState }] = await Promise.all([
      import("@/db/index"),
      import("@/db/queries"),
    ]);
    const db = getDb();
    await syncPortalState(db, payload.state, gates, payload.operator);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: toRouteErrorMessage(error) },
      { status: 500 },
    );
  }
}
