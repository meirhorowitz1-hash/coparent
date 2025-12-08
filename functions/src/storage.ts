import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// Default storage limit: 5GB (can be overridden per family)
const DEFAULT_STORAGE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;

function safeNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function ensurePositiveLimit(value: unknown): number {
  const candidate = safeNumber(value, DEFAULT_STORAGE_LIMIT_BYTES);
  return candidate > 0 ? candidate : DEFAULT_STORAGE_LIMIT_BYTES;
}

interface StorageStats {
  totalUsed: number;
  limit: number;
  percentage: number;
  remaining: number;
  breakdown: {
    paymentReceipts: number;
    documents: number;
    expenseReceipts: number;
  };
  updatedAt: admin.firestore.FieldValue;
}

/**
 * Get the storage limit for a family (from DB or default)
 */
async function getFamilyStorageLimit(familyId: string): Promise<number> {
  const familyDoc = await db.collection('families').doc(familyId).get();
  const data = familyDoc.data();
  
  // Check for custom storage limit
  if (data?.storageLimit) {
    return ensurePositiveLimit(data.storageLimit);
  }
  
  return DEFAULT_STORAGE_LIMIT_BYTES;
}

/**
 * Calculate the size of a base64 data URL in bytes
 */
function getDataUrlSize(dataUrl: string | undefined | null): number {
  if (!dataUrl || typeof dataUrl !== 'string') return 0;
  const base64 = dataUrl.split(',')[1] || '';
  return Math.ceil((base64.length * 3) / 4);
}

/**
 * Calculate storage used by a collection
 */
async function calculateCollectionStorage(
  familyId: string,
  collectionName: string,
  imageField: string
): Promise<number> {
  const snapshot = await db
    .collection('families')
    .doc(familyId)
    .collection(collectionName)
    .get();

  let total = 0;
  snapshot.forEach(doc => {
    const data = doc.data();
    total += getDataUrlSize(data[imageField]);
    // Also check for receiptPreview in expenses
    if (collectionName === 'expenses' && data['receiptPreview']) {
      total += getDataUrlSize(data['receiptPreview']);
    }
  });

  return total;
}

/**
 * Recalculate and update total storage for a family
 */
