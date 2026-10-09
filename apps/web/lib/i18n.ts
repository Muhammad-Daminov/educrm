/**
 * Minimal i18n: a flat key -> uz string dictionary. Only `uz` exists for
 * now (CLAUDE.md: "UI texts via i18n keys (uz default)") — this is the
 * single source of truth for every user-facing string, so swapping in a
 * real i18n library later only means changing this file's shape, not
 * every call site.
 *
 * Apostrophes here are plain ASCII `'`, which UX §8 does not accept — it
 * wants the proper Uzbek Latin characters in oʻ/gʻ. That is deferred rather
 * than forgotten (docs/QUESTIONS.md): the choice between U+02BB and U+2019
 * needs deciding once, and when it is, it is this one file plus Money's
 * currency suffix. The command palette normalizes every apostrophe variant
 * away when matching, so the switch cannot break search either way.
 */
const uz = {
  // Login
  'login.title': 'Tizimga kirish',
  'login.subtitle': 'Telefon raqami yoki email va parolingizni kiriting',
  'login.loginField': 'Telefon yoki email',
  'login.loginField.placeholder': '+998901234567',
  'login.password': 'Parol',
  'login.submit': 'Kirish',
  'login.submitting': 'Kirilmoqda...',
  'login.error.invalid': "Tenant, login yoki parol noto'g'ri",
  'login.error.rateLimited': "Urinishlar soni oshib ketdi, birozdan keyin qayta urinib ko'ring",
  'login.error.generic': "Kirishda xatolik yuz berdi, qayta urinib ko'ring",

  // Navigation (UX §1.1)
  'nav.dashboard': 'Ish stoli',
  'nav.students': "O'quvchilar",
  'nav.units': 'Guruhlar',
  'nav.schedule': 'Jadval',
  'nav.attendance': 'Davomat',
  'nav.finance': 'Moliya',
  'nav.finance.payments': "To'lovlar",
  'nav.finance.debtors': 'Qarzdorlar',
  'nav.org': 'Kompaniya',
  'nav.org.branches': 'Filiallar',
  'nav.org.classrooms': 'Xonalar',
  'nav.org.employees': 'Xodimlar',
  'nav.settings': 'Sozlamalar',
  'nav.profile': 'Profil',

  // App shell (UX §2)
  'shell.brand': 'EduCRM',
  'shell.sidebar.collapse': "Menyuni yig'ish",
  'shell.sidebar.expand': 'Menyuni ochish',
  'shell.sidebar.label': 'Asosiy menyu',
  'shell.search.placeholder': 'Qidirish...',
  'shell.search.shortcut': 'Ctrl K',
  'shell.userMenu.open': 'Foydalanuvchi menyusi',
  'shell.userMenu.profile': 'Profil',
  'shell.userMenu.logout': 'Chiqish',

  // Branch selector (UX §2.2)
  'branch.label': 'Filial',
  'branch.all': 'Barcha filiallar',
  'branch.none': 'Filial biriktirilmagan',
  'branch.select': 'Filialni tanlash',

  // Command palette (UX §2.4)
  'palette.title': 'Buyruqlar paneli',
  'palette.placeholder': "Bo'limlar bo'yicha qidirish...",
  'palette.empty': 'Hech narsa topilmadi',
  'palette.hint': "Harakatlanish uchun ↑ ↓, ochish uchun Enter, yopish uchun Esc",
  'palette.close': 'Yopish',

  // States (UX §3.8)
  'state.loading': 'Yuklanmoqda...',
  'state.empty.title': "Hali ma'lumot yo'q",
  'state.error.title': 'Xatolik yuz berdi',
  'state.error.retry': 'Qayta urinish',
  'state.error.requestId': "So'rov raqami",
  'state.error.requestIdCopy': "So'rov raqamini nusxalash",
  'state.error.requestIdCopied': 'Nusxalandi',
  'state.error.support': "Yordam uchun bu raqamni qo'llab-quvvatlash xizmatiga yuboring",
  'state.forbidden.title': "Ruxsat yo'q",
  'state.forbidden.description':
    "Bu bo'limni ko'rish uchun ruxsat kerak. Rahbaringizga murojaat qiling.",
  'state.placeholder.title': "Bu bo'lim hali tayyor emas",
  'state.placeholder.description':
    "Interfeys asosi tayyor, bo'lim mazmuni keyingi bosqichlarda qo'shiladi.",

  // Dashboard (UX §4.0)
  'dashboard.greeting': 'Xush kelibsiz',
  'dashboard.widgetsPending': "Vidjetlar keyingi bosqichlarda qo'shiladi",

  // Profile
  'me.title': 'Profil',
  'me.roles': 'Rollar',
  'me.permissions': 'Ruxsatlar',
  'me.branches': 'Filiallar',
  'me.noBranches': 'Filiallarga biriktirilmagan',

  // Toasts
  'toast.close': 'Yopish',

  'common.loading': 'Yuklanmoqda...',
} as const;

export type TranslationKey = keyof typeof uz;

export function t(key: TranslationKey): string {
  return uz[key];
}
