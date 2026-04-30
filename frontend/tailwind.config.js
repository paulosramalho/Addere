export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        /* ======================
           PALETA BASE — AMR
        ====================== */
        amr: {
          navy: "#0B1B3A",   // principal institucional
          navy2: "#0A1631",  // variação mais profunda
          blue: "#123A8C",   // destaque / ação
          ink: "#0F172A",    // texto escuro
        },

        /* ======================
           TOKENS SEMÂNTICOS
           (uso progressivo)
        ====================== */
        primary: {
          DEFAULT: "#0B1B3A",
          hover: "#0A1631",
          light: "#123A8C",
        },

        surface: {
          bg: "#F8FAFC",     // fundo geral
          card: "#FFFFFF",  // cards
          border: "#E2E8F0", // bordas
        },

        text: {
          primary: "#0F172A",
          secondary: "#475569",
          muted: "#64748B",
        },
      },
    },
  },
  plugins: [],
};
