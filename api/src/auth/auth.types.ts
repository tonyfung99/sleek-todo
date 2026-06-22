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
