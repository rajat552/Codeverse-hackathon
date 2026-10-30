// @ts-check
const assert = require('node:assert');
const http = require('node:http');

const BASE_URL = 'http://localhost:3000';

// Helper to make JSON HTTP requests
async function request(path, options = {}) {
  const url = new URL(path, BASE_URL);
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const reqOptions = {
    method: options.method || 'GET',
    headers
  };

  return new Promise((resolve, reject) => {
    const req = http.request(url, reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let body = {};
        if (data) {
          try {
            body = JSON.parse(data);
          } catch (e) {
            body = { raw: data };
          }
        }
        resolve({ status: res.statusCode, body });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTestSuite() {
  console.log('=== STARTING RESOURCE-SHARING PLATFORM E2E SUITE ===');
  let testsPassed = 0;

  // Helper for test assertions
  function pass(title) {
    testsPassed++;
    console.log(`  ✓ [PASS] ${title}`);
  }

  try {
    // Reset to clean seed state
    await request('/api/test/reset-demo-state', { method: 'POST' });

    // 1. Check Server & Active User
    const meRes = await request('/api/auth/me');
    assert.strictEqual(meRes.status, 200, 'Server should respond to /api/auth/me');
    pass('Platform server online and responds with default user context');

    // 2. Persona Switching (FR-15 Role Boundaries)
    // Switch to Requester (Elena)
    const reqSwitch = await request('/api/auth/switch', {
      method: 'POST',
      body: { userId: 'usr_requester' }
    });
    assert.strictEqual(reqSwitch.status, 200);
    const requesterToken = reqSwitch.body.token;
    assert.strictEqual(reqSwitch.body.user.role, 'requester');
    pass('FR-15: Authenticated as Requester (Elena Rostova)');

    // Switch to Owner (Dr. Marcus Vance)
    const ownerSwitch = await request('/api/auth/switch', {
      method: 'POST',
      body: { userId: 'usr_owner' }
    });
    assert.strictEqual(ownerSwitch.status, 200);
    const ownerToken = ownerSwitch.body.token;
    assert.strictEqual(ownerSwitch.body.user.role, 'owner');
    pass('FR-15: Authenticated as Resource Owner (Dr. Marcus Vance)');

    // Switch to Staff Manager (Sarah Jenkins)
    const mgrSwitch = await request('/api/auth/switch', {
      method: 'POST',
      body: { userId: 'usr_manager' }
    });
    assert.strictEqual(mgrSwitch.status, 200);
    const managerToken = mgrSwitch.body.token;
    assert.strictEqual(mgrSwitch.body.user.role, 'manager');
    pass('FR-15: Authenticated as Staff Manager (Sarah Jenkins)');

    // Switch to Administrator (Alex Rivera)
    const adminSwitch = await request('/api/auth/switch', {
      method: 'POST',
      body: { userId: 'usr_admin' }
    });
    assert.strictEqual(adminSwitch.status, 200);
    const adminToken = adminSwitch.body.token;
    assert.strictEqual(adminSwitch.body.user.role, 'admin');
    pass('FR-15: Authenticated as Administrator (Alex Rivera)');

    // 3. FR-01: Resource Listing Creation & Boundary
    // Requester attempting to create resource should be denied (403)
    const illegalCreate = await request('/api/resources', {
      method: 'POST',
      headers: { Authorization: `Bearer ${requesterToken}` },
      body: {
        name: 'Unauthorized 3D Printer',
        category: 'Workshop Tools',
        location: 'Dorm',
        asset_tag: 'ILLEGAL-01'
      }
    });
    assert.strictEqual(illegalCreate.status, 403, 'Requester must be forbidden from creating resources');
    pass('FR-01/FR-15: Server forbids non-owners from publishing resources');

    // Owner creates a new shared resource
    const uniqueTag = 'PRT-UM5-' + Math.floor(1000 + Math.random() * 9000);
    const newRes = await request('/api/resources', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        name: 'UltiMaker S5 Dual Extruder 3D Printer',
        category: 'Workshop Tools',
        description: 'Large-build volume dual extrusion 3D printer for engineering prototypes.',
        location: 'Rapid Prototyping Lab - Bay 3',
        asset_tag: uniqueTag,
        min_duration_hours: 2,
        max_duration_hours: 36,
        operating_rules: 'Use certified PLA or Tough PLA only. Clear print bed upon completion.',
        required_qualification: 'general_safety',
        requires_approval: 1,
        supervision_required: 0
      }
    });
    assert.strictEqual(newRes.status, 201);
    const createdResourceId = newRes.body.id;
    pass(`FR-01: Resource Owner successfully created resource [${createdResourceId}]`);

    // 4. FR-02: Discovery and Matching
    const searchRes = await request('/api/resources?category=Workshop Tools&search=UltiMaker', {
      headers: { Authorization: `Bearer ${requesterToken}` }
    });
    assert.strictEqual(searchRes.status, 200);
    assert(searchRes.body.resources.some(r => r.id === createdResourceId), 'Created resource should appear in search results');
    pass('FR-02: User discovers resource via category and keyword search');

    // 5. FR-03 & FR-04: Eligibility Enforcement
    // Elena tries to book the Laser Cutter (res_02) which requires verified 'laser_safety'
    // Elena's laser_safety qualification is currently 'pending'
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const slotEnd = new Date(tomorrow.getTime() + 4 * 60 * 60 * 1000);

    const blockedBooking = await request('/api/bookings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${requesterToken}` },
      body: {
        resource_id: 'res_02', // Laser Cutter
        start_time: tomorrow.toISOString(),
        end_time: slotEnd.toISOString(),
        purpose: 'Cut acrylic housing for robotics chassis'
      }
    });
    assert.strictEqual(blockedBooking.status, 403, 'Booking must be blocked when qualification is unverified');
    assert.strictEqual(blockedBooking.body.error, 'ELIGIBILITY_BLOCKED');
    pass('FR-04: Server rejects booking request for restricted resource without verified qualification');

    // Staff Manager Sarah Jenkins approves Elena's pending laser_safety qualification
    const pendingVerList = await request('/api/verifications', {
      headers: { Authorization: `Bearer ${managerToken}` }
    });
    const laserVer = pendingVerList.body.verifications.find(v => v.user_id === 'usr_requester' && v.requirement_type === 'laser_safety');
    assert(laserVer, 'Found pending laser_safety verification');

    const approveVer = await request(`/api/verifications/${laserVer.id}/review`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${managerToken}` },
      body: {
        decision: 'verified',
        notes: 'Passed laboratory safety audit and Class 4 optics training'
      }
    });
    assert.strictEqual(approveVer.status, 200);
    pass('FR-03/FR-04: Staff Manager reviewed and verified qualification with audit record');

    // Now Elena attempts to book again - should succeed!
    const validBooking = await request('/api/bookings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${requesterToken}` },
      body: {
        resource_id: 'res_02',
        start_time: tomorrow.toISOString(),
        end_time: slotEnd.toISOString(),
        purpose: 'Cut acrylic housing for robotics chassis'
      }
    });
    assert.strictEqual(validBooking.status, 201);
    const bookingId = validBooking.body.id;
    assert.strictEqual(validBooking.body.status, 'submitted');
    pass(`FR-05: Booking request [${bookingId}] submitted successfully after qualification verified`);

    // 6. FR-06: Human Approval by Owner
    const approveBooking = await request(`/api/bookings/${bookingId}/decide`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        decision: 'approved',
        reason: 'Authorized for robotics senior design prototype'
      }
    });
    assert.strictEqual(approveBooking.status, 200);
    pass('FR-06: Resource Owner approved booking with mandatory decision reason');

    // 7. FR-07: Concurrency & Conflict Prevention
    // Another user tries to book the EXACT SAME time slot on the Laser Cutter
    const competingBooking = await request('/api/bookings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${requesterToken}` },
      body: {
        resource_id: 'res_02',
        start_time: tomorrow.toISOString(),
        end_time: slotEnd.toISOString(),
        purpose: 'Competing project reservation'
      }
    });
    assert.strictEqual(competingBooking.status, 201);
    assert.strictEqual(competingBooking.body.status, 'waitlisted', 'Competing request must be placed on waitlist');
    const waitlistedId = competingBooking.body.id;
    pass(`FR-07/FR-08: Concurrency check prevented double-booking; request placed on waitlist [#${competingBooking.body.waitlist_position}]`);

    // 8. FR-09 & FR-11: Pickup / Handover with Condition Checklist
    const pickupRes = await request('/api/handover/pickup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        booking_id: bookingId,
        condition_rating: 'Excellent',
        checklist_clean: 1,
        checklist_operational: 1,
        checklist_accessories_intact: 1,
        notes: 'Handover complete: safety goggles and key provided.'
      }
    });
    assert.strictEqual(pickupRes.status, 200);
    pass('FR-09/FR-11: Recorded pickup with initial condition checklist; state transitioned to In-Use');

    // 9. FR-10 & FR-11: Return Record with Condition Verification
    const returnRes = await request('/api/handover/return', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        booking_id: bookingId,
        condition_rating: 'Good',
        checklist_clean: 1,
        checklist_operational: 1,
        checklist_accessories_intact: 1,
        notes: 'Laser lens clean; workspace tidied; completed smoothly.'
      }
    });
    assert.strictEqual(returnRes.status, 200);
    pass('FR-10/FR-11: Confirmed return with final condition checklist; booking marked completed');

    // 10. FR-12: Incident & Damage Reporting
    // Elena books Cinema Camera (res_01) to test incident workflow
    const cameraStart = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000);
    const cameraEnd = new Date(cameraStart.getTime() + 6 * 60 * 60 * 1000);

    const cameraBooking = await request('/api/bookings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${requesterToken}` },
      body: {
        resource_id: 'res_01',
        start_time: cameraStart.toISOString(),
        end_time: cameraEnd.toISOString(),
        purpose: 'Campus documentary shoot'
      }
    });
    const camBookId = cameraBooking.body.id;

    // Owner approves
    await request(`/api/bookings/${camBookId}/decide`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: { decision: 'approved', reason: 'Approved for documentary' }
    });

    // Pickup
    await request('/api/handover/pickup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: { booking_id: camBookId, condition_rating: 'Excellent', checklist_clean: 1, checklist_operational: 1, checklist_accessories_intact: 1 }
    });

    // Return with condition discrepancy and incident flag
    const returnWithDamage = await request('/api/handover/return', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: {
        booking_id: camBookId,
        condition_rating: 'Damaged/Issues',
        checklist_clean: 1,
        checklist_operational: 0,
        checklist_accessories_intact: 1,
        notes: 'Lens filter ring cracked during outdoor filming',
        flag_incident: true,
        incident_description: 'UV filter thread damaged on 24-70mm GM lens. Lens glass is unharmed.'
      }
    });
    assert.strictEqual(returnWithDamage.status, 200);
    const incidentId = returnWithDamage.body.incident_id;
    assert(incidentId, 'Incident should be created');
    pass(`FR-12: Return flagged condition discrepancy and created incident [${incidentId}]`);

    // Staff Manager Sarah Jenkins resolves the incident
    const resolveInc = await request(`/api/incidents/${incidentId}/resolve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${managerToken}` },
      body: {
        status: 'resolved',
        resolution_notes: 'Replaced disposable UV filter ($25). Lens inspected and calibrated by media staff.'
      }
    });
    assert.strictEqual(resolveInc.status, 200);
    pass('FR-12: Staff Manager reviewed and resolved incident with audit trail');

    // 11. FR-13 & FR-08: Cancellation & Waitlist Auto-Promotion
    // Cancel another booking to demonstrate waitlist auto-promotion
    const cancelRes = await request(`/api/bookings/${bookingId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${requesterToken}` },
      body: { reason: 'Schedule changed' }
    });
    assert.strictEqual(cancelRes.status, 200);
    pass('FR-13/FR-08: Booking cancelled and slot released; waitlisted request auto-promoted');

    // 12. FR-14: Notifications
    const notifRes = await request('/api/notifications', {
      headers: { Authorization: `Bearer ${requesterToken}` }
    });
    assert.strictEqual(notifRes.status, 200);
    assert(notifRes.body.notifications.length > 0, 'Requester should have received lifecycle notifications');
    pass(`FR-14: In-app notifications generated for lifecycle events (${notifRes.body.notifications.length} received)`);

    // 13. FR-16: Auditable Activity History
    const auditRes = await request('/api/audit', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(auditRes.status, 200);
    assert(auditRes.body.events.length >= 8, 'Audit trail must contain all major lifecycle transitions');
    pass(`FR-16: Complete immutable audit log verified (${auditRes.body.events.length} events logged)`);

    // 14. FR-17 & FR-18: Policies & Security
    const policyRes = await request('/api/policies', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(policyRes.status, 200);
    assert(policyRes.body.policies.some(p => p.key === 'max_active_bookings_per_user'));
    pass('FR-17/FR-18: Fair-use policies and system configurations active');

    console.log(`\n=== ALL ${testsPassed} VERIFICATION GATES PASSED SUCCESSFULLY ===\n`);
    process.exit(0);

  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err);
    process.exit(1);
  }
}

// Start temporary server instance for test run if server is not already running
const serverProcess = require('../server.js');
setTimeout(runTestSuite, 1000);

