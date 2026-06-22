import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListsModule } from '../lists/lists.module';
import { LockService } from './lock.service';
import { PresenceService } from './presence.service';
import { RealtimeGateway } from './realtime.gateway';
import { REALTIME_EMITTER } from './realtime.types';

@Module({
  imports: [AuthModule, ListsModule],
  providers: [
    LockService,
    PresenceService,
    RealtimeGateway,
    { provide: REALTIME_EMITTER, useExisting: RealtimeGateway },
  ],
  exports: [REALTIME_EMITTER, LockService, PresenceService],
})
export class RealtimeModule {}
