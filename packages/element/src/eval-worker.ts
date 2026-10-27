// Worker entry. It contains static module source only and nothing built from document content (ADR-003).
import { startWorkerHost, type WorkerPort } from "@tartlet/worker";

startWorkerHost(self as unknown as WorkerPort);