import type { Metadata } from 'next'
import { Inter, JetBrains_Mono, Space_Grotesk, Fira_Code } from 'next/font/google'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { AuthProvider } from '@/components/providers/AuthProvider'
import { ThemeEffects } from '@/components/effects/ThemeEffects'
import { ToastContainer } from '@/components/ui/Toast'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' })
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk' })
const firaCode = Fira_Code({ subsets: ['latin'], variable: '--font-fira-code' })

export const metadata: Metadata = {
  title: 'Aeon - Beautiful Project Timelines',
  description: 'Visualize your projects with stunning Gantt charts and task boards',
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
          <ThemeProvider>
            <ThemeEffects />
            <ToastContainer />
            {children}
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
