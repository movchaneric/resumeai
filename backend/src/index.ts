import "dotenv/config";
import express from "express";

const app = express();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`backend listening on :${port}`);
});
