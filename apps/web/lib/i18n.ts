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

  // Drawer / forms (UX P6)
  'drawer.close': 'Yopish',
  'form.save': 'Saqlash',
  'form.saving': 'Saqlanmoqda...',
  'form.cancel': 'Bekor qilish',
  'form.confirmDiscard': 'Saqlanmagan oʻzgarishlar bor. Yopilsinmi?',
  'form.select.empty': 'Tanlanmagan',
  'form.multiselect.empty': 'Hali variant yoʻq',
  'form.error.required': 'Bu maydon toʻldirilishi shart',
  'form.error.duplicate': 'Bu nom allaqachon mavjud',
  'form.error.notFound': 'Tanlangan yozuv topilmadi',
  'form.error.outOfRange': 'Qiymat notoʻgʻri oraliqda',
  'form.error.invalid': 'Qiymat notoʻgʻri',
  'form.error.self': 'Bu amalni oʻzingizga qoʻllay olmaysiz',
  'form.error.field': 'Qiymat qabul qilinmadi',
  'form.error.versionConflict':
    'Bu yozuvni boshqa foydalanuvchi oʻzgartirgan. Sahifani yangilab, qayta urinib koʻring.',
  'form.error.unknown': 'Saqlanmadi. Qayta urinib koʻring.',

  // List screen (UX P1)
  'list.records': 'yozuv',
  'list.create': 'Qoʻshish',
  'list.edit': 'Tahrirlash',
  'list.archive': 'Arxivlash',
  'list.restore': 'Tiklash',
  'list.actions': 'Amallar',
  'list.search': 'Qidirish',
  'list.previous': 'Oldingi',
  'list.next': 'Keyingi',
  'list.badge.archived': 'Arxivda',
  'list.filter.status': 'Holat',
  'list.filter.active': 'Faol',
  'list.filter.archived': 'Arxivdagilar',
  'list.filter.all': 'Barchasi',
  'list.filter.clear': 'Filtrlarni tozalash',
  'list.filter.remove': 'olib tashlash',
  'list.empty.title': 'Hali yozuv yoʻq',
  'list.empty.filtered.title': 'Filtr boʻyicha topilmadi',
  'list.empty.filtered.description':
    'Qidiruv yoki filtr natijani cheklab turibdi. Filtrlarni tozalab koʻring.',

  // Toasts
  'toast.created': 'Qoʻshildi',
  'toast.saved': 'Saqlandi',
  'toast.archived': 'Arxivlandi',
  'toast.restored': 'Tiklandi',

  // Branches (TZ M1.1)
  'branches.title': 'Filiallar',
  'branches.create': 'Yangi filial',
  'branches.edit': 'Filialni tahrirlash',
  'branches.empty': 'Birinchi filialni qoʻshing — xonalar, guruhlar va jadval shunga bogʻlanadi.',
  'branches.field.name': 'Nomi',
  'branches.field.code': 'Qisqartma',
  'branches.field.code.hint': 'Guruh nomlarini avtomatik yasashda ishlatiladi, masalan CHL.',
  'branches.field.address': 'Manzil',
  'branches.field.phone': 'Telefon',
  'branches.field.timezone': 'Vaqt mintaqasi',
  'branches.field.timezone.hint': 'Dars vaqtlari shu mintaqada hisoblanadi. Boʻsh boʻlsa — Asia/Tashkent.',

  // Classrooms (TZ M1.2)
  'classrooms.title': 'Xonalar',
  'classrooms.create': 'Yangi xona',
  'classrooms.edit': 'Xonani tahrirlash',
  'classrooms.empty': 'Xona qoʻshing — jadvalda bandlik shu xonalar boʻyicha tekshiriladi.',
  'classrooms.field.branch': 'Filial',
  'classrooms.field.branch.hint': 'Xona keyinchalik boshqa filialga koʻchirilmaydi.',
  'classrooms.field.name': 'Nomi',
  'classrooms.field.capacity': 'Sigʻimi',
  'classrooms.field.capacity.hint': 'Ogohlantirish uchun: guruh sigʻimdan oshsa eslatiladi.',
  'classrooms.field.equipment': 'Jihozlar',

  // Employees (TZ M1.4)
  'employees.title': 'Xodimlar',
  'employees.create': 'Yangi xodim',
  'employees.edit': 'Xodimni tahrirlash',
  'employees.empty': 'Xodim qoʻshing — rollar va filiallar shu yerda biriktiriladi.',
  'employees.field.fullName': 'Toʻliq ism',
  'employees.field.phone': 'Telefon',
  'employees.field.phone.hint': 'Telefon yoki email — bu tizimga kirish logini.',
  'employees.field.email': 'Email',
  'employees.field.password': 'Dastlabki parol',
  'employees.field.password.hint': 'Kamida 10 belgi. Xodim keyin oʻzgartiradi.',
  'employees.column.roles': 'Rollar',
  'employees.column.branches': 'Filiallar',
  'employees.column.status': 'Holat',
  'employees.status.active': 'Faol',
  'employees.status.inactive': 'Faol emas',
  'employees.action.deactivate': 'Deaktivatsiya',
  'employees.action.activate': 'Aktivlashtirish',
  'employees.action.roles': 'Rollar',
  'employees.action.branches': 'Filiallar',
  'employees.action.teacherProfile': 'Oʻqituvchi profili',
  'employees.roles.title': 'Rollarni biriktirish',
  'employees.roles.field': 'Rollar',
  'employees.branches.title': 'Filiallarni biriktirish',
  'employees.branches.field': 'Filiallar',
  'employees.teacher.title': 'Oʻqituvchi profili',
  'employees.teacher.disciplines': 'Fanlar',
  'employees.teacher.levels': 'Darajalar',
  'employees.teacher.notes': 'Izoh',
  'employees.deactivate.confirm':
    'Xodim deaktivatsiya qilinadi va barcha sessiyalari bekor qilinadi. Davom etilsinmi?',
  'employees.filter.role': 'Rol',
  'employees.filter.branch': 'Filial',
  'toast.deactivated': 'Deaktivatsiya qilindi',
  'toast.activated': 'Aktivlashtirildi',

  // Reference data (TZ M1.3)
  'settings.title': 'Sozlamalar',
  'settings.nav.disciplines': 'Fanlar',
  'settings.nav.levels': 'Darajalar',
  'settings.nav.ageCategories': 'Yosh toifalari',
  'settings.nav.paymentMethods': 'Toʻlov usullari',
  'settings.nav.holidays': 'Bayramlar',
  'settings.intro': 'Maʼlumotnomalar: bu roʻyxatlar guruh, jadval va toʻlov ekranlarida tanlanadi.',
  'reference.field.name': 'Nomi',
  'reference.field.sortOrder': 'Tartib',
  'reference.field.sortOrder.hint': 'Kichik raqam yuqorida turadi. Teng boʻlsa — nom boʻyicha.',
  'disciplines.title': 'Fanlar',
  'disciplines.create': 'Yangi fan',
  'disciplines.edit': 'Fanni tahrirlash',
  'disciplines.empty': 'Fan qoʻshing — guruhlar va darajalar shunga bogʻlanadi.',
  'levels.title': 'Darajalar',
  'levels.create': 'Yangi daraja',
  'levels.edit': 'Darajani tahrirlash',
  'levels.empty': 'Daraja qoʻshing, masalan A1, A2, B1.',
  'levels.field.discipline': 'Fan',
  'levels.field.discipline.hint': 'Boʻsh boʻlsa — daraja barcha fanlar uchun amal qiladi.',
  'levels.column.discipline': 'Fan',
  'levels.allDisciplines': 'Barcha fanlar',
  'ageCategories.title': 'Yosh toifalari',
  'ageCategories.create': 'Yangi yosh toifasi',
  'ageCategories.edit': 'Yosh toifasini tahrirlash',
  'ageCategories.empty': 'Yosh toifasi qoʻshing, masalan 7–10 yosh.',
  'ageCategories.field.minAge': 'Eng kichik yosh',
  'ageCategories.field.maxAge': 'Eng katta yosh',
  'ageCategories.field.maxAge.hint': 'Boʻsh boʻlsa — yuqori chegara yoʻq (masalan 16+).',
  'ageCategories.column.range': 'Yosh',
  'paymentMethods.title': 'Toʻlov usullari',
  'paymentMethods.create': 'Yangi toʻlov usuli',
  'paymentMethods.edit': 'Toʻlov usulini tahrirlash',
  'paymentMethods.empty': 'Toʻlov usuli qoʻshing, masalan Naqd, Karta, Bank oʻtkazmasi.',
  'holidays.title': 'Bayramlar',
  'holidays.create': 'Yangi bayram',
  'holidays.edit': 'Bayramni tahrirlash',
  'holidays.empty': 'Bayram qoʻshing — bu kunlarda dars jadvalga tushmaydi.',
  'holidays.field.name': 'Nomi',
  'holidays.field.date': 'Sana',
  'holidays.field.branch': 'Filial',
  'holidays.field.branch.hint': 'Boʻsh boʻlsa — butun tashkilot uchun.',
  'holidays.column.date': 'Sana',
  'holidays.column.branch': 'Filial',
  'holidays.allBranches': 'Barcha filiallar',

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
