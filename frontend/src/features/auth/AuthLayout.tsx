import type { ReactNode } from "react";
import { Link } from "react-router";

/** The two halves: the dark brand panel (stacked first below 960px) and the centred form column. */
export function AuthLayout({ panel, children }: { panel: ReactNode; children: ReactNode }) {
  return (
    <main className="grid min-h-screen bg-surface min-[960px]:grid-cols-2">
      <div className="flex flex-col gap-8 bg-panel px-6 py-8 text-panel-fg min-[960px]:justify-between min-[960px]:px-14 min-[960px]:py-12">
        <Link to="/" className="flex items-center gap-2 self-start font-bold tracking-tight">
          <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-sm bg-panel-fg text-sm text-panel">
            R
          </span>
          Resume AI
        </Link>
        {panel}
        <div aria-hidden="true" className="hidden min-[960px]:block" />
      </div>
      <div className="flex items-center justify-center px-4 py-10 md:px-6">
        <div className="flex w-full max-w-[400px] flex-col gap-5">{children}</div>
      </div>
    </main>
  );
}
