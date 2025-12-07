# 📋 תוכנית מעבר: CoParent - Hybrid Architecture

## 🎯 סיכום הגישה

**נשאר ב-Firebase:**
- ✅ Firebase Authentication (חינם עד 50K משתמשים)
- ✅ Firebase Cloud Messaging - FCM (פושים)

**עובר ל-Node.js Backend:**
- 🔄 Database → PostgreSQL
- 🔄 API → Express/Fastify REST API
- 🔄 Real-time → Socket.io (רק לצ'אט והתראות)
- 🔄 Files → S3/Cloudinary
- 🔄 Scheduled Jobs → node-cron/Bull

---

## 📅 לוח זמנים מוערך

| שלב | משך | תיאור |
|-----|-----|-------|
| שלב 1 | 1-2 שבועות | הקמת תשתית Backend |
| שלב 2 | 1 שבוע | Database Schema + Migration |
| שלב 3 | 2-3 שבועות | API Endpoints |
| שלב 4 | 1 שבוע | Real-time (Socket.io) |
| שלב 5 | 1 שבוע | File Upload |
| שלב 6 | 2-3 שבועות | Client Migration |
| שלב 7 | 1 שבוע | Testing + Deploy |

**סה"כ: 9-12 שבועות**

---

## 🏗️ שלב 1: הקמת תשתית Backend

### 1.1 מבנה פרויקט מומלץ

```
coparent-server/
├── src/
│   ├── config/
│   │   ├── database.ts
│   │   ├── firebase-admin.ts    # לאימות tokens
│   │   └── socket.ts
│   ├── middleware/
│   │   ├── auth.middleware.ts   # Firebase token verification
│   │   ├── family.middleware.ts # בדיקת חברות במשפחה
│   │   └── error.middleware.ts
│   ├── modules/
│   │   ├── users/
│   │   │   ├── users.controller.ts
│   │   │   ├── users.service.ts
│   │   │   ├── users.routes.ts
│   │   │   └── users.schema.ts
│   │   ├── families/
│   │   ├── calendar/
│   │   ├── expenses/
│   │   ├── tasks/
│   │   ├── documents/
│   │   ├── chat/
│   │   └── swap-requests/
│   ├── socket/
│   │   ├── socket.gateway.ts
│   │   └── handlers/
│   ├── jobs/
│   │   └── reminder.job.ts
│   └── app.ts
├── prisma/
│   └── schema.prisma
├── package.json
└── docker-compose.yml
```

### 1.2 Dependencies להתקנה

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.7.2",
    "firebase-admin": "^12.0.0",
    "@prisma/client": "^5.7.0",
    "zod": "^3.22.4",
    "node-cron": "^3.0.3",
    "multer": "^1.4.5-lts.1",
    "@aws-sdk/client-s3": "^3.450.0",
    "helmet": "^7.1.0",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "prisma": "^5.7.0",
    "typescript": "^5.3.0",
    "tsx": "^4.6.0",
    "@types/express": "^4.17.21",
    "@types/node": "^20.10.0"
  }
}
```

### 1.3 Firebase Admin Setup

```typescript
// src/config/firebase-admin.ts
import admin from 'firebase-admin';

// השתמש ב-service account מ-Firebase Console
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  })
});

export const firebaseAuth = admin.auth();
export const firebaseMessaging = admin.messaging();
```

### 1.4 Auth Middleware

```typescript
// src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { firebaseAuth } from '../config/firebase-admin';

