import { Module } from '@nestjs/common';
import { AnimalsModule } from './animals/animals.module.js';
import {
  PLATFORM_CONTROLLERS,
  PLATFORM_IMPORTS,
  PLATFORM_PROVIDERS,
} from './app.platform.js';
import { AuthModule } from './auth/auth.module.js';
import { DiseasesModule } from './diseases/diseases.module.js';
import { FarmsModule } from './farms/farms.module.js';
import { FilesModule } from './files/files.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { RationsModule } from './rations/rations.module.js';
import { SmsModule } from './sms/sms.module.js';
import { UsersModule } from './users/users.module.js';
import { VetModule } from './vet/vet.module.js';

export { ObserveInstrument, observeEnabled } from './app.platform.js';

export const FEATURE_MODULES = [
  SmsModule,
  AuthModule,
  UsersModule,
  FilesModule,
  FarmsModule,
  AnimalsModule,
  InventoryModule,
  RationsModule,
  VetModule,
  DiseasesModule,
];

@Module({
  imports: [...PLATFORM_IMPORTS, ...FEATURE_MODULES],
  controllers: PLATFORM_CONTROLLERS,
  providers: PLATFORM_PROVIDERS,
})
export class AppModule {}
