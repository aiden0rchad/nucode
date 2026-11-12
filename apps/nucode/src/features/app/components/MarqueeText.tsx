import { useEffect, useRef, type ReactNode } from "react";

const START_DELAY_MS = 400;
const SPEED_PX_PER_SECOND = 40;
const RETURN_MS = 150;

/**
 * Slides a cut-off title sideways while its row is hovered or focused, so the end
 * of the text can be read. The host row is the nearest `[data-marquee-host]`
 * ancestor. Overflow is measured on hover only, never at render time.
 */
export function useMarquee<T extends HTMLElement>(hostSelector = "[data-marquee-host]") {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const element = ref.current;
    const host = element?.closest(hostSelector) ?? element?.parentElement;
    if (!element || !host) {
      return undefined;
    }
    let timer: number | undefined;
    let frame = 0;
    const cancel = () => {
      window.clearTimeout(timer);
      timer = undefined;
      window.cancelAnimationFrame(frame);
    };
    const animate = (to: number, duration: number, done?: () => void) => {
      const from = element.scrollLeft;
      const startedAt = performance.now();
      const step = (now: number) => {
        const progress = duration <= 0 ? 1 : Math.min(1, (now - startedAt) / duration);
        element.scrollLeft = from + (to - from) * progress;
        if (progress < 1) {
          frame = window.requestAnimationFrame(step);
        } else {
          done?.();
        }
      };
      frame = window.requestAnimationFrame(step);
    };
    const reducedMotion = () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = () => {
      cancel();
      if (reducedMotion()) {
        return;
      }
      timer = window.setTimeout(() => {
        const distance = element.scrollWidth - element.clientWidth;
        if (distance <= 1) {
          return;
        }
        element.classList.add("is-scrolling");
        animate(distance, ((distance - element.scrollLeft) / SPEED_PX_PER_SECOND) * 1000);
      }, START_DELAY_MS);
    };
    const reset = () => {
      cancel();
      if (!element.classList.contains("is-scrolling")) {
        return;
      }
      animate(0, RETURN_MS, () => element.classList.remove("is-scrolling"));
    };
    const onFocusOut = (event: Event) => {
      if (!host.contains((event as FocusEvent).relatedTarget as Node | null)) {
        reset();
      }
    };
    host.addEventListener("mouseenter", start);
    host.addEventListener("mouseleave", reset);
    host.addEventListener("focusin", start);
    host.addEventListener("focusout", onFocusOut);
    return () => {
      cancel();
      host.removeEventListener("mouseenter", start);
      host.removeEventListener("mouseleave", reset);
      host.removeEventListener("focusin", start);
      host.removeEventListener("focusout", onFocusOut);
    };
  }, [hostSelector]);

  return ref;
}

export function MarqueeText({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useMarquee<HTMLSpanElement>();
  return (
    <span ref={ref} className={className} data-marquee="">
      {children}
    </span>
  );
}
