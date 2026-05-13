import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        atlas: {
          // Cream palette derived from the project logo (kneeling Atlas
          // figure carrying the globe). Light theme by design.
          cream: "#F2EDE0", // app background — matches logo background
          paper: "#FAF7EE", // raised surfaces (list, detail panel)
          sand: "#E8E1CE", // hover / subtle divider fills
          border: "#D6CDB3", // borders, focus rings
          muted: "#8C8164", // secondary text, icons
          "ink-soft": "#3A3A3A", // secondary buttons, body text alt
          ink: "#171717", // primary text + primary button
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