export interface AuthRequest extends Request {
  user?: {
    uid: string;
    email?: string;
  };
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing-token' });
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await firebaseAuth.verifyIdToken(token);
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email
    };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'invalid-token' });
  }
}
```

---

## 🗄️ שלב 2: Database Schema (Prisma)

### 2.1 Prisma Schema

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id              String    @id // Firebase UID
  email           String    @unique
  fullName        String?
  phone           String?
  photoUrl        String?
  calendarColor   String?
  activeFamilyId  String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  // Relations
  ownedFamilies   Family[]  @relation("FamilyOwner")
  familyMembers   FamilyMember[]
  pushTokens      PushToken[]
  expenses        Expense[] @relation("ExpenseCreator")
  tasks           Task[]    @relation("TaskCreator")
  calendarEvents  CalendarEvent[] @relation("EventCreator")
  documents       Document[] @relation("DocumentUploader")
  swapRequests    SwapRequest[] @relation("SwapRequester")
  swapResponses   SwapRequest[] @relation("SwapResponder")
  chatMessages    ChatMessage[]
}

model PushToken {
  id        String   @id @default(uuid())
  token     String   @unique
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
}

model Family {
  id              String   @id @default(uuid())
  name            String?
  photoUrl        String?
  shareCode       String?  @unique
  shareCodeUpdatedAt DateTime?
  ownerId         String
  owner           User     @relation("FamilyOwner", fields: [ownerId], references: [id])
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // Relations
  members         FamilyMember[]
  children        FamilyChild[]
  invites         FamilyInvite[]
  expenses        Expense[]
  tasks           Task[]
  calendarEvents  CalendarEvent[]
  documents       Document[]
  swapRequests    SwapRequest[]
  chatMessages    ChatMessage[]
  custodySchedule CustodySchedule?
  financeSettings FinanceSettings?
}

model FamilyMember {
  id        String   @id @default(uuid())
  familyId  String
  userId    String
  role      String   @default("member") // owner, member
  joinedAt  DateTime @default(now())

  family    Family   @relation(fields: [familyId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([familyId, userId])
}

model FamilyChild {
  id        String   @id @default(uuid())
  familyId  String
  name      String
  family    Family   @relation(fields: [familyId], references: [id], onDelete: Cascade)
}

model FamilyInvite {
  id            String   @id @default(uuid())
  familyId      String
  email         String
  invitedById   String
  invitedByName String?
  status        String   @default("pending") // pending, accepted
  createdAt     DateTime @default(now())

  family        Family   @relation(fields: [familyId], references: [id], onDelete: Cascade)

  @@unique([familyId, email])
}

model CustodySchedule {
  id                    String    @id @default(uuid())
  familyId              String    @unique
  name                  String?
  pattern               String    // weekly, biweekly, custom, week_on_week_off
  startDate             DateTime
  endDate               DateTime?
  parent1Days           Int[]     // 0-6 (Sun-Sat)
  parent2Days           Int[]
  biweeklyAltParent1Days Int[]
  biweeklyAltParent2Days Int[]
  isActive              Boolean   @default(true)
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  family                Family    @relation(fields: [familyId], references: [id], onDelete: Cascade)
  pendingApproval       CustodyApprovalRequest?
}

model CustodyApprovalRequest {
  id                String          @id @default(uuid())
  scheduleId        String          @unique
  name              String?
  pattern           String
  startDate         DateTime
  parent1Days       Int[]
  parent2Days       Int[]
  requestedById     String?
  requestedByName   String?
  requestedAt       DateTime        @default(now())

  schedule          CustodySchedule @relation(fields: [scheduleId], references: [id], onDelete: Cascade)
}

model CalendarEvent {
  id              String    @id @default(uuid())
  familyId        String
  title           String
  description     String?
  startDate       DateTime
  endDate         DateTime
  type            String    // custody, pickup, dropoff, school, etc.
  parentId        String    // parent1, parent2, both
  color           String?
  location        String?
  reminderMinutes Int?
  isAllDay        Boolean   @default(false)
  childId         String?
  swapRequestId   String?
  createdById     String?
  createdByName   String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  family          Family    @relation(fields: [familyId], references: [id], onDelete: Cascade)
  createdBy       User?     @relation("EventCreator", fields: [createdById], references: [id])
  reminder        EventReminder?
}

model EventReminder {
  id          String        @id @default(uuid())
  eventId     String        @unique
  sendAt      DateTime
  sent        Boolean       @default(false)
  sentAt      DateTime?
  createdAt   DateTime      @default(now())

  event       CalendarEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@index([sent, sendAt])
}

model Expense {
  id              String    @id @default(uuid())
  familyId        String
  title           String
  amount          Float
  date            DateTime
  notes           String?
  receiptUrl      String?   // S3/Cloudinary URL
  splitParent1    Int       @default(50) // percentage
  status          String    @default("pending") // pending, approved, rejected
  isPaid          Boolean   @default(false)
  createdById     String
  createdByName   String?
  updatedById     String?
  updatedByName   String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  family          Family    @relation(fields: [familyId], references: [id], onDelete: Cascade)
  createdBy       User      @relation("ExpenseCreator", fields: [createdById], references: [id])
}

model FinanceSettings {
  id                String  @id @default(uuid())
  familyId          String  @unique
  alimonyAmount     Float   @default(0)
  alimonyPayer      String? // parent1, parent2, null
  defaultSplitParent1 Int   @default(50)
  updatedAt         DateTime @updatedAt

  family            Family  @relation(fields: [familyId], references: [id], onDelete: Cascade)
  fixedExpenses     FixedExpense[]
}

model FixedExpense {
  id                String          @id @default(uuid())
  settingsId        String
  title             String
  amount            Float
  splitParent1      Int

  settings          FinanceSettings @relation(fields: [settingsId], references: [id], onDelete: Cascade)
}

model Task {
  id            String    @id @default(uuid())
  familyId      String
  title         String
  description   String?
  dueDate       DateTime?
  priority      String    @default("medium") // low, medium, high, urgent
  status        String    @default("pending") // pending, in_progress, completed, cancelled
  assignedTo    String    @default("both") // parent1, parent2, both
  category      String    @default("other")
  childId       String?
  createdById   String
  createdByName String?
  completedAt   DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  family        Family    @relation(fields: [familyId], references: [id], onDelete: Cascade)
  createdBy     User      @relation("TaskCreator", fields: [createdById], references: [id])
}

model Document {
  id              String    @id @default(uuid())
  familyId        String
  title           String
  fileName        String
  fileUrl         String    // S3/Cloudinary URL
  childId         String?
  uploadedById    String?
  uploadedByName  String?
  uploadedAt      DateTime  @default(now())

  family          Family    @relation(fields: [familyId], references: [id], onDelete: Cascade)
  uploadedBy      User?     @relation("DocumentUploader", fields: [uploadedById], references: [id])
}

model SwapRequest {
  id              String    @id @default(uuid())
  familyId        String
  requestedById   String
  requestedByName String?
  requestedToId   String
  requestedToName String?
  originalDate    DateTime
  proposedDate    DateTime?
  requestType     String    @default("swap") // swap, one-way
  reason          String?
  status          String    @default("pending") // pending, approved, rejected, cancelled
  responseNote    String?
  respondedAt     DateTime?
  createdAt       DateTime  @default(now())

  family          Family    @relation(fields: [familyId], references: [id], onDelete: Cascade)
  requestedBy     User      @relation("SwapRequester", fields: [requestedById], references: [id])
  requestedTo     User      @relation("SwapResponder", fields: [requestedToId], references: [id])
}

model ChatMessage {
  id          String    @id @default(uuid())
  familyId    String
  senderId    String
  senderName  String?
  text        String
  sentAt      DateTime  @default(now())

  family      Family    @relation(fields: [familyId], references: [id], onDelete: Cascade)
  sender      User      @relation(fields: [senderId], references: [id])

  @@index([familyId, sentAt])
}
```

