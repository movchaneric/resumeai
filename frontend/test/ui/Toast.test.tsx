import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "@/ui/Toast";

function Trigger({ message }: { message: string }) {
  const toast = useToast();
  return <button onClick={() => toast.show(message)}>Show</button>;
}

describe("Toast", () => {
  it("shows the message it is given", async () => {
    render(
      <ToastProvider>
        <Trigger message="Link copied" />
      </ToastProvider>,
    );
    expect(screen.queryByText("Link copied")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
  });

  it("shows an action button that runs its handler", async () => {
    const onSelect = vi.fn();
    function WithAction() {
      const toast = useToast();
      return <button onClick={() => toast.show("Rejected", { durationMs: 6000, action: { label: "Undo", onSelect } })}>Show</button>;
    }
    render(
      <ToastProvider>
        <WithAction />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("stays only as long as durationMs says", async () => {
    function Short() {
      const toast = useToast();
      return <button onClick={() => toast.show("Gone soon", { durationMs: 200 })}>Show</button>;
    }
    render(
      <ToastProvider>
        <Short />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(await screen.findByText("Gone soon")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Gone soon")).toBeNull(), { timeout: 2000 });
  });

  it("throws a clear error without a provider", () => {
    expect(() => render(<Trigger message="x" />)).toThrow("useToast needs a ToastProvider");
  });
});
