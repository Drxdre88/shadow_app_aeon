import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono, Space_Grotesk, Fira_Code } from 'next/font/google'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { AuthProvider } from '@/components/providers/AuthProvider'
import { PreferencesProvider } from '@/components/providers/PreferencesProvider'
import { ThemeEffects } from '@/components/effects/ThemeEffects'
import { CelebrationEngine } from '@/components/celebrations'
import { CursorEffect } from '@/components/effects/cursor'
import { ToastContainer } from '@/components/ui/Toast'
import { ServiceWorkerRegistration } from '@/components/pwa/ServiceWorkerRegistration'
import { CommandPalette } from '@/components/ui/CommandPalette'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' })
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk' })
const firaCode = Fira_Code({ subsets: ['latin'], variable: '--font-fira-code' })

export const metadata: Metadata = {
  title: {
    default: 'Aeon',
    template: 'AEON - %s',
  },
  description: 'Visualize your projects with stunning Gantt charts and task boards',
  manifest: '/manifest.json',
  icons: {
    icon: '/aeon.png',
    apple: '/aeon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Aeon',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#8b5cf6',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`antialiased ${inter.variable} ${jetbrainsMono.variable} ${spaceGrotesk.variable} ${firaCode.variable}`}
        suppressHydrationWarning
      >
        <AuthProvider>
          <PreferencesProvider>
          <ThemeProvider>
            <ThemeEffects />
            <CelebrationEngine />
            <CursorEffect />
            <ToastContainer />
            <ServiceWorkerRegistration />
            <CommandPalette />
            {children}
          </ThemeProvider>
          </PreferencesProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