async function recalculateFamilyStorage(familyId: string): Promise<StorageStats> {
  functions.logger.info('[storage] Recalculating storage for family', { familyId });

  // Get family's storage limit
  const storageLimit = await getFamilyStorageLimit(familyId);
  console.log('storageLimit', storageLimit);
  const [paymentReceipts, documents, expenseReceipts] = await Promise.all([
    calculateCollectionStorage(familyId, 'paymentReceipts', 'imageUrl'),
    calculateCollectionStorage(familyId, 'documents', 'dataUrl'),
    calculateCollectionStorage(familyId, 'expenses', 'receiptPreview')
  ]);

  const totalUsed = paymentReceipts + documents + expenseReceipts;
  const percentage = Math.round((totalUsed / storageLimit) * 100);
  const remaining = Math.max(0, storageLimit - totalUsed);

  const stats: StorageStats = {
    totalUsed,
    limit: storageLimit,
    percentage,
    remaining,
    breakdown: {
      paymentReceipts,
      documents,
      expenseReceipts
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  // Store in family document
  await db.collection('families').doc(familyId).set(
    { storageStats: stats },
    { merge: true }
  );

  functions.logger.info('[storage] Updated storage stats', { familyId, totalUsed, percentage, limit: storageLimit });

  return stats;
}

/**
 * Update storage stats after changes (incremental update)
 */
async function updateStorageStatsAfterChange(familyId: string): Promise<void> {
  // Get current limit to recalculate percentage and remaining
  const familyDoc = await db.collection('families').doc(familyId).get();
  const data = familyDoc.data();
  const storageLimit = ensurePositiveLimit(data?.storageLimit);
  const totalUsed = safeNumber(data?.storageStats?.totalUsed, 0);
  const rawPercentage = storageLimit > 0 ? Math.round((totalUsed / storageLimit) * 100) : 0;
  const percentage =
    Number.isFinite(rawPercentage) ? Math.min(100, Math.max(0, rawPercentage)) : 0;
  const remaining = Math.max(0, storageLimit - totalUsed);

  await db.collection('families').doc(familyId).set(
    {
      storageStats: {
        limit: storageLimit,
        percentage,
        remaining,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    },
    { merge: true }
  );
}

/**
 * Check if family has enough storage for a new upload
 */
async function checkStorageAvailability(
  familyId: string,
  additionalBytes: number
): Promise<{ allowed: boolean; currentUsage: number; limit: number; remaining: number }> {
  const familyDoc = await db.collection('families').doc(familyId).get();
  const data = familyDoc.data();
  const storageStats = data?.storageStats as StorageStats | undefined;
  const storageLimit = ensurePositiveLimit(data?.storageLimit);

  let currentUsage = storageStats ? safeNumber(storageStats.totalUsed, 0) : 0;

  // If no stats exist, recalculate
  if (!storageStats) {
    const freshStats = await recalculateFamilyStorage(familyId);
    currentUsage = freshStats.totalUsed;
  }

  const remaining = Math.max(0, storageLimit - currentUsage);
  const allowed = remaining >= additionalBytes;

  return {
    allowed,
    currentUsage,
    limit: storageLimit,
    remaining
  };
}

// ==================== TRIGGERS ====================

/**
 * Update storage when payment receipt is created
 */
export const onPaymentReceiptCreated = functions.firestore
  .document('families/{familyId}/paymentReceipts/{receiptId}')
  .onCreate(async (snapshot, context) => {
    const familyId = context.params.familyId;
    const data = snapshot.data();
    const imageSize = getDataUrlSize(data?.imageUrl);

    functions.logger.info('[storage] Payment receipt created', { familyId, imageSize });

    // Update total used
    await db.collection('families').doc(familyId).set(
      {
        storageStats: {
          totalUsed: admin.firestore.FieldValue.increment(imageSize),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          breakdown: {
            paymentReceipts: admin.firestore.FieldValue.increment(imageSize)
          }
        }
      },
      { merge: true }
    );

    // Recalculate percentage and remaining
    await updateStorageStatsAfterChange(familyId);
  });

/**
 * Update storage when payment receipt is deleted
 */
export const onPaymentReceiptDeleted = functions.firestore
  .document('families/{familyId}/paymentReceipts/{receiptId}')
  .onDelete(async (snapshot, context) => {
    const familyId = context.params.familyId;
    const data = snapshot.data();
    const imageSize = getDataUrlSize(data?.imageUrl);

    functions.logger.info('[storage] Payment receipt deleted', { familyId, imageSize });

    await db.collection('families').doc(familyId).set(
      {
        storageStats: {
          totalUsed: admin.firestore.FieldValue.increment(-imageSize),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          breakdown: {
            paymentReceipts: admin.firestore.FieldValue.increment(-imageSize)
          }
        }
      },
      { merge: true }
    );

    await updateStorageStatsAfterChange(familyId);
  });

/**
 * Update storage when document is created
 */
export const onDocumentCreated = functions.firestore
  .document('families/{familyId}/documents/{docId}')
  .onCreate(async (snapshot, context) => {
    const familyId = context.params.familyId;
    const data = snapshot.data();
const fileSize = getDataUrlSize(data?.dataUrl);

    functions.logger.info('[storage] Document created', { familyId, fileSize });

    await db.collection('families').doc(familyId).set(
      {
        storageStats: {
          totalUsed: admin.firestore.FieldValue.increment(fileSize),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          breakdown: {
            documents: admin.firestore.FieldValue.increment(fileSize)
          }
        }
      },
      { merge: true }
    );

    await updateStorageStatsAfterChange(familyId);
  });

/**
 * Update storage when document is deleted
 */
export const onDocumentDeleted = functions.firestore
  .document('families/{familyId}/documents/{docId}')
  .onDelete(async (snapshot, context) => {
    const familyId = context.params.familyId;
    const data = snapshot.data();
const fileSize = getDataUrlSize(data?.dataUrl);

    functions.logger.info('[storage] Document deleted', { familyId, fileSize });

    await db.collection('families').doc(familyId).set(
      {
        storageStats: {
          totalUsed: admin.firestore.FieldValue.increment(-fileSize),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          breakdown: {
            documents: admin.firestore.FieldValue.increment(-fileSize)
          }
        }
      },
      { merge: true }
    );

    await updateStorageStatsAfterChange(familyId);
  });

/**
 * Update storage when expense with receipt is created
 */
export const onExpenseWithReceiptCreated = functions.firestore
  .document('families/{familyId}/expenses/{expenseId}')
  .onCreate(async (snapshot, context) => {
    const familyId = context.params.familyId;
    const data = snapshot.data();
    const receiptSize = getDataUrlSize(data?.receiptPreview);

    if (receiptSize === 0) return;

    functions.logger.info('[storage] Expense with receipt created', { familyId, receiptSize });

    await db.collection('families').doc(familyId).set(
      {
        storageStats: {
          totalUsed: admin.firestore.FieldValue.increment(receiptSize),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          breakdown: {
            expenseReceipts: admin.firestore.FieldValue.increment(receiptSize)
          }
        }
      },
      { merge: true }
    );

    await updateStorageStatsAfterChange(familyId);
  });

/**
 * Update storage when expense is deleted
 */
export const onExpenseWithReceiptDeleted = functions.firestore
  .document('families/{familyId}/expenses/{expenseId}')
  .onDelete(async (snapshot, context) => {
    const familyId = context.params.familyId;
    const data = snapshot.data();
    const receiptSize = getDataUrlSize(data?.receiptPreview);

    if (receiptSize === 0) return;

    functions.logger.info('[storage] Expense with receipt deleted', { familyId, receiptSize });

    await db.collection('families').doc(familyId).set(
      {
        storageStats: {
          totalUsed: admin.firestore.FieldValue.increment(-receiptSize),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          breakdown: {
            expenseReceipts: admin.firestore.FieldValue.increment(-receiptSize)
          }
        }
      },
      { merge: true }
    );

    await updateStorageStatsAfterChange(familyId);
  });

/**
 * Trigger when family's storageLimit changes - recalculate stats
 */
export const onStorageLimitChanged = functions.firestore
  .document('families/{familyId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // Check if storageLimit changed
    if (before?.storageLimit !== after?.storageLimit) {
      const familyId = context.params.familyId;
      functions.logger.info('[storage] Storage limit changed for family', { 
        familyId, 
        oldLimit: before?.storageLimit, 
        newLimit: after?.storageLimit 
      });

      // Recalculate percentage and remaining with new limit
      await updateStorageStatsAfterChange(familyId);
    }
  });

// ==================== CALLABLE FUNCTIONS ====================

/**
 * Check if upload is allowed (callable from client)
 */
export const checkStorageLimit = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { familyId, fileSize } = data as { familyId: string; fileSize: number };

  if (!familyId || typeof fileSize !== 'number') {
    throw new functions.https.HttpsError('invalid-argument', 'Missing familyId or fileSize');
  }

  const result = await checkStorageAvailability(familyId, fileSize);

  return {
    allowed: result.allowed,
    currentUsage: result.currentUsage,
    limit: result.limit,
    remaining: result.remaining,
    percentage: Math.round((result.currentUsage / result.limit) * 100)
  };
});

