/**
 * Minimal i18n: a flat key -> uz string dictionary. Only `uz` exists for
 * now (CLAUDE.md: "UI texts via i18n keys (uz default)") — this is the
 * single source of truth for every user-facing string, so swapping in a
 * real i18n library later only means changing this file's shape, not
 * every call site.
 *
 * Orthography (TZ 8.5, UX §8, product-owner decision recorded in
 * docs/ROADMAP.md): `oʻ` and `gʻ` carry U+02BB MODIFIER LETTER TURNED
 * COMMA — the mark is part of the letter — and the tutuq belgisi
 * (`maʼlumot`) is U+02BC MODIFIER LETTER APOSTROPHE. Never the ASCII `'`
 * or a curly quote. Search and sort go through `uzSearchKey`
 * (`@educrm/shared`), which treats all of those as equivalent, so a user
 * typing `'` — or nothing at all — still finds this text.
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
  'login.error.invalid': 'Tenant, login yoki parol notoʻgʻri',
  'login.error.rateLimited': 'Urinishlar soni oshib ketdi, birozdan keyin qayta urinib koʻring',
  'login.error.generic': 'Kirishda xatolik yuz berdi, qayta urinib koʻring',

  // Navigation (UX §1.1)
  'nav.dashboard': 'Ish stoli',
  'nav.students': 'Oʻquvchilar',
  'nav.units': 'Guruhlar',
  'nav.schedule': 'Jadval',
  'nav.attendance': 'Davomat',
  'nav.finance': 'Moliya',
  'nav.finance.payments': 'Toʻlovlar',
  'nav.finance.debtors': 'Qarzdorlar',
  'nav.org': 'Kompaniya',
  'nav.org.branches': 'Filiallar',
  'nav.org.classrooms': 'Xonalar',
  'nav.org.employees': 'Xodimlar',
  'nav.settings': 'Sozlamalar',
  'nav.profile': 'Profil',

  // App shell (UX §2)
  'shell.brand': 'EduCRM',
  'shell.sidebar.collapse': 'Menyuni yigʻish',
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
  'palette.placeholder': 'Boʻlimlar boʻyicha qidirish...',
  'palette.empty': 'Hech narsa topilmadi',
  'palette.hint': 'Harakatlanish uchun ↑ ↓, ochish uchun Enter, yopish uchun Esc',
  'palette.close': 'Yopish',

  // States (UX §3.8)
  'state.loading': 'Yuklanmoqda...',
  'state.empty.title': 'Hali maʼlumot yoʻq',
  'state.error.title': 'Xatolik yuz berdi',
  'state.error.retry': 'Qayta urinish',
  'state.error.requestId': 'Soʻrov raqami',
  'state.error.requestIdCopy': 'Soʻrov raqamini nusxalash',
  'state.error.requestIdCopied': 'Nusxalandi',
  'state.error.support': 'Yordam uchun bu raqamni qoʻllab-quvvatlash xizmatiga yuboring',
  'state.forbidden.title': 'Ruxsat yoʻq',
  'state.forbidden.description':
    'Bu boʻlimni koʻrish uchun ruxsat kerak. Rahbaringizga murojaat qiling.',
  'state.placeholder.title': 'Bu boʻlim hali tayyor emas',
  'state.placeholder.description':
    'Interfeys asosi tayyor, boʻlim mazmuni keyingi bosqichlarda qoʻshiladi.',

  // Dashboard (UX §4.0)
  'dashboard.greeting': 'Xush kelibsiz',
  'dashboard.widgetsPending': 'Vidjetlar keyingi bosqichlarda qoʻshiladi',

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

/**
 * The whole dictionary, exposed so the orthography guard in
 * `test/i18n.spec.ts` can check every string at once. Call sites use `t`.
 */
export const translations = uz;

export type TranslationKey = keyof typeof uz;

export function t(key: TranslationKey): string {
  return uz[key];
}
