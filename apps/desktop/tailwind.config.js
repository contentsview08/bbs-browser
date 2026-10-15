// hono-bbs-merge packages/web/tailwind.config.js から複製。フォント名だけ同梱版(Variable)を先頭に足している
import forms from '@tailwindcss/forms'

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#3b82f6',
        'c-base': 'var(--c-base)',
        'c-surface': 'var(--c-surface)',
        'c-surface2': 'var(--c-surface2)',
        'c-surface3': 'var(--c-surface3)',
        'c-border': 'var(--c-border)',
        'c-border-strong': 'var(--c-border-strong)',
        'c-text-strong': 'var(--c-text-strong)',
        'c-text-body': 'var(--c-text-body)',
        'c-text-muted': 'var(--c-text-muted)',
        'c-text-emphasis': 'var(--c-text-emphasis)',
        'c-accent': 'var(--c-accent)',
        'c-accent-hover': 'var(--c-accent-hover)',
        'c-accent-self': 'var(--c-accent-self)',
        'c-accent-self-wash': 'var(--c-accent-self-wash)',
        'c-link': 'var(--c-link)',
        'c-link-image': 'var(--c-link-image)',
        'c-link-twitter': 'var(--c-link-twitter)',
        'c-link-youtube': 'var(--c-link-youtube)',
        'c-poster-name': 'var(--c-poster-name)',
        'c-heat-warm': 'var(--c-heat-warm)',
        'c-heat-hot': 'var(--c-heat-hot)',
        'c-heat-very-hot': 'var(--c-heat-very-hot)',
      },
      fontFamily: {
        display: ['"Noto Sans JP Variable"', '"Noto Sans JP"', 'sans-serif'],
        sans: ['"Noto Sans JP Variable"', '"Noto Sans JP"', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '0.1875rem',
        lg: '0.375rem',
        xl: '0.5rem',
        '2xl': '0.625rem',
        full: '9999px',
      },
    },
  },
  plugins: [forms],
}
