import type { Config } from "tailwindcss";

/**
 * Tailwind v4: design tokens and theme extensions live in `src/app/globals.css` (`@theme inline`).
 * This file exists for tooling/IDE awareness and explicit content paths only.
 */
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
} satisfies Config;