/**
 * Get storage stats for a family (callable from client)
 */
export const getStorageStats = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { familyId } = data as { familyId: string };

  if (!familyId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing familyId');
  }

  const familyDoc = await db.collection('families').doc(familyId).get();
  const familyData = familyDoc.data();
  let storageStats = familyData?.storageStats as StorageStats | undefined;

  // If no stats, recalculate
  if (!storageStats) {
    storageStats = await recalculateFamilyStorage(familyId);
  }

  return {
    totalUsed: storageStats.totalUsed,
    limit: storageStats.limit,
    percentage: storageStats.percentage,
    remaining: storageStats.remaining,
    breakdown: storageStats.breakdown
  };
});

/**
 * Force recalculate storage (admin/manual trigger)
 */
export const recalculateStorage = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { familyId } = data as { familyId: string };

  if (!familyId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing familyId');
  }

  const stats = await recalculateFamilyStorage(familyId);

  return {
    totalUsed: stats.totalUsed,
    limit: stats.limit,
    percentage: stats.percentage,
    remaining: stats.remaining,
    breakdown: stats.breakdown
  };
});

/**
 * Set storage limit for a family (admin only)
 */
export const setFamilyStorageLimit = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { familyId, limitBytes } = data as { familyId: string; limitBytes: number };

  if (!familyId || typeof limitBytes !== 'number' || limitBytes <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing familyId or invalid limitBytes');
  }

  // Update the family's storage limit
  await db.collection('families').doc(familyId).set(
    { storageLimit: limitBytes },
    { merge: true }
  );

  // Recalculate stats with new limit
  const stats = await recalculateFamilyStorage(familyId);

  functions.logger.info('[storage] Set new storage limit for family', { familyId, limitBytes });

  return {
    success: true,
    newLimit: limitBytes,
    stats: {
      totalUsed: stats.totalUsed,
      limit: stats.limit,
      percentage: stats.percentage,
      remaining: stats.remaining
    }
  };
});