### 2.2 Migration Script (Firestore → PostgreSQL)

```typescript
// scripts/migrate-from-firestore.ts
import admin from 'firebase-admin';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const firestore = admin.firestore();

async function migrateUsers() {
  console.log('Migrating users...');
  const usersSnap = await firestore.collection('users').get();
  
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    await prisma.user.upsert({
      where: { id: doc.id },
      create: {
        id: doc.id,
        email: data.email,
        fullName: data.fullName,
        phone: data.phone,
        photoUrl: data.photoUrl,
        calendarColor: data.calendarColor,
        activeFamilyId: data.activeFamilyId
      },
      update: {}
    });

    // Push tokens
    if (data.pushTokens?.length) {
      for (const token of data.pushTokens) {
        await prisma.pushToken.upsert({
          where: { token },
          create: { token, userId: doc.id },
          update: {}
        });
      }
    }
  }
  console.log(`Migrated ${usersSnap.size} users`);
}

async function migrateFamilies() {
  console.log('Migrating families...');
  const familiesSnap = await firestore.collection('families').get();

  for (const doc of familiesSnap.docs) {
    const data = doc.data();
    
    // Create family
    await prisma.family.upsert({
      where: { id: doc.id },
      create: {
        id: doc.id,
        name: data.name,
        photoUrl: data.photoUrl,
        shareCode: data.shareCode,
        ownerId: data.ownerId || data.members?.[0]
      },
      update: {}
    });

    // Family members
    if (data.members?.length) {
      for (const memberId of data.members) {
        await prisma.familyMember.upsert({
          where: { familyId_userId: { familyId: doc.id, userId: memberId } },
          create: {
            familyId: doc.id,
            userId: memberId,
            role: memberId === data.ownerId ? 'owner' : 'member'
          },
          update: {}
        });
      }
    }

    // Children
    if (data.children?.length) {
      for (const childName of data.children) {
        await prisma.familyChild.create({
          data: { familyId: doc.id, name: childName }
        });
      }
    }

    // Migrate subcollections
    await migrateExpenses(doc.id);
    await migrateTasks(doc.id);
    await migrateCalendarEvents(doc.id);
    await migrateMessages(doc.id);
    await migrateSwapRequests(doc.id);
    await migrateDocuments(doc.id);
    await migrateCustodySchedule(doc.id);
  }
}

async function migrateExpenses(familyId: string) {
  const snap = await firestore
    .collection('families').doc(familyId)
    .collection('expenses').get();

  for (const doc of snap.docs) {
    const data = doc.data();
    await prisma.expense.upsert({
      where: { id: doc.id },
      create: {
        id: doc.id,
        familyId,
        title: data.title,
        amount: data.amount,
        date: data.date?.toDate() || new Date(),
        notes: data.notes,
        splitParent1: data.splitParent1 ?? 50,
        status: data.status || 'pending',
        isPaid: data.isPaid || false,
        createdById: data.createdBy || 'unknown',
        createdByName: data.createdByName
      },
      update: {}
    });
  }
}

// דומה עבור שאר ה-subcollections...
async function migrateTasks(familyId: string) { /* ... */ }
async function migrateCalendarEvents(familyId: string) { /* ... */ }
async function migrateMessages(familyId: string) { /* ... */ }
async function migrateSwapRequests(familyId: string) { /* ... */ }
async function migrateDocuments(familyId: string) { /* ... */ }
async function migrateCustodySchedule(familyId: string) { /* ... */ }

async function main() {
  try {
    await migrateUsers();
    await migrateFamilies();
    console.log('Migration complete!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
```

