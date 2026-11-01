import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { RouterProvider } from "react-router";
import { useClaimGuestRuns } from "@/features/account";
import { ToastProvider } from "@/ui/Toast";

type Router = Parameters<typeof RouterProvider>[0]["router"];

export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true } } });
}

/** Hands this browser's Guest Runs to the Account once someone is signed in. Renders nothing. */
function GuestRunClaim() {
  useClaimGuestRuns();
  return null;
}

export function App({ router, client }: { router: Router; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <GuestRunClaim />
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
      {import.meta.env.DEV && <ReactQueryDevtools buttonPosition="bottom-left" />}
    </QueryClientProvider>
  );
}
