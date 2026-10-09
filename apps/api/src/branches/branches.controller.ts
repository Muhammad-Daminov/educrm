import { Body, Controller, Get, Post } from '@nestjs/common';
import type { Branch } from '@prisma/client';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { BranchesService } from './branches.service';
import { createBranchSchema, type CreateBranchDto } from './dto/create-branch.dto';

@Controller('branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @RequirePermission('branch.view')
  @Get()
  findAll(): Promise<Branch[]> {
    return this.branchesService.findAll();
  }

  @RequirePermission('branch.create')
  @Post()
  create(@Body(new ZodValidationPipe(createBranchSchema)) dto: CreateBranchDto): Promise<Branch> {
    return this.branchesService.create(dto);
  }
}
