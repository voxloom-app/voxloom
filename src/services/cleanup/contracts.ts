import type {
  CleanupAttempt,
  CleanupModelStatus,
  CleanupRequest,
  CleanupResult,
} from './types';
import type { CleanupDownloadProgress } from './modelDownload';

export interface CleanupEngine {
  acquire?(requestId: string, modelId: string): Promise<void>;
  cancel(requestId: string): Promise<void>;
  dispose?(): Promise<void>;
  release?(requestId: string): Promise<void>;
  // Bare-string adapters provide no model-attempt evidence. Native returns
  // verified identity on success/failure and signals launch for live UI state.
  run(
    request: CleanupRequest,
    onStarted?: (attempt: CleanupAttempt) => void,
  ): Promise<string | CleanupResult>;
}

export interface CleanupModelStore {
  status(): Promise<CleanupModelStatus>;
  /** BUS-181: one-click download, the only way to install a model. Test fakes may omit it. */
  download?(
    modelId: string, onProgress?: (progress: CleanupDownloadProgress) => void,
  ): Promise<CleanupModelStatus>;
  /** Stops that model's running download; false when it wasn't downloading. */
  cancelDownload?(modelId: string): Promise<boolean>;
  /** BUS-229: removes an installed model; refused while it is in use. */
  delete?(modelId: string): Promise<CleanupModelStatus>;
}
