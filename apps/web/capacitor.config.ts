import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.aeon.pm',
  appName: 'Aeon',
  webDir: 'out',
  server: {
    url: process.env.CAPACITOR_SERVER_URL || 'https://aeon.app',
    cleartext: false,
  },
  ios: {
    scheme: 'Aeon',
    contentInset: 'automatic',
  },
  android: {
    backgroundColor: '#0a0a0f',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#0a0a0f',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0a0a0f',
    },
  },
}

export default config
