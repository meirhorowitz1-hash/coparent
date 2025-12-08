// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  
  // Backend Mode: 'firebase' | 'server'
  // 'firebase' - Use Firebase Firestore directly (current behavior)
  // 'server' - Use Node.js backend API
  backendMode:'firebase',
  
  // Node.js Backend API URL (used when backendMode is 'server')
  apiUrl: 'http://localhost:3000/api',
  socketUrl: 'http://localhost:3000',
  
  // Firebase config (always needed for Authentication)
  firebase: {
    apiKey: "AIzaSyDn0rywlgPTW3vbQAJoIF446GKG2ts-wpU",
    authDomain: "coparent-393e0.firebaseapp.com",
    projectId: "coparent-393e0",
    storageBucket: "coparent-393e0.firebasestorage.app",
    messagingSenderId: "43802271173",
    appId: "1:43802271173:web:bedfe1e447a1d94ff67fac",
    measurementId: "G-YB8EHVMVYK",
    vapidKey: 'BFgl1lYzp7U_mpYKh1NREpJZvGgFBsnAF4yV59Uk1aifN1iOg5tdKZwVA1QWEVX51JmKNxVjwNYpKUCKjgXUbJk'
  }
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
