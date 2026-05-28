import { useEffect, useRef } from "react";

const DEFAULT_INTERVAL_MS = 7000;

export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs = DEFAULT_INTERVAL_MS,
  enabled = true
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return undefined;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = () => {
      void callbackRef.current();
    };

    const schedule = () => {
      timer = setTimeout(() => {
        if (document.visibilityState !== "hidden") {
          run();
        }
        schedule();
      }, intervalMs);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        run();
      }
    };

    run();
    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, intervalMs]);
}
