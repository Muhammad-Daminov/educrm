import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CrudDeps } from '../common/crud/crud.deps';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';

@Module({
  imports: [DatabaseModule],
  controllers: [BranchesController],
  providers: [CrudDeps, BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
