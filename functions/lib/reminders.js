"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertReminder = upsertReminder;
exports.deleteReminder = deleteReminder;
exports.dispatchDueReminders = dispatchDueReminders;
const admin = __importStar(require("firebase-admin"));
const functions = __importStar(require("firebase-functions/v1"));
// Ensure default app is initialized even if this module is loaded before index.ts runs initializeApp()
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
const messaging = admin.messaging();
async function upsertReminder(params) {
    const { familyId, eventId, startDate, reminderMinutes, targetUids, title } = params;
    const ref = db.collection('families').doc(familyId).collection('reminders').doc(eventId);
    if (reminderMinutes === undefined || reminderMinutes === null) {
        await ref.delete().catch(() => { });
        return;
    }
    const sendAtDate = new Date(startDate.getTime() - reminderMinutes * 60 * 1000);
    const now = new Date();
    if (isNaN(sendAtDate.getTime()) || sendAtDate <= now) {
        // אם הזמן כבר עבר, נוותר על תזכורת
        await ref.delete().catch(() => { });
        return;
    }
    const payload = {
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
async function deleteReminder(familyId, eventId) {
    const ref = db.collection('families').doc(familyId).collection('reminders').doc(eventId);
    await ref.delete().catch(() => { });
}
async function dispatchDueReminders(limit = 50) {
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
            const data = doc.data();
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
            }
            catch (error) {
                functions.logger.error('[dispatchDueReminders] failed to send reminder', { id: doc.id, error });
                // לא מסמנים כשליחה כדי לנסות שוב בריצה הבאה
            }
        }
    }
    catch (error) {
        functions.logger.error('[dispatchDueReminders] query failed', error);
    }
}
async function sendReminder(reminder) {
    if (!reminder.targetUids?.length) {
        return;
    }
    const tokenSet = new Set();
    for (const uid of reminder.targetUids) {
        const snap = await db.collection('users').doc(uid).get();
        const tokens = snap.get('pushTokens') ?? [];
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
//# sourceMappingURL=reminders.js.map