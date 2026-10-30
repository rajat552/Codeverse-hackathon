// @ts-check
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'platform.db');

// Initialize SQLite database
const db = new DatabaseSync(DB_FILE);

// Enable WAL mode & foreign keys for high performance and integrity
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL, -- 'requester', 'owner', 'manager', 'admin'
    department TEXT NOT NULL,
    membership_status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS verifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    requirement_type TEXT NOT NULL,
    requirement_name TEXT NOT NULL,
    status TEXT NOT NULL, -- 'pending', 'verified', 'rejected', 'expired'
    evidence_ref TEXT,
    verifier_id TEXT,
    verified_at TEXT,
    expires_at TEXT,
    notes TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    location TEXT NOT NULL,
    asset_tag TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'published', -- 'published', 'draft', 'maintenance', 'archived'
    min_duration_hours INTEGER NOT NULL DEFAULT 1,
    max_duration_hours INTEGER NOT NULL DEFAULT 48,
    operating_rules TEXT,
    required_qualification TEXT, -- NULL or matches requirement_type
    requires_approval INTEGER NOT NULL DEFAULT 1,
    supervision_required INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY(owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS resource_blackouts (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    reason TEXT NOT NULL,
    FOREIGN KEY(resource_id) REFERENCES resources(id)
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    requester_id TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    purpose TEXT NOT NULL,
    status TEXT NOT NULL, -- 'submitted', 'approved', 'rejected', 'waitlisted', 'in_use', 'returned', 'completed', 'cancelled'
    waitlist_position INTEGER,
    decision_by TEXT,
    decision_reason TEXT,
    decision_at TEXT,
    pickup_at TEXT,
    pickup_by TEXT,
    return_at TEXT,
    return_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(resource_id) REFERENCES resources(id),
    FOREIGN KEY(requester_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS condition_reports (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    stage TEXT NOT NULL, -- 'pickup', 'return'
    recorded_by TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    condition_rating TEXT NOT NULL, -- 'Excellent', 'Good', 'Fair', 'Damaged/Issues'
    checklist_clean INTEGER NOT NULL DEFAULT 1,
    checklist_operational INTEGER NOT NULL DEFAULT 1,
    checklist_accessories_intact INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    FOREIGN KEY(booking_id) REFERENCES bookings(id)
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    reported_by TEXT NOT NULL,
    type TEXT NOT NULL, -- 'damage', 'late_return', 'missing_item', 'dispute', 'safety'
    severity TEXT NOT NULL, -- 'low', 'medium', 'high', 'critical'
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', -- 'open', 'under_review', 'resolved', 'dismissed'
    assigned_to TEXT,
    resolution_notes TEXT,
    resolved_by TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(booking_id) REFERENCES bookings(id)
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    outcome TEXT NOT NULL, -- 'success', 'denied', 'conflict', 'failed'
    reason TEXT,
    details TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'info', -- 'info', 'success', 'warning', 'danger'
    link TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS policies (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// Seed Initial Demonstration Data
function seedDatabase() {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount > 0) return; // Already seeded

  console.log('Seeding initial demonstration accounts, resources, and policies...');
  const now = new Date().toISOString();

  // 1. Users representing each logical actor
  const users = [
    {
      id: 'usr_requester',
      name: 'Elena Rostova',
      email: 'student@campus.edu',
      role: 'requester',
      department: 'Robotics & Applied Physics',
      membership_status: 'active',
      created_at: now
    },
    {
      id: 'usr_owner',
      name: 'Dr. Marcus Vance',
      email: 'lab.manager@campus.edu',
      role: 'owner',
      department: 'Prototyping & Fabrication Lab',
      membership_status: 'active',
      created_at: now
    },
    {
      id: 'usr_manager',
      name: 'Sarah Jenkins',
      email: 'safety.officer@campus.edu',
      role: 'manager',
      department: 'Campus Safety & Compliance',
      membership_status: 'active',
      created_at: now
    },
    {
      id: 'usr_admin',
      name: 'Alex Rivera',
      email: 'admin@campus.edu',
      role: 'admin',
      department: 'Central Facilities & Operations',
      membership_status: 'active',
      created_at: now
    }
  ];

  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, role, department, membership_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const u of users) {
    insertUser.run(u.id, u.name, u.email, u.role, u.department, u.membership_status, u.created_at);
  }

  // 2. Initial Verifications for Elena Rostova
  const verifications = [
    {
      id: 'ver_01',
      user_id: 'usr_requester',
      requirement_type: 'general_safety',
      requirement_name: 'Campus General Safety Clearance',
      status: 'verified',
      evidence_ref: 'CERT-GEN-2026-9812',
      verifier_id: 'usr_manager',
      verified_at: '2026-01-15T09:00:00.000Z',
      expires_at: '2027-01-15T09:00:00.000Z',
      notes: 'Cleared annual workplace and lab basics safety.'
    },
    {
      id: 'ver_02',
      user_id: 'usr_requester',
      requirement_type: 'media_equipment',
      requirement_name: 'Media & Optics Handling Authorization',
      status: 'verified',
      evidence_ref: 'MEDIA-CERT-449',
      verifier_id: 'usr_manager',
      verified_at: '2026-02-10T14:30:00.000Z',
      expires_at: '2027-02-10T14:30:00.000Z',
      notes: 'Passed cinema camera and field audio checkout exam.'
    },
    {
      id: 'ver_03',
      user_id: 'usr_requester',
      requirement_type: 'laser_safety',
      requirement_name: 'Class 4 Laser Safety & Optics Protocol',
      status: 'pending',
      evidence_ref: 'LASER-SUB-8819',
      verifier_id: null,
      verified_at: null,
      expires_at: null,
      notes: 'Submitted test certificate. Awaiting compliance manager review.'
    }
  ];

  const insertVer = db.prepare(`
    INSERT INTO verifications (id, user_id, requirement_type, requirement_name, status, evidence_ref, verifier_id, verified_at, expires_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const v of verifications) {
    insertVer.run(v.id, v.user_id, v.requirement_type, v.requirement_name, v.status, v.evidence_ref, v.verifier_id, v.verified_at, v.expires_at, v.notes);
  }

  // 3. Realistic Shared Institutional Resources
  const resources = [
    {
      id: 'res_01',
      owner_id: 'usr_owner',
      name: 'Sony FX6 Cinema 4K Camera Kit',
      category: 'Media & Cameras',
      description: 'Full-frame 4K cinema package with 24-70mm GM lens, V-Mount batteries, CFexpress cards, and heavy-duty tripod.',
      location: 'Media Production Hub - Studio B2',
      asset_tag: 'MED-FX6-001',
      status: 'published',
      min_duration_hours: 2,
      max_duration_hours: 24,
      operating_rules: 'Indoor/outdoor studio use only. Return batteries fully charged. Check optical sensor clean on return.',
      required_qualification: 'media_equipment',
      requires_approval: 1,
      supervision_required: 0,
      created_at: now
    },
    {
      id: 'res_02',
      owner_id: 'usr_owner',
      name: 'Industrial Fiber Laser Cutter (150W)',
      category: 'Workshop Tools',
      description: 'High-precision CNC laser cutter capable of processing acrylic, anodized aluminum, wood, and structural composites.',
      location: 'Engineering Fabrication Wing - Lab 104',
      asset_tag: 'FAB-LSR-002',
      status: 'published',
      min_duration_hours: 1,
      max_duration_hours: 8,
      operating_rules: 'Mandatory fume extraction verification before power-on. No PVC or vinyl materials under any circumstance.',
      required_qualification: 'laser_safety',
      requires_approval: 1,
      supervision_required: 1,
      created_at: now
    },
    {
      id: 'res_03',
      owner_id: 'usr_owner',
      name: 'Collaborative Robotics & VR Testing Arena',
      category: 'Bookable Spaces',
      description: '80m² acoustically treated room with ceiling motion capture cameras, safety netting, high-speed Wi-Fi 6E, and dual workstation PCs.',
      location: 'Innovation Center - Room 310',
      asset_tag: 'SPC-ROB-003',
      status: 'published',
      min_duration_hours: 1,
      max_duration_hours: 12,
      operating_rules: 'No open liquids near motion tracking arrays. Reset sensor calibrate points before leaving.',
      required_qualification: 'general_safety',
      requires_approval: 0, // Instant reservation if eligible
      supervision_required: 0,
      created_at: now
    },
    {
      id: 'res_04',
      owner_id: 'usr_owner',
      name: 'Keysight 4-Channel 1GHz Digital Oscilloscope',
      category: 'Lab Instruments',
      description: 'InfiniiVision series 1GHz bandwidth oscilloscope with serial decode, logic analyzer probes, and power analysis software.',
      location: 'Electronics & Circuits Lab - Bench 4',
      asset_tag: 'LAB-OSC-004',
      status: 'published',
      min_duration_hours: 1,
      max_duration_hours: 48,
      operating_rules: 'Calibrate probes before precision measurement. Max input voltage 300V RMS CAT II.',
      required_qualification: 'general_safety',
      requires_approval: 1,
      supervision_required: 0,
      created_at: now
    }
  ];

  const insertRes = db.prepare(`
    INSERT INTO resources (id, owner_id, name, category, description, location, asset_tag, status, min_duration_hours, max_duration_hours, operating_rules, required_qualification, requires_approval, supervision_required, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of resources) {
    insertRes.run(r.id, r.owner_id, r.name, r.category, r.description, r.location, r.asset_tag, r.status, r.min_duration_hours, r.max_duration_hours, r.operating_rules, r.required_qualification, r.requires_approval, r.supervision_required, r.created_at);
  }

  // 4. Fair-Use & Allocation Policies
  const policies = [
    { key: 'max_active_bookings_per_user', value: '3', description: 'Maximum active/pending reservations allowed per individual requester' },
    { key: 'max_booking_duration_hours', value: '48', description: 'Maximum single reservation window allowed across institutional assets' },
    { key: 'waitlist_auto_promotion', value: 'true', description: 'Automatically promote highest waitlisted request upon booking cancellation' },
    { key: 'condition_checklist_mandatory', value: 'true', description: 'Handover pickup and return require operational and clean checklist audit' }
  ];

  const insertPolicy = db.prepare(`
    INSERT INTO policies (key, value, description, updated_at) VALUES (?, ?, ?, ?)
  `);
  for (const p of policies) {
    insertPolicy.run(p.key, p.value, p.description, now);
  }

  // 5. Initial Audit Log
  const insertAudit = db.prepare(`
    INSERT INTO audit_events (id, actor_id, actor_name, actor_role, action, target_type, target_id, outcome, reason, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertAudit.run('aud_init_01', 'usr_admin', 'Alex Rivera', 'admin', 'SYSTEM_INITIALIZED', 'system', 'root', 'success', 'System setup complete', 'Configured default fair-use policies and seed resources', now);

  console.log('Seed data successfully loaded.');
}

seedDatabase();

// In-Memory Session Storage
const sessions = new Map();

// Helper to log audit events
function logAudit(actor, action, targetType, targetId, outcome, reason, details) {
  const id = 'aud_' + crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  try {
    const stmt = db.prepare(`
      INSERT INTO audit_events (id, actor_id, actor_name, actor_role, action, target_type, target_id, outcome, reason, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, actor.id, actor.name, actor.role, action, targetType, targetId, outcome, reason || null, details || null, now);
  } catch (err) {
    console.error('Audit log failure:', err);
  }
}

// Helper to push notification
function pushNotification(userId, title, message, type = 'info', link = null) {
  const id = 'notif_' + crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  try {
    const stmt = db.prepare(`
      INSERT INTO notifications (id, user_id, title, message, type, link, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, userId, title, message, type, link, now);
  } catch (err) {
    console.error('Notification dispatch failure:', err);
  }
}

// Session authentication middleware helper
function getSessionUser(req) {
  const authHeader = req.headers['authorization'];
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers['x-session-token']) {
    token = req.headers['x-session-token'];
  } else if (req.headers.cookie) {
    const match = req.headers.cookie.match(/session_token=([^;]+)/);
    if (match) token = match[1];
  }

  if (token && sessions.has(token)) {
    const userId = sessions.get(token);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    return user || null;
  }

  // Fallback to default requester if no token provided, but tag as anonymous session
  return null;
}

// Body parser helper
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) { // 5MB limit
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

// JSON response helper
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Session-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Main HTTP Server
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Session-Token',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    return res.end();
  }

  // API Routes
  if (pathname.startsWith('/api/')) {
    try {
      const user = getSessionUser(req);

      // --- AUTH ROUTES ---
      if (pathname === '/api/test/reset-demo-state' && method === 'POST') {
        // Reset DB to clean initial seed data for repeatable tests and judge runs
        db.exec(`
          DELETE FROM notifications;
          DELETE FROM audit_events;
          DELETE FROM incidents;
          DELETE FROM condition_reports;
          DELETE FROM bookings;
          DELETE FROM resource_blackouts;
          DELETE FROM resources;
          DELETE FROM verifications;
          DELETE FROM users;
          DELETE FROM policies;
        `);
        seedDatabase();
        return sendJSON(res, 200, { message: 'Demo state successfully reset to initial seed data' });
      }

      if (pathname === '/api/auth/me' && method === 'GET') {
        if (!user) {
          // Provide default requester profile if unauthenticated for quick start
          const defaultUser = db.prepare('SELECT * FROM users WHERE id = ?').get('usr_requester');
          const token = crypto.randomUUID();
          sessions.set(token, defaultUser.id);
          return sendJSON(res, 200, { user: defaultUser, token });
        }
        return sendJSON(res, 200, { user });
      }

      if (pathname === '/api/auth/switch' && method === 'POST') {
        const body = await parseBody(req);
        const targetUserId = body.userId || 'usr_requester';
        const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);
        if (!targetUser) {
          return sendJSON(res, 404, { error: 'Target user not found' });
        }
        const token = crypto.randomUUID();
        sessions.set(token, targetUser.id);
        logAudit(targetUser, 'USER_SWITCH', 'user', targetUser.id, 'success', `Switched active role to ${targetUser.role}`);
        return sendJSON(res, 200, { user: targetUser, token, message: `Active persona switched to ${targetUser.name} (${targetUser.role})` });
      }

      if (pathname === '/api/auth/users' && method === 'GET') {
        const users = db.prepare('SELECT id, name, email, role, department, membership_status FROM users').all();
        return sendJSON(res, 200, { users });
      }

      // Ensure authenticated user for subsequent protected routes
      const activeUser = user || db.prepare('SELECT * FROM users WHERE id = ?').get('usr_requester');

      // --- RESOURCES ROUTES (FR-01, FR-02) ---
      if (pathname === '/api/resources' && method === 'GET') {
        const category = urlObj.searchParams.get('category');
        const search = urlObj.searchParams.get('search');
        const status = urlObj.searchParams.get('status') || 'published';

        let query = 'SELECT r.*, u.name AS owner_name, u.email AS owner_email FROM resources r JOIN users u ON r.owner_id = u.id WHERE 1=1';
        const params = [];

        // If not owner/admin, only show published
        if (activeUser.role === 'requester') {
          query += " AND r.status = 'published'";
        } else if (status !== 'all') {
          query += ' AND r.status = ?';
          params.push(status);
        }

        if (category && category !== 'All') {
          query += ' AND r.category = ?';
          params.push(category);
        }

        if (search) {
          query += ' AND (r.name LIKE ? OR r.description LIKE ? OR r.location LIKE ? OR r.asset_tag LIKE ?)';
          const searchParam = `%${search}%`;
          params.push(searchParam, searchParam, searchParam, searchParam);
        }

        query += ' ORDER BY r.created_at DESC';
        const resources = db.prepare(query).all(...params);
        return sendJSON(res, 200, { resources });
      }

      if (pathname.match(/^\/api\/resources\/[a-zA-Z0-9_-]+$/) && method === 'GET') {
        const resourceId = pathname.split('/')[3];
        const resource = db.prepare(`
          SELECT r.*, u.name AS owner_name, u.email AS owner_email 
          FROM resources r 
          JOIN users u ON r.owner_id = u.id 
          WHERE r.id = ?
        `).get(resourceId);

        if (!resource) return sendJSON(res, 404, { error: 'Resource not found' });

        // Fetch upcoming approved or in_use bookings for schedule checking
        const upcomingBookings = db.prepare(`
          SELECT id, start_time, end_time, status 
          FROM bookings 
          WHERE resource_id = ? AND status IN ('approved', 'in_use')
          ORDER BY start_time ASC
        `).all(resourceId);

        // Fetch blackouts
        const blackouts = db.prepare('SELECT * FROM resource_blackouts WHERE resource_id = ?').all(resourceId);

        return sendJSON(res, 200, { resource, upcomingBookings, blackouts });
      }

      if (pathname === '/api/resources' && method === 'POST') {
        // Only owner or admin can create resources
        if (activeUser.role !== 'owner' && activeUser.role !== 'admin') {
          return sendJSON(res, 403, { error: 'FORBIDDEN: Only resource owners and administrators can create resources' });
        }

        const body = await parseBody(req);
        if (!body.name || !body.category || !body.location || !body.asset_tag) {
          return sendJSON(res, 400, { error: 'VALIDATION_ERROR: Name, category, location, and asset tag are required' });
        }

        const id = 'res_' + crypto.randomUUID().slice(0, 8);
        const now = new Date().toISOString();
        const stmt = db.prepare(`
          INSERT INTO resources (
            id, owner_id, name, category, description, location, asset_tag, 
            status, min_duration_hours, max_duration_hours, operating_rules, 
            required_qualification, requires_approval, supervision_required, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        try {
          stmt.run(
            id,
            activeUser.id,
            body.name,
            body.category,
            body.description || '',
            body.location,
            body.asset_tag,
            body.status || 'published',
            parseInt(body.min_duration_hours || '1', 10),
            parseInt(body.max_duration_hours || '24', 10),
            body.operating_rules || '',
            body.required_qualification || null,
            body.requires_approval ? 1 : 0,
            body.supervision_required ? 1 : 0,
            now
          );
        } catch (insertErr) {
          if (insertErr.message && insertErr.message.includes('UNIQUE constraint failed')) {
            return sendJSON(res, 409, { error: 'CONFLICT: A resource with this asset tag already exists' });
          }
          throw insertErr;
        }

        logAudit(activeUser, 'RESOURCE_CREATE', 'resource', id, 'success', `Created resource ${body.name}`);
        return sendJSON(res, 201, { id, message: 'Resource created successfully' });
      }

      if (pathname.match(/^\/api\/resources\/[a-zA-Z0-9_-]+$/) && method === 'PUT') {
        if (activeUser.role !== 'owner' && activeUser.role !== 'admin') {
          return sendJSON(res, 403, { error: 'FORBIDDEN: Only resource owners and administrators can modify resources' });
        }
        const resourceId = pathname.split('/')[3];
        const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
        if (!resource) return sendJSON(res, 404, { error: 'Resource not found' });

        if (activeUser.role === 'owner' && resource.owner_id !== activeUser.id) {
          return sendJSON(res, 403, { error: 'FORBIDDEN: You do not own this resource' });
        }

        const body = await parseBody(req);
        const stmt = db.prepare(`
          UPDATE resources SET
            name = COALESCE(?, name),
            category = COALESCE(?, category),
            description = COALESCE(?, description),
            location = COALESCE(?, location),
            status = COALESCE(?, status),
            min_duration_hours = COALESCE(?, min_duration_hours),
            max_duration_hours = COALESCE(?, max_duration_hours),
            operating_rules = COALESCE(?, operating_rules),
            required_qualification = ?,
            requires_approval = COALESCE(?, requires_approval),
            supervision_required = COALESCE(?, supervision_required)
          WHERE id = ?
        `);

        stmt.run(
          body.name,
          body.category,
          body.description,
          body.location,
          body.status,
          body.min_duration_hours ? parseInt(body.min_duration_hours, 10) : null,
          body.max_duration_hours ? parseInt(body.max_duration_hours, 10) : null,
          body.operating_rules,
          body.required_qualification !== undefined ? body.required_qualification : resource.required_qualification,
          body.requires_approval !== undefined ? (body.requires_approval ? 1 : 0) : null,
          body.supervision_required !== undefined ? (body.supervision_required ? 1 : 0) : null,
          resourceId
        );

        logAudit(activeUser, 'RESOURCE_UPDATE', 'resource', resourceId, 'success', `Updated resource ${resource.name}`);
        return sendJSON(res, 200, { message: 'Resource updated successfully' });
      }

      // --- VERIFICATIONS & ELIGIBILITY (FR-03, FR-04) ---
      if (pathname === '/api/verifications' && method === 'GET') {
        let query = 'SELECT v.*, u.name as user_name, u.email as user_email, m.name as verifier_name FROM verifications v JOIN users u ON v.user_id = u.id LEFT JOIN users m ON v.verifier_id = m.id WHERE 1=1';
        const params = [];
        // Requesters can only inspect their own verifications
        if (activeUser.role === 'requester') {
          query += ' AND v.user_id = ?';
          params.push(activeUser.id);
        }
        query += ' ORDER BY v.status ASC, v.requirement_name ASC';
        const verifications = db.prepare(query).all(...params);
        return sendJSON(res, 200, { verifications });
      }

      if (pathname === '/api/verifications' && method === 'POST') {
        const body = await parseBody(req);
        if (!body.requirement_type || !body.requirement_name) {
          return sendJSON(res, 400, { error: 'VALIDATION_ERROR: requirement_type and requirement_name are required' });
        }

        const id = 'ver_' + crypto.randomUUID().slice(0, 8);
        const stmt = db.prepare(`
          INSERT INTO verifications (id, user_id, requirement_type, requirement_name, status, evidence_ref, notes)
          VALUES (?, ?, ?, ?, 'pending', ?, ?)
        `);

        stmt.run(id, activeUser.id, body.requirement_type, body.requirement_name, body.evidence_ref || 'DOC-' + Math.floor(1000 + Math.random() * 9000), body.notes || 'Submitted for staff verification');
        logAudit(activeUser, 'VERIFICATION_SUBMIT', 'verification', id, 'success', `Submitted qualification ${body.requirement_name}`);
        return sendJSON(res, 201, { id, message: 'Qualification submitted for verification' });
      }

      if (pathname.match(/^\/api\/verifications\/[a-zA-Z0-9_-]+\/review$/) && method === 'POST') {
        // Staff manager or admin can approve/reject qualifications
        if (activeUser.role !== 'manager' && activeUser.role !== 'admin') {
          return sendJSON(res, 403, { error: 'FORBIDDEN: Only authorized staff managers and administrators can verify qualifications' });
        }

        const verId = pathname.split('/')[3];
        const ver = db.prepare('SELECT * FROM verifications WHERE id = ?').get(verId);
        if (!ver) return sendJSON(res, 404, { error: 'Verification record not found' });

        const body = await parseBody(req);
        const decision = body.decision; // 'verified' or 'rejected'
        if (decision !== 'verified' && decision !== 'rejected') {
          return sendJSON(res, 400, { error: 'VALIDATION_ERROR: Decision must be either "verified" or "rejected"' });
        }

        const now = new Date();
        const verifiedAt = now.toISOString();
        const expiresAt = decision === 'verified' 
          ? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString() // 1 year validity
          : null;

        const stmt = db.prepare(`
          UPDATE verifications SET
            status = ?,
            verifier_id = ?,
            verified_at = ?,
            expires_at = ?,
            notes = ?
          WHERE id = ?
        `);
        stmt.run(decision, activeUser.id, verifiedAt, expiresAt, body.notes || (decision === 'verified' ? 'Approved by staff review' : 'Rejected after inspection'), verId);

        // Notify requester
        pushNotification(
          ver.user_id,
          `Qualification Review: ${ver.requirement_name}`,
          decision === 'verified' ? 'Your qualification was approved and is now active.' : `Your qualification was rejected: ${body.notes || 'Did not meet requirements'}.`,
          decision === 'verified' ? 'success' : 'danger'
        );

        logAudit(activeUser, 'VERIFICATION_REVIEW', 'verification', verId, 'success', `Marked ${decision} by ${activeUser.name}`, body.notes);
        return sendJSON(res, 200, { message: `Qualification successfully marked as ${decision}` });
      }

      // --- BOOKINGS & FAIR ALLOCATION (FR-05, FR-06, FR-07, FR-08) ---
      if (pathname === '/api/bookings' && method === 'GET') {
        let query = `
          SELECT b.*, 
                 r.name AS resource_name, r.category AS resource_category, r.location AS resource_location, r.asset_tag,
                 u.name AS requester_name, u.email AS requester_email, u.department AS requester_dept,
                 o.name AS owner_name, o.id AS owner_id
          FROM bookings b
          JOIN resources r ON b.resource_id = r.id
          JOIN users u ON b.requester_id = u.id
          JOIN users o ON r.owner_id = o.id
          WHERE 1=1
        `;
        const params = [];

        if (activeUser.role === 'requester') {
          query += ' AND b.requester_id = ?';
          params.push(activeUser.id);
        } else if (activeUser.role === 'owner') {
          query += ' AND r.owner_id = ?';
          params.push(activeUser.id);
        }
        // Staff and Admin see all bookings

        const statusFilter = urlObj.searchParams.get('status');
        if (statusFilter && statusFilter !== 'all') {
          query += ' AND b.status = ?';
          params.push(statusFilter);
        }

        query += ' ORDER BY b.created_at DESC';
        const bookings = db.prepare(query).all(...params);
        return sendJSON(res, 200, { bookings });
      }

      if (pathname.match(/^\/api\/bookings\/[a-zA-Z0-9_-]+$/) && method === 'GET') {
        const bookingId = pathname.split('/')[3];
        const booking = db.prepare(`
          SELECT b.*, 
                 r.name AS resource_name, r.category AS resource_category, r.location AS resource_location, r.asset_tag,
                 r.operating_rules, r.required_qualification,
                 u.name AS requester_name, u.email AS requester_email, u.department AS requester_dept,
                 o.name AS owner_name, o.id AS owner_id
          FROM bookings b
          JOIN resources r ON b.resource_id = r.id
          JOIN users u ON b.requester_id = u.id
          JOIN users o ON r.owner_id = o.id
          WHERE b.id = ?
        `).get(bookingId);

        if (!booking) return sendJSON(res, 404, { error: 'Booking not found' });

        // Authorization check: requester, owner, or staff/admin
        if (activeUser.role === 'requester' && booking.requester_id !== activeUser.id) {
          return sendJSON(res, 403, { error: 'FORBIDDEN: You cannot view this booking' });
        }
        if (activeUser.role === 'owner' && booking.owner_id !== activeUser.id) {
          return sendJSON(res, 403, { error: 'FORBIDDEN: You do not own this resource' });
        }

        // Fetch condition reports
        const conditionReports = db.prepare('SELECT * FROM condition_reports WHERE booking_id = ? ORDER BY recorded_at ASC').all(bookingId);
        // Fetch incidents
        const incidents = db.prepare('SELECT * FROM incidents WHERE booking_id = ? ORDER BY created_at DESC').all(bookingId);

        return sendJSON(res, 200, { booking, conditionReports, incidents });
      }

      if (pathname === '/api/bookings' && method === 'POST') {
        const body = await parseBody(req);
        const { resource_id, start_time, end_time, purpose } = body;

        if (!resource_id || !start_time || !end_time || !purpose) {
          return sendJSON(res, 400, { error: 'VALIDATION_ERROR: resource_id, start_time, end_time, and purpose are required' });
        }

        const start = new Date(start_time);
        const end = new Date(end_time);
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
          return sendJSON(res, 400, { error: 'VALIDATION_ERROR: Invalid booking time window (end time must be after start time)' });
        }

        const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(resource_id);
        if (!resource) return sendJSON(res, 404, { error: 'Resource not found' });
        if (resource.status !== 'published') {
          return sendJSON(res, 400, { error: 'VALIDATION_ERROR: Cannot book an unpublished or maintenance resource' });
        }

        // Check duration bounds
        const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        if (durationHours < resource.min_duration_hours || durationHours > resource.max_duration_hours) {
          return sendJSON(res, 400, {
            error: `VALIDATION_ERROR: Booking duration of ${durationHours.toFixed(1)}h is outside allowed limits (${resource.min_duration_hours}h - ${resource.max_duration_hours}h)`
          });
        }

        // Check Eligibility (FR-04)
        if (resource.required_qualification) {
          const userVer = db.prepare(`
            SELECT * FROM verifications 
            WHERE user_id = ? AND requirement_type = ? AND status = 'verified'
          `).get(activeUser.id, resource.required_qualification);

          if (!userVer) {
            logAudit(activeUser, 'BOOKING_REQUEST_BLOCKED', 'resource', resource.id, 'denied', 'Eligibility qualification missing or not verified', `Requires ${resource.required_qualification}`);
            return sendJSON(res, 403, {
              error: 'ELIGIBILITY_BLOCKED',
              message: `You do not have the required verified qualification (${resource.required_qualification.replace('_', ' ')}) to book this restricted resource. Please visit the Verification tab to complete requirements.`
            });
          }

          // Check expiry
          if (userVer.expires_at && new Date(userVer.expires_at) < new Date()) {
            logAudit(activeUser, 'BOOKING_REQUEST_BLOCKED', 'resource', resource.id, 'denied', 'Eligibility qualification expired', `Expired on ${userVer.expires_at}`);
            return sendJSON(res, 403, {
              error: 'ELIGIBILITY_EXPIRED',
              message: `Your verified qualification (${resource.required_qualification}) has expired. Please submit updated evidence.`
            });
          }
        }

        // Check Fair-Use Policy limits (FR-08)
        const policyLimitRow = db.prepare('SELECT value FROM policies WHERE key = ?').get('max_active_bookings_per_user');
        const maxActiveLimit = policyLimitRow ? parseInt(policyLimitRow.value, 10) : 3;

        const activeBookingsCount = db.prepare(`
          SELECT COUNT(*) AS count FROM bookings 
          WHERE requester_id = ? AND status IN ('submitted', 'approved', 'in_use')
        `).get(activeUser.id).count;

        if (activeBookingsCount >= maxActiveLimit) {
          logAudit(activeUser, 'FAIR_USE_LIMIT_EXCEEDED', 'booking', 'new', 'denied', `User has ${activeBookingsCount} active reservations; limit is ${maxActiveLimit}`);
          return sendJSON(res, 429, {
            error: 'FAIR_USE_LIMIT_EXCEEDED',
            message: `Fair allocation limit reached: you already have ${activeBookingsCount} active bookings (maximum allowed: ${maxActiveLimit}). Please complete or cancel existing bookings first.`
          });
        }

        // Transactional Concurrency & Conflict Check (FR-07)
        db.exec('BEGIN IMMEDIATE');
        try {
          const overlap = db.prepare(`
            SELECT id, status FROM bookings 
            WHERE resource_id = ? 
              AND status IN ('approved', 'in_use')
              AND start_time < ? 
              AND end_time > ?
          `).get(resource_id, end_time, start_time);

          let initialStatus = resource.requires_approval ? 'submitted' : 'approved';
          let waitlistPos = null;

          if (overlap) {
            // Check waitlist policy
            const waitlistCount = db.prepare(`
              SELECT COUNT(*) AS count FROM bookings 
              WHERE resource_id = ? AND status = 'waitlisted'
            `).get(resource_id).count;

            waitlistPos = waitlistCount + 1;
            initialStatus = 'waitlisted';
          }

          const bookingId = 'bok_' + crypto.randomUUID().slice(0, 8);
          const nowIso = new Date().toISOString();

          const insertBooking = db.prepare(`
            INSERT INTO bookings (
              id, resource_id, requester_id, start_time, end_time, purpose, 
              status, waitlist_position, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          insertBooking.run(
            bookingId, resource_id, activeUser.id, start_time, end_time, purpose,
            initialStatus, waitlistPos, nowIso, nowIso
          );

          db.exec('COMMIT');

          // Side-effects: Notifications & Audit
          if (initialStatus === 'waitlisted') {
            logAudit(activeUser, 'BOOKING_WAITLISTED', 'booking', bookingId, 'conflict', `Slot occupied; placed in queue position #${waitlistPos}`);
            pushNotification(activeUser.id, 'Booking Placed on Waitlist', `Resource slot was occupied. Your request is queued at position #${waitlistPos}.`, 'warning');
            return sendJSON(res, 201, {
              id: bookingId,
              status: 'waitlisted',
              waitlist_position: waitlistPos,
              message: `Requested slot is occupied by an existing confirmed booking. You have been placed on the waiting list at position #${waitlistPos}.`
            });
          }

          if (initialStatus === 'approved') {
            logAudit(activeUser, 'BOOKING_AUTO_APPROVED', 'booking', bookingId, 'success', 'Instant approval resource confirmed');
            pushNotification(activeUser.id, 'Booking Confirmed', `Your booking for ${resource.name} is confirmed!`, 'success');
            return sendJSON(res, 201, {
              id: bookingId,
              status: 'approved',
              message: 'Booking automatically approved and confirmed!'
            });
          }

          // Status: submitted (requires human review)
          logAudit(activeUser, 'BOOKING_SUBMITTED', 'booking', bookingId, 'success', 'Submitted for owner review');
          pushNotification(resource.owner_id, 'New Booking Request', `${activeUser.name} requested to book ${resource.name}.`, 'info');
          pushNotification(activeUser.id, 'Booking Submitted', `Your request for ${resource.name} is pending owner review.`, 'info');

          return sendJSON(res, 201, {
            id: bookingId,
            status: 'submitted',
            message: 'Booking request submitted successfully and is awaiting review.'
          });

        } catch (txErr) {
          db.exec('ROLLBACK');
          console.error('Booking transaction failure:', txErr);
          return sendJSON(res, 500, { error: 'INTERNAL_ERROR: Booking failed due to database conflict' });
        }
      }

      // Booking Decision: Approve / Reject / Waitlist (FR-06)
      if (pathname.match(/^\/api\/bookings\/[a-zA-Z0-9_-]+\/decide$/) && method === 'POST') {
        const bookingId = pathname.split('/')[3];
        const booking = db.prepare(`
          SELECT b.*, r.owner_id, r.name AS resource_name 
          FROM bookings b 
          JOIN resources r ON b.resource_id = r.id 
          WHERE b.id = ?
        `).get(bookingId);

        if (!booking) return sendJSON(res, 404, { error: 'Booking not found' });

        // Authorized: Owner, Manager, or Admin
        if (activeUser.role !== 'admin' && activeUser.role !== 'manager' && booking.owner_id !== activeUser.id) {
          return sendJSON(res, 403, { error: 'FORBIDDEN: Only resource owners, managers, or administrators can decide on bookings' });
        }

        const body = await parseBody(req);
        const { decision, reason } = body; // 'approved', 'rejected', 'waitlisted'

        if (!decision || !['approved', 'rejected', 'waitlisted'].includes(decision)) {
          return sendJSON(res, 400, { error: 'VALIDATION_ERROR: Decision must be approved, rejected, or waitlisted' });
        }

        if (!reason && (decision === 'rejected' || decision === 'waitlisted')) {
          return sendJSON(res, 400, { error: 'VALIDATION_ERROR: A clear decision reason is mandatory for rejection or waitlisting' });
        }

        db.exec('BEGIN IMMEDIATE');
        try {
          if (decision === 'approved') {
            // Re-verify no active overlap before locking in approval
            const overlap = db.prepare(`
              SELECT id FROM bookings 
              WHERE resource_id = ? 
                AND id != ?
                AND status IN ('approved', 'in_use')
                AND start_time < ? 
                AND end_time > ?
            `).get(booking.resource_id, booking.id, booking.end_time, booking.start_time);

            if (overlap) {
              db.exec('ROLLBACK');
              return sendJSON(res, 409, {
                error: 'CONFLICT',
                message: 'Cannot approve: another confirmed booking already occupies this time interval.'
              });
            }
          }

          const nowIso = new Date().toISOString();
          const stmt = db.prepare(`
            UPDATE bookings SET
              status = ?,
              decision_by = ?,
              decision_reason = ?,
              decision_at = ?,
              waitlist_position = CASE WHEN ? = 'waitlisted' THEN 1 ELSE NULL END,
              updated_at = ?
            WHERE id = ?
          `);

          stmt.run(decision, activeUser.id, reason || 'Approved by resource custodian', nowIso, decision, nowIso, bookingId);
          db.exec('COMMIT');

          // Notifications & Audit
          pushNotification(
            booking.requester_id,
            `Booking Decision: ${decision.toUpperCase()}`,
            `Your booking for ${booking.resource_name} was ${decision}. Reason: ${reason || 'Approved'}.`,
            decision === 'approved' ? 'success' : 'warning'
          );

          logAudit(activeUser, `BOOKING_${decision.toUpperCase()}`, 'booking', bookingId, 'success', reason || `Marked ${decision}`);
          return sendJSON(res, 200, { message: `Booking successfully ${decision}` });

        } catch (err) {
          db.exec('ROLLBACK');
          return sendJSON(res, 500, { error: 'Failed to record decision' });
        }
      }

      // Booking Cancellation & Auto-Promotion (FR-13, FR-08)
      if (pathname.match(/^\/api\/bookings\/[a-zA-Z0-9_-]+\/cancel$/) && method === 'POST') {
        const bookingId = pathname.split('/')[3];
        const booking = db.prepare(`
          SELECT b.*, r.owner_id, r.name AS resource_name 
          FROM bookings b 
          JOIN resources r ON b.resource_id = r.id 
          WHERE b.id = ?
        `).get(bookingId);

        if (!booking) return sendJSON(res, 404, { error: 'Booking not found' });

        if (activeUser.role === 'requester' && booking.requester_id !== activeUser.id) {
          return sendJSON(res, 403, { error: 'FORBIDDEN: You cannot cancel another user\'s booking' });
        }

        const body = await parseBody(req);
        const reason = body.reason || 'Cancelled by user';
        const nowIso = new Date().toISOString();

        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare(`
            UPDATE bookings SET
              status = 'cancelled',
              decision_reason = ?,
              updated_at = ?
            WHERE id = ?
          `).run(reason, nowIso, bookingId);

          // Check if there is an eligible waitlisted booking to auto-promote
          const waitlisted = db.prepare(`
            SELECT id, requester_id FROM bookings 
            WHERE resource_id = ? AND status = 'waitlisted'
            ORDER BY created_at ASC LIMIT 1
          `).get(booking.resource_id);

          let promotedId = null;
          if (waitlisted) {
            promotedId = waitlisted.id;
            db.prepare(`
              UPDATE bookings SET
                status = 'approved',
                waitlist_position = NULL,
                decision_reason = 'Auto-promoted from waitlist upon slot cancellation',
                updated_at = ?
              WHERE id = ?
            `).run(nowIso, waitlisted.id);

            pushNotification(
              waitlisted.requester_id,
              'Waitlist Promotion: Slot Confirmed!',
              `A slot opened for ${booking.resource_name} and your booking has been confirmed!`,
              'success'
            );
          }

          db.exec('COMMIT');

          logAudit(activeUser, 'BOOKING_CANCELLED', 'booking', bookingId, 'success', reason, promotedId ? `Auto-promoted waitlisted booking ${promotedId}` : null);
          return sendJSON(res, 200, {
            message: 'Booking cancelled successfully',
            promoted_waitlist_booking: promotedId
          });

        } catch (err) {
          db.exec('ROLLBACK');
          return sendJSON(res, 500, { error: 'Failed to cancel booking' });
        }
      }

      // --- HANDOVER & RETURN WORKSPACE (FR-09, FR-10, FR-11) ---
      // Record Pickup (Handover)
      if (pathname === '/api/handover/pickup' && method === 'POST') {
        const body = await parseBody(req);
        const { booking_id, condition_rating, checklist_clean, checklist_operational, checklist_accessories_intact, notes } = body;

        if (!booking_id) return sendJSON(res, 400, { error: 'VALIDATION_ERROR: booking_id is required' });

        const booking = db.prepare(`
          SELECT b.*, r.owner_id, r.name AS resource_name, r.asset_tag 
          FROM bookings b 
          JOIN resources r ON b.resource_id = r.id 
          WHERE b.id = ?
        `).get(booking_id);

        if (!booking) return sendJSON(res, 404, { error: 'Booking not found' });

        if (booking.status !== 'approved') {
          return sendJSON(res, 400, { error: `INVALID_STATE: Cannot record pickup for booking in status "${booking.status}" (must be "approved")` });
        }

        // Requester or Owner or Staff can record pickup
        const nowIso = new Date().toISOString();
        const reportId = 'cnd_' + crypto.randomUUID().slice(0, 8);

        db.exec('BEGIN IMMEDIATE');
        try {
          // Record condition report
          db.prepare(`
            INSERT INTO condition_reports (
              id, booking_id, resource_id, stage, recorded_by, recorded_at,
              condition_rating, checklist_clean, checklist_operational, checklist_accessories_intact, notes
            ) VALUES (?, ?, ?, 'pickup', ?, ?, ?, ?, ?, ?, ?)
          `).run(
            reportId, booking_id, booking.resource_id, activeUser.id, nowIso,
            condition_rating || 'Excellent',
            checklist_clean ? 1 : 0,
            checklist_operational ? 1 : 0,
            checklist_accessories_intact ? 1 : 0,
            notes || 'Initial handover condition verified.'
          );

          // Update booking status
          db.prepare(`
            UPDATE bookings SET
              status = 'in_use',
              pickup_at = ?,
              pickup_by = ?,
              updated_at = ?
            WHERE id = ?
          `).run(nowIso, activeUser.id, nowIso, booking_id);

          db.exec('COMMIT');

          pushNotification(booking.requester_id, 'Pickup Confirmed', `Handover recorded for ${booking.resource_name}. Item is now In-Use.`, 'info');
          logAudit(activeUser, 'HANDOVER_PICKUP', 'booking', booking_id, 'success', `Recorded initial condition: ${condition_rating || 'Excellent'}`);

          return sendJSON(res, 200, { message: 'Pickup recorded successfully. Booking is now In-Use.' });

        } catch (err) {
          db.exec('ROLLBACK');
          return sendJSON(res, 500, { error: 'Failed to record pickup' });
        }
      }

      // Confirm Return
      if (pathname === '/api/handover/return' && method === 'POST') {
        const body = await parseBody(req);
        const { booking_id, condition_rating, checklist_clean, checklist_operational, checklist_accessories_intact, notes, flag_incident, incident_description } = body;

        if (!booking_id) return sendJSON(res, 400, { error: 'VALIDATION_ERROR: booking_id is required' });

        const booking = db.prepare(`
          SELECT b.*, r.owner_id, r.name AS resource_name 
          FROM bookings b 
          JOIN resources r ON b.resource_id = r.id 
          WHERE b.id = ?
        `).get(booking_id);

        if (!booking) return sendJSON(res, 404, { error: 'Booking not found' });

        if (booking.status !== 'in_use') {
          return sendJSON(res, 400, { error: `INVALID_STATE: Cannot record return for booking in status "${booking.status}" (must be "in_use")` });
        }

        const nowIso = new Date().toISOString();
        const reportId = 'cnd_' + crypto.randomUUID().slice(0, 8);
        const finalStatus = flag_incident ? 'disputed' : 'completed';

        db.exec('BEGIN IMMEDIATE');
        try {
          // Record return condition report
          db.prepare(`
            INSERT INTO condition_reports (
              id, booking_id, resource_id, stage, recorded_by, recorded_at,
              condition_rating, checklist_clean, checklist_operational, checklist_accessories_intact, notes
            ) VALUES (?, ?, ?, 'return', ?, ?, ?, ?, ?, ?, ?)
          `).run(
            reportId, booking_id, booking.resource_id, activeUser.id, nowIso,
            condition_rating || 'Good',
            checklist_clean ? 1 : 0,
            checklist_operational ? 1 : 0,
            checklist_accessories_intact ? 1 : 0,
            notes || 'Return condition inspected.'
          );

          // Update booking status
          db.prepare(`
            UPDATE bookings SET
              status = ?,
              return_at = ?,
              return_by = ?,
              updated_at = ?
            WHERE id = ?
          `).run(finalStatus, nowIso, activeUser.id, nowIso, booking_id);

          let incidentId = null;
          if (flag_incident) {
            incidentId = 'inc_' + crypto.randomUUID().slice(0, 8);
            db.prepare(`
              INSERT INTO incidents (
                id, booking_id, resource_id, reported_by, type, severity, description, status, created_at
              ) VALUES (?, ?, ?, ?, 'damage', 'medium', ?, 'open', ?)
            `).run(
              incidentId, booking_id, booking.resource_id, activeUser.id,
              incident_description || 'Condition discrepancy or damage reported at return check-in.',
              nowIso
            );
          }

          db.exec('COMMIT');

          pushNotification(booking.requester_id, 'Return Confirmed', `Return recorded for ${booking.resource_name}. Status: ${finalStatus}.`, flag_incident ? 'warning' : 'success');
          logAudit(activeUser, 'HANDOVER_RETURN', 'booking', booking_id, 'success', `Return recorded. Condition: ${condition_rating}. Outcome: ${finalStatus}`, incidentId ? `Opened incident ${incidentId}` : null);

          return sendJSON(res, 200, {
            message: `Return recorded successfully. Transaction marked as ${finalStatus}.`,
            incident_id: incidentId
          });

        } catch (err) {
          db.exec('ROLLBACK');
          return sendJSON(res, 500, { error: 'Failed to record return' });
        }
      }

      // --- INCIDENTS & DISPUTES (FR-12) ---
      if (pathname === '/api/incidents' && method === 'GET') {
        let query = `
          SELECT i.*, 
                 r.name AS resource_name, r.asset_tag,
                 u.name AS reporter_name,
                 s.name AS resolver_name
          FROM incidents i
          JOIN resources r ON i.resource_id = r.id
          JOIN users u ON i.reported_by = u.id
          LEFT JOIN users s ON i.resolved_by = s.id
          WHERE 1=1
        `;
        const params = [];

        if (activeUser.role === 'requester') {
          query += ' AND i.reported_by = ?';
          params.push(activeUser.id);
        } else if (activeUser.role === 'owner') {
          query += ' AND r.owner_id = ?';
          params.push(activeUser.id);
        }

        query += ' ORDER BY i.created_at DESC';
        const incidents = db.prepare(query).all(...params);
        return sendJSON(res, 200, { incidents });
      }

      if (pathname === '/api/incidents' && method === 'POST') {
        const body = await parseBody(req);
        const { booking_id, type, severity, description } = body;

        if (!booking_id || !type || !description) {
          return sendJSON(res, 400, { error: 'VALIDATION_ERROR: booking_id, type, and description are required' });
        }

        const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking_id);
        if (!booking) return sendJSON(res, 404, { error: 'Booking not found' });

        const id = 'inc_' + crypto.randomUUID().slice(0, 8);
        const nowIso = new Date().toISOString();

        db.prepare(`
          INSERT INTO incidents (
            id, booking_id, resource_id, reported_by, type, severity, description, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)
        `).run(id, booking_id, booking.resource_id, activeUser.id, type, severity || 'medium', description, nowIso);

        logAudit(activeUser, 'INCIDENT_REPORTED', 'incident', id, 'success', `Reported ${type} with severity ${severity || 'medium'}`);
        return sendJSON(res, 201, { id, message: 'Incident reported successfully and queued for staff review' });
      }

      if (pathname.match(/^\/api\/incidents\/[a-zA-Z0-9_-]+\/resolve$/) && method === 'POST') {
        if (activeUser.role !== 'manager' && activeUser.role !== 'admin' && activeUser.role !== 'owner') {
          return sendJSON(res, 403, { error: 'FORBIDDEN: Only authorized staff or resource owners can resolve incidents' });
        }

        const incidentId = pathname.split('/')[3];
        const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incidentId);
        if (!incident) return sendJSON(res, 404, { error: 'Incident not found' });

        const body = await parseBody(req);
        const resolutionNotes = body.resolution_notes || 'Reviewed and resolved by staff.';
        const status = body.status || 'resolved'; // 'resolved' or 'dismissed'
        const nowIso = new Date().toISOString();

        db.prepare(`
          UPDATE incidents SET
            status = ?,
            resolution_notes = ?,
            resolved_by = ?,
            resolved_at = ?
          WHERE id = ?
        `).run(status, resolutionNotes, activeUser.id, nowIso, incidentId);

        logAudit(activeUser, 'INCIDENT_RESOLVED', 'incident', incidentId, 'success', `Status: ${status}. Notes: ${resolutionNotes}`);
        return sendJSON(res, 200, { message: `Incident successfully marked as ${status}` });
      }

      // --- AUDIT TRAIL & POLICIES (FR-15, FR-16, FR-17) ---
      if (pathname === '/api/audit' && method === 'GET') {
        let query = 'SELECT * FROM audit_events WHERE 1=1';
        const params = [];

        // Requesters can only see their own audit events
        if (activeUser.role === 'requester') {
          query += ' AND actor_id = ?';
          params.push(activeUser.id);
        }

        query += ' ORDER BY created_at DESC LIMIT 100';
        const events = db.prepare(query).all(...params);
        return sendJSON(res, 200, { events });
      }

      if (pathname === '/api/policies' && method === 'GET') {
        const policies = db.prepare('SELECT * FROM policies').all();
        return sendJSON(res, 200, { policies });
      }

      if (pathname === '/api/policies' && method === 'POST') {
        if (activeUser.role !== 'admin') {
          return sendJSON(res, 403, { error: 'FORBIDDEN: Only administrators can modify platform fair-use policies' });
        }

        const body = await parseBody(req);
        const { key, value } = body;
        if (!key || value === undefined) {
          return sendJSON(res, 400, { error: 'VALIDATION_ERROR: Policy key and value are required' });
        }

        const nowIso = new Date().toISOString();
        db.prepare('UPDATE policies SET value = ?, updated_at = ? WHERE key = ?').run(String(value), nowIso, key);

        logAudit(activeUser, 'POLICY_UPDATE', 'policy', key, 'success', `Updated policy ${key} to ${value}`);
        return sendJSON(res, 200, { message: `Policy ${key} updated successfully` });
      }

      // --- NOTIFICATIONS (FR-14) ---
      if (pathname === '/api/notifications' && method === 'GET') {
        const notifications = db.prepare(`
          SELECT * FROM notifications 
          WHERE user_id = ? 
          ORDER BY created_at DESC LIMIT 50
        `).all(activeUser.id);
        return sendJSON(res, 200, { notifications });
      }

      if (pathname.match(/^\/api\/notifications\/[a-zA-Z0-9_-]+\/read$/) && method === 'POST') {
        const notifId = pathname.split('/')[3];
        db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(notifId, activeUser.id);
        return sendJSON(res, 200, { message: 'Notification marked as read' });
      }

      if (pathname === '/api/notifications/read-all' && method === 'POST') {
        db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(activeUser.id);
        return sendJSON(res, 200, { message: 'All notifications marked as read' });
      }

      return sendJSON(res, 404, { error: 'API endpoint not found' });

    } catch (apiErr) {
      console.error('API Error:', apiErr);
      return sendJSON(res, 500, { error: 'Internal server error: ' + apiErr.message });
    }
  }

  // --- STATIC FILE SERVING ---
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // Fallback to index.html for SPA style routing if needed
        fs.readFile(path.join(__dirname, 'index.html'), (err2, indexContent) => {
          if (err2) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('404 Not Found');
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(indexContent);
        });
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Resource-Sharing Platform server running on http://localhost:${PORT}`);
});
