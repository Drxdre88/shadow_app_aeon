import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        surface: 'var(--surface)',
        glow: {
          primary: 'var(--primary)',
          secondary: 'var(--primary-hover)',
          accent: 'var(--accent)',
          success: 'var(--success)',
          warning: 'var(--warning)',
          danger: 'var(--error)',
          pink: '#ec4899',
          orange: '#f97316',
        },
      },
      boxShadow: {
        'glow-none': 'none',
        'glow-sm': 'var(--glow-sm)',
        'glow-md': 'var(--glow-md)',
        'glow-lg': 'var(--glow-lg)',
        'glow-xl': 'var(--glow-xl)',
        'glow-xxl': 'var(--glow-xxl)',
      },
      animation: {
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        'glow-breathe': 'glow-breathe 4s ease-in-out infinite',
        'fade-in': 'fade-in 0.2s ease-out',
        'scale-in': 'scale-in 0.15s ease-out',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': {
            boxShadow: '0 0 20px 5px var(--glow-color, rgba(99, 102, 241, 0.4))'
          },
          '50%': {
            boxShadow: '0 0 40px 10px var(--glow-color, rgba(99, 102, 241, 0.7))'
          },
        },
        'glow-breathe': {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
}
export default config
