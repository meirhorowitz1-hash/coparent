import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.ionic.starter',
  appName: 'coparent',
  webDir: 'www',
  plugins: {
    Keyboard: {
      resize: 'none',
      scrollAssist: false,
      resizeOnFullScreen: false,
      style: 'dark'
    }
  }
};

export default config;