---

## 🌐 שלב 3: API Endpoints

### 3.1 מבנה Routes

```typescript
// src/app.ts
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';

import { authMiddleware } from './middleware/auth.middleware';
import usersRoutes from './modules/users/users.routes';
import familiesRoutes from './modules/families/families.routes';
import calendarRoutes from './modules/calendar/calendar.routes';
import expensesRoutes from './modules/expenses/expenses.routes';
import tasksRoutes from './modules/tasks/tasks.routes';
import documentsRoutes from './modules/documents/documents.routes';
import swapRequestsRoutes from './modules/swap-requests/swap-requests.routes';
import chatRoutes from './modules/chat/chat.routes';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Public routes
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Protected routes
app.use('/api/users', authMiddleware, usersRoutes);
app.use('/api/families', authMiddleware, familiesRoutes);
app.use('/api/calendar', authMiddleware, calendarRoutes);
app.use('/api/expenses', authMiddleware, expensesRoutes);
app.use('/api/tasks', authMiddleware, tasksRoutes);
app.use('/api/documents', authMiddleware, documentsRoutes);
app.use('/api/swap-requests', authMiddleware, swapRequestsRoutes);
app.use('/api/chat', authMiddleware, chatRoutes);

export { app, httpServer, io };
```

### 3.2 דוגמת Module: Expenses

```typescript
// src/modules/expenses/expenses.routes.ts
import { Router } from 'express';
import { ExpensesController } from './expenses.controller';
import { familyMemberMiddleware } from '../../middleware/family.middleware';

const router = Router();
const controller = new ExpensesController();

router.get('/:familyId', familyMemberMiddleware, controller.getAll);
router.post('/:familyId', familyMemberMiddleware, controller.create);
router.patch('/:familyId/:expenseId', familyMemberMiddleware, controller.update);
router.patch('/:familyId/:expenseId/status', familyMemberMiddleware, controller.updateStatus);
router.delete('/:familyId/:expenseId', familyMemberMiddleware, controller.delete);

export default router;
```

```typescript
// src/modules/expenses/expenses.service.ts
import { PrismaClient } from '@prisma/client';
import { io } from '../../app';
import { sendPushToFamilyMembers } from '../../utils/push';

const prisma = new PrismaClient();

export class ExpensesService {
  async getAll(familyId: string) {
    return prisma.expense.findMany({
      where: { familyId },
      orderBy: { date: 'desc' }
    });
  }

  async create(familyId: string, data: CreateExpenseDto, userId: string, userName: string) {
    const expense = await prisma.expense.create({
      data: {
        familyId,
        ...data,
        createdById: userId,
        createdByName: userName
      }
    });

    // Real-time update via Socket.io
    io.to(`family:${familyId}`).emit('expense:created', expense);

    // Push notification
    await sendPushToFamilyMembers(familyId, userId, {
      title: 'הוצאה חדשה',
      body: `${userName} הוסיף: ${data.title} (${formatCurrency(data.amount)})`
    });

    return expense;
  }

  async updateStatus(familyId: string, expenseId: string, status: string, userId: string, userName: string) {
    const expense = await prisma.expense.update({
      where: { id: expenseId },
      data: {
        status,
        isPaid: status === 'approved' ? undefined : false,
        updatedById: userId,
        updatedByName: userName
      }
    });

    io.to(`family:${familyId}`).emit('expense:updated', expense);

    // Notify creator
    if (expense.createdById !== userId) {
      const statusLabel = status === 'approved' ? 'אושרה' : 'נדחתה';
      await sendPushToUser(expense.createdById, {
        title: `הוצאה ${statusLabel}`,
        body: `${userName} ${statusLabel} את ${expense.title}`
      });
    }

    return expense;
  }
}
```

