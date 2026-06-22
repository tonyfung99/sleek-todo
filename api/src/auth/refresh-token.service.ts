import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { RefreshToken } from './refresh-token.entity';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(RefreshToken) private readonly tokens: Repository<RefreshToken>,
  ) {}

  /** Issue a new opaque refresh token, persisting only its hash. Returns the raw token. */
  async issue(userId: string): Promise<string> {
    const raw = randomBytes(32).toString('hex');
    await this.tokens.save(
      this.tokens.create({
        userId,
        tokenHash: hash(raw),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        revokedAt: null,
      }),
    );
    return raw;
  }

  /**
   * Validate + rotate: the presented token must exist, be unrevoked and unexpired.
   * The old token is revoked and a fresh one issued (rotation). Reusing a rotated
   * (already-revoked) token fails — enabling server-side revocation.
   */
  async rotate(raw: string): Promise<{ userId: string; refreshToken: string }> {
    const record = await this.tokens.findOne({ where: { tokenHash: hash(raw) } });
    if (!record || record.revokedAt || record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    record.revokedAt = new Date();
    await this.tokens.save(record);
    const refreshToken = await this.issue(record.userId);
    return { userId: record.userId, refreshToken };
  }

  /** Revoke a token (logout). Safe to call with an unknown/already-revoked token. */
  async revoke(raw: string): Promise<void> {
    const record = await this.tokens.findOne({ where: { tokenHash: hash(raw) } });
    if (record && !record.revokedAt) {
      record.revokedAt = new Date();
      await this.tokens.save(record);
    }
  }
}
