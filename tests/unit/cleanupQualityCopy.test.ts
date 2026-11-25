import { describe, expect, it } from 'vitest';
import { qualityModelNote } from '../../src/features/settings/cleanupQualityCopy';
import {
  QUALITY_CLEANUP_MODEL_ID, QUALITY_CLEANUP_MODEL_SHA256,
} from '../../src/services/cleanup/types';

const installed = {
  available: true,
  id: QUALITY_CLEANUP_MODEL_ID,
  sha256: QUALITY_CLEANUP_MODEL_SHA256,
};
const missing = { ...installed, available: false };

describe('qualityModelNote', () => {
  it('says in use only when the 4B is chosen and local cleanup is on', () => {
    expect(qualityModelNote(installed, true, true)).toBe('Qwen3 4B is in use.');
  });

  it('says installed when the 4B is chosen but local cleanup is off', () => {
    expect(qualityModelNote(installed, true, false)).toBe('Qwen3 4B is installed.');
  });

  it('says installed when the 4B is available but not chosen', () => {
    expect(qualityModelNote(installed, false, true)).toBe('Qwen3 4B is installed.');
    expect(qualityModelNote(installed, false, false)).toBe('Qwen3 4B is installed.');
  });

  it('keeps the missing-model copy, whether or not cleanup is on', () => {
    expect(qualityModelNote(missing, false, false)).toBe('Not installed.');
    expect(qualityModelNote(missing, true, false))
      .toBe('Not installed. Download it again, or turn it off to use Qwen3 0.6B.');
    expect(qualityModelNote(missing, true, true))
      .toBe('Not installed. Download it again, or turn it off to use Qwen3 0.6B.');
  });
});
