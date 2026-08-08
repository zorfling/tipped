"use client";

import { useEffect, useRef } from "react";
import type { NightStatePayload } from "@/lib/nightState";

/**
 * Keeps the night screen impossible to miss:
 * - Screen Wake Lock while the event is running, so phones don't sleep at the table.
 * - A two-note chime + vibration whenever the phase changes (round starts,
 *   break starts, night ends). Audio is primed by the first tap anywhere on
 *   the page (browsers require a gesture); iOS has no vibration API, so there
 *   the chime carries it.
 */
export function useNightCues(state: NightStatePayload | null): void {
  const audioCtx = useRef<AudioContext | null>(null);
  const prevKey = useRef<string | null>(null);

  // Prime audio on the first user gesture (check-in tap counts).
  useEffect(() => {
    const prime = () => {
      if (!audioCtx.current) {
        try {
          audioCtx.current = new AudioContext();
        } catch {
          return; // no WebAudio — cues degrade to vibration only
        }
      }
      void audioCtx.current.resume();
    };
    window.addEventListener("pointerdown", prime);
    return () => window.removeEventListener("pointerdown", prime);
  }, []);

  // Hold a wake lock while the night is live; re-acquire when the tab returns.
  useEffect(() => {
    const active =
      state &&
      ["checkin", "awaiting_schedule", "before_first_round", "round", "break"].includes(
        state.phase,
      );
    if (!active || !("wakeLock" in navigator)) return;

    let lock: WakeLockSentinel | null = null;
    let released = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
        if (released) await lock.release();
      } catch {
        // low battery or unsupported — nothing to do
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [state]);

  // Chime + vibrate on phase transitions.
  useEffect(() => {
    if (!state) return;
    const key =
      state.phase === "round"
        ? `round-${state.round?.number}`
        : state.phase === "break" || state.phase === "before_first_round"
          ? `break-${state.nextRound?.number}`
          : state.phase;
    const prev = prevKey.current;
    prevKey.current = key;
    // Only cue real mid-night transitions, not the initial render.
    if (prev === null || prev === key) return;
    if (!["round", "break", "ended"].some((p) => key.startsWith(p))) return;

    navigator.vibrate?.([200, 100, 200]);

    const ctx = audioCtx.current;
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    for (const [freq, at] of [
      [660, 0],
      [990, 0.18],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + at);
      gain.gain.linearRampToValueAtTime(0.25, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + at + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.45);
    }
  }, [state]);
}
