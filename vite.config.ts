import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/Young-Methy-Comparation/",
  plugins: [react()],
  build: { target: "es2022" },
});
