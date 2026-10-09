import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CrudDeps } from '../common/crud/crud.deps';
import { ClassroomsController } from './classrooms.controller';
import { ClassroomsService } from './classrooms.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ClassroomsController],
  providers: [CrudDeps, ClassroomsService],
})
export class ClassroomsModule {}
