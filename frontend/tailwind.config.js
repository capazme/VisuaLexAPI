/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0d6efd', // Bootstrap primary match or custom
        secondary: '#6c757d',
      }
    },
  },
  plugins: [],
}

