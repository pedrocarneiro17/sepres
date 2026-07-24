/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './templates/**/*.html',
    './static/js/**/*.js'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        soft: '0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.05)'
      },
      colors: {
        // Paleta da marca SEPRES (dourado/oliva + preto), usada como cor de
        // destaque no lugar do roxo/indigo padrão do Tailwind.
        sepres: {
          50: '#f9f6e8',
          100: '#f0ead0',
          200: '#e2d5a1',
          300: '#d1bd6e',
          400: '#bfa845',
          500: '#b29c33',
          600: '#a89826',
          700: '#8a7d1f',
          800: '#6d6318',
          900: '#554d13',
          ink: '#1a1a1a'
        }
      }
    }
  },
  plugins: []
}
