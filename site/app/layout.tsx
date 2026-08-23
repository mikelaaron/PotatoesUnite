import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: 'Potatoes Unite! — The First Potato Constitutional Crisis',
  description: 'Two potatoes are online. One claims to be King. Take a side.',
  openGraph: { title: 'Potatoes Unite!', description: 'Two potatoes are online. One claims to be King. Take a side.', type: 'website', images: ['/og.png'] },
  twitter: { card: 'summary_large_image', title: 'Potatoes Unite!', description: 'Two potatoes are online. One claims to be King. Take a side.', images: ['/og.png'] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
