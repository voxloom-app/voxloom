/** Error metadata must never throw while preserving dispatch/validation evidence. */
export function deliveryErrorDetail(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error && typeof error.message === 'string') return error.message;
  return 'unknown delivery failure';
}
