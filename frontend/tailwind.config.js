/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        secondary: {
          50: '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827',
        },
        // Liquid Glass colors
        glass: {
          white: 'rgba(255, 255, 255, 0.72)',
          'white-light': 'rgba(255, 255, 255, 0.5)',
          dark: 'rgba(30, 30, 30, 0.72)',
          'dark-light': 'rgba(30, 30, 30, 0.5)',
          border: 'rgba(255, 255, 255, 0.2)',
          'border-dark': 'rgba(255, 255, 255, 0.1)',
        },
        // Semantic surface colors for glass layers
        surface: {
          DEFAULT: 'rgba(255, 255, 255, 0.72)',
          elevated: 'rgba(255, 255, 255, 0.85)',
          overlay: 'rgba(0, 0, 0, 0.4)',
          muted: 'rgba(255, 255, 255, 0.5)',
        },
        // Semantic text colors
        'text-semantic': {
          primary: '#1a1a1a',
          secondary: '#525252',
          muted: '#a3a3a3',
          inverse: '#fafafa',
        },
        // Apple-inspired accent colors
        accent: {
          blue: '#0071e3',
          purple: '#bf5af2',
          green: '#30d158',
          orange: '#ff9f0a',
          red: '#ff453a',
        },
        // Semantic border colors
        'border-semantic': {
          subtle: 'rgba(0, 0, 0, 0.06)',
          DEFAULT: 'rgba(0, 0, 0, 0.1)',
          glass: 'rgba(255, 255, 255, 0.18)',
          'glass-strong': 'rgba(255, 255, 255, 0.25)',
        },
        // Theme-aware colors (use CSS variables)
        theme: {
          bg: 'var(--color-bg)',
          'bg-elevated': 'var(--color-bg-elevated)',
          'bg-muted': 'var(--color-bg-muted)',
          text: 'var(--color-text)',
          'text-muted': 'var(--color-text-muted)',
          'text-inverted': 'var(--color-text-inverted)',
          border: 'var(--color-border)',
          'border-muted': 'var(--color-border-muted)',
          accent: 'var(--color-accent)',
          'accent-hover': 'var(--color-accent-hover)',
        },
      },
      // Legal-optimized typography
      fontSize: {
        'legal-sm': ['0.9375rem', { lineHeight: '1.65', letterSpacing: '0.01em' }],
        'legal-base': ['1.0625rem', { lineHeight: '1.75', letterSpacing: '0.01em' }],
        'legal-lg': ['1.125rem', { lineHeight: '1.8', letterSpacing: '0.005em' }],
        'legal-xl': ['1.25rem', { lineHeight: '1.7', letterSpacing: '0' }],
      },
      boxShadow: {
        // Liquid Glass shadows
        'glass': '0 8px 32px rgba(0, 0, 0, 0.08)',
        'glass-lg': '0 25px 50px rgba(0, 0, 0, 0.12)',
        'glass-glow': '0 0 40px rgba(255, 255, 255, 0.1)',
        'glass-inset': 'inset 0 1px 1px rgba(255, 255, 255, 0.15)',
        'glass-ring': '0 0 0 1px rgba(255, 255, 255, 0.1)',
        'elevated': '0 10px 40px rgba(0, 0, 0, 0.1)',
        'elevated-lg': '0 20px 60px rgba(0, 0, 0, 0.15)',
        // Enhanced premium shadows
        'glass-elevated': '0 8px 40px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.08)',
        'glass-card': '0 4px 24px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
        'glow-blue': '0 0 20px rgba(0, 113, 227, 0.4)',
        'glow-blue-lg': '0 0 40px rgba(0, 113, 227, 0.3)',
        'glow-soft': '0 0 30px rgba(255, 255, 255, 0.15)',
        'inner-highlight': 'inset 0 1px 0 rgba(255, 255, 255, 0.25)',
        'inner-highlight-strong': 'inset 0 1px 0 rgba(255, 255, 255, 0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.1)',
      },
      backdropBlur: {
        xs: '2px',
        '2xl': '40px',
        '3xl': '64px',
      },
      // iOS-inspired timing functions
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)', // For intentional bouncy effects
        'smooth-out': 'cubic-bezier(0.4, 0, 0.2, 1)', // Smooth without bounce (Material ease-out)
        'apple': 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        'bounce-soft': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)', // For intentional bounce
      },
      animation: {
        'shimmer': 'shimmer 2s ease-in-out infinite',
        'bounce-subtle': 'bounce-subtle 0.5s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
        'slide-in-left': 'slide-in-left 0.3s ease-out',
        // New premium animations
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        'press': 'press 0.15s ease-out',
        'float': 'float 3s ease-in-out infinite',
        'scale-in': 'scale-in 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'slide-up': 'slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        shimmer: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        'bounce-subtle': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'slide-in-left': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        // New keyframes
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 15px rgba(0, 113, 227, 0.3)' },
          '50%': { boxShadow: '0 0 30px rgba(0, 113, 227, 0.5)' },
        },
        'press': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(0.97)' },
          '100%': { transform: 'scale(1)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-5px)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}

