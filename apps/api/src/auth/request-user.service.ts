import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { REQUEST_USER_KEY } from './auth.constants';
import type { RequestUser } from './types';

@Injectable()
export class RequestUserService {
  constructor(private readonly cls: ClsService) {}

  get current(): RequestUser | undefined {
    return this.cls.get<RequestUser>(REQUEST_USER_KEY);
  }
}
