import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/tokens.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="mx-auto max-w-[960px] px-4 py-10 md:px-6">
      <h1 className="text-[28px]">Resume AI</h1>
    </main>
  </StrictMode>,
);
