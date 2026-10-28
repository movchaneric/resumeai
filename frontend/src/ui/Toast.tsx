import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import * as RadixToast from "@radix-ui/react-toast";

interface ToastApi {
  show: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Shows short confirmations ("Link copied"). Put it once near the root. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ text: string; key: number } | null>(null);
  const [open, setOpen] = useState(false);
  const show = useCallback((text: string) => {
    setMessage((previous) => ({ text, key: (previous?.key ?? 0) + 1 }));
    setOpen(true);
  }, []);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      <RadixToast.Provider duration={2500} label="Notifications">
        {children}
        {message && (
          <RadixToast.Root
            key={message.key}
            open={open}
            onOpenChange={setOpen}
            className="rounded-btn bg-fg px-4 py-2.5 text-sm font-semibold text-surface shadow-lg transition duration-150 ease-out data-[state=closed]:opacity-0 data-[state=open]:opacity-100"
          >
            <RadixToast.Title>{message.text}</RadixToast.Title>
          </RadixToast.Root>
        )}
        <RadixToast.Viewport className="fixed bottom-4 left-1/2 z-50 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 outline-none" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs a ToastProvider above it.");
  return api;
}
