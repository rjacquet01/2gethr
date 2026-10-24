import type { Metadata, Viewport } from 'next'
import { Inter, Geist_Mono } from 'next/font/google'
import { PrivacyAnalytics } from '@/components/privacy-analytics'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/theme-provider'
import { AndroidAppDetector } from '@/components/android-app-detector'
import './globals.css'

const _inter = Inter({ subsets: ["latin"], variable: '--font-inter' });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

const SHARE_IMAGE = { url: '/og-image.png', width: 1200, height: 630, alt: 'Togethr: connect people, connect events' }
const DESCRIPTION = 'Keep your family connected and coordinated with Togethr. Shared calendars, location sharing, and event management for busy families.'

export const metadata: Metadata = {
  metadataBase: new URL('https://mytogethr.com'),
  title: 'Togethr - Connect people, connect events',
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: 'Togethr',
    title: 'Togethr - Connect people, connect events',
    description: DESCRIPTION,
    url: '/',
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Togethr - Connect people, connect events',
    description: DESCRIPTION,
    images: [SHARE_IMAGE],
  },
  generator: 'Togethr',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Togethr',
  },
  formatDetection: {
    telephone: true,
  },
  icons: {
    icon: [
      { url: '/icons/togethr-icon-blue.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/togethr-icon-blue.png', sizes: '512x512', type: 'image/png' },
    ],
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#3b4563' },
    { media: '(prefers-color-scheme: dark)', color: '#3b4563' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/togethr-icon-blue.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body className="font-sans antialiased min-h-screen">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <AndroidAppDetector />
          <Toaster position="top-center" richColors />
        </ThemeProvider>
        <PrivacyAnalytics />
        <ServiceWorkerRegistration />
      </body>
    </html>
  )
}

function ServiceWorkerRegistration() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js').then(
                function(registration) {
                  console.log('Togethr SW registered:', registration.scope);
                },
                function(err) {
                  console.log('Togethr SW registration failed:', err);
                }
              );
            });
          }
        `,
      }}
    />
  )
}
