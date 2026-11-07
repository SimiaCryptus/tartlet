// Acoustic render worker entry. It contains static module source only and nothing built from
// document content (ADR-003).
import { startRenderHost } from './render-host';

startRenderHost(self);
