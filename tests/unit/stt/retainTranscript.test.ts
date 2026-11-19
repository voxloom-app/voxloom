import { describe, expect, it, vi } from 'vitest';
import type { ClipboardAdapter } from '../../../src/services/clipboard';
import { retainTranscript } from '../../../src/services/stt/retainTranscript';

function clipboard(ok = true): ClipboardAdapter {
  return {
    copy: ok
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(new Error('NotAllowedError')),
  };
}

describe('retainTranscript', () => {
  it('writes History and the clipboard when asked to copy', async () => {
    const clip = clipboard();
    const history = vi.fn();
    const status = await retainTranscript({
      clipboard: clip,
      copyToClipboard: true,
      durationMs: 8_000,
      id: 'dogfood-pcm-1',
      model: 'whisper-large-v3-turbo',
      now: 1,
      onHistoryRecord: history,
      style: 'formal',
      text: 'kept words',
    });
    expect(status).toBe('copied');
    expect(clip.copy).toHaveBeenCalledWith('kept words');
    expect(history).toHaveBeenCalledWith(expect.objectContaining({
      status: 'copied',
      text: 'kept words',
    }));
  });

  it('writes History only for a late result, even if a clipboard exists', async () => {
    const clip = clipboard();
    const history = vi.fn();
    const status = await retainTranscript({
      clipboard: clip,
      copyToClipboard: false,
      durationMs: 8_000,
      id: 'dogfood-pcm-2',
      now: 1,
      onHistoryRecord: history,
      style: 'formal',
      text: 'late words',
    });
    expect(status).toBe('failed');
    expect(clip.copy).not.toHaveBeenCalled();
    expect(history).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      text: 'late words',
    }));
  });

  it('ignores blank text and a clipboard failure still keeps History', async () => {
    const history = vi.fn();
    expect(await retainTranscript({
      copyToClipboard: false,
      durationMs: 1,
      id: 'blank',
      now: 1,
      onHistoryRecord: history,
      style: 'formal',
      text: '   ',
    })).toBe('failed');
    expect(history).not.toHaveBeenCalled();

    const clip = clipboard(false);
    const status = await retainTranscript({
      clipboard: clip,
      copyToClipboard: true,
      durationMs: 1,
      id: 'copy-fail',
      now: 1,
      onHistoryRecord: history,
      style: 'formal',
      text: 'still kept',
    });
    expect(status).toBe('failed');
    expect(history).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      text: 'still kept',
    }));
  });
});
