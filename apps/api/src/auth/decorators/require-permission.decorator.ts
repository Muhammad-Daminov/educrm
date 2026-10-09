import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSION_KEY = 'requiredPermission';

/** Route requires the caller to be authenticated AND hold this permission code. */
export const RequirePermission = (code: string) => SetMetadata(REQUIRED_PERMISSION_KEY, code);
