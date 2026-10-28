import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/tokens.css";
import { App, createQueryClient } from "@/routes/App";
import { createAppRouter } from "@/routes/router";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App router={createAppRouter()} client={createQueryClient()} />
  </StrictMode>,
);
