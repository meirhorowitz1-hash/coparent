import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';

// Ensure default app is initialized even if this module is loaded before index.ts runs initializeApp()
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const messaging = admin.messaging();

type ReminderDoc = {
  familyId: string;
  eventId: string;
  targetUids: string[];
  title: string;
  startDate: admin.firestore.Timestamp;
  sendAt: admin.firestore.Timestamp;
  sent: boolean;
  sentAt?: admin.firestore.Timestamp | null;
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
};

export async function upsertReminder(params: {
  familyId: string;
  eventId: string;
  startDate: Date;
  reminderMinutes?: number | null;
  targetUids: string[];
  title: string;
}): Promise<void> {
  const { familyId, eventId, startDate, reminderMinutes, targetUids, title } = params;

  const ref = db.collection('families').doc(familyId).collection('reminders').doc(eventId);

  if (reminderMinutes === undefined || reminderMinutes === null) {
    await ref.delete().catch(() => {});
    return;
  }

  const sendAtDate = new Date(startDate.getTime() - reminderMinutes * 60 * 1000);
  const now = new Date();
  if (isNaN(sendAtDate.getTime()) || sendAtDate <= now) {
    // אם הזמן כבר עבר, נוותר על תזכורת
    await ref.delete().catch(() => {});
    return;
  }

  const payload: ReminderDoc = {
    familyId,
    eventId,
    targetUids: Array.from(new Set(targetUids || [])),
    title,
    startDate: admin.firestore.Timestamp.fromDate(startDate),
    sendAt: admin.firestore.Timestamp.fromDate(sendAtDate),
    sent: false,
    sentAt: null,
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now()
  };

  await ref.set(payload, { merge: true });
}

export async function deleteReminder(familyId: string, eventId: string): Promise<void> {
  const ref = db.collection('families').doc(familyId).collection('reminders').doc(eventId);
  await ref.delete().catch(() => {});
}

export async function dispatchDueReminders(limit = 50): Promise<void> {
  const now = admin.firestore.Timestamp.now();
  functions.logger.info('[dispatchDueReminders] run', { now: now.toDate().toISOString(), limit });

  try {
    const snapshot = await db
      .collectionGroup('reminders')
      .where('sent', '==', false)
      .where('sendAt', '<=', now)
      .orderBy('sendAt')
      .limit(limit)
      .get();

    functions.logger.info('[dispatchDueReminders] reminders to send', snapshot.size);
    console.log('[dispatchDueReminders] reminders to send', snapshot.size);

    if (snapshot.empty) {
      functions.logger.info('[dispatchDueReminders] no reminders ready to send');
      console.log('[dispatchDueReminders] no reminders ready to send');
      return;
    }

    for (const doc of snapshot.docs) {
      const data = doc.data() as ReminderDoc;
      try {
        functions.logger.info('[dispatchDueReminders] sending reminder', {
          id: doc.id,
          sendAt: data.sendAt.toDate(),
          targets: data.targetUids?.length || 0
        });
        console.log('[dispatchDueReminders] sending reminder', {
          id: doc.id,
          sendAt: data.sendAt.toDate(),
          targets: data.targetUids?.length || 0
        });
        await sendReminder(data);
        await doc.ref.update({
          sent: true,
          sentAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now()
        });
      } catch (error) {
        functions.logger.error('[dispatchDueReminders] failed to send reminder', { id: doc.id, error });
        // לא מסמנים כשליחה כדי לנסות שוב בריצה הבאה
      }
    }
  } catch (error) {
    functions.logger.error('[dispatchDueReminders] query failed', error);
  }
}

async function sendReminder(reminder: ReminderDoc): Promise<void> {
  if (!reminder.targetUids?.length) {
    return;
  }

  const tokenSet = new Set<string>();
  for (const uid of reminder.targetUids) {
    const snap = await db.collection('users').doc(uid).get();
    const tokens = (snap.get('pushTokens') as string[] | undefined) ?? [];
    tokens.forEach(t => tokenSet.add(t));
  }

  const tokens = Array.from(tokenSet);
  if (!tokens.length) {
    functions.logger.warn('[sendReminder] no tokens for reminder', { eventId: reminder.eventId, targetUids: reminder.targetUids });
    console.warn('[sendReminder] no tokens for reminder', { eventId: reminder.eventId, targetUids: reminder.targetUids });
    return;
  }

  const start = reminder.startDate.toDate();
  const body = `${start.toLocaleDateString('he-IL', {
    weekday: 'long',
    day: '2-digit',
    month: 'long'
  })} • ${start.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;

  await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title: `תזכורת לאירוע: ${reminder.title}`,
      body
    },
    data: {
      type: 'calendar-event-reminder',
      familyId: reminder.familyId,
      eventId: reminder.eventId
    }
  });

  functions.logger.info('[sendReminder] sent', {
    eventId: reminder.eventId,
    tokenCount: tokens.length
  });
  console.info('[sendReminder] sent', {
    eventId: reminder.eventId,
    tokenCount: tokens.length
  });
}
