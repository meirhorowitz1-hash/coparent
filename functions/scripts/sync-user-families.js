#!/usr/bin/env node
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS must point to a service account JSON file.');
  process.exit(1);
}

try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
} catch (error) {
  console.error('Firebase admin initialization failed:', error);
  process.exit(1);
}

const firestore = admin.firestore();

async function syncFamilies() {
  const familiesSnapshot = await firestore.collection('families').get();
  console.log(`Found ${familiesSnapshot.size} families.`);
  let updatedCount = 0;

  for (const familyDoc of familiesSnapshot.docs) {
    const familyId = familyDoc.id;
    const members = familyDoc.get('members') || [];

    if (!Array.isArray(members) || members.length === 0) {
      continue;
    }

    for (const memberId of members) {
      if (!memberId) {
        continue;
      }
      await firestore
        .collection('users')
        .doc(memberId)
        .set(
          {
            families: FieldValue.arrayUnion(familyId),
          },
          { merge: true }
        );
      updatedCount += 1;
      console.log(`Added family ${familyId} to user ${memberId}`);
    }
  }

  console.log(`Synced ${updatedCount} user-family entries.`);
}

syncFamilies()
  .then(() => {
    console.log('Family sync completed.');
    process.exit(0);
  })
  .catch(error => {
    console.error('Family sync failed:', error);
    process.exit(1);
  });
