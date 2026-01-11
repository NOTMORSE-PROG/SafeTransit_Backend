// User Repository
// Handles all database operations for users and password reset tokens

import { neon } from '@neondatabase/serverless';
import type { User, UserInsert, PasswordResetToken, QueryResult } from '../types/database';

// Get database URL from environment
const getDatabaseUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return url;
};

const sql = neon(getDatabaseUrl());

// ==============================================================================
// User Repository
// ==============================================================================

export const UserRepository = {
  /**
   * Find user by ID
   */
  async findById(id: string): Promise<User | null> {
    const result = await sql`
      SELECT * FROM users WHERE id = ${id} LIMIT 1
    `;
    return (result[0] as User) || null;
  },

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    const result = await sql`
      SELECT * FROM users WHERE email = ${email} LIMIT 1
    `;
    return (result[0] as User) || null;
  },

  /**
   * Find user by Google ID
   */
  async findByGoogleId(googleId: string): Promise<User | null> {
    const result = await sql`
      SELECT * FROM users WHERE google_id = ${googleId} LIMIT 1
    `;
    return (result[0] as User) || null;
  },

  /**
   * Create a new user
   */
  async create(data: UserInsert): Promise<User> {
    const result = await sql`
      INSERT INTO users (
        email,
        password_hash,
        full_name,
        profile_image_url,
        phone_number,
        google_id,
        is_verified,
        verification_status
      )
      VALUES (
        ${data.email},
        ${data.password_hash},
        ${data.full_name},
        ${data.profile_image_url || null},
        ${data.phone_number || null},
        ${data.google_id || null},
        ${data.is_verified || false},
        ${data.verification_status || 'none'}
      )
      RETURNING *
    `;
    return result[0] as User;
  },

  /**
   * Update user profile
   */
  async updateProfile(
    id: string,
    data: Partial<Pick<User, 'full_name' | 'phone_number' | 'profile_image_url'>>
  ): Promise<User | null> {
    const updates: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: any[] = [];
    let paramIndex = 1;

    if (data.full_name !== undefined) {
      updates.push(`full_name = $${paramIndex++}`);
      values.push(data.full_name);
    }
    if (data.phone_number !== undefined) {
      updates.push(`phone_number = $${paramIndex++}`);
      values.push(data.phone_number);
    }
    if (data.profile_image_url !== undefined) {
      updates.push(`profile_image_url = $${paramIndex++}`);
      values.push(data.profile_image_url);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    const result = await sql`
      UPDATE users
      SET ${sql.unsafe(updates.join(', '))}
      WHERE id = ${id}
      RETURNING *
    `;
    return (result[0] as User) || null;
  },

  /**
   * Update password hash
   */
  async updatePassword(id: string, passwordHash: string): Promise<boolean> {
    const result = await sql`
      UPDATE users
      SET password_hash = ${passwordHash}
      WHERE id = ${id}
    `;
    return (result as unknown as QueryResult).count > 0;
  },

  /**
   * Mark user as verified
   */
  async markAsVerified(id: string): Promise<boolean> {
    const result = await sql`
      UPDATE users
      SET is_verified = TRUE, verification_status = 'approved'
      WHERE id = ${id}
    `;
    return (result as unknown as QueryResult).count > 0;
  },

  /**
   * Update verification status
   */
  async updateVerificationStatus(
    id: string,
    status: User['verification_status']
  ): Promise<boolean> {
    const result = await sql`
      UPDATE users
      SET verification_status = ${status}
      WHERE id = ${id}
    `;
    return (result as unknown as QueryResult).count > 0;
  },

  /**
   * Delete user (cascade deletes all related data)
   */
  async delete(id: string): Promise<boolean> {
    const result = await sql`
      DELETE FROM users WHERE id = ${id}
    `;
    return (result as unknown as QueryResult).count > 0;
  },

  /**
   * Check if email exists
   */
  async emailExists(email: string): Promise<boolean> {
    const result = await sql`
      SELECT 1 FROM users WHERE email = ${email} LIMIT 1
    `;
    return result.length > 0;
  },

  /**
   * Link Google account to existing user
   */
  async linkGoogleAccount(userId: string, googleId: string): Promise<boolean> {
    const result = await sql`
      UPDATE users
      SET google_id = ${googleId}
      WHERE id = ${userId} AND google_id IS NULL
    `;
    return (result as unknown as QueryResult).count > 0;
  },

  /**
   * Check if Google ID is already linked to another account
   */
  async isGoogleIdLinked(googleId: string): Promise<boolean> {
    const result = await sql`
      SELECT 1 FROM users WHERE google_id = ${googleId} LIMIT 1
    `;
    return result.length > 0;
  },

  /**
   * Get account type information
   */
  async getAccountType(email: string): Promise<{
    hasPassword: boolean;
    hasGoogle: boolean;
  } | null> {
    const result = await sql`
      SELECT
        (password_hash IS NOT NULL AND password_hash != '') as has_password,
        (google_id IS NOT NULL) as has_google
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `;

    if (result.length === 0) return null;

    return {
      hasPassword: result[0].has_password,
      hasGoogle: result[0].has_google,
    };
  },
};

// ==============================================================================
// Password Reset Token Repository
// ==============================================================================

export const PasswordResetTokenRepository = {
  /**
   * Create a new password reset token
   */
  async create(
    userId: string,
    token: string,
    expiresAt: Date
  ): Promise<PasswordResetToken> {
    const result = await sql`
      INSERT INTO password_reset_tokens (user_id, token, expires_at)
      VALUES (${userId}, ${token}, ${expiresAt.toISOString()})
      RETURNING *
    `;
    return result[0] as PasswordResetToken;
  },

  /**
   * Find valid (unused and not expired) token
   */
  async findValidToken(token: string): Promise<PasswordResetToken | null> {
    const result = await sql`
      SELECT * FROM password_reset_tokens
      WHERE token = ${token}
        AND used_at IS NULL
        AND expires_at > NOW()
      LIMIT 1
    `;
    return (result[0] as PasswordResetToken) || null;
  },

  /**
   * Mark token as used
   */
  async markAsUsed(id: string): Promise<boolean> {
    const result = await sql`
      UPDATE password_reset_tokens
      SET used_at = NOW()
      WHERE id = ${id}
    `;
    return (result as unknown as QueryResult).count > 0;
  },

  /**
   * Delete expired tokens (cleanup)
   */
  async deleteExpired(): Promise<number> {
    const result = await sql`
      DELETE FROM password_reset_tokens
      WHERE expires_at < NOW()
    `;
    return (result as unknown as QueryResult).count || 0;
  },

  /**
   * Delete all tokens for a user
   */
  async deleteForUser(userId: string): Promise<number> {
    const result = await sql`
      DELETE FROM password_reset_tokens
      WHERE user_id = ${userId}
    `;
    return (result as unknown as QueryResult).count || 0;
  },
};
