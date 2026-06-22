import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { AuthUser, JwtPayload, SessionTokens } from './auth.types';
import { RefreshTokenService } from './refresh-token.service';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<SessionTokens> {
    const existing = await this.users.findOne({ where: { email: input.email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const user = await this.users.save(
      this.users.create({
        email: input.email,
        passwordHash,
        displayName: input.displayName,
      }),
    );
    return this.session(user);
  }

  async login(input: { email: string; password: string }): Promise<SessionTokens> {
    const user = await this.users.findOne({ where: { email: input.email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.session(user);
  }

  async refresh(rawRefreshToken: string): Promise<SessionTokens> {
    const { userId, refreshToken } = await this.refreshTokens.rotate(rawRefreshToken);
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return {
      accessToken: this.signAccessToken(user),
      user: this.toAuthUser(user),
      refreshToken,
    };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.refreshTokens.revoke(rawRefreshToken);
  }

  validateUser(payload: JwtPayload): AuthUser {
    return { id: payload.sub, email: payload.email, displayName: payload.displayName };
  }

  private async session(user: User): Promise<SessionTokens> {
    const refreshToken = await this.refreshTokens.issue(user.id);
    return {
      accessToken: this.signAccessToken(user),
      user: this.toAuthUser(user),
      refreshToken,
    };
  }

  private signAccessToken(user: User): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
    };
    return this.jwt.sign(payload);
  }

  private toAuthUser(user: User): AuthUser {
    return { id: user.id, email: user.email, displayName: user.displayName };
  }
}
