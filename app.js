// @ts-check
/**
 * EquipShare Frontend Application
 * Fully integrated client communicating directly with Node.js SQLite Backend
 */

(function () {
  'use strict';

  // State Management
  const state = {
    currentUser: null,
    sessionToken: localStorage.getItem('equipshare_token') || null,
    resources: [],
    bookings: [],
    verifications: [],
    incidents: [],
    auditEvents: [],
    policies: [],
    notifications: [],
    activeTab: 'discover',
    bookingStatusFilter: 'all',
    categoryFilter: 'All',
    searchQuery: '',
    selectedResourceForBooking: null
  };

  // API Client Helper
  async function api(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (state.sessionToken) {
      headers['Authorization'] = `Bearer ${state.sessionToken}`;
    }

    try {
      const res = await fetch(path, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || data.error || `HTTP ${res.status}`);
      }

      return data;
    } catch (err) {
      console.error(`API Error on ${path}:`, err);
      throw err;
    }
  }

  // Toast Notification UI
  function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? 'fa-circle-check' : (type === 'error' ? 'fa-circle-exclamation' : 'fa-triangle-exclamation');
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${escapeHtml(message)}</span>`;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDate(isoStr) {
    if (!isoStr) return '-';
    const d = new Date(isoStr);
    return isNaN(d.getTime()) ? '-' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // Modal Dialog Handlers
  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('open');
      document.body.style.overflow = '';
    }
  }

  // --- CORE DATA INITIALIZATION & ROLE SYNCHRONIZATION ---
  async function initAuth() {
    try {
      const data = await api('/api/auth/me');
      state.currentUser = data.user;
      if (data.token) {
        state.sessionToken = data.token;
        localStorage.setItem('equipshare_token', data.token);
      }

      // Update persona selector to match active user
      const personaSelect = document.getElementById('personaSelect');
      if (personaSelect && state.currentUser) {
        personaSelect.value = state.currentUser.id;
      }

      applyRolePermissions();
      await refreshAllData();

    } catch (err) {
      console.error('Failed to init user session:', err);
      showToast('Could not connect to backend server. Retrying...', 'error');
    }
  }

  function applyRolePermissions() {
    const role = state.currentUser?.role || 'requester';
    const isOwnerOrAdmin = role === 'owner' || role === 'admin';
    const isManagerOrAdmin = role === 'manager' || role === 'admin';

    // Toggle navigation tab visibility according to role boundaries
    const navOwnerDesk = document.getElementById('navOwnerDesk');
    if (navOwnerDesk) {
      navOwnerDesk.style.display = isOwnerOrAdmin ? 'flex' : 'none';
    }

    const navVerifications = document.getElementById('navVerifications');
    if (navVerifications) {
      navVerifications.style.display = 'flex'; // Visible to all; managers verify, requesters submit
    }

    const navIncidents = document.getElementById('navIncidents');
    if (navIncidents) {
      navIncidents.style.display = 'flex';
    }

    const navAudit = document.getElementById('navAudit');
    if (navAudit) {
      navAudit.style.display = isManagerOrAdmin ? 'flex' : 'none';
    }

    const newResBtns = document.querySelectorAll('.hidden-for-requester');
    newResBtns.forEach(btn => {
      btn.style.display = isOwnerOrAdmin ? 'inline-flex' : 'none';
    });

    // If current tab is forbidden for new role, switch back to discover
    if (state.activeTab === 'ownerDesk' && !isOwnerOrAdmin) switchTab('discover');
    if (state.activeTab === 'audit' && !isManagerOrAdmin) switchTab('discover');
  }

  async function switchPersona(userId) {
    try {
      const data = await api('/api/auth/switch', {
        method: 'POST',
        body: { userId }
      });

      state.currentUser = data.user;
      state.sessionToken = data.token;
      localStorage.setItem('equipshare_token', data.token);

      showToast(data.message, 'success');
      applyRolePermissions();
      await refreshAllData();

    } catch (err) {
      showToast('Failed to switch persona: ' + err.message, 'error');
    }
  }

  async function refreshAllData() {
    try {
      await Promise.all([
        fetchResources(),
        fetchBookings(),
        fetchVerifications(),
        fetchIncidents(),
        fetchNotifications(),
        fetchPolicies(),
        fetchAuditEvents()
      ]);
      updateKPIs();
    } catch (err) {
      console.error('Error refreshing data:', err);
    }
  }

  function updateKPIs() {
    const totalRes = state.resources.length;
    const activeLoans = state.bookings.filter(b => b.status === 'in_use').length;
    const pendingReviews = state.bookings.filter(b => b.status === 'submitted').length;
    const openIncidents = state.incidents.filter(i => i.status === 'open').length;

    const elTotal = document.getElementById('kpiTotalResources');
    if (elTotal) elTotal.textContent = String(totalRes);

    const elActive = document.getElementById('kpiActiveLoans');
    if (elActive) elActive.textContent = String(activeLoans);

    const elPending = document.getElementById('kpiPendingReviews');
    if (elPending) elPending.textContent = String(pendingReviews);

    const elInc = document.getElementById('kpiOpenIncidents');
    if (elInc) elInc.textContent = String(openIncidents);

    // Tab Badges
    const myBookingsCount = state.bookings.filter(b => b.status !== 'completed' && b.status !== 'cancelled').length;
    const tabMy = document.getElementById('tabMyBookingsCount');
    if (tabMy) tabMy.textContent = String(myBookingsCount);

    const tabOwner = document.getElementById('tabOwnerDeskCount');
    if (tabOwner) tabOwner.textContent = String(pendingReviews);

    const pendingVerifs = state.verifications.filter(v => v.status === 'pending').length;
    const tabVer = document.getElementById('tabVerificationsCount');
    if (tabVer) tabVer.textContent = String(pendingVerifs);

    const tabInc = document.getElementById('tabIncidentsCount');
    if (tabInc) tabInc.textContent = String(openIncidents);

    const ownerPendingBadge = document.getElementById('ownerPendingBadge');
    if (ownerPendingBadge) ownerPendingBadge.textContent = `${pendingReviews} requests`;
  }

  // --- TAB 1: RESOURCES & DISCOVERY (FR-01, FR-02) ---
  async function fetchResources() {
    let url = `/api/resources?category=${encodeURIComponent(state.categoryFilter)}`;
    if (state.searchQuery) {
      url += `&search=${encodeURIComponent(state.searchQuery)}`;
    }
    const data = await api(url);
    state.resources = data.resources || [];
    renderResources();
    renderOwnerResources();
  }

  function renderResources() {
    const grid = document.getElementById('resourcesGrid');
    if (!grid) return;

    if (state.resources.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; color: var(--text-muted);">
          <i class="fa-solid fa-box-open" style="font-size: 40px; margin-bottom: 12px; color: var(--text-subtle);"></i>
          <h3>No matching resources available</h3>
          <p>Try adjusting your category filter or search keywords.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = state.resources.map(res => {
      let icon = 'fa-microchip';
      if (res.category === 'Media & Cameras') icon = 'fa-camera';
      else if (res.category === 'Workshop Tools') icon = 'fa-wrench';
      else if (res.category === 'Bookable Spaces') icon = 'fa-building-columns';
      else if (res.category === 'Lab Instruments') icon = 'fa-flask-vial';

      const requiresApprovalBadge = res.requires_approval
        ? '<span class="badge badge-warning"><i class="fa-solid fa-user-clock"></i> Approval Required</span>'
        : '<span class="badge badge-success"><i class="fa-solid fa-bolt"></i> Instant Booking</span>';

      const qualBadge = res.required_qualification
        ? `<span class="badge badge-primary"><i class="fa-solid fa-shield-halved"></i> Req: ${res.required_qualification.replace('_', ' ')}</span>`
        : '<span class="badge badge-secondary">Open Access</span>';

      return `
        <article class="resource-card" data-id="${res.id}">
          <div class="resource-card-top">
            <div class="resource-icon">
              <i class="fa-solid ${icon}"></i>
            </div>
            <div class="resource-meta">
              <h3 class="resource-title">${escapeHtml(res.name)}</h3>
              <div class="resource-location">
                <i class="fa-solid fa-location-dot"></i> ${escapeHtml(res.location)} • <span class="badge badge-secondary">${escapeHtml(res.asset_tag)}</span>
              </div>
            </div>
          </div>

          <p class="resource-desc">${escapeHtml(res.description)}</p>

          <div class="resource-tags">
            ${requiresApprovalBadge}
            ${qualBadge}
            <span class="badge badge-secondary"><i class="fa-solid fa-hourglass-half"></i> ${res.min_duration_hours}h - ${res.max_duration_hours}h</span>
          </div>

          <div class="resource-footer">
            <span class="resource-duration-limit">Custodian: ${escapeHtml(res.owner_name || 'Staff')}</span>
            <button class="primary-btn btn-sm book-resource-btn" data-id="${res.id}">
              <i class="fa-solid fa-calendar-check"></i> Reserve
            </button>
          </div>
        </article>
      `;
    }).join('');

    // Attach Reserve click listeners
    grid.querySelectorAll('.book-resource-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const resId = btn.getAttribute('data-id');
        openBookingModal(resId);
      });
    });
  }

  // Booking Modal Setup (FR-04, FR-05)
  function openBookingModal(resourceId) {
    const resource = state.resources.find(r => r.id === resourceId);
    if (!resource) return;

    state.selectedResourceForBooking = resource;

    document.getElementById('bookingResourceId').value = resource.id;
    document.getElementById('modalResourceName').textContent = resource.name;
    document.getElementById('modalResourceTag').textContent = resource.asset_tag;
    document.getElementById('modalMinMaxDuration').textContent = `${resource.min_duration_hours}h - ${resource.max_duration_hours}h`;
    document.getElementById('modalOperatingRules').textContent = resource.operating_rules || 'Standard institutional safety rules apply.';

    // Check Eligibility status for active user
    const banner = document.getElementById('bookingEligibilityBanner');
    const msg = document.getElementById('bookingEligibilityMsg');

    if (resource.required_qualification) {
      const userVer = state.verifications.find(v => v.user_id === state.currentUser?.id && v.requirement_type === resource.required_qualification);
      if (!userVer || userVer.status !== 'verified') {
        banner.className = 'alert-banner alert-warning';
        banner.classList.remove('hidden');
        msg.innerHTML = `<strong>Restricted Resource:</strong> Requires verified <em>${resource.required_qualification.replace('_', ' ')}</em>. Your status: <strong>${userVer ? userVer.status.toUpperCase() : 'NOT SUBMITTED'}</strong>. Booking will be blocked until verified by staff.`;
      } else {
        banner.className = 'alert-banner alert-success';
        banner.classList.remove('hidden');
        msg.innerHTML = `<strong>Eligible:</strong> Your <em>${resource.required_qualification.replace('_', ' ')}</em> qualification is verified and active.`;
      }
    } else {
      banner.classList.add('hidden');
    }

    // Default datetime values (Tomorrow 10:00 to 14:00)
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0);
    const tomorrowEnd = new Date(tomorrow.getTime() + 4 * 60 * 60 * 1000);

    const pad = (n) => String(n).padStart(2, '0');
    const toLocalISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

    document.getElementById('bookingStartTime').value = toLocalISO(tomorrow);
    document.getElementById('bookingEndTime').value = toLocalISO(tomorrowEnd);
    updateBookingDurationCalculation();

    openModal('bookingModal');
  }

  function updateBookingDurationCalculation() {
    const startVal = document.getElementById('bookingStartTime').value;
    const endVal = document.getElementById('bookingEndTime').value;
    const hint = document.getElementById('bookingDurationHint');
    if (!startVal || !endVal || !hint) return;

    const start = new Date(startVal);
    const end = new Date(endVal);
    if (end > start) {
      const diffHours = (end - start) / (1000 * 60 * 60);
      hint.innerHTML = `Estimated duration: <strong>${diffHours.toFixed(1)} hours</strong> (Allowed: <span id="modalMinMaxDuration">${state.selectedResourceForBooking?.min_duration_hours || 1}h - ${state.selectedResourceForBooking?.max_duration_hours || 24}h</span>)`;
    } else {
      hint.innerHTML = '<span class="text-danger">End time must be after start time!</span>';
    }
  }

  // --- TAB 2: MY BOOKINGS (FR-05, FR-08, FR-09, FR-10, FR-13) ---
  async function fetchBookings() {
    const data = await api('/api/bookings');
    state.bookings = data.bookings || [];
    renderBookings();
    renderOwnerRequests();
    renderOwnerHandoverQueue();
  }

  function renderBookings() {
    const container = document.getElementById('bookingsList');
    if (!container) return;

    const filtered = state.bookings.filter(b => {
      if (state.bookingStatusFilter === 'all') return true;
      return b.status === state.bookingStatusFilter;
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="text-align: center; padding: 48px 20px; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
          <i class="fa-solid fa-calendar-xmark" style="font-size: 36px; color: var(--text-subtle); margin-bottom: 12px;"></i>
          <h3>No bookings found</h3>
          <p class="text-muted">You have no reservations matching the "${state.bookingStatusFilter}" status filter.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(b => {
      let statusBadge = '<span class="badge badge-warning">Pending Review</span>';
      if (b.status === 'approved') statusBadge = '<span class="badge badge-success"><i class="fa-solid fa-check"></i> Approved</span>';
      else if (b.status === 'in_use') statusBadge = '<span class="badge badge-primary"><i class="fa-solid fa-dolly"></i> In Use</span>';
      else if (b.status === 'waitlisted') statusBadge = `<span class="badge badge-warning"><i class="fa-solid fa-clock"></i> Waitlist #${b.waitlist_position || 1}</span>`;
      else if (b.status === 'completed') statusBadge = '<span class="badge badge-secondary"><i class="fa-solid fa-flag-checkered"></i> Completed</span>';
      else if (b.status === 'rejected') statusBadge = '<span class="badge badge-danger"><i class="fa-solid fa-xmark"></i> Rejected</span>';
      else if (b.status === 'cancelled') statusBadge = '<span class="badge badge-secondary">Cancelled</span>';
      else if (b.status === 'disputed') statusBadge = '<span class="badge badge-danger"><i class="fa-solid fa-triangle-exclamation"></i> Disputed / Damaged</span>';

      const isCurrentRequester = b.requester_id === state.currentUser?.id;
      const isOwner = b.owner_id === state.currentUser?.id;
      const isStaffOrAdmin = state.currentUser?.role === 'manager' || state.currentUser?.role === 'admin';

      // Action buttons
      let actionButtons = '';
      if (b.status === 'approved' && (isCurrentRequester || isOwner || isStaffOrAdmin)) {
        actionButtons += `
          <button class="primary-btn btn-success btn-sm btn-action-pickup" data-id="${b.id}">
            <i class="fa-solid fa-box-open"></i> Record Pickup
          </button>
        `;
      }

      if (b.status === 'in_use' && (isCurrentRequester || isOwner || isStaffOrAdmin)) {
        actionButtons += `
          <button class="primary-btn btn-sm btn-action-return" data-id="${b.id}">
            <i class="fa-solid fa-rotate-left"></i> Confirm Return
          </button>
        `;
      }

      if ((b.status === 'submitted' || b.status === 'approved' || b.status === 'waitlisted') && (isCurrentRequester || isStaffOrAdmin)) {
        actionButtons += `
          <button class="secondary-btn btn-sm btn-action-cancel text-danger" data-id="${b.id}">
            <i class="fa-solid fa-ban"></i> Cancel
          </button>
        `;
      }

      return `
        <article class="booking-card">
          <div class="booking-info">
            <div class="booking-header-row">
              <h4 class="booking-title">${escapeHtml(b.resource_name)}</h4>
              ${statusBadge}
              <span class="badge badge-secondary">${escapeHtml(b.asset_tag)}</span>
            </div>

            <div class="booking-details-row">
              <span><i class="fa-solid fa-calendar"></i> ${formatDate(b.start_time)} → ${formatDate(b.end_time)}</span>
              <span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(b.resource_location)}</span>
              <span><i class="fa-solid fa-user"></i> Requester: ${escapeHtml(b.requester_name)} (${escapeHtml(b.requester_dept)})</span>
            </div>

            <div class="booking-details-row mt-2">
              <span><strong>Purpose:</strong> ${escapeHtml(b.purpose)}</span>
            </div>

            ${b.decision_reason ? `
              <div class="booking-reason">
                <strong>Custodian Note:</strong> ${escapeHtml(b.decision_reason)}
              </div>
            ` : ''}
          </div>

          <div class="booking-actions">
            ${actionButtons}
          </div>
        </article>
      `;
    }).join('');

    // Attach Action Listeners
    container.querySelectorAll('.btn-action-pickup').forEach(btn => {
      btn.addEventListener('click', () => openPickupModal(btn.getAttribute('data-id')));
    });

    container.querySelectorAll('.btn-action-return').forEach(btn => {
      btn.addEventListener('click', () => openReturnModal(btn.getAttribute('data-id')));
    });

    container.querySelectorAll('.btn-action-cancel').forEach(btn => {
      btn.addEventListener('click', () => cancelBooking(btn.getAttribute('data-id')));
    });
  }

  // --- TAB 3: OWNER DESK & QUEUES (FR-01, FR-06, FR-09, FR-10, FR-17) ---
  function renderOwnerRequests() {
    const container = document.getElementById('ownerRequestsList');
    if (!container) return;

    const pending = state.bookings.filter(b => b.status === 'submitted');

    if (pending.length === 0) {
      container.innerHTML = `
        <div style="padding: 32px; text-align: center; color: var(--text-muted);">
          <i class="fa-solid fa-circle-check text-success" style="font-size: 28px; margin-bottom: 8px;"></i>
          <p>No pending booking requests requiring custodian approval.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Resource</th>
            <th>Requester</th>
            <th>Requested Window</th>
            <th>Purpose</th>
            <th>Submitted</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${pending.map(b => `
            <tr>
              <td><strong>${escapeHtml(b.resource_name)}</strong><br><small class="text-muted">${escapeHtml(b.asset_tag)}</small></td>
              <td>${escapeHtml(b.requester_name)}<br><small class="text-muted">${escapeHtml(b.requester_dept)}</small></td>
              <td>${formatDate(b.start_time)}<br><small class="text-muted">to ${formatDate(b.end_time)}</small></td>
              <td>${escapeHtml(b.purpose)}</td>
              <td>${formatDate(b.created_at)}</td>
              <td>
                <button class="primary-btn btn-sm btn-review-booking" data-id="${b.id}">
                  <i class="fa-solid fa-gavel"></i> Review & Decide
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    container.querySelectorAll('.btn-review-booking').forEach(btn => {
      btn.addEventListener('click', () => openDecisionModal(btn.getAttribute('data-id')));
    });
  }

  function renderOwnerHandoverQueue() {
    const container = document.getElementById('ownerHandoverList');
    if (!container) return;

    // Items that are either ready for pickup ('approved') or ready for return ('in_use')
    const activeOps = state.bookings.filter(b => b.status === 'approved' || b.status === 'in_use');

    if (activeOps.length === 0) {
      container.innerHTML = `
        <div style="padding: 32px; text-align: center; color: var(--text-muted);">
          <i class="fa-solid fa-clipboard-check text-muted" style="font-size: 28px; margin-bottom: 8px;"></i>
          <p>No pending handovers or returns at this time.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Resource & Tag</th>
            <th>Borrower</th>
            <th>Interval</th>
            <th>Current Stage</th>
            <th>Next Action</th>
          </tr>
        </thead>
        <tbody>
          ${activeOps.map(b => {
            const isApproved = b.status === 'approved';
            const actionBtn = isApproved
              ? `<button class="primary-btn btn-success btn-sm btn-action-pickup" data-id="${b.id}"><i class="fa-solid fa-dolly"></i> Record Pickup</button>`
              : `<button class="primary-btn btn-sm btn-action-return" data-id="${b.id}"><i class="fa-solid fa-rotate-left"></i> Confirm Return</button>`;

            return `
              <tr>
                <td><strong>${escapeHtml(b.resource_name)}</strong><br><span class="badge badge-secondary">${escapeHtml(b.asset_tag)}</span></td>
                <td>${escapeHtml(b.requester_name)} (${escapeHtml(b.requester_email)})</td>
                <td>${formatDate(b.start_time)} → ${formatDate(b.end_time)}</td>
                <td>${isApproved ? '<span class="badge badge-warning">Awaiting Pickup</span>' : '<span class="badge badge-primary">In Use (On Loan)</span>'}</td>
                <td>${actionBtn}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;

    container.querySelectorAll('.btn-action-pickup').forEach(btn => {
      btn.addEventListener('click', () => openPickupModal(btn.getAttribute('data-id')));
    });

    container.querySelectorAll('.btn-action-return').forEach(btn => {
      btn.addEventListener('click', () => openReturnModal(btn.getAttribute('data-id')));
    });
  }

  function renderOwnerResources() {
    const container = document.getElementById('ownerResourcesTable');
    if (!container) return;

    if (state.resources.length === 0) {
      container.innerHTML = '<p class="text-muted" style="padding: 20px;">No resources registered.</p>';
      return;
    }

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Name & Tag</th>
            <th>Category</th>
            <th>Location</th>
            <th>Required Training</th>
            <th>Approval Mode</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${state.resources.map(r => `
            <tr>
              <td><strong>${escapeHtml(r.name)}</strong><br><span class="badge badge-secondary">${escapeHtml(r.asset_tag)}</span></td>
              <td>${escapeHtml(r.category)}</td>
              <td>${escapeHtml(r.location)}</td>
              <td>${r.required_qualification ? `<span class="badge badge-primary">${escapeHtml(r.required_qualification)}</span>` : '<span class="text-muted">None</span>'}</td>
              <td>${r.requires_approval ? '<span class="badge badge-warning">Review Required</span>' : '<span class="badge badge-success">Instant</span>'}</td>
              <td><span class="badge badge-success">${escapeHtml(r.status)}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // --- DECISION DIALOG (FR-06) ---
  function openDecisionModal(bookingId) {
    const booking = state.bookings.find(b => b.id === bookingId);
    if (!booking) return;

    document.getElementById('decisionBookingIdInput').value = booking.id;
    document.getElementById('decisionBookingId').textContent = booking.id;
    document.getElementById('decisionResourceTitle').textContent = `${booking.resource_name} (${booking.asset_tag})`;
    document.getElementById('decisionRequesterTitle').textContent = `${booking.requester_name} (${booking.requester_dept})`;
    document.getElementById('decisionTimeWindow').textContent = `${formatDate(booking.start_time)} to ${formatDate(booking.end_time)}`;
    document.getElementById('decisionPurpose').textContent = booking.purpose;
    document.getElementById('decisionReason').value = 'Approved for academic/lab project.';

    openModal('decisionModal');
  }

  // --- PICKUP & RETURN INSPECTION WORKFLOWS (FR-09, FR-10, FR-11) ---
  function openPickupModal(bookingId) {
    const booking = state.bookings.find(b => b.id === bookingId);
    if (!booking) return;

    document.getElementById('pickupBookingId').value = booking.id;
    document.getElementById('pickupItemTitle').textContent = booking.resource_name;
    document.getElementById('pickupAssetTag').textContent = booking.asset_tag;
    document.getElementById('pickupBorrowerTitle').textContent = `${booking.requester_name} (${booking.requester_email})`;
    document.getElementById('pickupNotes').value = 'Handover verified operational and clean with case.';

    openModal('pickupModal');
  }

  function openReturnModal(bookingId) {
    const booking = state.bookings.find(b => b.id === bookingId);
    if (!booking) return;

    document.getElementById('returnBookingId').value = booking.id;
    document.getElementById('returnItemTitle').textContent = `${booking.resource_name} (${booking.asset_tag})`;
    document.getElementById('returnBorrowerTitle').textContent = booking.requester_name;
    document.getElementById('returnNotes').value = 'Returned in good order. Self-test passed.';
    document.getElementById('returnIncidentFlag').checked = false;
    document.getElementById('returnIncidentDetails').classList.add('hidden');

    openModal('returnModal');
  }

  async function cancelBooking(bookingId) {
    if (!confirm('Are you sure you want to cancel this booking? If there is an active waiting list, the next eligible requester will be promoted.')) {
      return;
    }

    try {
      const res = await api(`/api/bookings/${bookingId}/cancel`, {
        method: 'POST',
        body: { reason: 'User cancellation' }
      });

      showToast(res.message, 'success');
      await refreshAllData();
    } catch (err) {
      showToast('Cancellation failed: ' + err.message, 'error');
    }
  }

  // --- TAB 4: STAFF VERIFICATIONS & ELIGIBILITY (FR-03, FR-04) ---
  async function fetchVerifications() {
    const data = await api('/api/verifications');
    state.verifications = data.verifications || [];
    renderVerifications();
  }

  function renderVerifications() {
    const container = document.getElementById('verificationsTable');
    if (!container) return;

    if (state.verifications.length === 0) {
      container.innerHTML = '<p class="text-muted" style="padding: 24px; text-align: center;">No qualification records found.</p>';
      return;
    }

    const isStaffOrAdmin = state.currentUser?.role === 'manager' || state.currentUser?.role === 'admin';

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Qualification Standard</th>
            <th>Evidence / Certificate Ref</th>
            <th>Status</th>
            <th>Expiry Date</th>
            <th>Notes / Auditor</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${state.verifications.map(v => {
            let statusBadge = '<span class="badge badge-warning">Pending Review</span>';
            if (v.status === 'verified') statusBadge = '<span class="badge badge-success"><i class="fa-solid fa-check"></i> Verified</span>';
            else if (v.status === 'rejected') statusBadge = '<span class="badge badge-danger"><i class="fa-solid fa-xmark"></i> Rejected</span>';
            else if (v.status === 'expired') statusBadge = '<span class="badge badge-secondary">Expired</span>';

            const canDecide = isStaffOrAdmin && v.status === 'pending';
            const actionBtn = canDecide
              ? `<button class="primary-btn btn-sm btn-audit-qual" data-id="${v.id}"><i class="fa-solid fa-stamp"></i> Audit</button>`
              : '<span class="text-muted">-</span>';

            return `
              <tr>
                <td><strong>${escapeHtml(v.user_name || 'User')}</strong><br><small class="text-muted">${escapeHtml(v.user_email || '')}</small></td>
                <td><strong>${escapeHtml(v.requirement_name)}</strong><br><small class="text-muted">${escapeHtml(v.requirement_type)}</small></td>
                <td><span class="badge badge-secondary">${escapeHtml(v.evidence_ref || 'DOC-PENDING')}</span></td>
                <td>${statusBadge}</td>
                <td>${v.expires_at ? formatDate(v.expires_at) : '<span class="text-muted">N/A</span>'}</td>
                <td>${escapeHtml(v.notes || '-')} ${v.verifier_name ? `<br><small class="text-muted">by ${escapeHtml(v.verifier_name)}</small>` : ''}</td>
                <td>${actionBtn}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;

    container.querySelectorAll('.btn-audit-qual').forEach(btn => {
      btn.addEventListener('click', () => openReviewQualModal(btn.getAttribute('data-id')));
    });
  }

  function openReviewQualModal(verId) {
    const ver = state.verifications.find(v => v.id === verId);
    if (!ver) return;

    document.getElementById('reviewQualIdInput').value = ver.id;
    document.getElementById('reviewQualIdBadge').textContent = ver.id;
    document.getElementById('reviewQualUserName').textContent = `${ver.user_name} (${ver.user_email})`;
    document.getElementById('reviewQualName').textContent = ver.requirement_name;
    document.getElementById('reviewQualDocRef').textContent = ver.evidence_ref || 'N/A';
    document.getElementById('reviewQualNotes').value = 'Audited against campus safety credentials database.';

    openModal('reviewQualModal');
  }

  // --- TAB 5: INCIDENTS & DISPUTES (FR-12) ---
  async function fetchIncidents() {
    const data = await api('/api/incidents');
    state.incidents = data.incidents || [];
    renderIncidents();
  }

  function renderIncidents() {
    const container = document.getElementById('incidentsTable');
    if (!container) return;

    if (state.incidents.length === 0) {
      container.innerHTML = `
        <div style="padding: 32px; text-align: center; color: var(--text-muted);">
          <i class="fa-solid fa-circle-check text-success" style="font-size: 28px; margin-bottom: 8px;"></i>
          <p>No active damage reports or equipment disputes recorded.</p>
        </div>
      `;
      return;
    }

    const isStaffOrOwner = state.currentUser?.role === 'manager' || state.currentUser?.role === 'admin' || state.currentUser?.role === 'owner';

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Resource</th>
            <th>Type & Severity</th>
            <th>Description</th>
            <th>Reported By</th>
            <th>Status</th>
            <th>Resolution</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${state.incidents.map(inc => {
            const isResolved = inc.status === 'resolved';
            const statusBadge = isResolved
              ? '<span class="badge badge-success"><i class="fa-solid fa-check"></i> Resolved</span>'
              : '<span class="badge badge-danger"><i class="fa-solid fa-circle-exclamation"></i> Open</span>';

            const canResolve = isStaffOrOwner && !isResolved;
            const actionBtn = canResolve
              ? `<button class="secondary-btn btn-sm text-danger btn-resolve-inc" data-id="${inc.id}"><i class="fa-solid fa-wrench"></i> Resolve</button>`
              : '<span class="text-muted">-</span>';

            return `
              <tr>
                <td><strong>${escapeHtml(inc.resource_name)}</strong><br><small class="text-muted">${escapeHtml(inc.asset_tag)}</small></td>
                <td>
                  <span class="badge badge-danger">${escapeHtml(inc.type)}</span>
                  <span class="badge badge-secondary">${escapeHtml(inc.severity)}</span>
                </td>
                <td>${escapeHtml(inc.description)}</td>
                <td>${escapeHtml(inc.reporter_name)}<br><small class="text-muted">${formatDate(inc.created_at)}</small></td>
                <td>${statusBadge}</td>
                <td>${inc.resolution_notes ? escapeHtml(inc.resolution_notes) : '<span class="text-muted">Under investigation</span>'}</td>
                <td>${actionBtn}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;

    container.querySelectorAll('.btn-resolve-inc').forEach(btn => {
      btn.addEventListener('click', () => openResolveIncidentModal(btn.getAttribute('data-id')));
    });
  }

  function openResolveIncidentModal(incId) {
    const inc = state.incidents.find(i => i.id === incId);
    if (!inc) return;

    document.getElementById('resolveIncidentIdInput').value = inc.id;
    document.getElementById('resolveIncidentBadge').textContent = inc.id;
    document.getElementById('resolveIncResource').textContent = `${inc.resource_name} (${inc.asset_tag})`;
    document.getElementById('resolveIncReporter').textContent = inc.reporter_name;
    document.getElementById('resolveIncType').textContent = inc.type.toUpperCase();
    document.getElementById('resolveIncDescription').textContent = inc.description;
    document.getElementById('resolveIncNotes').value = 'Inspected and repaired by lab technician.';

    openModal('resolveIncidentModal');
  }

  // --- TAB 6: AUDIT TRAIL & POLICIES (FR-08, FR-15, FR-16) ---
  async function fetchAuditEvents() {
    const data = await api('/api/audit');
    state.auditEvents = data.events || [];
    renderAuditEvents();
  }

  function renderAuditEvents() {
    const container = document.getElementById('auditTable');
    if (!container) return;

    if (state.auditEvents.length === 0) {
      container.innerHTML = '<p class="text-muted" style="padding: 20px;">No audit events recorded.</p>';
      return;
    }

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Actor</th>
            <th>Role</th>
            <th>Action</th>
            <th>Target</th>
            <th>Outcome</th>
            <th>Reason / Details</th>
          </tr>
        </thead>
        <tbody>
          ${state.auditEvents.map(evt => {
            const outcomeBadge = evt.outcome === 'success'
              ? '<span class="badge badge-success">Success</span>'
              : (evt.outcome === 'denied' ? '<span class="badge badge-danger">Denied</span>' : '<span class="badge badge-warning">Conflict</span>');

            return `
              <tr>
                <td><small>${formatDate(evt.created_at)}</small></td>
                <td><strong>${escapeHtml(evt.actor_name)}</strong></td>
                <td><span class="badge badge-secondary">${escapeHtml(evt.actor_role)}</span></td>
                <td><code>${escapeHtml(evt.action)}</code></td>
                <td>${escapeHtml(evt.target_type)}:${escapeHtml(evt.target_id)}</td>
                <td>${outcomeBadge}</td>
                <td>${escapeHtml(evt.reason || '-')} ${evt.details ? `<br><small class="text-muted">${escapeHtml(evt.details)}</small>` : ''}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  async function fetchPolicies() {
    const data = await api('/api/policies');
    state.policies = data.policies || [];
    renderPolicies();
  }

  function renderPolicies() {
    const container = document.getElementById('policiesGrid');
    if (!container) return;

    container.innerHTML = state.policies.map(p => `
      <div class="policy-card">
        <span class="policy-title">${escapeHtml(p.key.replace(/_/g, ' '))}</span>
        <p class="policy-desc">${escapeHtml(p.description)}</p>
        <div class="policy-value-row">
          <span class="policy-val">${escapeHtml(p.value)}</span>
          <span class="badge badge-secondary">Active Policy</span>
        </div>
      </div>
    `).join('');
  }

  // --- NOTIFICATIONS (FR-14) ---
  async function fetchNotifications() {
    const data = await api('/api/notifications');
    state.notifications = data.notifications || [];
    const unreadCount = state.notifications.filter(n => !n.is_read).length;

    const badge = document.getElementById('notifBadge');
    if (badge) {
      badge.textContent = String(unreadCount);
      badge.style.display = unreadCount > 0 ? 'flex' : 'none';
    }
  }

  function renderNotificationsModal() {
    const list = document.getElementById('notificationsList');
    if (!list) return;

    if (state.notifications.length === 0) {
      list.innerHTML = '<p class="text-muted" style="padding: 24px; text-align: center;">No notifications.</p>';
      return;
    }

    list.innerHTML = state.notifications.map(n => `
      <div class="notif-item ${n.is_read ? '' : 'unread'}">
        <div class="notif-title">${escapeHtml(n.title)}</div>
        <div class="notif-msg">${escapeHtml(n.message)}</div>
        <div class="notif-time">${formatDate(n.created_at)}</div>
      </div>
    `).join('');
  }

  // --- EVENT LISTENERS & FORM SUBMISSIONS ---
  function setupEventListeners() {
    // 1. Persona Switcher
    const personaSelect = document.getElementById('personaSelect');
    if (personaSelect) {
      personaSelect.addEventListener('change', (e) => {
        switchPersona(e.target.value);
      });
    }

    // 2. Navigation Tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const targetView = tab.getAttribute('data-tab');
        switchTab(targetView);
      });
    });

    // 3. Status Filters on My Bookings
    document.querySelectorAll('#bookingStatusFilters .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#bookingStatusFilters .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.bookingStatusFilter = chip.getAttribute('data-filter') || 'all';
        renderBookings();
      });
    });

    // 4. Resource Search & Category Filters
    const searchInput = document.getElementById('resourceSearchInput');
    if (searchInput) {
      let debounceTimer;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          state.searchQuery = e.target.value.trim();
          fetchResources();
        }, 250);
      });
    }

    const catFilter = document.getElementById('categoryFilter');
    if (catFilter) {
      catFilter.addEventListener('change', (e) => {
        state.categoryFilter = e.target.value;
        fetchResources();
      });
    }

    // 5. Booking Form Submission (FR-05)
    const bookingForm = document.getElementById('bookingForm');
    if (bookingForm) {
      document.getElementById('bookingStartTime').addEventListener('change', updateBookingDurationCalculation);
      document.getElementById('bookingEndTime').addEventListener('change', updateBookingDurationCalculation);

      bookingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const resId = document.getElementById('bookingResourceId').value;
        const startTime = document.getElementById('bookingStartTime').value;
        const endTime = document.getElementById('bookingEndTime').value;
        const purpose = document.getElementById('bookingPurpose').value.trim();

        try {
          const res = await api('/api/bookings', {
            method: 'POST',
            body: {
              resource_id: resId,
              start_time: new Date(startTime).toISOString(),
              end_time: new Date(endTime).toISOString(),
              purpose
            }
          });

          closeModal('bookingModal');
          showToast(res.message, res.status === 'waitlisted' ? 'warning' : 'success');
          await refreshAllData();
          switchTab('bookings');

        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    // 6. Custodian Decision Form Submission (FR-06)
    const decisionForm = document.getElementById('decisionForm');
    if (decisionForm) {
      decisionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const bookingId = document.getElementById('decisionBookingIdInput').value;
        const decision = document.querySelector('input[name="bookingDecision"]:checked').value;
        const reason = document.getElementById('decisionReason').value.trim();

        try {
          const res = await api(`/api/bookings/${bookingId}/decide`, {
            method: 'POST',
            body: { decision, reason }
          });

          closeModal('decisionModal');
          showToast(res.message, 'success');
          await refreshAllData();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    // 7. Pickup Inspection Form Submission (FR-09, FR-11)
    const pickupForm = document.getElementById('pickupForm');
    if (pickupForm) {
      pickupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const bookingId = document.getElementById('pickupBookingId').value;
        const clean = document.getElementById('pickupCleanCheck').checked;
        const oper = document.getElementById('pickupOperationalCheck').checked;
        const acc = document.getElementById('pickupAccessoriesCheck').checked;
        const rating = document.getElementById('pickupConditionRating').value;
        const notes = document.getElementById('pickupNotes').value.trim();

        try {
          const res = await api('/api/handover/pickup', {
            method: 'POST',
            body: {
              booking_id: bookingId,
              condition_rating: rating,
              checklist_clean: clean,
              checklist_operational: oper,
              checklist_accessories_intact: acc,
              notes
            }
          });

          closeModal('pickupModal');
          showToast(res.message, 'success');
          await refreshAllData();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    // 8. Return Inspection Form Submission (FR-10, FR-11, FR-12)
    const returnForm = document.getElementById('returnForm');
    if (returnForm) {
      const incFlag = document.getElementById('returnIncidentFlag');
      const incDetails = document.getElementById('returnIncidentDetails');
      if (incFlag && incDetails) {
        incFlag.addEventListener('change', () => {
          incDetails.classList.toggle('hidden', !incFlag.checked);
        });
      }

      returnForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const bookingId = document.getElementById('returnBookingId').value;
        const clean = document.getElementById('returnCleanCheck').checked;
        const oper = document.getElementById('returnOperationalCheck').checked;
        const acc = document.getElementById('returnAccessoriesCheck').checked;
        const rating = document.getElementById('returnConditionRating').value;
        const notes = document.getElementById('returnNotes').value.trim();
        const flagIncident = document.getElementById('returnIncidentFlag').checked;
        const incDesc = document.getElementById('returnIncidentDescription').value.trim();

        try {
          const res = await api('/api/handover/return', {
            method: 'POST',
            body: {
              booking_id: bookingId,
              condition_rating: rating,
              checklist_clean: clean,
              checklist_operational: oper,
              checklist_accessories_intact: acc,
              notes,
              flag_incident: flagIncident,
              incident_description: incDesc
            }
          });

          closeModal('returnModal');
          showToast(res.message, flagIncident ? 'warning' : 'success');
          await refreshAllData();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    // 9. Create Resource Form (FR-01, FR-17)
    const openResBtn = document.getElementById('openNewResourceBtn');
    const addOwnerResBtn = document.getElementById('addResourceFromOwnerBtn');
    if (openResBtn) openResBtn.addEventListener('click', () => openModal('resourceModal'));
    if (addOwnerResBtn) addOwnerResBtn.addEventListener('click', () => openModal('resourceModal'));

    const resourceForm = document.getElementById('resourceForm');
    if (resourceForm) {
      resourceForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {
          name: document.getElementById('resNameInput').value.trim(),
          category: document.getElementById('resCategoryInput').value,
          location: document.getElementById('resLocationInput').value.trim(),
          asset_tag: document.getElementById('resAssetTagInput').value.trim(),
          description: document.getElementById('resDescriptionInput').value.trim(),
          min_duration_hours: parseInt(document.getElementById('resMinHoursInput').value, 10),
          max_duration_hours: parseInt(document.getElementById('resMaxHoursInput').value, 10),
          required_qualification: document.getElementById('resQualInput').value || null,
          operating_rules: document.getElementById('resOperatingRulesInput').value.trim(),
          requires_approval: document.getElementById('resRequiresApprovalInput').checked ? 1 : 0,
          supervision_required: document.getElementById('resSupervisionInput').checked ? 1 : 0
        };

        try {
          const res = await api('/api/resources', { method: 'POST', body });
          closeModal('resourceModal');
          showToast(res.message, 'success');
          resourceForm.reset();
          await fetchResources();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    // 10. Qualification Submit & Review Forms (FR-03, FR-04)
    const submitQualBtn = document.getElementById('submitQualificationBtn');
    if (submitQualBtn) submitQualBtn.addEventListener('click', () => openModal('qualificationModal'));

    const qualForm = document.getElementById('qualificationForm');
    if (qualForm) {
      qualForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const type = document.getElementById('qualTypeSelect').value;
        const name = document.getElementById('qualTypeSelect').selectedOptions[0].text;
        const ref = document.getElementById('qualEvidenceRef').value.trim();
        const notes = document.getElementById('qualNotes').value.trim();

        try {
          const res = await api('/api/verifications', {
            method: 'POST',
            body: { requirement_type: type, requirement_name: name, evidence_ref: ref, notes }
          });
          closeModal('qualificationModal');
          showToast(res.message, 'success');
          await fetchVerifications();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    const reviewQualForm = document.getElementById('reviewQualForm');
    if (reviewQualForm) {
      reviewQualForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const verId = document.getElementById('reviewQualIdInput').value;
        const decision = document.querySelector('input[name="qualDecision"]:checked').value;
        const notes = document.getElementById('reviewQualNotes').value.trim();

        try {
          const res = await api(`/api/verifications/${verId}/review`, {
            method: 'POST',
            body: { decision, notes }
          });
          closeModal('reviewQualModal');
          showToast(res.message, 'success');
          await fetchVerifications();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    // 11. Resolve Incident Form (FR-12)
    const resolveIncForm = document.getElementById('resolveIncidentForm');
    if (resolveIncForm) {
      resolveIncForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const incId = document.getElementById('resolveIncidentIdInput').value;
        const status = document.getElementById('resolveIncStatus').value;
        const notes = document.getElementById('resolveIncNotes').value.trim();

        try {
          const res = await api(`/api/incidents/${incId}/resolve`, {
            method: 'POST',
            body: { status, resolution_notes: notes }
          });
          closeModal('resolveIncidentModal');
          showToast(res.message, 'success');
          await fetchIncidents();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    // 12. Notifications Modal
    const notifBtn = document.getElementById('notifBellBtn');
    if (notifBtn) {
      notifBtn.addEventListener('click', () => {
        renderNotificationsModal();
        openModal('notificationsModal');
      });
    }

    const markAllReadBtn = document.getElementById('markAllNotifsReadBtn');
    if (markAllReadBtn) {
      markAllReadBtn.addEventListener('click', async () => {
        try {
          await api('/api/notifications/read-all', { method: 'POST' });
          await fetchNotifications();
          renderNotificationsModal();
        } catch (err) {
          console.error(err);
        }
      });
    }

    // 13. Audit Refresh Button
    const refreshAuditBtn = document.getElementById('refreshAuditBtn');
    if (refreshAuditBtn) {
      refreshAuditBtn.addEventListener('click', fetchAuditEvents);
    }

    // 14. Theme Toggle
    const themeBtn = document.getElementById('themeToggle');
    const themeIcon = document.getElementById('themeIcon');
    const savedTheme = localStorage.getItem('equipshare_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    if (themeIcon) {
      themeIcon.className = savedTheme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }

    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('equipshare_theme', next);
        if (themeIcon) {
          themeIcon.className = next === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
        }
      });
    }

    // 15. Generic Modal Close Listeners (Backdrop & close buttons)
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.getAttribute('data-close');
        closeModal(modalId);
      });
    });

    document.querySelectorAll('.modal-backdrop').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          closeModal(modal.id);
        }
      });
    });
  }

  function switchTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll('.nav-tab').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-tab') === tabName);
    });

    document.querySelectorAll('.tab-view').forEach(view => {
      view.classList.toggle('active', view.id === `view-${tabName}`);
    });
  }

  // Entry Point
  document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    initAuth();
  });

})();
