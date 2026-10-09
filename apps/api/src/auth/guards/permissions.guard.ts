import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRED_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { SELF_SERVICE_PERMISSIONS } from '../auth.constants';
import { RequestUserService } from '../request-user.service';
import { PermissionsService } from '../permissions.service';

/**
 * Global, default-deny (TZ 3.3 / step 0.3 requirement E): a route with
 * neither @Public() nor @RequirePermission() is rejected, same as one that
 * fails its permission check. The CI scanner
 * (scripts/check-route-permissions.js, run from `pnpm lint`) catches this
 * at build time — this is the runtime backstop in case something slips
 * through anyway.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly requestUserService: RequestUserService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const requiredPermission = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRED_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    const user = this.requestUserService.current;
    if (!user) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
        details: null,
      });
    }

    if (!requiredPermission) {
      // Neither @Public() nor @RequirePermission() — default deny.
      throw new ForbiddenException({
        code: 'ROUTE_NOT_AUTHORIZED',
        message: 'This route has no permission requirement configured',
        details: null,
      });
    }

    if (SELF_SERVICE_PERMISSIONS.has(requiredPermission)) {
      return true;
    }

    const effective = await this.permissionsService.getEffectivePermissions(user.tenantId, user.userId);
    if (!this.permissionsService.hasPermission(effective, requiredPermission)) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: `Missing permission: ${requiredPermission}`,
        details: null,
      });
    }

    return true;
  }
}
