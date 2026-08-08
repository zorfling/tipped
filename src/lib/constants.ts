export const MIN_PRICE_CENTS = 1000; // free RSVPs flake — price is the commitment device

export const DEFAULTS = {
  minSize: 6,
  maxSize: 12,
  maxImbalance: 2,
  roundLengthSec: 300,
  breakLengthSec: 90,
  tipDeadlineHoursBefore: 48,
  bucketLabels: ["Side A", "Side B"],
} as const;

/** Registration states that count toward a bucket's active tally. */
export const ACTIVE_STATES = ["reserved", "confirmed", "checked_in"] as const;
