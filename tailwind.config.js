/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: '#16181d',
        'panel-2': '#1c1f26',
        'panel-3': '#23272f',
        stroke: '#2c313a',
        ink: '#e6e9ef',
        'ink-dim': '#9aa3b2',
        'ink-faint': '#6b7382',
        accent: '#5b8cff',
        'accent-soft': 'rgba(91,140,255,0.16)',
        image: '#4dd4ac',
        text: '#ffb86b',
        video: '#c084fc',
      },
      fontFamily: {
        ui: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
