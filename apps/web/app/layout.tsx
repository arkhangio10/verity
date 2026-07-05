import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@covenant/core';
import type { Metadata } from 'next';
import { Fraunces, Inter_Tight, JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const sans = Inter_Tight({ subsets: ['latin'], display: 'swap', variable: '--font-sans' });
const display = Space_Grotesk({ subsets: ['latin'], display: 'swap', variable: '--font-display' });
const mono = JetBrains_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-mono' });
const serif = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-serif',
  style: ['normal', 'italic'],
});

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: PRODUCT_TAGLINE,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${display.variable} ${mono.variable} ${serif.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
