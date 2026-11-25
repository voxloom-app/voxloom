// BUS-16 PR 2c: the writing-style captions use the same gate as the Local
// cleanup block (`cleanupShown`): no cleanup wording while it is hidden.
import { invoke } from '@tauri-apps/api/core';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '../../src/app/AppContext';
import { initialSettings } from '../../src/domain/fixtures';
import type { Settings } from '../../src/domain/types';
import { HomeHero } from '../../src/features/home/HomeHero';
import { CaptureTab } from '../../src/features/settings/CaptureTab';
import { Settings as SettingsWindow } from '../../src/features/settings/Settings';
import type { CleanupModelStore } from '../../src/services/cleanup/contracts';
import { CLEANUP_MODEL_ID, CLEANUP_MODEL_SHA256, type CleanupModelStatus } from '../../src/services/cleanup/types';
import { renderWithApp } from './testUtils';

vi.mock('../../src/services/capture/useCaptureState', () => ({
  useCaptureState: () => ({
    captureReady: true, captureState: { kind: 'idle' }, deviceListError: null, devices: [],
    devicesLoading: false, permissionStatus: 'authorized', prepareDeviceChange: vi.fn(),
    refreshDevices: vi.fn(), requestMicPermission: vi.fn(), runMicTest: vi.fn(), stopMicTest: vi.fn(),
  }),
}));
vi.mock('../../src/services/capture/captureService', () => ({ isTauriEnv: vi.fn().mockReturnValue(true) }));

const status = (runtimeAvailable: boolean): CleanupModelStatus => ({
  available: true, id: CLEANUP_MODEL_ID, runtimeAvailable, sha256: CLEANUP_MODEL_SHA256,
});
const store = (next: CleanupModelStatus): CleanupModelStore => ({
  status: vi.fn().mockResolvedValue(next),
});
const activeSettings = { cleanupEnabled: true, cleanupModelId: CLEANUP_MODEL_ID, cleanupOptIn: true };

function Start({ settings }: { settings?: Partial<Settings> }) {
  const { dispatch } = useApp();
  useEffect(() => {
    if (settings) dispatch({ onboardingComplete: true, settings: { ...initialSettings, ...settings }, type: 'hydrate-settings' });
  }, [dispatch, settings]);
  return null;
}

async function renderBoth(models: CleanupModelStore, settings?: Partial<Settings>) {
  renderWithApp(<>
    <Start settings={settings} />
    <HomeHero cleanupModelStore={models} isNative />
    <CaptureTab cleanupModelStore={models} onSetup={vi.fn()} />
  </>);
  await waitFor(() => expect(models.status).toHaveBeenCalledTimes(1));
  await act(async () => { await Promise.resolve(); });
}

const settingsHelp = () => screen.queryByText('Used by local cleanup');
const settingsHelpOff = () => screen.queryByText('Styles apply only when local cleanup is on.');
const styleControl = () => screen.getByRole('radiogroup', { name: /^Style preference/ });
const homePicker = () => screen.queryByRole('radiogroup', { name: 'Current writing style' });
const OFF_NOTE = 'Styles need local cleanup, which is off.';

