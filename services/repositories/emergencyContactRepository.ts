import { neon } from '@neondatabase/serverless';
import type { EmergencyContact, QueryResult } from '../types/database';

const getDatabaseUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return url;
};

const sql = neon(getDatabaseUrl());

export const EmergencyContactRepository = {
  async findByUserId(userId: string): Promise<EmergencyContact[]> {
    const result = await sql`
      SELECT * FROM emergency_contacts
      WHERE user_id = ${userId}
      ORDER BY "order" ASC
    `;
    return result as EmergencyContact[];
  },

  async createBatch(
    userId: string,
    contacts: { name: string; phone_number: string; order: number }[]
  ): Promise<EmergencyContact[]> {
    await sql`
      DELETE FROM emergency_contacts WHERE user_id = ${userId}
    `;

    const insertPromises = contacts.map((contact) =>
      sql`
        INSERT INTO emergency_contacts (user_id, name, phone_number, "order")
        VALUES (${userId}, ${contact.name}, ${contact.phone_number}, ${contact.order})
        RETURNING *
      `
    );

    const results = await Promise.all(insertPromises);
    return results.map((r) => r[0] as EmergencyContact);
  },

  async deleteByUserId(userId: string): Promise<boolean> {
    const result = await sql`
      DELETE FROM emergency_contacts WHERE user_id = ${userId}
    `;
    return (result as unknown as QueryResult).count > 0;
  },
};
