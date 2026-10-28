import { Check } from "lucide-react";

function Checks({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5 text-[15px] text-panel-fg-2">
          <Check aria-hidden="true" size={18} strokeWidth={2.5} className="mt-0.5 shrink-0 text-panel-added" />
          {item}
        </li>
      ))}
    </ul>
  );
}

/** A made-up example of a Change, to show what the product does. */
function SampleChange() {
  return (
    <div className="hidden flex-col gap-2 rounded-tile bg-panel-raised p-4 ring-1 ring-panel-ring min-[960px]:flex">
      <p className="text-sm text-panel-muted line-through">Worked on the reporting tool for the sales team</p>
      <p className="text-[15px] text-panel-fg">Built the reporting tool the sales team uses to track weekly targets</p>
      <p className="self-start rounded-sm bg-panel-badge-bg px-2 py-0.5 text-xs font-semibold text-panel-badge">
        Based on your CV · Experience, second bullet
      </p>
    </div>
  );
}

export function SignInPanel() {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="max-w-[460px] text-[28px] leading-tight min-[960px]:text-[36px]">Your CV, tailored to the job. Nothing invented.</h2>
      <SampleChange />
      <div className="hidden min-[960px]:block">
        <Checks items={["Every change shows what it's based on", "You approve each one before download", "Always one page, PDF or Word"]} />
      </div>
    </div>
  );
}

export function SignUpPanel() {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="max-w-[460px] text-[28px] leading-tight min-[960px]:text-[36px]">Keep every tailored CV in one place.</h2>
      <div className="hidden min-[960px]:block">
        <Checks items={["All your Runs, listed", "Download again any time", "Delete it all in one click"]} />
      </div>
    </div>
  );
}
