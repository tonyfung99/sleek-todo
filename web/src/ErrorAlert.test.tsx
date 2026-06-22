import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorAlert } from './ErrorAlert';

describe('ErrorAlert', () => {
  it('renders its message as an alert', () => {
    render(<ErrorAlert message="Unable to load your lists." />);

    expect(screen.getByRole('alert').textContent).toContain(
      'Unable to load your lists.',
    );
  });

  it('invokes retry and dismiss callbacks', () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ErrorAlert
        message="Unable to save your todo."
        onRetry={onRetry}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('omits actions when callbacks are absent', () => {
    render(<ErrorAlert message="Unable to connect." />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('applies the compact class only when requested', () => {
    const regular = render(<ErrorAlert message="Regular alert" />);
    expect(screen.getByRole('alert').classList.contains('error-alert-compact')).toBe(
      false,
    );

    regular.unmount();
    render(<ErrorAlert message="Compact alert" compact />);
    expect(screen.getByRole('alert').classList.contains('error-alert-compact')).toBe(
      true,
    );
  });
});
