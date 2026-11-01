import { Navigate } from "react-router";
import { useAccount } from "@/features/account";
import { MyRunsScreen } from "@/features/myRuns/MyRunsScreen";

/** `/runs`: My Runs for a signed-in person; a guest is sent to sign in and back. */
export function MyRunsRoute() {
  const { account } = useAccount();
  if (account === undefined) {
    return (
      <section className="mx-auto w-full max-w-[560px] px-4 py-10 md:px-6">
        <p role="status" className="text-fg-2">Loading…</p>
      </section>
    );
  }
  if (account === null) return <Navigate to="/sign-in?next=/runs" replace />;
  return <MyRunsScreen />;
}
