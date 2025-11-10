import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

type SwapRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

interface SwapRequestDoc {
  requestedBy: string;
  requestedByName?: string;
  requestedTo?: string;
  requestedToName?: string;
  originalDate: admin.firestore.Timestamp;
  proposedDate: admin.firestore.Timestamp;
  reason?: string | null;
  status: SwapRequestStatus;
}

export const onSwapRequestCreated = functions.firestore
  .document('families/{familyId}/swapRequests/{swapRequestId}')
  .onCreate(async (snapshot: functions.firestore.QueryDocumentSnapshot, context: functions.EventContext) => {
    functions.logger.info('[swapRequestCreated] Triggered', {
      familyId: context.params.familyId,
      requestId: context.params.swapRequestId
    });
    const request = snapshot.data() as SwapRequestDoc;

    await sendPushToUser(request.requestedTo, {
      title: 'בקשת החלפה חדשה',
      body: `${request.requestedByName || 'הורה אחר'} ביקש להחליף את ${formatDate(request.originalDate)}`
    }, {
      type: 'swap-request-created',
      familyId: context.params.familyId,
      requestId: context.params.swapRequestId
    });
  });

export const onSwapRequestStatusChanged = functions.firestore
  .document('families/{familyId}/swapRequests/{swapRequestId}')
  .onUpdate(async (
    change: functions.Change<functions.firestore.QueryDocumentSnapshot>,
    context: functions.EventContext
  ) => {
    functions.logger.info('[swapRequestStatusChanged] Triggered', {
      familyId: context.params.familyId,
      requestId: context.params.swapRequestId
    });
    const before = change.before.data() as SwapRequestDoc;
    const after = change.after.data() as SwapRequestDoc;

    if (before.status === after.status) {
      return;
    }

    if (after.status !== 'approved' && after.status !== 'rejected') {
      return;
    }

    const statusLabel = after.status === 'approved' ? 'אושרה' : 'נדחתה';

    await sendPushToUser(after.requestedBy, {
      title: `בקשה ${statusLabel}`,
      body: `${after.requestedToName || 'ההורה השני'} ${statusLabel} את ההחלפה עבור ${formatDate(after.proposedDate)}`
    }, {
      type: `swap-request-${after.status}`,
      familyId: context.params.familyId,
      requestId: context.params.swapRequestId
    });
  });

async function sendPushToUser(
  uid: string | undefined,
  notification: { title: string; body: string },
  data: Record<string, string>
): Promise<void> {
  if (!uid) {
    return;
  }

  functions.logger.info('[sendPushToUser] preparing message', { uid, data });

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    functions.logger.warn('[sendPushToUser] user not found', { uid });
    return;
  }

  const tokens = (userSnap.get('pushTokens') as string[] | undefined) ?? [];
  if (!tokens.length) {
    functions.logger.warn('[sendPushToUser] no tokens for user', { uid });
    return;
  }

  const response = await messaging.sendEachForMulticast({
    tokens,
    notification,
    data,
    android: {
      priority: 'high',
      notification: {
        sound: 'default'
      }
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          alert: {
            title: notification.title,
            body: notification.body
          }
        }
      }
    }
  });

  const invalidTokens = response.responses
    .map((res, idx) => (!res.success ? tokens[idx] : null))
    .filter((token): token is string => Boolean(token));

  functions.logger.info('[sendPushToUser] push responses', {
    uid,
    successCount: response.successCount,
    failureCount: response.failureCount,
    invalidTokens
  });

  if (invalidTokens.length) {
    await userSnap.ref.update({
      pushTokens: admin.firestore.FieldValue.arrayRemove(...invalidTokens)
    });
    functions.logger.info('[sendPushToUser] removed invalid tokens', { uid, invalidTokens });
  }
}

function formatDate(timestamp: admin.firestore.Timestamp): string {
  const date = timestamp.toDate();
  return date.toLocaleDateString('he-IL', {
    weekday: 'long',
    day: '2-digit',
    month: 'long'
  });
}
