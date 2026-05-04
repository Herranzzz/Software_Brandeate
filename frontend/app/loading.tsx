/**
 * Root-level loading UI shown during route transitions.
 *
 * Next.js App Router uses this file as the Suspense boundary fallback while
 * a server component is fetching its data. Without it the user sees the
 * previous page until the new page is fully ready, which can take 1-3s on
 * heavy routes (orders, dashboard) and feels like the app is frozen.
 *
 * Visual: a thin animated bar across the top — unobtrusive, fast, and
 * communicates progress without hiding any existing UI.
 */
export default function Loading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        zIndex: 9999,
        overflow: "hidden",
        pointerEvents: "none",
        background: "transparent",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: "100%",
          width: "40%",
          background:
            "linear-gradient(90deg, transparent 0%, var(--color-primary, #4f46e5) 50%, transparent 100%)",
          animation: "nav-progress-slide 1.1s ease-in-out infinite",
        }}
      />
      <style>{`
        @keyframes nav-progress-slide {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(150%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
}
