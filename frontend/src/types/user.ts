// User type definitions based on JWT token structure
// Matches the user object from the API response

export interface User {
  id: string;
  name: string;
  email: string;
  title: string;
  designation?: string;
  department?: string;
  employeeId?: string;
  hasTeam?: boolean;
  isHR?: boolean;
  isCDO?: boolean;
  role: string;
  view: boolean;
  edit: boolean;
  settings: boolean;
  authMethod: 'microsoft' | 'manual';
}

export interface UserPermissions {
  view: boolean;
  edit: boolean;
  settings: boolean;
}

export interface JWTPayload {
  user: {
    email: string;
    id: string;
    name: string;
    title: string;
    designation?: string;
    employeeId?: string;
    role: string;
    view: boolean;
    edit: boolean;
    settings: boolean;
  };
  exp: number;
  iat: number;
  iss: string;
}

export interface LoginResponse {
  success: boolean;
  message: string;
  token?: string;
  expires_in?: number;
  error?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
}

export interface AuthContextType {
  authState: AuthState;
  login: () => Promise<void>;
  manualLogin: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  initAuth: () => Promise<void>;
}
