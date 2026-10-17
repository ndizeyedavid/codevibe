# Dashboard Loading Recovery

## Goal

Prevent the CodeVibe dashboard from remaining on its loading state when the data request fails or never settles, while preserving the successful dashboard behavior used by the 0.1.10-era flow.

## Design

- Start the initial dashboard load immediately when the webview is resolved; automatic refreshes remain debounced.
- Bound each dashboard data load with a 15-second timeout.
- Preserve the existing `updateData` message and dashboard rendering path on success.
- Send a useful `error` message on rejection or timeout, including the failing load context in the extension log.
- Render a safe in-webview error state with a retry action. Retrying clears the error state, shows loading feedback, and requests an immediate provider refresh.
- Keep the provider's existing error boundary so repository failures cannot leave the webview waiting indefinitely.

## Testing

- Provider tests cover immediate initial loading, successful updates, rejected loads, and timeout handling.
- Webview source tests cover the retry action and error-state rendering contract.
- Run the focused dashboard tests, then compile and lint.
