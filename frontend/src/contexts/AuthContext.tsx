import React, { createContext, useContext, useEffect, useLayoutEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { MicrosoftAuthService, AuthService } from '../services/authService';
import ApiService from '../services/apiService';
import JWTUtils from '../utils/jwtUtils';
import {
  INACTIVITY_TIMEOUT_MS,
  isSessionTimedOut,
  clearSessionCredentials,
  redirectToLoginAfterTimeout,
} from '../utils/sessionTimeout';
import { type User, type AuthState, type AuthContextType } from '../types/user';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const location = useLocation();
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    user: null
  });
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const INACTIVITY_TIMEOUT = INACTIVITY_TIMEOUT_MS;

  // Redirect before child useEffects run (e.g. dashboard/edit API fetches on refresh).
  useLayoutEffect(() => {
    if (isSessionTimedOut()) {
      redirectToLoginAfterTimeout();
    }
  }, []);

  // Check if current route is a public route (no authentication required)
  const isPublicRoute = useCallback((pathname: string): boolean => {
    // Keep in sync with the routes outside ProtectedLayout in App.tsx.
    const publicRoutes = [
      '/login',
      '/login/callback',
    ];

    const path = pathname.toLowerCase();
    return publicRoutes.some((route) => path.startsWith(route.toLowerCase()));
  }, []);

  // Check for existing manual login session
  const checkManualAuth = async (): Promise<User | null> => {
        // Use sessionStorage instead of localStorage so session clears when tab closes
        const authToken = sessionStorage.getItem('authToken') || localStorage.getItem('authToken');
        
        if (authToken) {
          try {
            // Structural/expiry check FIRST (real signature verification only
            // happens server-side, on every authenticated request)
            const isTokenValid = JWTUtils.isTokenStructurallyValid(authToken);
            if (!isTokenValid) {
              console.log('🔐 Token invalid or expired, clearing stored credentials');
              sessionStorage.removeItem('authToken');
              localStorage.removeItem('authToken');
              sessionStorage.removeItem('manualAuthUser');
              localStorage.removeItem('manualAuthUser');
              sessionStorage.removeItem('lastActivity');
              localStorage.removeItem('lastActivity');
              return null;
            }

            // Note: Session timeout is now checked in initAuth before calling checkManualAuth
            // So we don't need to check it here to avoid duplicate logic

            // Always try to get fresh data from token first, then fallback to stored user
            const flatClaims = JWTUtils.getFlatClaims(authToken);
        
         if (flatClaims && flatClaims.email && flatClaims.name) {
           const user: User = {
             id: flatClaims.user_id || 'unknown',
             name: flatClaims.name,
             email: flatClaims.email,
             title: (flatClaims as any).title || 'User',
             designation: (flatClaims as any).designation || undefined,
             department: (flatClaims as any).department || undefined,
             employeeId: (flatClaims as any).employee_id || undefined,
             hasTeam: (flatClaims as any).has_team || false,
             isHR: (flatClaims as any).is_hr || false,
             isCDO: (flatClaims as any).is_cdo || false,
             role: (flatClaims as any).role || 'user', // Use mapped role name from JWT
             view: (flatClaims as any).view || true, // Permissions are at root level in JWT
             edit: (flatClaims as any).edit || true,
             settings: (flatClaims as any).settings || true,
             authMethod: 'manual'
           };
          
          
          // Store the fresh user data (prefer sessionStorage)
          sessionStorage.setItem('manualAuthUser', JSON.stringify(user));
          localStorage.setItem('manualAuthUser', JSON.stringify(user));
          return user;
        }

        // Fallback to stored user if token extraction fails
        const storedUser = sessionStorage.getItem('manualAuthUser') || localStorage.getItem('manualAuthUser');
        if (storedUser) {
          const user = JSON.parse(storedUser);
          return user;
        }

      } catch (error) {
        // Clear invalid stored data
        sessionStorage.removeItem('manualAuthUser');
        localStorage.removeItem('manualAuthUser');
        sessionStorage.removeItem('authToken');
        localStorage.removeItem('authToken');
      }
    }
    return null;
  };

  const logout = useCallback(async () => {
    try {
      // Clear manual auth data from both sessionStorage and localStorage
      sessionStorage.removeItem('authToken');
      localStorage.removeItem('authToken');
      sessionStorage.removeItem('manualAuthUser');
      localStorage.removeItem('manualAuthUser');
      sessionStorage.removeItem('lastActivity');
      localStorage.removeItem('lastActivity');
      
      // Sign out from Microsoft if authenticated via Microsoft
      if (authState.user?.authMethod === 'microsoft') {
        try {
          await MicrosoftAuthService.signOut();
        } catch (msalError) {
          console.error('Microsoft logout error:', msalError);
          // Continue with logout even if Microsoft signOut fails
          // The cache clearing in signOut should still work
        }
      }
      
      // Clear auth state and redirect
      setAuthState({
        isAuthenticated: false,
        isLoading: false,
        user: null
      });
      
      // Small delay to ensure state is cleared before redirect
      setTimeout(() => {
        window.location.href = '/login';
      }, 100);
    } catch (error) {
      // Force logout by clearing everything
      sessionStorage.removeItem('authToken');
      localStorage.removeItem('authToken');
      sessionStorage.removeItem('manualAuthUser');
      localStorage.removeItem('manualAuthUser');
      sessionStorage.removeItem('lastActivity');
      localStorage.removeItem('lastActivity');
      
      // Also clear MSAL cache manually as fallback
      try {
        const cacheKeys = Object.keys(localStorage);
        cacheKeys.forEach(key => {
          if (key.startsWith('msal.')) {
            localStorage.removeItem(key);
          }
        });
        const sessionCacheKeys = Object.keys(sessionStorage);
        sessionCacheKeys.forEach(key => {
          if (key.startsWith('msal.')) {
            sessionStorage.removeItem(key);
          }
        });
      } catch (clearError) {
        console.error('Error clearing MSAL cache:', clearError);
      }
      
      setAuthState({
        isAuthenticated: false,
        isLoading: false,
        user: null
      });
      
      setTimeout(() => {
        window.location.href = '/login';
      }, 100);
    }
  }, [authState.user?.authMethod]);

  // Expose initAuth for manual refresh
  const initAuth = useCallback(async () => {
    try {
      // Skip authentication checks for public routes
      if (isSessionTimedOut()) {
        clearSessionCredentials();
        setAuthState({
          isAuthenticated: false,
          isLoading: false,
          user: null
        });
        window.location.replace('/login');
        return;
      }

      if (isPublicRoute(location.pathname)) {
        setAuthState({
          isAuthenticated: false,
          isLoading: false,
          user: null
        });
        return;
      }

      // First check for manual authentication
      const manualUser = await checkManualAuth();
      if (manualUser) {
        // Update last activity when authentication succeeds
        const now = Date.now().toString();
        sessionStorage.setItem('lastActivity', now);
        localStorage.setItem('lastActivity', now);
        setAuthState({
          isAuthenticated: true,
          isLoading: false,
          user: manualUser
        });
        return;
      }

      // Then check Microsoft authentication
      const isMicrosoftAuthenticated = await MicrosoftAuthService.isAuthenticated();
      if (isMicrosoftAuthenticated) {
        try {
          // Get current Microsoft user profile first to verify identity
          const microsoftUser = await MicrosoftAuthService.getUserProfile();
          const currentMicrosoftEmail = microsoftUser.mail || microsoftUser.userPrincipalName;
          
          // First check if we have a stored backend token (from previous Microsoft login)
          const storedToken = sessionStorage.getItem('authToken') || localStorage.getItem('authToken');
          const storedUser = sessionStorage.getItem('manualAuthUser') || localStorage.getItem('manualAuthUser');
          
          if (storedToken && storedUser) {
            // Verify token is still valid
            const isTokenValid = JWTUtils.isTokenStructurallyValid(storedToken);
            if (isTokenValid) {
              // Extract email from stored token to verify it matches current Microsoft user
              const storedTokenClaims = JWTUtils.getFlatClaims(storedToken);
              const storedTokenEmail = storedTokenClaims?.email || '';
              
              // Verify the stored token's email matches the current Microsoft user's email
              if (storedTokenEmail.toLowerCase() === currentMicrosoftEmail.toLowerCase()) {
                // Use stored token and user (from previous Microsoft login that exchanged for backend token)
                const user = JSON.parse(storedUser);
                const now = Date.now().toString();
                sessionStorage.setItem('lastActivity', now);
                localStorage.setItem('lastActivity', now);
                setAuthState({
                  isAuthenticated: true,
                  isLoading: false,
                  user: user
                });
                return;
              } else {
                // Email mismatch - clear stored data and fetch fresh token
                console.log('🔐 Email mismatch detected. Stored:', storedTokenEmail, 'Current Microsoft:', currentMicrosoftEmail);
                sessionStorage.removeItem('authToken');
                localStorage.removeItem('authToken');
                sessionStorage.removeItem('manualAuthUser');
                localStorage.removeItem('manualAuthUser');
              }
            }
          }
          
          // If no valid stored token or email mismatch, try to exchange Microsoft auth for backend token
          try {
            const response = await ApiService.microsoftLogin({
              email: microsoftUser.mail || microsoftUser.userPrincipalName,
              name: microsoftUser.displayName,
              id: microsoftUser.id
            });
            
            if (response.success && response.token) {
              // Verify the token
              const isTokenValid = JWTUtils.isTokenStructurallyValid(response.token);
              if (isTokenValid) {
                // Extract user info from JWT token
                const flatClaims = JWTUtils.getFlatClaims(response.token);
                if (flatClaims && flatClaims.email) {
                  const user: User = {
                    id: flatClaims.user_id || microsoftUser.id,
                    name: flatClaims.name || microsoftUser.displayName,
                    email: flatClaims.email || microsoftUser.mail || microsoftUser.userPrincipalName,
                    title: (flatClaims as any).title || 'Microsoft User',
                    role: (flatClaims as any).role || 'user',
                    view: (flatClaims as any).view || true,
                    edit: (flatClaims as any).edit || false,
                    settings: (flatClaims as any).settings || false,
                    authMethod: 'microsoft'
                  };
                  
                  // Store token and user
                  sessionStorage.setItem('authToken', response.token);
                  localStorage.setItem('authToken', response.token);
                  sessionStorage.setItem('manualAuthUser', JSON.stringify(user));
                  localStorage.setItem('manualAuthUser', JSON.stringify(user));
                  
                  const now = Date.now().toString();
                  sessionStorage.setItem('lastActivity', now);
                  localStorage.setItem('lastActivity', now);
                  setAuthState({
                    isAuthenticated: true,
                    isLoading: false,
                    user: user
                  });
                  return;
                }
              }
            }
          } catch (apiError) {
            // If backend token exchange fails, fall back to Microsoft-only auth (APIs won't work)
            console.warn('Backend token exchange failed, using Microsoft-only auth:', apiError);
          }
          
          // Fallback: Use Microsoft user info without backend token (APIs won't work)
          const user: User = {
            id: microsoftUser.id,
            name: microsoftUser.displayName,
            email: microsoftUser.mail || microsoftUser.userPrincipalName,
            title: 'Microsoft User',
            role: 'User',
            view: true,
            edit: false,
            settings: false,
            authMethod: 'microsoft'
          };
          const now = Date.now().toString();
          sessionStorage.setItem('lastActivity', now);
          localStorage.setItem('lastActivity', now);
          setAuthState({
            isAuthenticated: true,
            isLoading: false,
            user: user
          });
        } catch (error) {
          // If we can't get the user profile, treat as not authenticated
          setAuthState({
            isAuthenticated: false,
            isLoading: false,
            user: null
          });
        }
      } else {
        setAuthState(prevState => {
          // Only update if the state actually changed
          if (prevState.isAuthenticated !== false || prevState.isLoading !== false) {
            return {
              isAuthenticated: false,
              isLoading: false,
              user: null
            };
          }
          return prevState;
        });
      }
    } catch (error) {
      setAuthState(prevState => {
        // Only update if the state actually changed
        if (prevState.isAuthenticated !== false || prevState.isLoading !== false) {
          return {
            isAuthenticated: false,
            isLoading: false,
            user: null
          };
        }
        return prevState;
      });
    }
  }, [location.pathname, isPublicRoute]);

  // Debounce ref for updateLastActivity to prevent excessive updates from mousemove
  const updateLastActivityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const DEBOUNCE_DELAY = 5000; // Only update lastActivity every 5 seconds max

  // Update last activity timestamp
  const updateLastActivity = useCallback(() => {
    if (authState.isAuthenticated) {
      // Clear existing debounce timeout
      if (updateLastActivityTimeoutRef.current) {
        clearTimeout(updateLastActivityTimeoutRef.current);
      }
      
      // Set new debounced update
      updateLastActivityTimeoutRef.current = setTimeout(() => {
        sessionStorage.setItem('lastActivity', Date.now().toString());
        localStorage.setItem('lastActivity', Date.now().toString());
        
        // Clear existing timer and reset it
        if (inactivityTimerRef.current) {
          clearTimeout(inactivityTimerRef.current);
        }
        updateLastActivityTimeoutRef.current = null;
      }, DEBOUNCE_DELAY);
    }
  }, [authState.isAuthenticated]);

  // Activity event handlers
  useEffect(() => {
    // Skip session timeout checks for public routes
    if (isPublicRoute(location.pathname)) {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      return;
    }

    if (!authState.isAuthenticated) {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      return;
    }

    // Initialize last activity on mount
    updateLastActivity();

    // List of events that indicate user activity
    // Note: mousemove is excluded to prevent constant timer resets from minor mouse movements
    // Only track intentional user actions
    const activityEvents = [
      'mousedown',
      'keypress',
      'scroll',
      'touchstart',
      'click',
      'keydown',
      'wheel'
    ];

    // Add event listeners
    activityEvents.forEach(event => {
      window.addEventListener(event, updateLastActivity, true);
    });

    // Check inactivity periodically
    const checkInterval = setInterval(() => {
      if (authState.isAuthenticated && isSessionTimedOut()) {
        redirectToLoginAfterTimeout();
      }
    }, 1000); // Check every second

    // Cleanup
    return () => {
      activityEvents.forEach(event => {
        window.removeEventListener(event, updateLastActivity, true);
      });
      clearInterval(checkInterval);
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
      if (updateLastActivityTimeoutRef.current) {
        clearTimeout(updateLastActivityTimeoutRef.current);
        updateLastActivityTimeoutRef.current = null;
      }
    };
  }, [authState.isAuthenticated, updateLastActivity, logout, location.pathname, isPublicRoute, INACTIVITY_TIMEOUT]);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // Note: We do NOT clear localStorage on pagehide/pageunload because:
  // 1. sessionStorage already clears automatically when tab closes
  // 2. localStorage should persist across page navigations and reloads
  // 3. Token should only be cleared on explicit logout or session timeout
  // This allows forms opened in new tabs to access the token even after page reloads

  const login = async () => {
    try {
      // Step 1: Authenticate with Microsoft
      const authResult = await MicrosoftAuthService.signIn();

      // Get the account info from MSAL to see what email was actually used to log in
      const msalAccount = authResult.account;
      const loginEmail = msalAccount?.username || msalAccount?.name;

      // Step 2: Get Microsoft user profile using the token from sign-in result
      // This avoids calling getAccessToken() again which could fail with interaction_required
      const microsoftUser = await MicrosoftAuthService.getUserProfile(authResult.accessToken);

      // Determine which email to use
      // CRITICAL: If login email differs from Graph API email, use login email (alias scenario)
      const graphEmail = microsoftUser.mail || microsoftUser.userPrincipalName;
      let emailToSend = graphEmail;

      if (loginEmail && loginEmail.toLowerCase() !== graphEmail.toLowerCase()) {
        // Alias scenario: the address used to sign in differs from the Graph
        // API's own record of the user's email — send the login alias rather
        // than the Graph email so the backend resolves the same account the
        // user actually authenticated as.
        emailToSend = loginEmail;
      }

      // Step 3: Exchange Microsoft authentication for backend JWT token (same as manual login)
      try {
        const response = await ApiService.microsoftLogin({
          email: emailToSend, // Use selected email (alias if detected, otherwise Graph API email)
          name: microsoftUser.displayName,
          id: microsoftUser.id
        });
        
        if (!response.success || !response.token) {
          throw new Error(response.message || response.error || 'Failed to get backend token');
        }
        
        // Step 4: Sanity-check the token from the backend
        const isTokenValid = JWTUtils.isTokenStructurallyValid(response.token);
        if (!isTokenValid) {
          console.error('🔐 Token invalid or expired - unexpected response from backend');
          throw new Error('Invalid token received from backend');
        }
        
        // Step 5: Extract user info from JWT token (same as manual login)
        const flatClaims = JWTUtils.getFlatClaims(response.token);
        if (!flatClaims || !flatClaims.email) {
          throw new Error('Invalid token structure');
        }
        
        // Use backend token email (backend's source of truth) — it may have
        // normalized an alias we sent to the account's primary address.
        const finalEmail = flatClaims.email;
        
        const user: User = {
          id: flatClaims.user_id || microsoftUser.id,
          name: flatClaims.name || microsoftUser.displayName,
          email: finalEmail, // Use backend token email (backend normalized alias to primary email)
          title: (flatClaims as any).title || 'Microsoft User',
          role: (flatClaims as any).role || 'user',
          view: (flatClaims as any).view || true,
          edit: (flatClaims as any).edit || false,
          settings: (flatClaims as any).settings || false,
          authMethod: 'microsoft'
        };
        
        // Step 6: Store authentication data (same as manual login)
        sessionStorage.setItem('authToken', response.token);
        localStorage.setItem('authToken', response.token);
        sessionStorage.setItem('manualAuthUser', JSON.stringify(user));
        localStorage.setItem('manualAuthUser', JSON.stringify(user));
        sessionStorage.setItem('lastActivity', Date.now().toString());
        localStorage.setItem('lastActivity', Date.now().toString());
        
        // Step 7: Update auth state
        setAuthState({
          isAuthenticated: true,
          isLoading: false,
          user: user
        });
        
      } catch (apiError: any) {
        // If backend token exchange fails, still allow Microsoft auth but APIs won't work
        console.error('❌ Backend token exchange failed:', apiError);
        // Fallback: Use Microsoft user info without backend token (APIs won't work)
        const user: User = {
          id: microsoftUser.id,
          name: microsoftUser.displayName,
          email: microsoftUser.mail || microsoftUser.userPrincipalName,
          title: 'Microsoft User',
          role: 'User',
          view: true,
          edit: false,
          settings: false,
          authMethod: 'microsoft'
        };
        setAuthState({
          isAuthenticated: true,
          isLoading: false,
          user: user
        });
        // Re-throw the error so user knows APIs won't work
        throw new Error(`Microsoft authentication succeeded but backend token exchange failed: ${apiError.message || 'Please contact administrator'}`);
      }
    } catch (error) {
      // Re-throw with more context
      if (error instanceof Error) {
        throw new Error(`Microsoft 365 login failed: ${error.message}`);
      } else {
        throw new Error('Microsoft 365 login failed with an unknown error');
      }
    }
  };

  const manualLogin = async (username: string, password: string) => {
    try {
      let user: User;
      let token: string;

      // Encode password to base64 before sending to the backend
      const encodedPassword = btoa(password);

      try {
        const response = await AuthService.login({ username, password: encodedPassword });

        // Transform backend response to match frontend expectations
        user = {
          id: response.user.id,
          name: response.user.name,
          email: response.user.email,
          title: response.user.title || 'User',
          designation: (response.user as any).designation || undefined,
          department: (response.user as any).department || undefined,
          employeeId: (response.user as any).employeeId || undefined,
          hasTeam: (response.user as any).hasTeam || false,
          isHR: (response.user as any).isHR || false,
          isCDO: (response.user as any).isCDO || false,
          role: (response.user as any).role || 'user', // Use mapped role name from backend
          view: response.user.view || true, // Permissions are inside user object
          edit: response.user.edit || true,
          settings: response.user.settings || true,
          authMethod: 'manual'
        };
        token = response.token;
      } catch (apiError) {
        throw apiError;
      }

      // Sanity-check the token from the backend
      const isTokenValid = JWTUtils.isTokenStructurallyValid(token);
      if (!isTokenValid) {
        console.error('🔐 Token invalid or expired - unexpected response from backend');
        throw new Error('Invalid token received from backend');
      }

      // Store authentication data in sessionStorage (clears when tab closes)
      // Also store in localStorage as backup, but prefer sessionStorage
      sessionStorage.setItem('authToken', token);
      localStorage.setItem('authToken', token);
      sessionStorage.setItem('manualAuthUser', JSON.stringify(user));
      localStorage.setItem('manualAuthUser', JSON.stringify(user));
      sessionStorage.setItem('lastActivity', Date.now().toString());
      localStorage.setItem('lastActivity', Date.now().toString());

      // Update auth state
      setAuthState({
        isAuthenticated: true,
        isLoading: false,
        user: user
      });
    } catch (error: any) {
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ authState, login, manualLogin, logout, initAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