describe('writing-style captions, production build', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('without a worker: no Home picker (BUS-229), no Settings cleanup caption, no block', async () => {
    vi.stubEnv('DEV', false);
    await renderBoth(store(status(false)));
    expect(homePicker()).not.toBeInTheDocument();
    expect(screen.queryByText(/Writing style ·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/local cleanup/)).not.toBeInTheDocument();
    expect(settingsHelp()).not.toBeInTheDocument();
    expect(styleControl()).toHaveAccessibleName('Style preference');
    expect(screen.queryByText('Local cleanup')).not.toBeInTheDocument();
  });

  it('while the status is unreadable: same as no worker', async () => {
    vi.stubEnv('DEV', false);
    const failing: CleanupModelStore = { status: vi.fn().mockRejectedValue(new Error('denied')) };
    await renderBoth(failing);
    expect(homePicker()).not.toBeInTheDocument();
    expect(settingsHelp()).not.toBeInTheDocument();
    expect(settingsHelpOff()).not.toBeInTheDocument();
  });

  it('with a worker, cleanup off: disabled Home picker with its note; Settings stays live', async () => {
    vi.stubEnv('DEV', false);
    await renderBoth(store(status(true)));
    // Home caption (the Capture row has its own "Writing style" label).
    expect(screen.getByText('Writing style', { selector: '.fine' })).toBeInTheDocument();
    expect(screen.getByText(OFF_NOTE)).toBeInTheDocument();
    expect(homePicker()).toHaveAttribute('aria-disabled', 'true');
    expect(settingsHelpOff()).toBeInTheDocument();
    expect(settingsHelp()).not.toBeInTheDocument();
    expect(styleControl()).toHaveAccessibleName('Style preference · applies only when local cleanup is on');
    expect(styleControl()).not.toHaveAttribute('aria-disabled');
    expect(screen.getByText('Local cleanup')).toBeInTheDocument();
  });

  it('cleanup already active without a worker: new wording on both, and the block', async () => {
    vi.stubEnv('DEV', false);
    await renderBoth(store(status(false)), activeSettings);
    expect(screen.getByText('Writing style · local cleanup on')).toBeInTheDocument();
    expect(homePicker()).not.toHaveAttribute('aria-disabled');
    expect(settingsHelp()).toBeInTheDocument();
    expect(styleControl()).toHaveAccessibleName('Style preference · used by local cleanup');
    expect(screen.getByText('Local cleanup')).toBeInTheDocument();
  });
});

describe('writing-style captions, dev build', () => {
  it('without a worker: new wording on both, and the block with its note', async () => {
    expect(import.meta.env.DEV).toBe(true);
    await renderBoth(store(status(false)));
    expect(screen.getByText(OFF_NOTE)).toBeInTheDocument();
    expect(homePicker()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('button', { name: 'Turn on local cleanup' })).not.toBeInTheDocument();
    expect(settingsHelpOff()).toBeInTheDocument();
    expect(screen.getByText(/doesn't include the cleanup worker yet/)).toBeInTheDocument();
  });
});

describe('one cleanup model status read per window', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });
  const statusCalls = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === 'cleanup_model_status').length;

  it('Home and Capture share one result; remounting Home reads nothing new', async () => {
    const models = store(status(true));
    const first = renderWithApp(<HomeHero cleanupModelStore={models} isNative />);
    await waitFor(() => expect(screen.getByText(OFF_NOTE)).toBeInTheDocument());
    first.unmount();
    // Back to Home (as after History or Dictionary), then Settings → Capture.
    renderWithApp(<>
      <HomeHero cleanupModelStore={models} isNative />
      <CaptureTab cleanupModelStore={models} onSetup={vi.fn()} />
    </>);
    expect(screen.getByText('Local cleanup')).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(models.status).toHaveBeenCalledOnce();
  });

  it('Check again in Capture re-reads once and updates Home too', async () => {
    vi.stubEnv('DEV', false);
    const user = userEvent.setup();
    const models = store(status(true));
    vi.mocked(models.status).mockResolvedValueOnce(status(true)).mockResolvedValueOnce(status(false));
    renderWithApp(<>
      <HomeHero cleanupModelStore={models} isNative />
      <CaptureTab cleanupModelStore={models} onSetup={vi.fn()} />
    </>);
    await user.click(await screen.findByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(homePicker()).not.toBeInTheDocument());
    expect(models.status).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Local cleanup')).not.toBeInTheDocument();
  });

  it('switching Settings tabs never triggers a new native status call', async () => {
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockImplementation(async (command: string) => (
      command === 'cleanup_model_status' ? status(true) : undefined) as never);
    const user = userEvent.setup();
    renderWithApp(<SettingsWindow onSetup={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Local cleanup')).toBeInTheDocument());
    for (const tab of ['Models', 'Privacy', 'Capture', 'Appearance', 'Capture']) {
      await user.click(screen.getByRole('tab', { name: tab }));
    }
    expect(screen.getByText('Local cleanup')).toBeInTheDocument();
    expect(statusCalls()).toBe(1);
  });
});
