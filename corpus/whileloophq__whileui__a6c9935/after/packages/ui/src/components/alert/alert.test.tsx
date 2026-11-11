import { AccessibilityInfo, Platform } from 'react-native';
import { render, screen } from '../../test/render';
import { Alert, AlertDescription, AlertTitle } from './alert';

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

  describe('on iOS, which has no live regions', () => {
    const original = Platform.OS;
    let announce: jest.SpyInstance;
    beforeEach(() => {
      Platform.OS = 'ios';
      announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    });
    afterEach(() => {
      Platform.OS = original;
      announce.mockRestore();
    });

    it('speaks an announced alert once, title then description', async () => {
      const view = await render(
        <Alert variant="destructive" announce>
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>Check your connection.</AlertDescription>
        </Alert>
      );
      await view.rerender(
        <Alert variant="destructive" announce>
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>Check your connection.</AlertDescription>
        </Alert>
      );

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith('Could not save. Check your connection.');
    });

    it('stays quiet by default, so alerts in a screen are not read on every visit', async () => {
      await render(
        <Alert>
          <AlertDescription>Your plan renews tomorrow.</AlertDescription>
        </Alert>
      );

      expect(announce).not.toHaveBeenCalled();
    });
  });
});
