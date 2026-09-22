import "dotenv/config";
import cors from "cors";
import express from "express";
import { authMiddleware } from "./middleware/auth.ts";
import { errorHandler } from "./middleware/errorHandler.ts";
import { accessRouter } from "./routes/access.ts";
import { aiRouter } from "./routes/ai.ts";
import { gatesRouter } from "./routes/gates.ts";
import { hireRouter } from "./routes/hire.ts";
import { schedulerRouter } from "./routes/scheduler.ts";
import { database } from "./services/database.ts";

const app = express();
const port = Number(process.env.PORT ?? 4010);

app.use(cors());
app.use(express.json());
app.use(authMiddleware);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "magic-keys-portal" });
});

app.get("/ready", async (_req, res, next) => {
  try {
    res.json({ ok: true, database: await database.getSqlHealth() });
  } catch (error) {
    next(error);
  }
});

app.use("/api/v1/access", accessRouter);
app.use("/api/v1/gates", gatesRouter);
app.use("/api/v1/scheduler", schedulerRouter);
app.use("/api/v1/ai", aiRouter);
app.use("/api/v1/hire", hireRouter);

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Magic Keys backend listening on http://localhost:${port}`);
});
