import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PL CHAT Admin',
  description: 'Production operations dashboard for PL CHAT'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
