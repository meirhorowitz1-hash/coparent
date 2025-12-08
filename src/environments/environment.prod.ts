export const environment = {
  production: true,
  
  // Backend Mode: 'firebase' | 'server'
  // Set to 'server' when deploying with the Node.js backend
  backendMode: 'firebase' as 'firebase' | 'server',
  
  // Node.js Backend API URL (update with your production URL)
  apiUrl: 'https://api.coparent.app/api',
  socketUrl: 'https://api.coparent.app',
  
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
