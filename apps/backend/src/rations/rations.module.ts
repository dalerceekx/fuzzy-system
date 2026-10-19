import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { RationAnimalTypesService } from './ration-animal-types.service.js';
import { RationIssuesService } from './ration-issues.service.js';
import { RationsController } from './rations.controller.js';
import { RationsService } from './rations.service.js';

@Module({
  // Issues write their OUT movements through the stock ledger's write path.
  imports: [InventoryModule],
  controllers: [RationsController],
  providers: [RationAnimalTypesService, RationsService, RationIssuesService],
})
export class RationsModule {}
