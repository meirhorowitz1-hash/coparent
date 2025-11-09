# CoParent App

Ionic + Angular application for managing shared parenting logistics.

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure Firebase**
   - Open `src/environments/environment.ts` and `src/environments/environment.prod.ts`.
   - Replace the `firebase` placeholder values with your Firebase project's config (Project Settings → General → Your apps).
   - Enable both **Authentication (Email/Password)** and **Cloud Firestore** in the Firebase console.

3. **Enable Email/Password Auth**
   - In the Firebase console navigate to `Build > Authentication > Sign-in method`.
   - Enable the Email/Password provider.

4. **Run the app**
   ```bash
   npm start
   ```
   The login and signup screens now authenticate via Firebase. Successful authentication redirects users to the calendar tab.

## שיתוף החשבון עם עוד הורה

1. המשתמש הראשון נרשם ונכנס לאפליקציה.
2. בלשונית **פרופיל** ניתן להזין את כתובת המייל של ההורה השני ולשלוח הזמנה.
3. אפשרות נוספת: ליצור קוד שיתוף (מופיע רק למנהל המשפחה) ולהעתיק אותו. שותף שנכנס למסך הפרופיל שלו ומזין את הקוד מצטרף מיידית לאותו מקור נתונים – גם אם הוא כבר חבר במשפחה אחרת.
4. בכל רגע ניתן להצטרף לעוד משפחה באמצעות קוד, ולבחור איזו משפחה תהיה פעילה מתוך הרשימה בלשונית הפרופיל.
5. בלשונית הפרופיל ניתן לעקוב אחרי הזמנות ממתינות, להפיק קוד חדש, להצטרף לקוד אחר או להתנתק מהחשבון.

## Useful Scripts

| Command        | Description                  |
| -------------- | ---------------------------- |
| `npm start`    | Run the dev server           |
| `npm run build`| Build the production bundle  |
| `npm run test` | Execute unit tests           |
# coparent
