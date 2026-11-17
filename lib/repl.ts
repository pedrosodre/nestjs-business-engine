import { repl } from '@nestjs/core';
import { BusinessEngineModule } from './business-engine.module';

async function bootstrap() {
	await repl(BusinessEngineModule);
}
bootstrap();
