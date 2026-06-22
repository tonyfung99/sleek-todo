import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { AuthResult, AuthUser, JwtPayload } from './auth.types';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
  ) {}

  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<AuthResult> {
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
    return this.toResult(user);
  }

  async login(input: { email: string; password: string }): Promise<AuthResult> {
    const user = await this.users.findOne({ where: { email: input.email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.toResult(user);
  }

  validateUser(payload: JwtPayload): AuthUser {
    return { id: payload.sub, email: payload.email, displayName: payload.displayName };
  }

  private toResult(user: User): AuthResult {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
    };
    return {
      accessToken: this.jwt.sign(payload),
      user: { id: user.id, email: user.email, displayName: user.displayName },
    };
  }
}
