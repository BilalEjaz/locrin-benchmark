import { render, screen } from '../../test/render';
import { Alert, AlertDescription } from './alert';

describe('Alert', () => {
  it('is an alert region without the caller adding a role', async () => {
    await render(
      <Alert variant="destructive" testID="alert">
        <AlertDescription>Could not save.</AlertDescription>
      </Alert>
    );

    // A role query needs an accessibility element, and the container must stay
    // non-accessible so buttons inside it remain reachable on iOS; read the props.
    const alert = screen.getByTestId('alert');
    expect(alert.props.accessibilityRole).toBe('alert');
    expect(alert.props.accessibilityLiveRegion).toBe('polite');
  });

  it('lets the caller choose a different role', async () => {
    await render(
      <Alert accessibilityRole="none" testID="note">
        <AlertDescription>Tip</AlertDescription>
      </Alert>
    );

    expect(screen.getByTestId('note').props.accessibilityRole).toBe('none');
  });
});
