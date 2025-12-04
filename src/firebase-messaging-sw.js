importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDn0rywlgPTW3vbQAJoIF446GKG2ts-wpU',
  authDomain: 'coparent-393e0.firebaseapp.com',
  projectId: 'coparent-393e0',
  storageBucket: 'coparent-393e0.firebasestorage.app',
  messagingSenderId: '43802271173',
  appId: '1:43802271173:web:bedfe1e447a1d94ff67fac'
});

const messaging = firebase.messaging();
console.log('[Firebase SW] Initialized');

messaging.onBackgroundMessage(payload => {
  console.log('[Firebase SW] onBackgroundMessage', payload);
  const notification = payload.notification || {};
  const title = notification.title || 'CoNest';
  const options = {
    body: notification.body,
    data: payload.data || {},
    icon: '/assets/icon/favicon.png'
  };

  self.registration.showNotification(title, options);
});
