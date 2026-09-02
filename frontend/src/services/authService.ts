// Authentication service for Microsoft 365 and manual login
// This demonstrates how to integrate with Microsoft Graph API and your backend API

import { PublicClientApplication, AccountInfo, AuthenticationResult } from '@azure/msal-browser';
import ApiService, { type LoginRequest } from './apiService';
import JWTUtils from '../utils/jwtUtils';
import { type User } from '../types/user';

interface LoginCredentials {
  username: string;
  password: string; // Should be base64 encoded when using real API
}


interface MicrosoftUser {
  id: string;
  displayName: string;
  mail: string;
  userPrincipalName: string;
}

// Microsoft Graph Authentication Service
export class MicrosoftAuthService {
  private static msalInstance: PublicClientApplication | null = null;
  private static isInitialized: boolean = false;

  // MSAL configuration
  private static readonly msalConfig = {
    auth: {
      clientId: process.env.REACT_APP_AZURE_CLIENT_ID || '',
      authority: process.env.REACT_APP_AZURE_TENANT_ID 
        ? `https://login.microsoftonline.com/${process.env.REACT_APP_AZURE_TENANT_ID}`
        : 'https://login.microsoftonline.com/common',
      redirectUri: process.env.REACT_APP_REDIRECT_URI || window.location.origin,
    },
    cache: {
      cacheLocation: 'localStorage' as const,
      storeAuthStateInCookie: false,
    },
  };

  // Microsoft Graph scopes
  private static readonly graphScopes = [
    'user.read',
    'profile',
    'openid',
    'email'
  ];

  /**
   * Initialize MSAL instance
   */
  static async initialize(): Promise<PublicClientApplication> {
    if (!this.msalInstance || !this.isInitialized) {
      this.msalInstance = new PublicClientApplication(this.msalConfig);
      await this.msalInstance.initialize();
      this.isInitialized = true;
    }
    return this.msalInstance;
  }

  /**
   * Sign in with Microsoft 365
   */
  static async signIn(): Promise<AuthenticationResult> {
    const msalInstance = await this.initialize();

    try {
      const loginRequest = {
        scopes: this.graphScopes,
        prompt: 'select_account' as const,
      };

      const response = await msalInstance.loginPopup(loginRequest);
      return response;
    } catch (error) {
      console.error('❌ Microsoft sign-in error:', error);
      if (error instanceof Error) {
        // Provide more specific error messages
        if (error.message.includes('popup')) {
          throw new Error('Popup was blocked. Please allow popups for this site and try again.');
        } else if (error.message.includes('user_cancelled')) {
          throw new Error('Sign-in was cancelled by the user.');
        } else if (error.message.includes('consent_required')) {
          throw new Error('Administrator consent is required. Please contact your administrator.');
        }
      }
      throw error;
    }
  }

  /**
   * Sign out from Microsoft 365
   */
  static async signOut(): Promise<void> {
    const msalInstance = await this.initialize();
    
    try {
      const accounts = msalInstance.getAllAccounts();
      
      // Always clear MSAL cache manually to ensure complete logout
      // MSAL stores cache with keys like 'msal.{clientId}.{cacheKey}'
      const clientId = this.msalConfig.auth.clientId;
      const cacheKeys = Object.keys(localStorage);
      cacheKeys.forEach(key => {
        if (key.includes(`msal.${clientId}`) || key.startsWith('msal.')) {
          localStorage.removeItem(key);
        }
      });
      
      // Also clear from sessionStorage
      const sessionCacheKeys = Object.keys(sessionStorage);
      sessionCacheKeys.forEach(key => {
        if (key.includes(`msal.${clientId}`) || key.startsWith('msal.')) {
          sessionStorage.removeItem(key);
        }
      });
      
      // Try to logout from Microsoft if accounts exist
      if (accounts.length > 0) {
        try {
          // Use logoutPopup to sign out from Microsoft
          // Note: This might show a popup, but it ensures proper logout from Microsoft's side
          await msalInstance.logoutPopup({
            account: accounts[0],
          });
        } catch (popupError) {
          // If popup fails (e.g., blocked), try silent logout by clearing cache only
          console.warn('Logout popup failed, using cache clearing only:', popupError);
          // Cache is already cleared above, so we're done
        }
      }
    } catch (error) {
      console.error('Microsoft sign-out error:', error);
      // Even if logout fails, ensure MSAL cache is cleared
      try {
        const clientId = this.msalConfig.auth.clientId;
        const cacheKeys = Object.keys(localStorage);
        cacheKeys.forEach(key => {
          if (key.includes(`msal.${clientId}`) || key.startsWith('msal.')) {
            localStorage.removeItem(key);
          }
        });
        const sessionCacheKeys = Object.keys(sessionStorage);
        sessionCacheKeys.forEach(key => {
          if (key.includes(`msal.${clientId}`) || key.startsWith('msal.')) {
            sessionStorage.removeItem(key);
          }
        });
      } catch (clearError) {
        console.error('Error clearing MSAL cache:', clearError);
      }
      // Don't throw error - we've cleared the cache, which is the important part
    }
  }

  /**
   * Get current Microsoft user account
   */
  static async getCurrentAccount(): Promise<AccountInfo | null> {
    const msalInstance = await this.initialize();
    const accounts = msalInstance.getAllAccounts();
    return accounts.length > 0 ? accounts[0] : null;
  }

