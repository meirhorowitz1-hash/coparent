export interface CustodySchedule {
  id: string;
  name: string;
  pattern: CustodyPattern;
  startDate: Date;
  endDate?: Date; // אם לא מוגדר - אין סוף
  parent1Days: number[]; // 0=ראשון, 1=שני, וכו'
  parent2Days: number[];
  // לשבועיים: ניתן להגדיר דפוס משלים לשבוע הבא (שבוע לא). אם לא מוגדר - השבוע הלא פעיל נשאר ריק.
  biweeklyAltParent1Days?: number[];
  biweeklyAltParent2Days?: number[];
  isActive: boolean;
  pendingApproval?: CustodyScheduleApprovalRequest | null;
}

export enum CustodyPattern {
  WEEKLY = 'weekly',           // כל שבוע
  BIWEEKLY = 'biweekly',       // כל שבועיים
  WEEK_ON_WEEK_OFF = 'week_on_week_off',  // שבוע אצל כל אחד לסירוגין
  CUSTOM = 'custom'            // מותאם אישית
}

export interface CustodyTemplate {
  id: string;
  name: string;
  nameHebrew: string;
  description: string;
  pattern: CustodyPattern;
  parent1Days: number[];
  parent2Days: number[];
}

export interface CustodyScheduleApprovalRequest {
  name: string;
  pattern: CustodyPattern;
  startDate: Date;
  parent1Days: number[];
  parent2Days: number[];
  requestedBy: string | null;
  requestedByName?: string | null;
  requestedAt: Date;
}

// תבניות מוכנות
export const CUSTODY_TEMPLATES: CustodyTemplate[] = [
  {
    id: 'split_week',
    name: 'Split Week',
    nameHebrew: 'חלוקת שבוע',
    description: 'הורה 1: א-ד, הורה 2: ה-ש',
    pattern: CustodyPattern.WEEKLY,
    parent1Days: [0, 1, 2, 3], // ראשון-רביעי
    parent2Days: [4, 5, 6]     // חמישי-שבת
  },
  {
    id: 'weekends',
    name: 'Weekends Alternating',
    nameHebrew: 'סופי שבוע לסירוגין',
    description: 'הורה 1: ימי חול, הורה 2: סופי שבוע לסירוגין',
    pattern: CustodyPattern.BIWEEKLY,
    parent1Days: [0, 1, 2, 3, 4], // א-ה
    parent2Days: [5, 6]           // ו-ש (בשבוע הנוכחי)
  },
  {
    id: 'week_on_off',
    name: 'Week On/Off',
    nameHebrew: 'שבוע אצל כל אחד',
    description: 'שבוע שלם אצל כל הורה לסירוגין',
    pattern: CustodyPattern.WEEK_ON_WEEK_OFF,
    parent1Days: [0, 1, 2, 3, 4, 5, 6], // כל השבוע
    parent2Days: []
  },
  {
    id: '2-2-3',
    name: '2-2-3 Schedule',
    nameHebrew: 'תבנית 2-2-3',
    description: 'הורה 1: 2 ימים, הורה 2: 2 ימים, לסירוגין 3 ימים',
    pattern: CustodyPattern.WEEKLY,
    parent1Days: [0, 1, 4, 5, 6], // א-ב, ה-ש
    parent2Days: [2, 3]           // ג-ד
  },
  {
    id: 'custom',
    name: 'Custom',
    nameHebrew: 'מותאם אישית',
    description: 'בחר בעצמך את הימים',
    pattern: CustodyPattern.CUSTOM,
    parent1Days: [],
    parent2Days: []
  }
];
