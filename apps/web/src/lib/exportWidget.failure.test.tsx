import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { Toaster } from 'sonner';
import html2canvas from 'html2canvas';
import { exportToPNG } from './exportWidget';

/**
 * The PNG exporter must never hand out a file it could not produce correctly,
 * and the user must see why. These are asserted against rendered output (a real
 * sonner host) and the download path, not against internal mock calls.
 *
 * Static imports on purpose: the exporter and the toast host must share one
 * `sonner` instance, which a per-test module registry reset would split.
 */
jest.mock('html2canvas', () => ({ __esModule: true, default: jest.fn() }));

const html2canvasMock = html2canvas as jest.MockedFunction<typeof html2canvas>;

/** A clone document whose root carries the light palette, like html2canvas's. */
function lightClone() {
  const root = document.createElement('html');
  root.style.setProperty('--bg-primary', '#ffffff');
  const clone = { defaultView: document.defaultView, documentElement: root, body: document.body };
  return { documentClone: clone as unknown as Document, root };
}

describe('exportToPNG failures', () => {
  let originalCreate: typeof URL.createObjectURL;
  let originalRevoke: typeof URL.revokeObjectURL;
  let createObjectURL: jest.Mock;
  let click: jest.SpyInstance;
  // What the mocked encoder hands back; `null` models a browser that could not
  // encode the capture.
  let encoded: Blob | null;

  beforeEach(() => {
    encoded = new Blob(['png'], { type: 'image/png' });
    // jsdom has no 2D context, so the provenance strip falls back to the raw
    // capture; the encoder and object URLs are the observable download boundary.
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(encoded);
    });
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    createObjectURL = jest.fn(() => 'blob:test');
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = jest.fn();
    click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });
  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    jest.restoreAllMocks();
    jest.clearAllMocks();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark', 'light');
  });

  it('shows the chart refusal and downloads nothing', async () => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'dark');
    root.classList.add('dark');

    const widget = document.createElement('div');
    const host = document.createElement('div');
    host.setAttribute('data-light-chart-capture', '');
    widget.appendChild(host);
    document.body.appendChild(widget);
    host.addEventListener('vnibb:capture-light-chart', (event) => {
      // A real chart reports its throw here; `dispatchEvent` cannot rethrow.
      (event as CustomEvent<{ error?: unknown }>).detail.error = new Error('the chart screenshot is empty');
    });
    html2canvasMock.mockImplementation((_element, options) => {
      // html2canvas copies the page, then calls `onclone`; a throw there rejects.
      const { documentClone } = lightClone();
      options?.onclone?.(documentClone, widget.cloneNode(true) as HTMLElement);
      return Promise.resolve(document.createElement('canvas'));
    });

    const view = render(createElement(Toaster));
    try {
      expect(await exportToPNG(widget, 'chart', { sourceLabel: 'Price chart' })).toBe(false);

      const title = await screen.findByText('PNG export failed');
      expect(title.closest('[data-sonner-toast]')).not.toBeNull();
      // The chart's own reason reaches the user, not just a generic abort.
      expect(screen.getByText(/the chart screenshot is empty/)).toBeInTheDocument();
      // No artefact: the download path was never entered.
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
      // The live theme was never restyled.
      expect(root.getAttribute('data-theme')).toBe('dark');
      expect(root.classList.contains('dark')).toBe(true);
      expect(root.classList.contains('light')).toBe(false);
    } finally {
      view.unmount();
      widget.remove();
    }
  });

  it('shows an encode failure instead of downloading nothing silently', async () => {
    const widget = document.createElement('div');
    document.body.appendChild(widget);
    // The browser declined to encode the capture.
    encoded = null;
    html2canvasMock.mockImplementation(() => Promise.resolve(document.createElement('canvas')));

    const view = render(createElement(Toaster));
    try {
      expect(await exportToPNG(widget, 'encode', { sourceLabel: 'Market heatmap' })).toBe(false);

      const title = await screen.findByText('PNG export failed');
      expect(title.closest('[data-sonner-toast]')).not.toBeNull();
      expect(screen.getByText(/could not encode/)).toBeInTheDocument();
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      widget.remove();
    }
  });

  it('reports a missing widget instead of failing silently', async () => {
    const view = render(createElement(Toaster));
    try {
      expect(await exportToPNG('missing-widget', 'gone')).toBe(false);
      const title = await screen.findByText('PNG export failed');
      expect(title.closest('[data-sonner-toast]')).not.toBeNull();
      expect(screen.getByText(/missing-widget/)).toBeInTheDocument();
      expect(createObjectURL).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  // html2canvas appends one iframe per capture and removes it only on success.
  // Captures are serialized so a refusal cannot strip a running export's clone.
  it('does not strip a later export when an earlier one is refused', async () => {
    const failing = document.createElement('div');
    const succeeding = document.createElement('div');
    document.body.append(failing, succeeding);

    // The iframe stands in for the clone html2canvas appends for each capture.
    const cloneFor = (owner: 'failing' | 'succeeding') => {
      const frame = document.createElement('iframe');
      frame.className = 'html2canvas-container';
      frame.dataset.owner = owner;
      document.body.appendChild(frame);
    };
    const capturedOwners: string[] = [];
    html2canvasMock.mockImplementation((element) => {
      const owner = element === failing ? 'failing' : 'succeeding';
      cloneFor(owner);
      if (owner === 'failing') return Promise.reject(new Error('refused'));
      capturedOwners.push(owner);
      return Promise.resolve(document.createElement('canvas'));
    });

    const view = render(createElement(Toaster));
    try {
      const [failed, succeeded] = await Promise.all([
        exportToPNG(failing, 'first'),
        exportToPNG(succeeding, 'second'),
      ]);
      expect(failed).toBe(false);
      expect(succeeded).toBe(true);
      expect(capturedOwners).toEqual(['succeeding']);
      // The refusal cleaned up its own clone only.
      const owners = Array.from(document.querySelectorAll('iframe.html2canvas-container'))
        .map((frame) => (frame as HTMLElement).dataset.owner);
      expect(owners).toEqual(['succeeding']);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      for (const frame of document.querySelectorAll('iframe.html2canvas-container')) frame.remove();
      failing.remove();
      succeeding.remove();
    }
  });
});
