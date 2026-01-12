import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../services/auth/jwt';
import { validatePhoneNumber } from '../../services/auth/validation';
import { EmergencyContactRepository } from '../../services/repositories/emergencyContactRepository';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (req.method === 'GET') {
      const contacts = await EmergencyContactRepository.findByUserId(payload.userId);
      return res.status(200).json({ success: true, contacts });
    }

    if (req.method === 'POST') {
      const { contacts } = req.body;

      if (!contacts || !Array.isArray(contacts)) {
        return res.status(400).json({ error: 'Contacts array is required' });
      }

      if (contacts.length === 0) {
        await EmergencyContactRepository.deleteByUserId(payload.userId);
        return res.status(200).json({ success: true, contacts: [] });
      }

      const validatedContacts: Array<{ name: string; phone_number: string; order: number }> = [];

      for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];

        if (!contact.name || !contact.phoneNumber) {
          return res.status(400).json({
            error: `Contact ${i + 1}: Both name and phone number are required`,
          });
        }

        const validation = validatePhoneNumber(contact.phoneNumber);
        if (!validation.valid) {
          return res.status(400).json({
            error: `Contact ${i + 1}: ${validation.error || 'Invalid phone number'}`,
          });
        }

        validatedContacts.push({
          name: contact.name.trim(),
          phone_number: validation.formatted!,
          order: i + 1,
        });
      }

      const createdContacts = await EmergencyContactRepository.createBatch(
        payload.userId,
        validatedContacts
      );

      return res.status(200).json({ success: true, contacts: createdContacts });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Emergency contacts error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
