import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
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

  it("throws a clear error without a provider", () => {
    expect(() => render(<Trigger message="x" />)).toThrow("useToast needs a ToastProvider");
  });
});
