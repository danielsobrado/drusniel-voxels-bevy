import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        editor: {
          app: "#0d0f12",
          canvas: "#101215",
          panel: "#181b20",
          panel2: "#1d2026",
          elev: "#20242b",
          border: "#2a2e36",
          "border-strong": "#353a43",
          fg: "#e6e8ec",
          "fg-2": "#b3b8c2",
          "fg-3": "#7e8591",
          cyan: "#2cb8ff",
          warn: "#f5a524",
          ok: "#36c46a",
          bad: "#ef4f5e",
          agent: "#a26cff",
        },
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        lg: "0.65rem",
      },
      boxShadow: {
        panel: "0 10px 35px rgba(0,0,0,0.28)",
      },
    },
  },
  plugins: [],
} satisfies Config;