### 3.3 API Endpoints מלאים

| Method | Endpoint | תיאור |
|--------|----------|-------|
| **Users** |||
| GET | `/api/users/me` | פרופיל משתמש נוכחי |
| PATCH | `/api/users/me` | עדכון פרופיל |
| POST | `/api/users/me/push-token` | הוספת push token |
| **Families** |||
| GET | `/api/families` | רשימת משפחות |
| POST | `/api/families` | יצירת משפחה |
| GET | `/api/families/:id` | פרטי משפחה |
| PATCH | `/api/families/:id` | עדכון משפחה |
| POST | `/api/families/:id/invite` | הזמנת הורה |
| POST | `/api/families/join` | הצטרפות עם קוד |
| POST | `/api/families/:id/leave` | עזיבת משפחה |
| **Calendar** |||
| GET | `/api/calendar/:familyId/events` | אירועים |
| POST | `/api/calendar/:familyId/events` | יצירת אירוע |
| PATCH | `/api/calendar/:familyId/events/:id` | עדכון |
| DELETE | `/api/calendar/:familyId/events/:id` | מחיקה |
| GET | `/api/calendar/:familyId/custody` | תבנית משמורת |
| PUT | `/api/calendar/:familyId/custody` | עדכון תבנית |
| POST | `/api/calendar/:familyId/custody/approve` | אישור/דחייה |
| **Expenses** |||
| GET | `/api/expenses/:familyId` | הוצאות |
| POST | `/api/expenses/:familyId` | הוספה |
| PATCH | `/api/expenses/:familyId/:id` | עדכון |
| PATCH | `/api/expenses/:familyId/:id/status` | שינוי סטטוס |
| DELETE | `/api/expenses/:familyId/:id` | מחיקה |
| GET | `/api/expenses/:familyId/settings` | הגדרות פיננסיות |
| PUT | `/api/expenses/:familyId/settings` | עדכון הגדרות |
| **Tasks** |||
| GET | `/api/tasks/:familyId` | משימות |
| POST | `/api/tasks/:familyId` | יצירה |
| PATCH | `/api/tasks/:familyId/:id` | עדכון |
| DELETE | `/api/tasks/:familyId/:id` | מחיקה |
| **Documents** |||
| GET | `/api/documents/:familyId` | מסמכים |
| POST | `/api/documents/:familyId` | העלאה |
| DELETE | `/api/documents/:familyId/:id` | מחיקה |
| **Swap Requests** |||
| GET | `/api/swap-requests/:familyId` | בקשות |
| POST | `/api/swap-requests/:familyId` | יצירה |
| PATCH | `/api/swap-requests/:familyId/:id/status` | תגובה |
| **Chat** |||
| GET | `/api/chat/:familyId/messages` | הודעות |
| POST | `/api/chat/:familyId/messages` | שליחה |

---

## 🔌 שלב 4: Socket.io - Real-time

### 4.1 Socket Gateway

```typescript
// src/socket/socket.gateway.ts
import { Server, Socket } from 'socket.io';
import { firebaseAuth } from '../config/firebase-admin';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  familyId?: string;
}

export function setupSocketHandlers(io: Server) {
  // Authentication middleware
  io.use(async (socket: AuthenticatedSocket, next) => {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('missing-token'));
    }

    try {
      const decoded = await firebaseAuth.verifyIdToken(token);
      socket.userId = decoded.uid;
      next();
    } catch (error) {
      next(new Error('invalid-token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`User connected: ${socket.userId}`);

    // Join family room
    socket.on('join:family', (familyId: string) => {
      socket.familyId = familyId;
      socket.join(`family:${familyId}`);
      console.log(`User ${socket.userId} joined family ${familyId}`);
    });

    // Leave family room
    socket.on('leave:family', (familyId: string) => {
      socket.leave(`family:${familyId}`);
    });

    // Chat message (alternative to REST)
    socket.on('chat:send', async (data: { familyId: string; text: string }) => {
      // Save to DB and broadcast
      const message = await saveChatMessage(data.familyId, socket.userId!, data.text);
      io.to(`family:${data.familyId}`).emit('chat:message', message);
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.userId}`);
    });
  });
}
```

### 4.2 Events להאזנה בצד Client

| Event | Direction | תיאור |
|-------|-----------|-------|
| `join:family` | Client → Server | הצטרפות לחדר משפחה |
| `leave:family` | Client → Server | עזיבת חדר |
| `chat:send` | Client → Server | שליחת הודעה |
| `chat:message` | Server → Client | הודעה חדשה |
| `expense:created` | Server → Client | הוצאה חדשה |
| `expense:updated` | Server → Client | עדכון הוצאה |
| `task:created` | Server → Client | משימה חדשה |
| `task:updated` | Server → Client | עדכון משימה |
| `event:created` | Server → Client | אירוע חדש |
| `event:updated` | Server → Client | עדכון אירוע |
| `swap:created` | Server → Client | בקשת החלפה חדשה |
| `swap:updated` | Server → Client | עדכון בקשה |

---

## 📁 שלב 5: File Upload (S3/Cloudinary)

### 5.1 S3 Setup

```typescript
// src/utils/s3.ts
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuid } from 'uuid';

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
  }
});

