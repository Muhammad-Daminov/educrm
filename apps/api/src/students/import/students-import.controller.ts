import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { importMappingFormSchema } from './import.dto';
import type { ImportConfirmResult, ImportDryRunResult } from './import.dto';
import { StudentsImportService } from './students-import.service';

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

/**
 * TZ M11.1: "fayl → mapping → dry-run validatsiya → xatolar → tasdiq →
 * import". `import.run` gates dry-run and confirm; `import.rollback` is its
 * own permission (TZ 3.2) because undoing a batch is a different kind of
 * trust than running one.
 */
@Controller('students/import')
export class StudentsImportController {
  constructor(private readonly service: StudentsImportService) {}

  @RequirePermission('import.run')
  @Post('dry-run')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }))
  dryRun(
    @UploadedFile() file: Express.Multer.File | undefined,
    // multipart/form-data has no nested JSON, so the mapping travels as a
    // JSON-encoded text field alongside the file.
    @Body('mapping') mappingRaw: string | undefined,
  ): Promise<ImportDryRunResult> {
    const { file: text, mapping } = this.parse(file, mappingRaw);
    return this.service.dryRun(text, mapping);
  }

  @RequirePermission('import.run')
  @Post('confirm')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }))
  confirm(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('mapping') mappingRaw: string | undefined,
  ): Promise<ImportConfirmResult> {
    const { file: text, mapping } = this.parse(file, mappingRaw);
    return this.service.confirm(text, file?.originalname ?? 'import.csv', mapping);
  }

  @RequirePermission('import.rollback')
  @Post(':batchId/rollback')
  @HttpCode(HttpStatus.OK)
  rollback(@Param('batchId', ParseUUIDPipe) batchId: string): Promise<{ archivedCount: number }> {
    return this.service.rollback(batchId);
  }

  private parse(
    file: Express.Multer.File | undefined,
    mappingRaw: string | undefined,
  ): { file: string; mapping: ReturnType<typeof importMappingFormSchema.parse>['mapping'] } {
    if (file === undefined) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'file is required',
        details: [{ field: 'file', code: 'REQUIRED' }],
      });
    }
    const parsed = importMappingFormSchema.safeParse({ mapping: mappingRaw ?? '' });
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'mapping is invalid',
        details: [{ field: 'mapping', code: 'INVALID' }],
      });
    }
    return { file: file.buffer.toString('utf-8'), mapping: parsed.data.mapping };
  }
}
