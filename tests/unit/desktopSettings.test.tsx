import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { register } from '@tauri-apps/plugin-global-shortcut';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { AppProvider } from '../../src/app/AppContext';
import { CLEANUP_MODEL_ID } from '../../src/services/cleanup/types';
import { STT_MODEL_CATALOG } from '../../src/services/stt/types';
import type { CaptureStatus } from '../../src/services/capture/types';
import { resetRecorderStore } from '../../src/features/settings/recorderStore';

// Mock the OS edges, not navigation, Settings persistence or global shortcut registration.
vi.unmock('../../src/services/capture/captureService');
vi.unmock('../../src/services/capture/useCaptureState');
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ setTitle: async () => {} }) }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: () => ({ label: 'main' }) }));
vi.mock('@tauri-apps/plugin-global-shortcut', () => ({ register: vi.fn(), unregister: vi.fn(), unregisterAll: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => {
  const bus = new EventTarget();
  return {
    emit: async (event: string, payload: unknown) => { bus.dispatchEvent(new CustomEvent(event, { detail: payload })); },
    listen: async (event: string, handle: (e: { payload: unknown }) => void) => {
      const fn = (e: Event) => handle({ payload: (e as CustomEvent).detail });
      bus.addEventListener(event, fn);
      return () => bus.removeEventListener(event, fn);
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  resetRecorderStore();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockImplementation(async (cmd, args) => {
    if (cmd === 'capture_list_devices') return [];
    if (cmd === 'capture_query_permission') await emit('capture:event', { kind: 'permission-status', status: 'authorized' });
    if (cmd === 'capture_start') return { generation: 1, mode: 'test', request_id: (args as { requestId: string }).requestId };
    if (cmd === 'setup_query_permissions') return { microphone: 'authorized', accessibility: 'granted' };
    if (cmd === 'setup_model_readiness') return { ready: false };
    if (cmd === 'stt_list_models') return [];
    if (cmd === 'cleanup_model_status') {
      const missing = { id: CLEANUP_MODEL_ID, available: false };
      return { ...missing, runtimeAvailable: true, models: [missing] };
    }
    if (cmd === 'cleanup_download_model') throw new Error('Offline');
    return null;
  });
});

async function start() {
  const user = userEvent.setup();
  render(<AppProvider><App /></AppProvider>);
  await screen.findByRole('button', { name: /Start setup/ });
  await user.click(screen.getByRole('button', { name: 'Set up later' }));
  return user;
}
const rail = (name: string) => screen.getByRole('button', { name });
function expectSettings(pane = 'Shortcut') {
  expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  expect(rail('Settings')).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('tab', { name: new RegExp(`^${pane}:`), selected: true })).toBeVisible();
  expect(invoke).not.toHaveBeenCalledWith('settings_window_open');
}

describe('desktop Settings in the main shell', () => {
  it('routes the rail, keyboard, Recall and the native menu to the same page', async () => {
    const user = await start();
    await user.click(rail('Settings'));
    expectSettings();
    for (const keys of ['{Alt>}4{/Alt}', '{Meta>},{/Meta}']) {
      await user.click(rail('Dictionary'));
      await user.keyboard(keys);
      expectSettings();
    }
    await user.click(rail('Home'));
    await user.click(screen.getByRole('combobox', { name: 'Recall what you said' }));
    await user.click(screen.getByRole('option', { name: 'Settings' }));
    expectSettings();
    await user.click(rail('History'));
    await act(() => emit('settings:open'));
    expectSettings();
  });

  it('opens the retention and failed download notes at their named stops', async () => {
    const user = await start();
    await user.click(rail('History'));
    await user.click(rail('Transcripts'));
    expectSettings('Transcripts');
    expect(screen.getByRole('tab', { selected: true })).toHaveFocus();
    await user.click(rail('Home'));
    await user.click(rail('Turn on local cleanup'));
    await user.click(await screen.findByRole('button', { name: 'Cleanup' }));
    expectSettings('Cleanup');
  });

  it('saves and binds from local state without any settings:changed event', async () => {
    const user = await start();
    await user.click(rail('Settings'));
    await user.click(screen.getByRole('button', { name: /Change keys$/ }));
    await user.keyboard('{Control>}{Alt>}k{/Alt}{/Control}');
    await waitFor(() => expect(register).toHaveBeenCalledWith('Control+Alt+K', expect.any(Function)));
    expect(await screen.findByText(/Shortcut set to/)).toBeVisible();
    await user.click(screen.getByRole('tab', { name: /^Appearance:/ }));
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.body).toHaveAttribute('data-appearance-resolved', 'dark');
    const saves = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'settings_save');
    expect(JSON.parse((saves.at(-1)?.[1] as { contents: string }).contents).settings)
      .toMatchObject({ appearance: 'dark', shortcut: 'Ctrl + Alt + K' });
  });

  it('starts a microphone test explicitly and never adopts a product recording on a pane visit', async () => {
    const user = await start();
    await user.click(rail('Settings'));
    const tab = screen.getByRole('tab', { name: /^Microphone:/ });
    await user.click(tab);
    await user.click(await screen.findByRole('button', { name: 'Test Microphone' }));
    expect(invoke).toHaveBeenCalledWith('capture_start', { preferredDeviceId: null, requestId: expect.any(String), testMode: true });
    await user.click(rail('Stop test'));
    expect(invoke).toHaveBeenCalledWith('capture_cancel', { requestId: expect.any(String) });
    await user.click(screen.getByRole('tab', { name: /^Output:/ }));
    const base = vi.mocked(invoke).getMockImplementation()!;
    const recording: CaptureStatus = { generation: 9, mode: 'full', request_id: 'other-recording' };
    vi.mocked(invoke).mockImplementation((cmd, args) => cmd === 'capture_status' ? Promise.resolve(recording) : base(cmd, args));
    await user.click(tab);
    await waitFor(() => expect(rail('Refresh microphones')).toBeEnabled());
    await user.click(rail('Home'));
    expect(invoke).not.toHaveBeenCalledWith('capture_cancel', { requestId: 'other-recording' });
  });

  it('lists speech packs on entry and downloads and cancels only on request', async () => {
    const user = await start();
    const base = vi.mocked(invoke).getMockImplementation()!;
    const model = { ...STT_MODEL_CATALOG[0], status: 'missing' };
    let cancel: () => void;
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === 'stt_list_models') return [model];
      if (cmd === 'stt_download_model') return new Promise<void>((_, reject) => { cancel = () => reject({ code: 'cancelled' }); });
      if (cmd === 'stt_cancel_download') return cancel();
      return base(cmd, args);
    });
    await user.click(rail('Settings'));
    await user.click(screen.getByRole('tab', { name: /^Speech:/ }));
    const download = await screen.findByRole('button', { name: 'Download' });
    expect(invoke).not.toHaveBeenCalledWith('stt_download_model', expect.anything());
    await user.click(download);
    expect(invoke).toHaveBeenCalledWith('stt_download_model', { modelId: model.id });
    await user.click(rail('Cancel download'));
    expect(invoke).toHaveBeenCalledWith('stt_cancel_download', { modelId: model.id });
  });

  it('reopens setup locally and leaves Resume setup available after deferral', async () => {
    const user = await start();
    await user.click(rail('Settings'));
    await user.click(rail('Set up shortcuts'));
    await user.click(rail('Set up later'));
    expectSettings();
    expect(invoke).not.toHaveBeenCalledWith('settings_request_onboarding');
    await user.click(rail('Home'));
    await user.click(rail('Resume setup'));
    expect(screen.getByRole('main', { name: 'Set up Voxloom' })).toBeVisible();
  });
});