const BUCKET = process.env.S3_BUCKET!;
const CDN_URL = process.env.CDN_URL; // CloudFront או S3 public URL

export async function uploadFile(
  file: Buffer,
  mimeType: string,
  folder: string
): Promise<string> {
  const key = `${folder}/${uuid()}-${Date.now()}`;
  
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: file,
    ContentType: mimeType
  }));

  return `${CDN_URL}/${key}`;
}

export async function deleteFile(url: string): Promise<void> {
  const key = url.replace(`${CDN_URL}/`, '');
  
  await s3.send(new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key
  }));
}
```

### 5.2 Document Upload Endpoint

```typescript
// src/modules/documents/documents.controller.ts
import multer from 'multer';
import { uploadFile } from '../../utils/s3';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

router.post('/:familyId',
  familyMemberMiddleware,
  upload.single('file'),
  async (req, res) => {
    const file = req.file!;
    
    const fileUrl = await uploadFile(
      file.buffer,
      file.mimetype,
      `families/${req.params.familyId}/documents`
    );

    const document = await prisma.document.create({
      data: {
        familyId: req.params.familyId,
        title: req.body.title,
        fileName: file.originalname,
        fileUrl,
        childId: req.body.childId || null,
        uploadedById: req.user!.uid,
        uploadedByName: req.body.uploaderName
      }
    });

    res.json(document);
  }
);
```

---

## 📱 שלב 6: Client Migration (Angular)

### 6.1 API Service בסיסי

```typescript
// src/app/core/services/api.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Auth, idToken } from '@angular/fire/auth';
import { Observable, switchMap, from } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(Auth);
  private readonly baseUrl = environment.apiUrl; // 'https://api.coparent.app'

  private async getHeaders(): Promise<HttpHeaders> {
    const user = this.auth.currentUser;
    if (!user) {
      throw new Error('not-authenticated');
    }
    
    const token = await user.getIdToken();
    return new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    });
  }

  get<T>(path: string): Observable<T> {
    return from(this.getHeaders()).pipe(
      switchMap(headers => this.http.get<T>(`${this.baseUrl}${path}`, { headers }))
    );
  }

  post<T>(path: string, body: unknown): Observable<T> {
    return from(this.getHeaders()).pipe(
      switchMap(headers => this.http.post<T>(`${this.baseUrl}${path}`, body, { headers }))
    );
  }

  patch<T>(path: string, body: unknown): Observable<T> {
    return from(this.getHeaders()).pipe(
      switchMap(headers => this.http.patch<T>(`${this.baseUrl}${path}`, body, { headers }))
    );
  }

  delete<T>(path: string): Observable<T> {
    return from(this.getHeaders()).pipe(
      switchMap(headers => this.http.delete<T>(`${this.baseUrl}${path}`, { headers }))
    );
  }
}
```

### 6.2 Socket Service

```typescript
// src/app/core/services/socket.service.ts
import { Injectable, inject, OnDestroy } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { io, Socket } from 'socket.io-client';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SocketService implements OnDestroy {
  private readonly auth = inject(Auth);
  private socket: Socket | null = null;
  private connectedSubject = new BehaviorSubject<boolean>(false);
  readonly connected$ = this.connectedSubject.asObservable();

  private eventSubjects = new Map<string, Subject<unknown>>();

  async connect(): Promise<void> {
    if (this.socket?.connected) return;

    const user = this.auth.currentUser;
    if (!user) return;

    const token = await user.getIdToken();

    this.socket = io(environment.socketUrl, {
      auth: { token },
      transports: ['websocket']
    });

    this.socket.on('connect', () => {
      this.connectedSubject.next(true);
    });

    this.socket.on('disconnect', () => {
      this.connectedSubject.next(false);
    });

    // Forward all events
    const events = [
      'chat:message',
      'expense:created', 'expense:updated',
      'task:created', 'task:updated',
      'event:created', 'event:updated',
      'swap:created', 'swap:updated'
    ];

    events.forEach(event => {
      this.socket!.on(event, (data: unknown) => {
        this.getSubject(event).next(data);
      });
    });
  }

  joinFamily(familyId: string): void {
    this.socket?.emit('join:family', familyId);
  }

  leaveFamily(familyId: string): void {
    this.socket?.emit('leave:family', familyId);
  }

  on<T>(event: string): Observable<T> {
    return this.getSubject(event).asObservable() as Observable<T>;
  }

  private getSubject(event: string): Subject<unknown> {
    if (!this.eventSubjects.has(event)) {
      this.eventSubjects.set(event, new Subject());
    }
    return this.eventSubjects.get(event)!;
  }

  ngOnDestroy(): void {
    this.socket?.disconnect();
    this.eventSubjects.forEach(subject => subject.complete());
  }
}
```

### 6.3 דוגמת Service מעודכן: Expenses

```typescript
// src/app/core/services/expense-store.service.ts (MIGRATED)
import { Injectable, inject, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subscription } from 'rxjs';
import { ApiService } from './api.service';
import { SocketService } from './socket.service';
import { UserProfileService } from './user-profile.service';
import { ExpenseRecord, FinanceSettings } from '../models/expense.model';

