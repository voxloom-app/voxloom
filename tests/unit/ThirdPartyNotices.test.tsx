import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AppProvider } from '../../src/app/AppContext';
import { Settings } from '../../src/features/settings/Settings';

const noticePath = 'src-tauri/licenses/insertion/THIRD-PARTY-NOTICES.txt';

function renderSettings() {
  render(
    <div id="root">
      <AppProvider>
        <Settings initialTab="appearance" onSetup={() => {}} />
      </AppProvider>
    </div>,
  );
}

describe('Third-party notices', () => {
  it('opens the bundled notices from Privacy with keyboard access and restores focus', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole('tab', { name: 'Privacy' }));
    const opener = screen.getByRole('button', { name: 'Third-Party Notices' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    opener.focus();
    await user.keyboard('{Enter}');

    const dialog = screen.getByRole('dialog', { name: 'Third-Party Notices' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { name: 'Third-Party Notices' })).toBeVisible();
    const text = within(dialog).getByRole('region', { name: 'License texts' });
    expect(text.textContent).toBe(readFileSync(noticePath, 'utf8'));
    expect(text).toHaveStyle({ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
    expect(text).toHaveAttribute('tabindex', '0');
    expect(text.textContent).toContain('Copyright (c) 2025 CJ Pais');
    expect(text.textContent).toContain('Copyright (c) 2024 OpenSuperWhisper');

    const close = within(dialog).getByRole('button', { name: 'Close Third-Party Notices' });
    expect(close).toHaveFocus();
    await user.tab();
    expect(text).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Done' })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Close Third-Party Notices' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('packages both complete pinned MIT licenses with their modified-source provenance', () => {
    const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
    const resource = 'licenses/insertion/THIRD-PARTY-NOTICES.txt';
    expect(config.bundle.resources[resource]).toBe(resource);
    const notice = readFileSync(noticePath, 'utf8');
    const licenses = notice.match(/MIT License\n\nCopyright[\s\S]*?SOFTWARE\./g) ?? [];
    expect(licenses).toHaveLength(2);
    // SHA-256 of the unmodified LICENSE bytes at the recorded upstream revisions.
    const donors = [
      {
        repository: 'cjpais/Handy',
        revision: '4807c21a7bb9a3bf2d52578a9b541e165b6bc8b9',
        source: 'src-tauri/src/input.rs',
        licenseFinalNewline: '\n',
        licenseHash: '3564e8ec14055ed54f896e8660a62627ea4fc3a1b64f72b798593df00e1f4edc',
      },
      {
        repository: 'Starmel/OpenSuperWhisper',
        revision: 'c8e6fe79d6851078940f459ab7dbc8ee39e2a97d',
        source: 'OpenSuperWhisper/Utils/ClipboardUtil.swift',
        licenseFinalNewline: '',
        licenseHash: 'ea168b4e84c58baf90c016718a90ae874b43a7473318fad6e4d83db5b0d65155',
      },
    ];
    donors.forEach((donor, index) => {
      const pinned = `https://github.com/${donor.repository}/blob/${donor.revision}`;
      expect(notice).toContain(`Revision: ${donor.revision}`);
      expect(notice).toContain(`Pinned source: ${pinned}/${donor.source}`);
      expect(notice).toContain(`License source: ${pinned}/LICENSE`);
      const upstreamLicense = licenses[index] + donor.licenseFinalNewline;
      expect(createHash('sha256').update(upstreamLicense).digest('hex')).toBe(donor.licenseHash);
    });
    expect(notice).toContain('Modifications: Command-modified keyboard-layout scanning');
    expect(notice).toContain('Modifications: The 1500 ms delayed, clipboard-generation-guarded restoration');
  });
});
