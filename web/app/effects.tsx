/** Small celebration pieces shared by the list page and the dashboard. */

/** An unwrapped gift box with a little sparkle, for the places that have nothing to show yet. */
export function EmptyGift({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty-gift">
      <svg width="92" height="84" viewBox="0 0 92 84" aria-hidden="true">
        <ellipse cx="46" cy="77" rx="28" ry="4" fill="#E6E9F0" />
        <rect x="16" y="38" width="60" height="36" rx="7" fill="#F6C9D0" />
        <rect x="11" y="26" width="70" height="16" rx="6" fill="#EE9FAC" />
        <rect x="40" y="26" width="12" height="48" fill="#F2C14E" />
        <path d="M46 26C41 10 24 8 26 18c1.3 7 13 8.4 20 8z" fill="#F7D57A" stroke="#E0A92E" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M46 26c5-16 22-18 20-8-1.3 7-13 8.4-20 8z" fill="#F7D57A" stroke="#E0A92E" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M80 8l1.6 4.4L86 14l-4.4 1.6L80 20l-1.6-4.4L74 14l4.4-1.6zM10 30l1.1 3L14 34l-2.9 1L10 38l-1.1-3L6 34l2.9-1z" fill="#F2C14E" />
      </svg>
      <p className="empty-gift-t">{title}</p>
      {hint && <p className="empty-gift-h">{hint}</p>}
    </div>
  );
}

const CONFETTI_COLORS = ["#D4243B", "#0F7B5F", "#E8B031", "#16213A", "#F28C9B"];
// fixed pseudo-random layout so rendering stays pure
const CONFETTI = (() => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 44 }, (_, i) => ({
    x: rnd() * 100,
    dx: (rnd() - 0.5) * 30,
    r: rnd() * 360,
    d: 1.9 + rnd() * 1.2,
    delay: rnd() * 0.5,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    round: i % 4 === 0,
  }));
})();

/** One burst of paper. Mount it (with a new key) to play it; it removes nothing itself. */
export function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {CONFETTI.map((c, i) => (
        <span
          key={i}
          className={c.round ? "round" : undefined}
          style={
            {
              "--x": `${c.x}%`,
              "--dx": `${c.dx}vw`,
              "--r": `${c.r}deg`,
              "--d": `${c.d}s`,
              "--delay": `${c.delay}s`,
              "--c": c.color,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
