import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EncryptionService } from './encryption.service.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { GlobalRateLimitGuard } from './guards/global-rate-limit.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { PasswordService } from './password.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { SessionService } from './sessions/session.service.js';
import { TokenService } from './tokens/token.service.js';

const exported = [
  PasswordService,
  EncryptionService,
  RateLimitService,
  TokenService,
  SessionService,
  GlobalRateLimitGuard,
  AccessTokenGuard,
  RolesGuard,
];

@Global()
@Module({
  // Secrets are passed per call (separate access/refresh key rings).
  imports: [JwtModule.register({})],
  providers: exported,
  exports: exported,
})
export class SecurityModule {}
