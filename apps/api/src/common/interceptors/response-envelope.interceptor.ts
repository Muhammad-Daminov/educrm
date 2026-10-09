import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { envelope, type ResponseEnvelope } from '../http/response-envelope';

/**
 * Wraps every successful HTTP response in the TZ 6.2 envelope.
 *
 * Registered as an APP_INTERCEPTOR in AppModule rather than in main.ts, so
 * the integration tests that boot the app through `Test.createTestingModule`
 * get the same wire format the real server produces — a contract this
 * central should not differ between the two.
 *
 * Errors are not touched: AllExceptionsFilter already produces the
 * `{ error: { code, message, details, request_id } }` half of TZ 6.2, and a
 * filter runs outside the interceptor chain anyway.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ResponseEnvelope<unknown>> {
    // Only HTTP responses have a body to wrap. The worker process has no
    // HTTP at all, but a future queue/RPC context would arrive here too.
    if (context.getType() !== 'http') {
      return next.handle() as Observable<ResponseEnvelope<unknown>>;
    }
    return next.handle().pipe(map((value: unknown) => envelope(value)));
  }
}
