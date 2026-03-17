/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primärfarbe: Petrol
        primary: {
          50: '#e6f0f4',
          100: '#b3d4e0',
          200: '#80b8cc',
          300: '#4d9cb8',
          400: '#267da0',
          500: '#1B5E7B',
          600: '#174e66',
          700: '#133f52',
          800: '#0f2f3d',
          900: '#0b1f29',
        },
        // Energietyp-Farben
        energy: {
          electricity: '#F59E0B',   // Gelb
          gas: '#3B82F6',           // Blau
          heating: '#EF4444',       // Rot
          water: '#06B6D4',         // Cyan
          solar: '#10B981',         // Grün
          oil: '#8B5CF6',           // Violett
          district: '#F97316',      // Orange
          pellets: '#84CC16',       // Lime
        },
        // Status-Farben
        status: {
          success: '#10B981',
          warning: '#F59E0B',
          error: '#EF4444',
          info: '#3B82F6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
