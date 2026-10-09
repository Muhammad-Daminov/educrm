import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Route needs no authentication and no permission check. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
