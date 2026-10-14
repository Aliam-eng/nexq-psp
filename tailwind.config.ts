import type { Config } from "tailwindcss";

// Design tokens distilled from nexqcapital.com: light canvas, the site's #393C41
// charcoal for header/hero bands, nexQ cyan (#00ABD7) -> magenta (#CE3D95) gradient
// from the Q mark, Montserrat. Deliberately light — nothing like the old dark portal.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        bg: "#f3f4f6",
        charcoal: {
          DEFAULT: "#393c41", // nexqcapital.com header
          deep: "#2b2e32",
        },
        surface: {
          DEFAULT: "#ffffff",
          raised: "#f8f9fb",
          overlay: "#eef0f3",
        },
        line: {
          DEFAULT: "#e2e5ea",
          strong: "#cdd2d9",
        },
        ink: {
          DEFAULT: "#1d2024",
          muted: "#565c64",
          dim: "#8a9099",
        },
        brand: {
          DEFAULT: "#00abd7",
          600: "#0089ad",
          500: "#00abd7",
          400: "#00799b", // text-safe cyan on white (AA)
          magenta: "#ce3d95",
          ink: "#ffffff",
        },
        success: "#15803d",
        gold: "#a16207",
        danger: "#c81e3a",
      },
      borderRadius: {
        lg: "0.75rem",
        xl: "1rem",
        "2xl": "1.25rem",
        "3xl": "1.75rem",
      },
      boxShadow: {
        glow: "0 12px 32px -14px rgba(0,137,173,0.35)",
        "glow-sm": "0 8px 20px -10px rgba(206,61,149,0.45)",
        card: "0 1px 2px rgba(16,24,40,0.05), 0 12px 32px -16px rgba(16,24,40,0.14)",
        focus: "0 0 0 4px rgba(0,171,215,0.18)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "none" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "pulse-soft": {
          "0%,100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.16,1,0.3,1) both",
        shimmer: "shimmer 1.6s infinite",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
