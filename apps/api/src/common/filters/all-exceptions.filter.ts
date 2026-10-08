import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { RequestWithId } from '../middleware/request-id.middleware';

interface ErrorBody {
  code: string;
  message: string;
  details: unknown;
  request_id: string;
}

const DEFAULT_CODE = 'INTERNAL_ERROR';
const SERVER_ERROR_THRESHOLD: number = HttpStatus.INTERNAL_SERVER_ERROR;

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();
    const requestId = request.id ?? 'unknown';

    const { status, body } = this.buildResponse(exception, requestId);

    if (status >= SERVER_ERROR_THRESHOLD) {
      this.logger.error(
        `request_id=${requestId} status=${status} message=${body.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({ error: body });
  }

  private buildResponse(
    exception: unknown,
    requestId: string,
  ): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'object' && payload !== null) {
        const payloadObj = payload as Record<string, unknown>;
        const code = typeof payloadObj.code === 'string' ? payloadObj.code : httpStatusToCode(status);
        const message =
          typeof payloadObj.message === 'string'
            ? payloadObj.message
            : Array.isArray(payloadObj.message)
              ? payloadObj.message.join(', ')
              : exception.message;

        return {
          status,
          body: {
            code,
            message,
            details: payloadObj.details ?? null,
            request_id: requestId,
          },
        };
      }

      return {
        status,
        body: {
          code: httpStatusToCode(status),
          message: typeof payload === 'string' ? payload : exception.message,
          details: null,
          request_id: requestId,
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: DEFAULT_CODE,
        message: 'An unexpected error occurred',
        details: null,
        request_id: requestId,
      },
    };
  }
}

const STATUS_CODE_MAP: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
};

function httpStatusToCode(status: number): string {
  return STATUS_CODE_MAP[status] ?? DEFAULT_CODE;
}
