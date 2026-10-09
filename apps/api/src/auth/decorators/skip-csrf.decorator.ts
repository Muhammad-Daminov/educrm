import { SetMetadata } from '@nestjs/common';

export const SKIP_CSRF_KEY = 'skipCsrf';

/**
 * Only for /auth/login: the browser cannot possibly have a CSRF cookie
 * before its first successful response from this API, so the double-submit
 * check can't apply to the very request that would set one. Every other
 * non-GET route (including /auth/refresh and /auth/logout) keeps the
 * check — by the time those are called, login has already issued the CSRF
 * cookie. See docs/QUESTIONS.md.
 */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);