@Injectable({ providedIn: 'root' })
export class ExpenseStoreService implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly socket = inject(SocketService);
  private readonly userProfile = inject(UserProfileService);

  private expensesSubject = new BehaviorSubject<ExpenseRecord[]>([]);
  readonly expenses$ = this.expensesSubject.asObservable();

  private financeSettingsSubject = new BehaviorSubject<FinanceSettings | null>(null);
  readonly financeSettings$ = this.financeSettingsSubject.asObservable();

  private activeFamilyId: string | null = null;
  private subscriptions: Subscription[] = [];

  constructor() {
    // Listen to socket events
    this.subscriptions.push(
      this.socket.on<ExpenseRecord>('expense:created').subscribe(expense => {
        const current = this.expensesSubject.value;
        this.expensesSubject.next([expense, ...current]);
      }),

      this.socket.on<ExpenseRecord>('expense:updated').subscribe(updated => {
        const current = this.expensesSubject.value;
        const next = current.map(e => e.id === updated.id ? updated : e);
        this.expensesSubject.next(next);
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  setActiveFamily(familyId: string | null): void {
    if (this.activeFamilyId === familyId) return;
    
    if (this.activeFamilyId) {
      this.socket.leaveFamily(this.activeFamilyId);
    }

    this.activeFamilyId = familyId;

    if (familyId) {
      this.socket.joinFamily(familyId);
      this.loadExpenses(familyId);
      this.loadSettings(familyId);
    } else {
      this.expensesSubject.next([]);
      this.financeSettingsSubject.next(null);
    }
  }

  private loadExpenses(familyId: string): void {
    this.api.get<ExpenseRecord[]>(`/api/expenses/${familyId}`)
      .subscribe(expenses => this.expensesSubject.next(expenses));
  }

  private loadSettings(familyId: string): void {
    this.api.get<FinanceSettings>(`/api/expenses/${familyId}/settings`)
      .subscribe(settings => this.financeSettingsSubject.next(settings));
  }

  addExpense(expense: Omit<ExpenseRecord, 'id' | 'createdAt'>): Promise<ExpenseRecord> {
    if (!this.activeFamilyId) {
      return Promise.reject(new Error('missing-family-context'));
    }

    return this.api.post<ExpenseRecord>(
      `/api/expenses/${this.activeFamilyId}`,
      expense
    ).toPromise() as Promise<ExpenseRecord>;
  }

  setStatus(id: string, status: string): Promise<void> {
    if (!this.activeFamilyId) {
      return Promise.reject(new Error('missing-family-context'));
    }

    return this.api.patch<void>(
      `/api/expenses/${this.activeFamilyId}/${id}/status`,
      { status }
    ).toPromise() as Promise<void>;
  }

  updateExpense(id: string, updates: Partial<ExpenseRecord>): Promise<void> {
    if (!this.activeFamilyId) {
      return Promise.reject(new Error('missing-family-context'));
    }

    return this.api.patch<void>(
      `/api/expenses/${this.activeFamilyId}/${id}`,
      updates
    ).toPromise() as Promise<void>;
  }

  deleteExpense(id: string): Promise<void> {
    if (!this.activeFamilyId) {
      return Promise.reject(new Error('missing-family-context'));
    }

    // Optimistic update
    const current = this.expensesSubject.value;
    this.expensesSubject.next(current.filter(e => e.id !== id));

    return this.api.delete<void>(
      `/api/expenses/${this.activeFamilyId}/${id}`
    ).toPromise() as Promise<void>;
  }

  getAll(): ExpenseRecord[] {
    return [...this.expensesSubject.value];
  }
}
```

### 6.4 Migration Checklist לכל Service

| Service | קובץ | שינויים נדרשים |
|---------|------|----------------|
| ✅ | `auth.service.ts` | **ללא שינוי** - נשאר Firebase Auth |
| 🔄 | `user-profile.service.ts` | REST API + Socket |
| 🔄 | `family.service.ts` | REST API |
| 🔄 | `calendar.service.ts` | REST API + Socket |
| 🔄 | `expense-store.service.ts` | REST API + Socket |
| 🔄 | `task-history.service.ts` | REST API + Socket |
| 🔄 | `document.service.ts` | REST API + File Upload |
| 🔄 | `chat.service.ts` | REST API + Socket |
| 🔄 | `swap-request.service.ts` | REST API + Socket |
| ✅ | `push-notification.service.ts` | **ללא שינוי** - נשאר FCM |
| 🔄 | `home.service.ts` | התאמות קלות |

---

## ⏰ שלב 7: Scheduled Jobs

```typescript
// src/jobs/reminder.job.ts
import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { sendPushToUsers } from '../utils/push';

const prisma = new PrismaClient();

// Run every minute
cron.schedule('* * * * *', async () => {
  const now = new Date();
  
  const dueReminders = await prisma.eventReminder.findMany({
    where: {
      sent: false,
      sendAt: { lte: now }
    },
    include: {
      event: {
        include: {
          family: {
            include: {
              members: { select: { userId: true } }
            }
          }
        }
      }
    },
    take: 50
  });

  for (const reminder of dueReminders) {
    try {
      const userIds = reminder.event.family.members.map(m => m.userId);
      
      await sendPushToUsers(userIds, {
        title: `תזכורת: ${reminder.event.title}`,
        body: formatEventTime(reminder.event.startDate)
      });

      await prisma.eventReminder.update({
        where: { id: reminder.id },
        data: { sent: true, sentAt: new Date() }
      });
    } catch (error) {
      console.error(`Failed to send reminder ${reminder.id}:`, error);
    }
  }
});
```

---

## 🚀 Deploy Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CloudFlare                           │
│                      (CDN + SSL)                            │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
┌─────────────────┐ ┌───────────┐ ┌─────────────────┐
│  Static Files   │ │   API     │ │   WebSocket     │
│  (Vercel/CF)    │ │  Server   │ │    Server       │
│                 │ │  (Node)   │ │   (Socket.io)   │
│  - Angular App  │ │           │ │                 │
│  - Assets       │ └─────┬─────┘ └────────┬────────┘
└─────────────────┘       │                │
                          │                │
                    ┌─────┴────────────────┴─────┐
                    │                            │
              ┌─────▼─────┐              ┌───────▼───────┐
              │ PostgreSQL│              │    Redis      │
              │ (Supabase/│              │  (Sessions)   │
              │  Railway) │              └───────────────┘
              └───────────┘
                    │
              ┌─────▼─────┐              ┌───────────────┐
              │    S3     │              │   Firebase    │
              │  (Files)  │              │  Auth + FCM   │
              └───────────┘              └───────────────┘
```

### Recommended Hosting

| Service | Provider | עלות משוערת |
|---------|----------|-------------|
| API + Socket | Railway / Render | $5-20/month |
| PostgreSQL | Supabase / Railway | Free tier - $25/month |
| Redis | Upstash | Free tier |
| File Storage | Cloudflare R2 / S3 | $0.015/GB |
| Frontend | Vercel / Cloudflare Pages | Free |
| **Firebase Auth** | Firebase | Free (up to 50K users) |
| **FCM** | Firebase | Free |

---

## ✅ סיכום: מה נשאר, מה משתנה

### נשאר ב-Firebase (חינם):
- 🔐 Authentication (כל הסוגים)
- 📱 Cloud Messaging (Push notifications)
- 🔑 Token verification בצד Server

### עובר ל-Node.js:
- 🗄️ Database → PostgreSQL + Prisma
- 🌐 API → Express REST
- ⚡ Real-time → Socket.io
- 📁 Files → S3/Cloudinary
- ⏰ Jobs → node-cron

### יתרונות הגישה הזו:
1. **עלות נמוכה** - רוב השירותים ב-free tier
2. **שליטה מלאה** - ב-DB ו-API
3. **סקלביליות** - קל להרחיב
4. **Auth פשוט** - לא צריך לכתוב מחדש
5. **Push פשוט** - FCM עובד מצוין

### חסרונות:
1. **זמן פיתוח** - 9-12 שבועות
2. **תחזוקת Server** - אחריות שלך
3. **Migration** - סיכון לאובדן נתונים (צריך גיבויים!)
