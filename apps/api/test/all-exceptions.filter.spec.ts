import { describe, expect, it, vi } from 'vitest';
import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import type { RequestWithId } from '../src/common/middleware/request-id.middleware';

function createHost(request: Partial<RequestWithId>): { host: ArgumentsHost; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const response = { status };

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { host, json };
}

describe('AllExceptionsFilter', () => {
  it('formats HttpException instances into the { error } envelope with request_id', () => {
    const filter = new AllExceptionsFilter();
    const { host, json } = createHost({ id: 'req-1' });

    filter.catch(new NotFoundException('Student not found'), host);

    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'NOT_FOUND',
        message: 'Student not found',
        details: null,
        request_id: 'req-1',
      },
    });
  });

  it('propagates custom code/details from the exception payload', () => {
    const filter = new AllExceptionsFilter();
    const { host, json } = createHost({ id: 'req-2' });

    filter.catch(
      new BadRequestException({
        code: 'SCHEDULE_CONFLICT',
        message: 'Xona bu vaqtda band',
        details: [{ field: 'classroom_id' }],
      }),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'SCHEDULE_CONFLICT',
        message: 'Xona bu vaqtda band',
        details: [{ field: 'classroom_id' }],
        request_id: 'req-2',
      },
    });
  });

  it('falls back to a generic 500 envelope for unknown/non-HTTP exceptions', () => {
    const filter = new AllExceptionsFilter();
    const { host, json } = createHost({ id: 'req-3' });

    filter.catch(new Error('boom'), host);

    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: null,
        request_id: 'req-3',
      },
    });
  });
});
