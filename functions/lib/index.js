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
exports.onExpenseStatusChanged = exports.onExpenseCreated = exports.dispatchEventReminders = exports.onCalendarEventDeleted = exports.onCalendarEventUpdated = exports.onCalendarEventCreated = exports.onSwapRequestStatusChanged = exports.onCustodyScheduleChanged = exports.onSwapRequestCreated = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
const reminders_1 = require("./reminders");
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
const messaging = admin.messaging();
exports.onSwapRequestCreated = functions.firestore
    .document('families/{familyId}/swapRequests/{swapRequestId}')
    .onCreate(async (snapshot, context) => {
    functions.logger.info('[swapRequestCreated] Triggered', {
        familyId: context.params.familyId,
        requestId: context.params.swapRequestId
    });
    const request = snapshot.data();
    await sendPushToUser(request.requestedTo, {
        title: 'בקשת החלפה חדשה',
        body: `${request.requestedByName || 'הורה אחר'} ביקש להחליף את ${formatDate(request.originalDate)}`
    }, {
        type: 'swap-request-created',
        familyId: context.params.familyId,
        requestId: context.params.swapRequestId
    });
});
exports.onCustodyScheduleChanged = functions.firestore
    .document('families/{familyId}/settings/custodySchedule')
    .onWrite(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const beforePending = before?.pendingApproval ?? null;
    const afterPending = after?.pendingApproval ?? null;
    // new request
    if (!beforePending && afterPending) {
        const targets = await getFamilyMembers(context.params.familyId);
        const requestor = afterPending.requestedBy;
        const notifyUids = targets.filter(uid => uid && uid !== requestor);
        const body = `${afterPending.requestedByName || 'הורה אחר'} ביקש לאשר תבנית משמורת חדשה מ־${formatDate(afterPending.startDate)}`;
        for (const uid of notifyUids) {
            await sendPushToUser(uid, { title: 'בקשת משמרות חדשה', body }, {
                type: 'custody-approval-request',
                familyId: context.params.familyId
            });
        }
        return;
    }
    // approval/decline
    if (beforePending && !afterPending) {
        const requester = beforePending.requestedBy;
        if (requester) {
            await sendPushToUser(requester, {
                title: 'בקשת המשמרות אושרה/טופלה',
                body: 'הבקשה לסידור המשמרות עודכנה על ידי ההורה השני.'
            }, {
                type: 'custody-approval-updated',
                familyId: context.params.familyId
            });
        }
    }
});
exports.onSwapRequestStatusChanged = functions.firestore
    .document('families/{familyId}/swapRequests/{swapRequestId}')
    .onUpdate(async (change, context) => {
    functions.logger.info('[swapRequestStatusChanged] Triggered', {
        familyId: context.params.familyId,
        requestId: context.params.swapRequestId
    });
    const before = change.before.data();
    const after = change.after.data();
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
exports.onCalendarEventCreated = functions.firestore
    .document('families/{familyId}/calendarEvents/{eventId}')
    .onCreate(async (snapshot, context) => {
    const event = snapshot.data();
    const familyId = context.params.familyId;
    functions.logger.info('[calendarEventCreated] Triggered', {
        familyId,
        eventId: context.params.eventId,
        parentId: event.parentId
    });
    const targetUids = await resolveTargetUidsForEvent(familyId, event.parentId, event.targetUids);
    if (!targetUids.length) {
        functions.logger.warn('[calendarEventCreated] No target users for event', { familyId });
        return;
    }
    const payload = {
        title: 'אירוע חדש בלוח המשפחה',
        body: `${event.title} • ${formatEventDate(event.startDate.toDate(), event.isAllDay)}`
    };
    const dataPayload = {
        type: 'calendar-event-created',
        familyId,
        eventId: context.params.eventId,
        parentId: event.parentId
    };
    for (const uid of targetUids) {
        await sendPushToUser(uid, payload, dataPayload);
    }
    await (0, reminders_1.upsertReminder)({
        familyId,
        eventId: context.params.eventId,
        startDate: event.startDate.toDate(),
        reminderMinutes: event.reminderMinutes,
        targetUids,
        title: event.title
    });
});
exports.onCalendarEventUpdated = functions.firestore
    .document('families/{familyId}/calendarEvents/{eventId}')
    .onUpdate(async (change, context) => {
    const after = change.after.data();
    const familyId = context.params.familyId;
    const targetUids = await resolveTargetUidsForEvent(familyId, after.parentId, after.targetUids);
    await (0, reminders_1.upsertReminder)({
        familyId,
        eventId: context.params.eventId,
        startDate: after.startDate.toDate(),
        reminderMinutes: after.reminderMinutes,
        targetUids,
        title: after.title
    });
});
exports.onCalendarEventDeleted = functions.firestore
    .document('families/{familyId}/calendarEvents/{eventId}')
    .onDelete(async (_, context) => {
    await (0, reminders_1.deleteReminder)(context.params.familyId, context.params.eventId);
});
// Scheduled dispatcher for due event reminders (runs every minute)
exports.dispatchEventReminders = functions.pubsub
    .schedule('every 1 minutes')
    .onRun(async (context) => {
    functions.logger.info('[dispatchEventReminders] start', { ts: context.timestamp });
    console.log('[dispatchEventReminders] start', context.timestamp);
    try {
        await (0, reminders_1.dispatchDueReminders)();
        functions.logger.info('[dispatchEventReminders] done');
        console.log('[dispatchEventReminders] done');
    }
    catch (error) {
        functions.logger.error('[dispatchEventReminders] error', error);
        console.error('[dispatchEventReminders] error', error);
        throw error;
    }
    return null;
});
exports.onExpenseCreated = functions.firestore
    .document('families/{familyId}/expenses/{expenseId}')
    .onCreate(async (snapshot, context) => {
    const expense = snapshot.data();
    const familyId = context.params.familyId;
    const members = await getFamilyMembers(familyId);
    const targetUid = resolveOtherParent(members, expense.createdBy);
    if (!targetUid) {
        return;
    }
    const body = `${expense.createdByName || 'ההורה השני'} הוסיף/הוסיפה: ${expense.title} (${formatCurrency(expense.amount)})`;
    await sendPushToUser(targetUid, {
        title: 'הוצאה חדשה',
        body
    }, {
        type: 'expense-created',
        familyId,
        expenseId: context.params.expenseId
    });
});
exports.onExpenseStatusChanged = functions.firestore
    .document('families/{familyId}/expenses/{expenseId}')
    .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    if (before.status === after.status) {
        return;
    }
    if (after.status !== 'approved' && after.status !== 'rejected') {
        return;
    }
    const familyId = context.params.familyId;
    const statusLabel = after.status === 'approved' ? 'אושרה' : 'נדחתה';
    const targetUid = after.createdBy;
    if (!targetUid) {
        return;
    }
    const body = `${after.updatedByName || 'ההורה השני'} ${statusLabel} את ${after.title} (${formatCurrency(after.amount)})`;
    await sendPushToUser(targetUid, {
        title: `הוצאה ${statusLabel}`,
        body
    }, {
        type: `expense-${after.status}`,
        familyId,
        expenseId: context.params.expenseId
    });
});
async function sendPushToUser(uid, notification, data) {
    if (!uid) {
        return;
    }
    functions.logger.info('[sendPushToUser] preparing message', { uid, data });
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) {
        functions.logger.warn('[sendPushToUser] user not found', { uid });
        return;
    }
    const tokens = userSnap.get('pushTokens') ?? [];
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
        .filter((token) => Boolean(token));
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
function formatDate(timestamp) {
    const date = timestamp.toDate();
    return date.toLocaleDateString('he-IL', {
        weekday: 'long',
        day: '2-digit',
        month: 'long'
    });
}
async function resolveTargetUidsForEvent(familyId, parentId, targetUids) {
    if (targetUids?.length) {
        return Array.from(new Set(targetUids));
    }
    const familySnap = await db.collection('families').doc(familyId).get();
    const members = familySnap.get('members') ?? [];
    if (!members.length) {
        return [];
    }
    const sorted = Array.from(new Set(members)).sort();
    const parent1 = sorted[0];
    const parent2 = sorted[1];
    if (parentId === 'both') {
        return sorted;
    }
    if (parentId === 'parent1' && parent1) {
        return [parent1];
    }
    if (parentId === 'parent2' && parent2) {
        return [parent2];
    }
    // Fallback: send to all if we cannot map
    return sorted;
}
function formatEventDate(date, isAllDay) {
    if (isAllDay) {
        return date.toLocaleDateString('he-IL', {
            weekday: 'long',
            day: '2-digit',
            month: 'long'
        });
    }
    return `${date.toLocaleDateString('he-IL', {
        weekday: 'long',
        day: '2-digit',
        month: 'long'
    })} • ${date.toLocaleTimeString('he-IL', {
        hour: '2-digit',
        minute: '2-digit'
    })}`;
}
async function getFamilyMembers(familyId) {
    try {
        const familySnap = await db.collection('families').doc(familyId).get();
        if (!familySnap.exists) {
            return [];
        }
        const members = familySnap.get('members') ?? [];
        return Array.from(new Set(members.filter(Boolean)));
    }
    catch (error) {
        functions.logger.error('[getFamilyMembers] failed', { familyId, error });
        return [];
    }
}
function resolveOtherParent(members, actorUid) {
    const unique = Array.from(new Set(members.filter(Boolean)));
    if (!unique.length) {
        return null;
    }
    if (!actorUid) {
        return unique[0] ?? null;
    }
    const other = unique.find(uid => uid !== actorUid);
    return other ?? null;
}
function formatCurrency(amount) {
    const safeAmount = typeof amount === 'number' ? amount : 0;
    return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(safeAmount);
}
//# sourceMappingURL=index.js.map