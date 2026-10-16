import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  timingSafeEqual,
} from 'node:crypto';
export const random = () => randomBytes(32).toString('base64url');
export const digest = (v: string) => createHash('sha256').update(v).digest('base64url');
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function vault(key: string) {
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new Error('ENCRYPTION_KEY must be 32 random bytes encoded as hex');
  const material = Buffer.from(key, 'hex');
  return {
    seal(value: unknown) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', material, iv);
      const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
    },
    open<T>(value: string): T {
      const b = Buffer.from(value, 'base64');
      const cipher = createDecipheriv('aes-256-gcm', material, b.subarray(0, 12));
      cipher.setAuthTag(b.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString(),
      ) as T;
    },
  };
}
