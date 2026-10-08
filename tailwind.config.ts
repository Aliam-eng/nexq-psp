import type { Config } from "tailwindcss";

// Design tokens distilled from nexqcapital.com: graphite canvas built off the
// site's #393C41 charcoal, nexQ cyan (#00ABD7) -> magenta (#CE3D95) gradient
// from the Q mark, Montserrat, soft cyan glow.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        bg: "#16171a",
        charcoal: "#393c41", // nexqcapital.com header
        surface: {
          DEFAULT: "#1e2023",
          raised: "#25272b",
          overlay: "#2e3135",
        },
        line: {
          DEFAULT: "#33363b",
          strong: "#45494f",
        },
        ink: {
          DEFAULT: "#f5f5f5",
          muted: "#a4a8af",
          dim: "#6f747b",
        },
        brand: {
          DEFAULT: "#00abd7",
          600: "#008fb5",
          500: "#00abd7",
          400: "#3cc3e6",
          magenta: "#ce3d95",
          ink: "#ffffff",
        },
        success: "#2fc77a",
        gold: "#efbc2a",
        danger: "#e63946",
      },
      borderRadius: {
        lg: "0.75rem",
        xl: "1rem",
        "2xl": "1.25rem",
        "3xl": "1.75rem",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(0,171,215,0.10), 0 18px 50px -22px rgba(0,171,215,0.40)",
        "glow-sm": "0 6px 22px -10px rgba(206,61,149,0.55)",
        card: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 24px 50px -30px rgba(0,0,0,0.85)",
        focus: "0 0 0 3px rgba(0,171,215,0.25)",
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
