// JWT token utilities for decoding and validation
// Handles JWT token parsing and user data extraction

interface JWTHeader {
  alg: string;
  typ: string;
}

interface JWTPayload {
  // Flat structure - fields at top level
  email?: string;
  name?: string;
  role?: string;
  role_id?: string; // Backend uses role_id
  user_id?: string;
  title?: string; // Backend uses title
  designation?: string;
  department?: string;
  employee_id?: string;
  has_team?: boolean;
  is_hr?: boolean;
  is_cdo?: boolean;
  organization?: string;
  view?: boolean; // Permissions are at root level in backend JWT
  edit?: boolean;
  settings?: boolean;
  permissions?: {
    view: boolean;
    edit: boolean;
    settings: boolean;
  };
  exp?: number;
  iat?: number;
  iss?: string;
  // Legacy nested structure (for backward compatibility)
  user?: {
    email: string;
    id: string;
    name: string;
    title: string;
    role: string;
    role_id?: string;
    view: boolean;
    edit: boolean;
    settings: boolean;
  };
}

interface DecodedToken {
  header: JWTHeader;
  payload: JWTPayload;
  signature: string;
}

class JWTUtils {
  /**
   * Client-side structural check only: well-formed JWT and not expired.
   * This is NOT a cryptographic signature verification — the signing secret
   * lives only on the backend, which independently verifies every token's
   * signature on every authenticated request (see _get_current_user in
   * main.py). Verifying a signature here would require shipping the signing
   * secret in the public JS bundle, which would let anyone forge a token
   * that also passes the backend's real check — so the browser never gets
   * to see it, and this check exists purely for UX (e.g. proactively
   * clearing an expired/malformed token instead of waiting on a 401).
   */
  static isTokenStructurallyValid(token: string): boolean {
    return this.isValidTokenFormat(token) && !this.isTokenExpired(token);
  }

