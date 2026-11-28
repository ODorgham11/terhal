"use client";

import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "motion/react";

// The road: from off the panel's corner, through the pickup, to the drop-off.
const ROAD = "M-20 470 C 120 430, 150 300, 250 260 S 420 210, 470 60";
// Where the stops sit along it, as fractions of its length, so the car starts and ends exactly on them.
const PICKUP = 0.193;
const DROPOFF = 0.901;
// One trip, from the pickup to the drop-off, in seconds; the car then fades and sets off again.
const TRIP = 7;
const draw = { duration: 1.4, ease: [0.32, 0.72, 0, 1] as const };

// The panel beside the signed-out pages' form: a route drawn like the trip timeline inside the app, and a line about
// what Terhal is for. On arrival the road draws itself and the stops pop in; then its centre line keeps moving and a
// car drives from the pickup to the drop-off, over and over. All of it stands still for readers who ask for less
// motion.
export function AuthPanel() {
  const t = useTranslations("staff.auth.panel");
  const still = useReducedMotion() ?? false;

  return (
    <aside className="relative hidden w-[42%] max-w-160 shrink-0 flex-col justify-end overflow-hidden rounded-2xl bg-primary p-12 text-primary-foreground lg:flex">
      <svg
        aria-hidden
        viewBox="0 0 520 520"
        fill="none"
        className="absolute -end-10 -top-6 w-[115%] max-w-none rtl:-scale-x-100"
      >
        <defs>
          <radialGradient id="auth-car-glow">
            <stop offset="0" stopColor="white" stopOpacity="0.55" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* The road, wide and faint, drawing itself in. */}
        <motion.path
          d={ROAD}
          stroke="currentColor"
          strokeOpacity="0.08"
          strokeWidth="56"
          strokeLinecap="round"
          initial={still ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={draw}
        />
        {/* Its dashed centre line, flowing towards the drop-off once the road is down. */}
        <motion.path
          d={ROAD}
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="2"
          strokeDasharray="10 12"
          strokeLinecap="round"
          className={still ? undefined : "animate-[auth-road_1.6s_linear_infinite]"}
          initial={still ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.9 }}
        />

        {/* The drop-off: a filled stop with a ring that keeps pulsing out from it. */}
        {!still && (
          <circle
            cx="445"
            cy="121"
            r="14"
            fill="var(--accent)"
            // Hidden until the stop has popped in; the pulse then takes over its opacity.
            opacity="0"
            className="origin-center animate-[auth-pulse_2.4s_ease-out_1.6s_infinite] [transform-box:fill-box]"
          />
        )}
        <motion.g
          initial={still ? false : { opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...draw, duration: 0.5, delay: 1.1 }}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        >
          <circle
            cx="445"
            cy="121"
            r="26"
            stroke="var(--accent)"
            strokeOpacity="0.35"
            strokeWidth="2"
          />
          <circle cx="445" cy="121" r="14" fill="var(--accent)" />
        </motion.g>

        {/* The car: a soft light driving from the pickup to the drop-off, fading in and out at each end. */}
        {!still && (
          <g opacity="0">
            <circle r="16" fill="url(#auth-car-glow)" />
            <circle r="5.5" fill="white" />
            <animateMotion
              path={ROAD}
              dur={`${String(TRIP)}s`}
              begin="1.6s"
              repeatCount="indefinite"
              keyPoints={`${String(PICKUP)};${String(DROPOFF)}`}
              keyTimes="0;1"
              calcMode="linear"
            />
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              keyTimes="0;0.08;0.9;1"
              dur={`${String(TRIP)}s`}
              begin="1.6s"
              repeatCount="indefinite"
            />
          </g>
        )}

        {/* The pickup: a hollow ring, on top so the car sets off from under it. */}
        <motion.circle
          cx="90"
          cy="407"
          r="13"
          fill="var(--primary)"
          stroke="var(--accent)"
          strokeWidth="5"
          initial={still ? false : { opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...draw, duration: 0.5, delay: 0.5 }}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        />
      </svg>

      <motion.div
        className="relative flex max-w-sm flex-col gap-3"
        initial={still ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...draw, duration: 0.7, delay: 0.3 }}
      >
        <p className="text-[2.25rem] leading-[1.1] font-semibold tracking-tight">{t("title")}</p>
        <p className="text-sm text-primary-foreground/75">{t("body")}</p>
      </motion.div>
    </aside>
  );
}
