import { cn } from "@/lib/utils";

/**
 * The signature tally: one tick per seat, not a percentage. Filled seats glow
 * warm; the notch after `min` marks where the side tips.
 */
export function SeatMeter({
  active,
  min,
  max,
  className,
}: {
  active: number;
  min: number;
  max: number;
  className?: string;
}) {
  const tipped = active >= min;
  return (
    <div className={cn("select-none", className)}>
      <div className="flex items-center gap-1">
        {Array.from({ length: max }, (_, i) => {
          const filled = i < active;
          const isNotch = i === min - 1;
          return (
            <span
              key={i}
              className={cn(
                "h-3 flex-1 rounded-full transition-colors",
                filled ? "seat-filled" : "bg-secondary",
                isNotch && "mr-2.5",
              )}
              aria-hidden
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex text-[11px] leading-none">
        <span
          className={cn(
            "font-medium",
            tipped ? "text-candle" : "text-muted-foreground",
          )}
          /* label sits under the notch */
          style={{ marginLeft: `calc(${(min / max) * 100}% - 2rem)` }}
        >
          {tipped ? "✓ enough to tip" : `tips at ${min}`}
        </span>
      </div>
      <span className="sr-only">
        {active} of {max} seats filled; needs {min} to tip.
      </span>
    </div>
  );
}
