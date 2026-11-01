import { Link } from "react-router";
import { useMyRuns } from "@/features/account";
import { RunRow } from "@/features/myRuns/RunRow";
import { ApiError } from "@/api";
import { useToast } from "@/ui/Toast";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-4 py-10 md:px-6">
      <h1 className="text-[28px] leading-tight">My Runs</h1>
      {children}
    </section>
  );
}

/** The signed-in person's Owned Runs, newest first (the API sorts). */
export function MyRunsScreen() {
  const toast = useToast();
  const runs = useMyRuns();

  const onDownloadError = (error: unknown) => {
    if (error === null) return;
    toast.show(error instanceof ApiError && error.status === 409 ? error.message : "Couldn't download the file. Try again.");
  };

  if (runs.isPending) {
    return (
      <Frame>
        <p role="status" className="text-fg-2">Loading your Runs…</p>
      </Frame>
    );
  }
  if (runs.isError) {
    return (
      <Frame>
        <p role="alert" className="text-fg-2">Couldn&apos;t load your Runs.</p>
        <button type="button" onClick={() => void runs.refetch()} className="self-start font-semibold text-accent underline">
          Try again
        </button>
      </Frame>
    );
  }
  if (runs.data.runs.length === 0) {
    return (
      <Frame>
        <p role="status" className="text-fg-2">No Runs yet</p>
        <Link
          to="/"
          className="inline-flex min-h-12 items-center self-start rounded-btn bg-fg px-5 text-[15px] font-semibold text-surface transition-colors duration-150 hover:bg-fg-2"
        >
          Tailor a CV
        </Link>
      </Frame>
    );
  }
  return (
    <Frame>
      <ul className="flex flex-col gap-3">
        {runs.data.runs.map((run) => (
          <RunRow key={run.id} run={run} onDownloadError={onDownloadError} />
        ))}
      </ul>
    </Frame>
  );
}
