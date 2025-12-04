import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const SESSIONS_KEY = 'agent-coord:sessions';
const CEO_CONTACTS_KEY = 'agent-coord:ceo:contacts';
const CEO_IDEAS_KEY = 'agent-coord:ceo:ideas';
const CEO_NOTES_KEY = 'agent-coord:ceo:notes';

// Superadmin usernames - only these users can access CEO portal
const SUPERADMIN_USERS = ['tyler', 'tyler3', 'admin'];

interface Session {
  id: string;
  userId: string;
  username: string;
  role: string;
  createdAt: string;
  expiresAt: string;
}

interface CeoContact {
  id: string;
  name: string;
  company?: string;
  role?: string;
  email?: string;
  phone?: string;
  linkedIn?: string;
  notes?: string;
  category: 'investor' | 'partner' | 'customer' | 'advisor' | 'press' | 'other';
  status: 'active' | 'nurturing' | 'cold' | 'closed';
  lastContact?: string;
  nextFollowUp?: string;
  createdAt: string;
  updatedAt: string;
}

interface CeoIdea {
  id: string;
  title: string;
  description: string;
  category: 'product' | 'marketing' | 'strategy' | 'name' | 'feature' | 'partnership' | 'other';
  priority: 'high' | 'medium' | 'low';
  status: 'new' | 'exploring' | 'decided' | 'archived';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface CeoNote {
  id: string;
  title: string;
  content: string;
  category: 'meeting' | 'strategy' | 'personal' | 'todo' | 'other';
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

function getSessionFromCookie(req: VercelRequest): string | null {
  const cookies = req.headers.cookie;
  if (!cookies) return null;
  const sessionMatch = cookies.match(/session=([^;]+)/);
  return sessionMatch ? sessionMatch[1] : null;
}

async function requireSuperAdmin(req: VercelRequest): Promise<Session | null> {
  const sessionId = getSessionFromCookie(req);
  if (!sessionId) return null;

  const raw = await redis.hget(SESSIONS_KEY, sessionId);
  if (!raw) return null;

  const session: Session = typeof raw === 'string' ? JSON.parse(raw) : raw;

  // Check expiry
  if (new Date(session.expiresAt) < new Date()) return null;

  // Check if user is a superadmin
  const username = session.username.toLowerCase();
  if (!SUPERADMIN_USERS.includes(username)) return null;

  return session;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Require superadmin for all operations
  const session = await requireSuperAdmin(req);
  if (!session) {
    return res.status(403).json({ error: 'Superadmin access required' });
  }

  const { resource, action } = req.query;

  try {
    // === CONTACTS ===
    if (resource === 'contacts') {
      if (req.method === 'GET') {
        const contacts = await redis.hgetall(CEO_CONTACTS_KEY) || {};
        const contactList = Object.values(contacts).map((c: any) =>
          typeof c === 'string' ? JSON.parse(c) : c
        );
        // Sort by lastContact or createdAt
        contactList.sort((a: CeoContact, b: CeoContact) =>
          new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
        );
        return res.json({ contacts: contactList, count: contactList.length });
      }

      if (req.method === 'POST') {
        const { name, company, role, email, phone, linkedIn, notes, category, status, nextFollowUp } = req.body;
        if (!name) {
          return res.status(400).json({ error: 'Name is required' });
        }
        const contact: CeoContact = {
          id: generateId(),
          name,
          company,
          role,
          email,
          phone,
          linkedIn,
          notes,
          category: category || 'other',
          status: status || 'active',
          nextFollowUp,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await redis.hset(CEO_CONTACTS_KEY, { [contact.id]: JSON.stringify(contact) });
        return res.json({ success: true, contact });
      }

      if (req.method === 'PUT') {
        const { id } = req.query;
        if (!id || typeof id !== 'string') {
          return res.status(400).json({ error: 'Contact ID required' });
        }
        const existing = await redis.hget(CEO_CONTACTS_KEY, id);
        if (!existing) {
          return res.status(404).json({ error: 'Contact not found' });
        }
        const contact: CeoContact = typeof existing === 'string' ? JSON.parse(existing) : existing;
        const updates = req.body;
        const updated: CeoContact = {
          ...contact,
          ...updates,
          id: contact.id, // Preserve ID
          createdAt: contact.createdAt, // Preserve creation date
          updatedAt: new Date().toISOString(),
          lastContact: updates.logContact ? new Date().toISOString() : contact.lastContact,
        };
        await redis.hset(CEO_CONTACTS_KEY, { [id]: JSON.stringify(updated) });
        return res.json({ success: true, contact: updated });
      }

      if (req.method === 'DELETE') {
        const { id } = req.query;
        if (!id || typeof id !== 'string') {
          return res.status(400).json({ error: 'Contact ID required' });
        }
        await redis.hdel(CEO_CONTACTS_KEY, id);
        return res.json({ success: true, deleted: id });
      }
    }

    // === IDEAS ===
    if (resource === 'ideas') {
      if (req.method === 'GET') {
        const ideas = await redis.hgetall(CEO_IDEAS_KEY) || {};
        const ideaList = Object.values(ideas).map((i: any) =>
          typeof i === 'string' ? JSON.parse(i) : i
        );
        // Sort by priority then date
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        ideaList.sort((a: CeoIdea, b: CeoIdea) => {
          const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
          if (pDiff !== 0) return pDiff;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
        return res.json({ ideas: ideaList, count: ideaList.length });
      }

      if (req.method === 'POST') {
        const { title, description, category, priority, notes } = req.body;
        if (!title) {
          return res.status(400).json({ error: 'Title is required' });
        }
        const idea: CeoIdea = {
          id: generateId(),
          title,
          description: description || '',
          category: category || 'other',
          priority: priority || 'medium',
          status: 'new',
          notes,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await redis.hset(CEO_IDEAS_KEY, { [idea.id]: JSON.stringify(idea) });
        return res.json({ success: true, idea });
      }

      if (req.method === 'PUT') {
        const { id } = req.query;
        if (!id || typeof id !== 'string') {
          return res.status(400).json({ error: 'Idea ID required' });
        }
        const existing = await redis.hget(CEO_IDEAS_KEY, id);
        if (!existing) {
          return res.status(404).json({ error: 'Idea not found' });
        }
        const idea: CeoIdea = typeof existing === 'string' ? JSON.parse(existing) : existing;
        const updates = req.body;
        const updated: CeoIdea = {
          ...idea,
          ...updates,
          id: idea.id,
          createdAt: idea.createdAt,
          updatedAt: new Date().toISOString(),
        };
        await redis.hset(CEO_IDEAS_KEY, { [id]: JSON.stringify(updated) });
        return res.json({ success: true, idea: updated });
      }

      if (req.method === 'DELETE') {
        const { id } = req.query;
        if (!id || typeof id !== 'string') {
          return res.status(400).json({ error: 'Idea ID required' });
        }
        await redis.hdel(CEO_IDEAS_KEY, id);
        return res.json({ success: true, deleted: id });
      }
    }

    // === NOTES ===
    if (resource === 'notes') {
      if (req.method === 'GET') {
        const notes = await redis.hgetall(CEO_NOTES_KEY) || {};
        const noteList = Object.values(notes).map((n: any) =>
          typeof n === 'string' ? JSON.parse(n) : n
        );
        // Sort pinned first, then by date
        noteList.sort((a: CeoNote, b: CeoNote) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });
        return res.json({ notes: noteList, count: noteList.length });
      }

      if (req.method === 'POST') {
        const { title, content, category, pinned } = req.body;
        if (!title) {
          return res.status(400).json({ error: 'Title is required' });
        }
        const note: CeoNote = {
          id: generateId(),
          title,
          content: content || '',
          category: category || 'other',
          pinned: pinned || false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await redis.hset(CEO_NOTES_KEY, { [note.id]: JSON.stringify(note) });
        return res.json({ success: true, note });
      }

      if (req.method === 'PUT') {
        const { id } = req.query;
        if (!id || typeof id !== 'string') {
          return res.status(400).json({ error: 'Note ID required' });
        }
        const existing = await redis.hget(CEO_NOTES_KEY, id);
        if (!existing) {
          return res.status(404).json({ error: 'Note not found' });
        }
        const note: CeoNote = typeof existing === 'string' ? JSON.parse(existing) : existing;
        const updates = req.body;
        const updated: CeoNote = {
          ...note,
          ...updates,
          id: note.id,
          createdAt: note.createdAt,
          updatedAt: new Date().toISOString(),
        };
        await redis.hset(CEO_NOTES_KEY, { [id]: JSON.stringify(updated) });
        return res.json({ success: true, note: updated });
      }

      if (req.method === 'DELETE') {
        const { id } = req.query;
        if (!id || typeof id !== 'string') {
          return res.status(400).json({ error: 'Note ID required' });
        }
        await redis.hdel(CEO_NOTES_KEY, id);
        return res.json({ success: true, deleted: id });
      }
    }

    // === CHECK ACCESS ===
    if (resource === 'check-access') {
      // If we got here, user is superadmin
      return res.json({
        hasAccess: true,
        username: session.username,
        role: 'superadmin'
      });
    }

    // === DASHBOARD STATS ===
    if (resource === 'stats') {
      const [contacts, ideas, notes] = await Promise.all([
        redis.hgetall(CEO_CONTACTS_KEY) || {},
        redis.hgetall(CEO_IDEAS_KEY) || {},
        redis.hgetall(CEO_NOTES_KEY) || {},
      ]);

      const contactList = Object.values(contacts).map((c: any) => typeof c === 'string' ? JSON.parse(c) : c);
      const ideaList = Object.values(ideas).map((i: any) => typeof i === 'string' ? JSON.parse(i) : i);
      const noteList = Object.values(notes).map((n: any) => typeof n === 'string' ? JSON.parse(n) : n);

      // Calculate stats
      const activeContacts = contactList.filter((c: CeoContact) => c.status === 'active').length;
      const needsFollowUp = contactList.filter((c: CeoContact) => {
        if (!c.nextFollowUp) return false;
        return new Date(c.nextFollowUp) <= new Date();
      }).length;
      const highPriorityIdeas = ideaList.filter((i: CeoIdea) => i.priority === 'high' && i.status !== 'archived').length;
      const pinnedNotes = noteList.filter((n: CeoNote) => n.pinned).length;

      return res.json({
        stats: {
          totalContacts: contactList.length,
          activeContacts,
          needsFollowUp,
          totalIdeas: ideaList.length,
          highPriorityIdeas,
          totalNotes: noteList.length,
          pinnedNotes,
        }
      });
    }

    return res.status(400).json({ error: 'Invalid resource. Use: contacts, ideas, notes, stats, check-access' });

  } catch (error) {
    console.error('CEO Portal error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
