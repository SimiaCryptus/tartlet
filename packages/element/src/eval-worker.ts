// Worker entry. It contains static module source only and nothing built from document content (ADR-003).
import { startWorkerHost } from '@tartlet/worker';

startWorkerHost(self);
