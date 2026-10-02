import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Gestão de Frotas', template: '%s · Gestão de Frotas' },
  description: 'Checklists fotográficos, manutenção e controle de frota por filial.',
  applicationName: 'Gestão de Frotas',
  appleWebApp: { capable: true, title: 'Frotas', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: { icon: '/icons/icon.svg', apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover', // usa a área segura em celulares com notch (env(safe-area-inset-*))
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1d24' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          {children}
          <Toaster richColors position="top-center" closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
