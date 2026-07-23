import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#f6f7f4',
        ink: '#172121',
        primary: '#0f8790',
        line: '#dce2dc'
      }
    }
  },
  plugins: []
};

export default config;
