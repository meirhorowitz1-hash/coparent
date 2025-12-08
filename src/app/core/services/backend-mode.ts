import { environment } from '../../../environments/environment';

/**
 * Check if we should use the Node.js backend server
 */
export function useServerBackend(): boolean {
  return environment.backendMode === 'server';
}

/**
 * Check if we should use Firebase directly
 */
export function useFirebaseBackend(): boolean {
  return environment.backendMode === 'firebase';
}
