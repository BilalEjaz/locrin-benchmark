import { ApiClient } from './ApiClient';
import {
  AuthResponse,
  RegisterResponse,
  PublicUser,
  TotpChallengeResponse,
  isTotpChallengeResponse,
} from '@blast-arena/shared';
import { i18n } from '../i18n';
import { API_URL } from '../config';

export type AuthChangeCallback = (user: PublicUser | null) => void;

export class AuthManager {
  private accessToken: string | null = null;
  private currentUser: PublicUser | null = null;
  private listeners: AuthChangeCallback[] = [];
  private _isGuest: boolean = false;
  private _loggingOut: boolean = false;
  private pendingTotpToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;

  constructor() {
    ApiClient.setAuthManager(this);
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  getUser(): PublicUser | null {
    return this.currentUser;
  }

  get isGuest(): boolean {
    return this._isGuest;
  }

  /** Set guest identity (assigned by server on openworld:join) */
  setGuestIdentity(id: number, username: string): void {
    this._isGuest = true;
    this.currentUser = {
      id,
      username,
      role: 'user',
      language: 'en',
      emailVerified: false,
      twoFactorEnabled: false,
    };
    this.notify();
  }

  clearGuest(): void {
    if (this._isGuest) {
      this._isGuest = false;
      this.currentUser = null;
      this.notify();
    }
  }

  onChange(callback: AuthChangeCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.currentUser);
    }
  }

  private setAuth(response: AuthResponse): void {
    this.accessToken = response.accessToken;
    this.currentUser = response.user;
    // Sync i18n language with user's stored preference
    if (response.user.language && response.user.language !== i18n.language) {
      i18n.changeLanguage(response.user.language);
    }
    this.notify();
  }

  async register(username: string, email: string, password: string): Promise<void> {
    // No auto-login: registration issues no session. The account must verify its email and then
    // log in. (audit EMAIL-005)
    await ApiClient.post<RegisterResponse>(
      '/auth/register',
      {
        username,
        email,
        password,
      },
      true,
    );
  }

  async login(username: string, password: string): Promise<'success' | 'totp-required'> {
    const response = await ApiClient.post<AuthResponse | TotpChallengeResponse>(
      '/auth/login',
      { username, password },
      true,
    );
    if (isTotpChallengeResponse(response)) {
      this.pendingTotpToken = response.totpToken;
      return 'totp-required';
    }
    this.setAuth(response);
    return 'success';
  }

  async verifyTotp(code: string): Promise<void> {
    if (!this.pendingTotpToken) throw new Error('No pending TOTP challenge');
    const response = await ApiClient.post<AuthResponse>(
      '/auth/verify-totp',
      { totpToken: this.pendingTotpToken, code },
      true,
    );
    this.pendingTotpToken = null;
    this.setAuth(response);
  }

  /**
   * Rotate the refresh cookie for a new access token. One refresh at a time — within this tab via
   * the shared promise, across tabs via a Web Lock: two requests presenting the same cookie look
   * like token reuse to the server, which then revokes every session of the account (two tabs
   * refreshing together after the machine woke up logged the user out everywhere).
   */
  refresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    const pending = this.lockedRefresh().finally(() => {
      this.refreshing = null;
    });
    this.refreshing = pending;
    return pending;
  }

  private async lockedRefresh(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.locks) return this.doRefresh();
    return await navigator.locks.request('blast-arena-auth-refresh', () => this.doRefresh());
  }

  private async doRefresh(): Promise<boolean> {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) return false;

      const data: AuthResponse = await response.json();
      this.setAuth(data);
      return true;
    } catch {
      return false;
    }
  }

  async logout(): Promise<void> {
    if (this._loggingOut) return;
    this._loggingOut = true;
    try {
      await ApiClient.post('/auth/logout', undefined, true);
    } catch {
      // Ignore errors during logout
    }
    this.accessToken = null;
    this.currentUser = null;
    this._loggingOut = false;
    this.notify();
  }

  updateUser(updates: Partial<PublicUser>): void {
    if (this.currentUser) {
      this.currentUser = { ...this.currentUser, ...updates };
      this.notify();
    }
  }

  async tryAutoLogin(): Promise<boolean> {
    return this.refresh();
  }
}
