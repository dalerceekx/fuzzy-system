import { Module } from '@nestjs/common';
import { InventoryItemsService } from './inventory-items.service.js';
import { InventoryController } from './inventory.controller.js';
import { StockMovementsService } from './stock-movements.service.js';

@Module({
  controllers: [InventoryController],
  providers: [InventoryItemsService, StockMovementsService],
  // StockMovementsService is the stock ledger's write path (ration issues).
  exports: [InventoryItemsService, StockMovementsService],
})
export class InventoryModule {}
