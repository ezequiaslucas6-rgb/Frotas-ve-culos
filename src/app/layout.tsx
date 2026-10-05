import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Rodar · Gestão de Frotas', template: '%s · Rodar' },
  description: 'Checklists fotográficos, manutenção e controle de frota por filial.',
  applicationName: 'Rodar',
  appleWebApp: { capable: true, title: 'Rodar', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: { icon: '/icons/icon.svg', apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover', // usa a área segura em celulares com notch (env(safe-area-inset-*))
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f3f7' },
    { media: '(prefers-color-scheme: dark)', color: '#1d1e26' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          {children}
          <Toaster theme="system" position="top-center" closeButton toastOptions={{ className: '!rounded-xl' }} />
        </ThemeProvider>
      </body>
    </html>
  );
}
