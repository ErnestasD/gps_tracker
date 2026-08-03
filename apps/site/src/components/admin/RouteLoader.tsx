import * as React from "react";
import { useRouterState } from "@tanstack/react-router";

/**
 * Top progress bar shown ONLY while the router is actually fetching a route.
 * No minimum-visible timer, no fake spinner — if navigation is instant, nothing renders.
 */
export function RouteLoader() {
  const isLoading = useRouterState({
    select: (s) => s.status === "pending" || s.isLoading,
  });

  // Small delay before showing, so instant transitions don't flash a bar.
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    if (!isLoading) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), 120);
    return () => clearTimeout(t);
  }, [isLoading]);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px] overflow-hidden"
    >
      <div
        className="h-full w-2/5"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--admin-brand) 50%, transparent)",
          animation: "orbetraBar 1s ease-in-out infinite",
          boxShadow: "0 0 10px color-mix(in oklab, var(--admin-brand) 60%, transparent)",
        }}
      />
      <style>{`
        @keyframes orbetraBar {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
}
