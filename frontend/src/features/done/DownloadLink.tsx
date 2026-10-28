import { useState } from "react";
import { Loader2 } from "lucide-react";
import { ApiError, downloadCv, downloadUrl } from "@/api";
import { cx } from "@/ui/cx";

export type DownloadFormat = "pdf" | "docx";

const STYLE = {
  primary: "bg-fg text-surface hover:bg-fg-2",
  secondary: "bg-surface text-fg ring-1 ring-fg-3 hover:bg-soft",
};

/**
 * A link to the file with `download`. A click fetches the file through `@/api` instead, so a 409 can show its message,
 * then saves the blob; without script the plain link still downloads.
 */
export function DownloadLink({
  runId,
  format,
  variant,
  label,
  onError,
}: {
  runId: string;
  format: DownloadFormat;
  variant: "primary" | "secondary";
  label: string;
  onError: (error: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);

  const onClick = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const { blob, filename } = await downloadCv(runId, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename ?? `tailored-cv.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking at once can cancel the download in Firefox and Safari.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onError(null);
    } catch (error) {
      onError(error instanceof ApiError ? error : new Error("download failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <a
      href={downloadUrl(runId, format)}
      download={`tailored-cv.${format}`}
      onClick={(e) => void onClick(e)}
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-btn px-5 text-[15px] font-semibold transition-colors duration-150",
        STYLE[variant],
        busy && "pointer-events-none opacity-50",
      )}
    >
      {busy && <Loader2 aria-hidden="true" size={16} strokeWidth={2} className="animate-spin motion-reduce:animate-none" />}
      {busy ? "Preparing…" : label}
    </a>
  );
}
