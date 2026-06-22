import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { User } from '../users/user.entity';

function makeRepoMock() {
  const store: User[] = [];
  return {
    store,
    findOne: jest.fn(async ({ where: { email } }: { where: { email: string } }) =>
      store.find((u) => u.email === email) ?? null,
    ),
    create: jest.fn((data: Partial<User>) => ({ id: 'user-1', ...data }) as User),
    save: jest.fn(async (u: User) => {
      store.push(u);
      return u;
    }),
  } as unknown as Repository<User> & { store: User[] };
}

describe('AuthService', () => {
  const jwt = new JwtService({ secret: 'test-secret-0123456789', signOptions: { expiresIn: '1d' } });
  let repo: ReturnType<typeof makeRepoMock>;
  let service: AuthService;

  beforeEach(() => {
    repo = makeRepoMock();
    service = new AuthService(repo, jwt);
  });

  it('register hashes the password and returns a token + user', async () => {
    const result = await service.register({
      email: 'a@example.com',
      password: 'password123',
      displayName: 'Alice',
    });
    expect(result.user).toEqual({ id: 'user-1', email: 'a@example.com', displayName: 'Alice' });
    expect(result.accessToken).toEqual(expect.any(String));
    const stored = repo.store[0];
    expect(stored.passwordHash).not.toBe('password123');
    expect(await bcrypt.compare('password123', stored.passwordHash)).toBe(true);
    const decoded = jwt.verify(result.accessToken);
    expect(decoded.sub).toBe('user-1');
    expect(decoded.email).toBe('a@example.com');
  });

  it('register rejects a duplicate email', async () => {
    await service.register({ email: 'a@example.com', password: 'password123', displayName: 'Alice' });
    await expect(
      service.register({ email: 'a@example.com', password: 'other12345', displayName: 'Al' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('login returns a token for valid credentials', async () => {
    await service.register({ email: 'a@example.com', password: 'password123', displayName: 'Alice' });
    const result = await service.login({ email: 'a@example.com', password: 'password123' });
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.user.email).toBe('a@example.com');
  });

  it('login rejects a wrong password', async () => {
    await service.register({ email: 'a@example.com', password: 'password123', displayName: 'Alice' });
    await expect(
      service.login({ email: 'a@example.com', password: 'wrongpass1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('login rejects an unknown email', async () => {
    await expect(
      service.login({ email: 'nobody@example.com', password: 'whatever12' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
