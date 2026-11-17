import { Module } from '@nestjs/common';
import { BusinessEngineService } from './business-engine.service';

@Module({
	providers: [BusinessEngineService],
	exports: [BusinessEngineService],
})
export class BusinessEngineModule {}
