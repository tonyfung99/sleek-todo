export interface JwtPayload {
  sub: string;
  email: string;
  displayName: string;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthResult {
  accessToken: string;
  user: AuthUser;
}

// Internal: includes the raw refresh token the controller moves into an httpOnly cookie.
export interface SessionTokens extends AuthResult {
  refreshToken: string;
}
