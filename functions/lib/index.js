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
exports.onSwapRequestStatusChanged = exports.onSwapRequestCreated = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();
exports.onSwapRequestCreated = functions.firestore
    .document('families/{familyId}/swapRequests/{swapRequestId}')
    .onCreate(async (snapshot, context) => {
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
exports.onSwapRequestStatusChanged = functions.firestore
    .document('families/{familyId}/swapRequests/{swapRequestId}')
    .onUpdate(async (change, context) => {
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
async function sendPushToUser(uid, notification, data) {
    if (!uid) {
        return;
    }
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) {
        return;
    }
    const tokens = userSnap.get('pushTokens') ?? [];
    if (!tokens.length) {
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
    if (invalidTokens.length) {
        await userSnap.ref.update({
            pushTokens: admin.firestore.FieldValue.arrayRemove(...invalidTokens)
        });
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
//# sourceMappingURL=index.js.map