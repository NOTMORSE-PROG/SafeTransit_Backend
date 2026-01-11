// JWT Token Generation and Verification
// Handles creating and validating JSON Web Tokens for authentication

import jwt, { SignOptions } from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev-only';

// Convert JWT_EXPIRES_IN to proper format
// If it's a number string (like "7" for days), convert to seconds
// If it's a time string (like "7d", "100y"), keep as is
// Otherwise default to '7d'
const getExpiresIn = (): string | number => {
  const envValue = process.env.JWT_EXPIRES_IN;
  if (!envValue) return '7d';

  // For very long expiration like "100y", use a large number in seconds instead
  // 100 years ≈ 3,153,600,000 seconds
  if (envValue === '100y') return 3153600000;

  return envValue;
};

export interface JwtPayload {
  userId: string;
  email: string;
}

/**
 * Generate a JWT token with user data
 */
export const generateToken = (payload: JwtPayload): string => {
  const expiresIn = getExpiresIn();
  // Use type assertion to satisfy jwt.sign type requirements
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: expiresIn as SignOptions['expiresIn']
  });
};

/**
 * Verify and decode a JWT token
 * Returns null if token is invalid or expired
 */
export const verifyToken = (token: string): JwtPayload | null => {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
};
