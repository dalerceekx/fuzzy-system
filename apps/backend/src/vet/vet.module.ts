import { Module } from '@nestjs/common';
import { MedicinesController } from './medicines.controller.js';
import { MedicinesService } from './medicines.service.js';
import { ProtocolsController } from './protocols.controller.js';
import { ProtocolsService } from './protocols.service.js';
import { RecommendationsController } from './recommendations.controller.js';
import { RecommendationsService } from './recommendations.service.js';
import { TreatmentsController } from './treatments.controller.js';
import { TreatmentsService } from './treatments.service.js';

@Module({
  controllers: [
    MedicinesController,
    ProtocolsController,
    RecommendationsController,
    TreatmentsController,
  ],
  providers: [
    MedicinesService,
    ProtocolsService,
    RecommendationsService,
    TreatmentsService,
  ],
})
export class VetModule {}
