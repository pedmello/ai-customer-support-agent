// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PendingIndicator } from './PendingIndicator';

afterEach(() => { cleanup(); vi.useRealTimers(); });
it.each(['Resultado disponível', 'Falha na consulta'])('keeps only the visual indicator briefly, without hiding %s or locking a completed action', result => {
  vi.useFakeTimers();
  const view = render(<><button disabled>Consulta</button><PendingIndicator key="pending" active label="Consultando" /></>);
  expect(screen.getByRole('status').textContent).toContain('Consultando');
  act(() => { vi.advanceTimersByTime(40); });
  view.rerender(<><button>Consulta</button><p>{result}</p><PendingIndicator key="pending" active={false} label="Consultando" /></>);
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText(result)).toBeTruthy();
  expect(screen.getByRole('status')).toBeTruthy();
  act(() => { vi.advanceTimersByTime(200); });
  expect(screen.queryByRole('status')).toBeNull();
});
it('does not extend an already long operation and cleans up a pending timer', () => {
  vi.useFakeTimers();
  const view = render(<PendingIndicator active label="Carregando" />);
  act(() => { vi.advanceTimersByTime(1000); });
  view.rerender(<PendingIndicator active={false} label="Carregando" />);
  expect(screen.queryByRole('status')).toBeNull();
  view.rerender(<PendingIndicator active label="Carregando" />);
  view.rerender(<PendingIndicator active={false} label="Carregando" />);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
