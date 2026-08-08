import { cn } from "@/lib/utils";

/** The brand: the second p in Tipped has, well, tipped. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn("font-heading font-bold tracking-tight", className)}
      aria-label="Tipped"
    >
      Tip
      <span aria-hidden className="tipped-letter">
        p
      </span>
      <span className="sr-only">p</span>ed
    </span>
  );
}
