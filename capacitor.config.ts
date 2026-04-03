import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.equalpath.app',
  appName: 'EqualPath',
  webDir: 'www',
  server: {
    // Use the remote backend API
    allowNavigation: ['equalpath.onrender.com', 'routing.openstreetmap.de', 'nominatim.openstreetmap.org', 'overpass-api.de']
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#4A90D9',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#4A90D9',
    },
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
};

export default config;
