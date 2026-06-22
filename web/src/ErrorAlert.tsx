import { WarningIcon } from './icons';

type ErrorAlertProps = {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
};

export function ErrorAlert({
  message,
  onRetry,
  onDismiss,
  compact = false,
}: ErrorAlertProps) {
  const hasActions = Boolean(onRetry || onDismiss);

  return (
    <div
      className={`error-alert${compact ? ' error-alert-compact' : ''}`}
      role="alert"
    >
      <WarningIcon className="error-alert-icon" />
      <div className="error-alert-message">{message}</div>
      {hasActions && (
        <div className="error-alert-actions">
          {onRetry && (
            <button className="btn-link" type="button" onClick={onRetry}>
              Try again
            </button>
          )}
          {onDismiss && (
            <button className="btn-link" type="button" onClick={onDismiss}>
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
