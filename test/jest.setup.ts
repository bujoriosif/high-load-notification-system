import { Logger } from '@nestjs/common';

// Keep test output focused on assertions, not the stub publishers' debug logs.
Logger.overrideLogger(false);