  /**
   * Get access token for Microsoft Graph
   */
  static async getAccessToken(): Promise<string> {
    const msalInstance = await this.initialize();
    const account = await this.getCurrentAccount();

    if (!account) {
      throw new Error('No active account found');
    }

    try {
      // Try to acquire token silently first
      const response = await msalInstance.acquireTokenSilent({
        scopes: this.graphScopes,
        account: account,
      });

      return response.accessToken;
    } catch (error: any) {
      console.error('Token acquisition error:', error);
      
      // If silent token acquisition fails with interaction_required or other errors,
      // fall back to interactive authentication
      if (error.errorCode === 'interaction_required' || 
          error.errorCode === 'consent_required' ||
          error.errorCode === 'login_required' ||
          error.message?.includes('interaction_required') ||
          error.message?.includes('AADSTS160021') ||
          error.message?.includes('AADSTS50058')) {
        console.log('🔄 Silent token acquisition failed, falling back to interactive authentication...');
        
        try {
          // Fall back to popup-based interactive authentication
          const interactiveResponse = await msalInstance.acquireTokenPopup({
            scopes: this.graphScopes,
            account: account,
          });
          
          return interactiveResponse.accessToken;
        } catch (popupError) {
          console.error('Interactive token acquisition error:', popupError);
          throw new Error('Failed to acquire token. Please try logging in again.');
        }
      }
      
      // For other errors, re-throw as-is
      throw error;
    }
  }

  /**
   * Get Microsoft user profile from Graph API
   * @param accessToken Optional access token. If not provided, will acquire one automatically.
   */
  static async getUserProfile(accessToken?: string): Promise<MicrosoftUser> {
    try {
      // Use provided token or acquire one
      const token = accessToken || await this.getAccessToken();
      
      const response = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch user profile: ${response.status} ${response.statusText}`);
      }

      const user = await response.json();
      
      return {
        id: user.id,
        displayName: user.displayName,
        mail: user.userPrincipalName || user.mail, // Prioritize userPrincipalName (login email) over mail (alias)
        userPrincipalName: user.userPrincipalName,
      };
    } catch (error) {
      console.error('Error fetching user profile:', error);
      throw error;
    }
  }

  /**
   * Check if user is authenticated with Microsoft
   */
  static async isAuthenticated(): Promise<boolean> {
    try {
      const account = await this.getCurrentAccount();
      return account !== null;
    } catch (error) {
      console.error('Error checking authentication status:', error);
      return false;
    }
  }
}

export class AuthService {
  /**
   * Authenticate user with username and password
   */
  static async login(credentials: LoginCredentials): Promise<{ user: User; token: string; expiresIn: number }> {
    try {
      const response = await ApiService.login(credentials as LoginRequest);

      if (!response.success || !response.token) {
        console.error('Login failed:', response.message || response.error);
        throw new Error(response.message || response.error || 'Invalid username or password');
      }

      // Debug
      console.log("JWT Token:", response.token);

      const userFromToken = JWTUtils.getUserFromToken(response.token);

      console.log("Decoded User:", userFromToken);

      if (!userFromToken) {
        throw new Error('Invalid token received from server');
      }

      // Convert API user format to our User interface
      const user: User = {
        id: userFromToken.id,
        name: userFromToken.name,
        email: userFromToken.email,
        title: userFromToken.title,
        designation: userFromToken.designation || undefined,
        department: userFromToken.department || undefined,
        employeeId: userFromToken.employee_id || undefined,
        hasTeam: userFromToken.has_team || false,
        isHR: userFromToken.is_hr || false,
        isCDO: userFromToken.is_cdo || false,
        role: userFromToken.role || userFromToken.role_id || 'user',
        view: userFromToken.view,
        edit: userFromToken.edit,
        settings: userFromToken.settings,
        authMethod: 'manual'
      };

      return {
        user,
        token: response.token,
        expiresIn: response.expires_in || 10 * 365 * 24 * 60 * 60 // Matches the backend's long-lived token; the 1-hour inactivity timeout is what actually ends a session
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      // ApiService.makeRequest throws a plain ApiError object (not instanceof Error) on HTTP errors
      if (error && typeof error === 'object') {
        const e = error as { message?: string; data?: { error?: unknown; message?: unknown } };
        const str = (v: unknown): string => {
          if (v == null) return '';
          const s = typeof v === 'string' ? v : String(v);
          return s.trim();
        };
        const data = e.data;
        const fromApi =
          str(data?.error) || str(data?.message) || str(e.message);
        if (fromApi) {
          throw new Error(fromApi);
        }
      }
      throw new Error('Network error occurred during authentication');
    }
  }

  /**
   * Get user profile information from JWT token
   */
  static async getProfile(token: string): Promise<User> {
    try {
      const userFromToken = JWTUtils.getUserFromToken(token);
      if (!userFromToken) {
        throw new Error('Invalid token or unable to decode user information');
      }

      return {
        id: userFromToken.id,
        name: userFromToken.name,
        email: userFromToken.email,
        title: userFromToken.title,
        role: userFromToken.role || userFromToken.role_id || 'user',
        view: userFromToken.view,
        edit: userFromToken.edit,
        settings: userFromToken.settings,
        authMethod: 'manual'
      };
    } catch (error) {
      throw new Error('Failed to load user profile');
    }
  }
}

export default AuthService;