import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0e1414",
          muted: "#4a5959",
          subtle: "#7a8a8a",
        },
        paper: {
          DEFAULT: "#faf7f2",
          card: "#ffffff",
          subtle: "#f3efe8",
          line: "#e6e1d7",
        },
        accent: {
          DEFAULT: "#0d5b58",
          hover: "#0a4744",
          soft: "#e8f0ef",
        },
        danger: { DEFAULT: "#9a2929", soft: "#f5e3e3" },
        warn: { DEFAULT: "#8a5a00", soft: "#f7ecd5" },
        ok: { DEFAULT: "#1f6b3a", soft: "#e3efe5" },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        sm: "3px",
        DEFAULT: "5px",
        md: "6px",
        lg: "8px",
      },
      boxShadow: {
        card: "0 1px 0 rgba(14,20,20,0.04), 0 1px 3px rgba(14,20,20,0.06)",
        pop: "0 4px 16px rgba(14,20,20,0.10), 0 2px 4px rgba(14,20,20,0.06)",
      },
    },
  },
  plugins: [],
};
export default config;