  /**
   * Decode JWT token without verification (client-side only)
   * Note: This is for display purposes only. Server-side verification is required for security.
   */
  static decodeToken(token: string): DecodedToken | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT token format');
      }

      const [headerPart, payloadPart, signaturePart] = parts;

      const header = JSON.parse(this.base64UrlDecode(headerPart));
      const payload = JSON.parse(this.base64UrlDecode(payloadPart));

      return {
        header,
        payload,
        signature: signaturePart,
      };
    } catch (error) {
      console.error('Error decoding JWT token:', error);
      return null;
    }
  }

  /**
   * Extract user data from JWT token
   * Handles both flat structure and nested user object
   */
  static getUserFromToken(token: string): any | null {
    const decoded = this.decodeToken(token);
    if (!decoded) return null;
    
    const payload = decoded.payload;
    
    // Check if it's the new flat structure
    if (payload.email && payload.name) {
      return {
        email: payload.email,
        name: payload.name,
        role: payload.role,
        role_id: payload.role_id,
        id: payload.user_id || payload.employee_id,
        user_id: payload.user_id || payload.employee_id,
        title: payload.title,
        organization: payload.organization || "Dataflix Performance Review",
        designation: payload.designation,
        department: payload.department,
        employee_id: payload.employee_id,
        has_team: payload.has_team,
        is_hr: payload.is_hr,
        is_cdo: payload.is_cdo,
        view: payload.view,
        edit: payload.edit,
        settings: payload.settings
      };
    }

    // Fallback to nested structure for backward compatibility — main.py
    // never actually issues this shape (its tokens always have flat
    // email/name, handled above), so this exists only for a token from
    // some other, unrelated source.
    return payload.user || null;
  }

  /**
   * Check if JWT token is expired
   */
  static isTokenExpired(token: string): boolean {
    const decoded = this.decodeToken(token);
    if (!decoded || !decoded.payload.exp) return true;

    const currentTime = Math.floor(Date.now() / 1000);
    return decoded.payload.exp < currentTime;
  }

  /**
   * Get token expiration time in milliseconds
   */
  static getTokenExpirationTime(token: string): number | null {
    const decoded = this.decodeToken(token);
    if (!decoded || !decoded.payload.exp) return null;

    return decoded.payload.exp * 1000; // Convert to milliseconds
  }

  /**
   * Get time until token expires in seconds
   */
  static getTimeUntilExpiration(token: string): number | null {
    const expirationTime = this.getTokenExpirationTime(token);
    if (!expirationTime) return null;

    const currentTime = Date.now();
    const timeUntilExpiration = Math.floor((expirationTime - currentTime) / 1000);
    
    return timeUntilExpiration > 0 ? timeUntilExpiration : 0;
  }

  /**
   * Check if token will expire soon (within specified minutes)
   */
  static isTokenExpiringSoon(token: string, minutesThreshold: number = 5): boolean {
    const timeUntilExpiration = this.getTimeUntilExpiration(token);
    if (timeUntilExpiration === null) return true;

    return timeUntilExpiration < (minutesThreshold * 60);
  }

  /**
   * Base64 URL decode
   */
  private static base64UrlDecode(str: string): string {
    // Add padding if needed
    str += '='.repeat((4 - str.length % 4) % 4);
    
    // Replace URL-safe characters
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    
    return atob(str);
  }

  /**
   * Validate token format (basic check)
   */
  static isValidTokenFormat(token: string): boolean {
    if (!token || typeof token !== 'string') return false;
    
    const parts = token.split('.');
    return parts.length === 3;
  }

  /**
   * Validate token structure and report missing fields
   */
  static validateTokenStructure(token: string): { isValid: boolean; missingFields: string[] } {
    const missing: string[] = [];
    const decoded = this.decodeToken(token);
    if (!decoded) return { isValid: false, missingFields: ['token'] };
    const user = decoded.payload?.user as Partial<JWTPayload['user']> | undefined;
    if (!user) missing.push('user');
    else {
      if (!user.email) missing.push('user.email');
      if (!user.id) missing.push('user.id');
      if (user.role === undefined) missing.push('user.role');
    }
    if (!decoded.payload?.exp) missing.push('exp');
    if (!decoded.payload?.iat) missing.push('iat');
    return { isValid: missing.length === 0, missingFields: missing };
  }

  /**
   * Get token issuer
   */
  static getTokenIssuer(token: string): string | null {
    const decoded = this.decodeToken(token);
    return decoded?.payload?.iss || null;
  }

  /**
   * Get token issued at time
   */
  static getTokenIssuedAt(token: string): Date | null {
    const decoded = this.decodeToken(token);
    if (!decoded || !decoded.payload.iat) return null;

    return new Date(decoded.payload.iat * 1000);
  }

  /**
   * Get token expiration date
   */
  static getTokenExpirationDate(token: string): Date | null {
    const decoded = this.decodeToken(token);
    if (!decoded || !decoded.payload.exp) return null;

    return new Date(decoded.payload.exp * 1000);
  }

  /**
   * Normalize token payload to flat claims expected by the app
   * Handles both flat structure and nested user object
   * Maps nested structure to flat format like "Previous Token 2"
   */
  static getFlatClaims(token: string): {
    email: string;
    name: string;
    role?: string;
    role_id?: string; // Backend uses role_id
    user_id?: string;
    title?: string; // Backend uses title
    designation?: string;
    department?: string;
    employee_id?: string;
    has_team?: boolean;
    is_hr?: boolean;
    is_cdo?: boolean;
    organization?: string;
    view?: boolean; // Permissions are at root level in backend JWT
    edit?: boolean;
    settings?: boolean;
    permissions?: {
      view: boolean;
      edit: boolean;
      settings: boolean;
    };
    exp?: number;
    iat?: number;
    iss?: string;
  } | null {
    const decoded = this.decodeToken(token);
    if (!decoded) return null;

    const p: any = decoded.payload || {};
    const u: any = p.user || {};

    // Check if it's already the flat structure (fields at top level)
    if (p.email && p.name) {
      return {
        email: p.email,
        name: p.name,
        role: p.role,
        role_id: p.role_id, // Include role_id
        user_id: p.user_id,
        title: p.title, // Include title
        designation: p.designation,
        department: p.department,
        employee_id: p.employee_id,
        has_team: p.has_team,
        is_hr: p.is_hr,
        is_cdo: p.is_cdo,
        organization: p.organization || 'Dataflix Performance Review',
        view: p.view, // Include permissions at root level
        edit: p.edit,
        settings: p.settings,
        exp: p.exp,
        iat: p.iat,
        iss: p.iss,
      };
    }

    // Convert nested structure to flat format — main.py never actually
    // issues this shape (its tokens always have flat email/name, handled
    // above), so this exists only for a token from some other, unrelated
    // source.

    // Extract fields from nested structure and map to flat format
    const email = u.email || p.email || '';
    const name = u.name || p.name || '';

    // role_id has no known name mapping for a token from an unrelated
    // source, so it's passed through as-is rather than resolved to a name.
    const role = u.role || p.role || u.role_id || p.role_id;

    // Map user ID - use the nested id field as user_id
    const user_id = u.id || p.user_id || '';
    
    // Set default organization
    const organization = p.organization || 'Dataflix Performance Review';


    return {
      email,
      name,
      role,
      role_id: u.role_id || p.role_id, // Include role_id
      user_id,
      title: u.title || p.title, // Include title
      organization,
      view: u.view || p.view || false, // Include permissions at root level
      edit: u.edit || p.edit || false,
      settings: u.settings || p.settings || false,
      permissions: {
        view: u.view || p.view || false,
        edit: u.edit || p.edit || false,
        settings: u.settings || p.settings || false
      },
      exp: p.exp,
      iat: p.iat,
      iss: p.iss,
    };
  }
}

export default JWTUtils;
export type { JWTPayload, DecodedToken, JWTHeader };
