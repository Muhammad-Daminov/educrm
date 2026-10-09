/**
 * Minimal i18n: a flat key -> uz string dictionary. Only `uz` exists for
 * now (CLAUDE.md: "UI texts via i18n keys (uz default)") — this is the
 * single source of truth for every user-facing string, so swapping in a
 * real i18n library later only means changing this file's shape, not
 * every call site.
 */
const uz = {
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
  'header.logout': 'Chiqish',
  'header.loading': 'Yuklanmoqda...',
  'me.title': 'Profil',
  'me.roles': 'Rollar',
  'me.permissions': 'Ruxsatlar',
  'me.branches': 'Filiallar',
  'me.noBranches': 'Filiallarga biriktirilmagan',
  'common.loading': 'Yuklanmoqda...',
} as const;

export type TranslationKey = keyof typeof uz;

export function t(key: TranslationKey): string {
  return uz[key];
}
